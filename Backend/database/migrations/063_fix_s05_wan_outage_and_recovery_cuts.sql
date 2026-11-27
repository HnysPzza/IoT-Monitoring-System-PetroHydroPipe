-- Preserve valid S-05 output pulses across same-boot ISP WAN outages where
-- S-05 retries early machine_offline rejections or S-03 stops rotating between
-- recovery Heartbeat #1 and Heartbeat #2.
-- Advances backend readiness schema version to 63.

begin;

alter table public.sensor_watchdog_state
  add column if not exists recovery_activity_observed boolean not null default false;

create or replace function public.ingest_iot_grouped_sensor_event(
  p_device_event_id uuid,
  p_sensor_id uuid,
  p_machine_id uuid,
  p_event_type text,
  p_event_value jsonb,
  p_recorded_at timestamptz
)
returns table (
  sensor_event_id uuid, device_event_id uuid, event_type text, event_value jsonb,
  recorded_at timestamptz, duplicate boolean, stale boolean, state_applied boolean,
  previous_machine_status text, new_machine_status text, downtime_action text,
  downtime_id uuid, downtime_started_at timestamptz, downtime_ended_at timestamptz,
  downtime_duration_seconds integer, downtime_cause text, alert_action text,
  alert_record jsonb, downtime_sensor_code text, transition_descriptors jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sensor public.sensors%rowtype;
  v_machine public.machines%rowtype;
  v_s03 public.sensors%rowtype;
  v_s03_watchdog public.sensor_watchdog_state%rowtype;
  v_existing public.sensor_events%rowtype;
  v_event public.sensor_events%rowtype;
  v_promoting_existing boolean := false;
  v_last_output_at timestamptz;
  v_prev_conn_state text;
  v_prev_conn_at timestamptz;
  v_is_same_boot_running_outage boolean := false;
  v_output_accepted boolean;
  v_output_rejection_reason text;
  v_result_event_value jsonb;
  v_absence_enabled boolean := false;
  v_is_eligible boolean := true;
  v_is_device_absence_fault boolean := false;
  v_is_device_running boolean := false;
  v_effective_event_type text;
  v_effective_signal text;
  v_is_after_hours_device_recovery boolean := false;
  v_was_fault boolean := false;
  v_process_alert record;
  v_reconciliation record;
  v_alert_action text;
  v_alert_record jsonb;
  v_transition_descriptors jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_event_value->'metadata') = 'object'
    and p_event_value->'metadata' ?| array['outputAccepted', 'outputRejectionReason'] then
    raise exception using errcode = '22023', message = 'Sensor event metadata uses server-reserved keys.';
  end if;
  if p_event_type not in ('pulse', 'idle', 'fault', 'recovered') then
    raise exception using errcode = '22023', message = 'Unsupported grouped sensor event type.';
  end if;
  if not (
    (p_event_type in ('pulse', 'recovered') and p_event_value->>'signal' = 'active')
    or (p_event_type = 'idle' and p_event_value->>'signal' = 'idle')
    or (p_event_type = 'fault' and p_event_value->>'signal' = 'fault')
  ) then
    raise exception using errcode = '22023', message = 'Signal does not match sensor event type.';
  end if;
  if p_recorded_at is null or p_recorded_at < '2026-05-01T00:00:00+08:00'::timestamptz then
    raise exception using errcode = '22023', message = 'Sensor event timestamp is too far in the past.';
  end if;
  if p_recorded_at > clock_timestamp() + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'Sensor event timestamp is too far in the future.';
  end if;

  select sensor.* into v_sensor
  from public.sensors sensor
  where sensor.id = p_sensor_id and sensor.machine_id = p_machine_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'Sensor is not assigned to the supplied machine.';
  end if;
  if v_sensor.sensor_code not in ('S-01', 'S-02', 'S-03', 'S-04', 'S-05') then
    raise exception using errcode = '22023', message = 'Sensor is not part of the grouped downtime rule.';
  end if;
  if v_sensor.sensor_code = 'S-05' and p_event_type = 'fault' then
    raise exception using errcode = '22023', message = 'S-05 faults must use observational ingestion.';
  end if;

  select machine.* into v_machine
  from public.machines machine where machine.id = p_machine_id for update;
  if not found then raise exception using errcode = '23503', message = 'Machine was not found.'; end if;

  select coalesce((settings.sensor_thresholds->v_sensor.sensor_code->>'absenceDetectionEnabled')::boolean, false)
    and v_sensor.sensor_code <> 'S-05'
  into v_absence_enabled
  from public.machine_operational_settings settings
  where settings.machine_id = p_machine_id;
  v_absence_enabled := coalesce(v_absence_enabled, false);
  v_is_device_absence_fault := v_sensor.sensor_code in ('S-01', 'S-02', 'S-03', 'S-04')
    and p_event_type = 'fault'
    and coalesce(p_event_value->'metadata'->>'detectionState' = 'FAULT', false);
  v_is_device_running := v_sensor.sensor_code in ('S-01', 'S-02', 'S-03', 'S-04')
    and p_event_type in ('pulse', 'recovered')
    and coalesce(p_event_value->'metadata'->>'detectionState' = 'RUNNING', false);

  if (v_is_device_absence_fault and v_absence_enabled)
    or (v_is_device_running and (v_sensor.status = 'Fault' or v_sensor.fault_source is not null)) then
    v_is_eligible := public.watchdog_eligible_seconds(
      p_machine_id,
      p_recorded_at,
      p_recorded_at + interval '1 second'
    ) = 1;
  end if;

  v_effective_event_type := case
    when v_is_device_absence_fault and (not v_absence_enabled or not v_is_eligible)
      then 'idle'
    else p_event_type
  end;
  v_effective_signal := case
    when v_effective_event_type = 'idle' then 'idle'
    else p_event_value->>'signal'
  end;
  v_is_after_hours_device_recovery := v_is_device_running and not v_is_eligible;

  select event.* into v_existing
  from public.sensor_events event
  where event.sensor_id = p_sensor_id and event.device_event_id = p_device_event_id;
  if found then
    if v_existing.event_type is distinct from p_event_type
      or v_existing.event_value is distinct from p_event_value
      or v_existing.recorded_at is distinct from p_recorded_at then
      raise exception using errcode = '22023', message = 'Device event ID was reused with different event data.';
    end if;
    if v_sensor.sensor_code = 'S-05'
      and v_existing.event_type = 'pulse'
      and v_existing.stale is not true
      and v_existing.output_accepted is false
      and v_existing.output_rejection_reason = 'machine_offline' then
      v_promoting_existing := true;
      v_event := v_existing;
    else
      v_result_event_value := v_existing.event_value;
      if v_sensor.sensor_code = 'S-05'
        and v_existing.event_type = 'pulse'
        and v_existing.output_accepted is not null then
        v_result_event_value := jsonb_set(
          coalesce(v_result_event_value, '{}'::jsonb),
          '{metadata}',
          coalesce(v_result_event_value->'metadata', '{}'::jsonb)
            || jsonb_build_object(
              'outputAccepted', v_existing.output_accepted,
              'outputRejectionReason', v_existing.output_rejection_reason
            ),
          true
        );
      end if;
      return query select v_existing.id, v_existing.device_event_id, v_existing.event_type,
        v_result_event_value, v_existing.recorded_at, true, false, false,
        v_machine.status, v_machine.status, null::text, null::uuid, null::timestamptz,
        null::timestamptz, null::integer, null::text, null::text, null::jsonb, null::text,
        '[]'::jsonb;
      return;
    end if;
  end if;

  if not v_promoting_existing then
    insert into public.sensor_events (
      sensor_id, machine_id, device_event_id, event_type, event_value, recorded_at
    ) values (
      p_sensor_id, p_machine_id, p_device_event_id, p_event_type, p_event_value, p_recorded_at
    ) returning * into v_event;
  end if;

  if v_event.stale is true then
    if v_sensor.sensor_code = 'S-05' and p_event_type = 'pulse' then
      update public.sensor_events
      set output_accepted = false, output_rejection_reason = 'stale_event'
      where id = v_event.id
      returning * into v_event;
      v_result_event_value := jsonb_set(
        coalesce(v_event.event_value, '{}'::jsonb),
        '{metadata}',
        coalesce(v_event.event_value->'metadata', '{}'::jsonb)
          || jsonb_build_object(
            'outputAccepted', false,
            'outputRejectionReason', 'stale_event'
          ),
        true
      );
    else
      v_result_event_value := v_event.event_value;
    end if;
    return query select v_event.id, v_event.device_event_id, v_event.event_type,
      v_result_event_value, v_event.recorded_at, false, true, false,
      v_machine.status, v_machine.status, null::text, null::uuid, null::timestamptz,
      null::timestamptz, null::integer, null::text, null::text, null::jsonb, null::text,
      '[]'::jsonb;
    return;
  end if;

  if v_sensor.sensor_code = 'S-05' and p_event_type = 'pulse' then
    select sensor.* into v_s03
    from public.sensors sensor
    where sensor.machine_id = p_machine_id
      and sensor.sensor_code = 'S-03';

    if v_s03.id is not null then
      select watchdog.* into v_s03_watchdog
      from public.sensor_watchdog_state watchdog
      where watchdog.sensor_id = v_s03.id;

      select transition.to_state, transition.evaluated_at
      into v_prev_conn_state, v_prev_conn_at
      from public.sensor_watchdog_transitions transition
      where transition.sensor_id = v_s03.id
        and transition.to_state like 'connectivity:%'
        and transition.evaluated_at <= p_recorded_at
      order by transition.evaluated_at desc, transition.created_at desc
      limit 1;

      if v_prev_conn_state is not null
        and v_prev_conn_state <> 'connectivity:online'
        and exists (
          select 1
          from (
            select s03_event.event_type
            from public.sensor_events s03_event
            where s03_event.sensor_id = v_s03.id
              and s03_event.stale is not true
              and s03_event.recorded_at <= p_recorded_at
            order by s03_event.recorded_at desc, s03_event.created_at desc
            limit 1
          ) latest_s03_event
          where latest_s03_event.event_type in ('pulse', 'recovered')
        )
        and exists (
          select 1
          from public.sensor_events post_s03_event
          where post_s03_event.sensor_id = v_s03.id
            and post_s03_event.stale is not true
            and post_s03_event.recorded_at > v_prev_conn_at
            and post_s03_event.event_type in ('pulse', 'recovered')
        )
        and not exists (
          select 1
          from public.sensor_events stop_s03_event
          where stop_s03_event.sensor_id = v_s03.id
            and stop_s03_event.stale is not true
            and stop_s03_event.recorded_at > v_prev_conn_at
            and stop_s03_event.recorded_at <= p_recorded_at
            and stop_s03_event.event_type in ('idle', 'fault')
        )
        and (
          exists (
            select 1
            from (
              select transition.to_state, transition.metadata
              from public.sensor_watchdog_transitions transition
              where transition.sensor_id = v_s03.id
                and transition.to_state like 'connectivity:%'
                and transition.evaluated_at > v_prev_conn_at
              order by transition.evaluated_at asc, transition.created_at asc
              limit 1
            ) next_conn
            where next_conn.to_state = 'connectivity:online'
              and coalesce((next_conn.metadata->>'sameBootRecovery')::boolean, false)
          )
          or (
            not exists (
              select 1
              from public.sensor_watchdog_transitions transition
              where transition.sensor_id = v_s03.id
                and transition.to_state like 'connectivity:%'
                and transition.evaluated_at > v_prev_conn_at
            )
            and v_s03_watchdog.connectivity_state = 'offline'
            and (
              (
                coalesce(v_s03_watchdog.ordered_recovery_heartbeats, 0) > 0
                and v_s03_watchdog.last_heartbeat_received_at >= clock_timestamp() - interval '30 seconds'
              )
              or v_s03.updated_at >= clock_timestamp() - interval '30 seconds'
            )
          )
        ) then
        v_is_same_boot_running_outage := true;
      end if;
    end if;

    if exists (
      select 1
      from public.downtime_events downtime
      join public.sensors sensor on sensor.id = downtime.sensor_id
      where downtime.machine_id = p_machine_id
        and sensor.sensor_code = 'S-03'
        and downtime.started_at <= p_recorded_at
        and (downtime.ended_at is null or downtime.ended_at > p_recorded_at)
    ) or (
      v_machine.status = 'Downtime'
      and not exists (
        select 1
        from public.downtime_events downtime
        where downtime.machine_id = p_machine_id
          and downtime.status = 'Open'
          and downtime.started_at > p_recorded_at
      )
    ) then
      v_output_rejection_reason := 'machine_downtime';
    elsif not public.is_machine_output_schedule_eligible(p_machine_id, p_recorded_at) then
      v_output_rejection_reason := 'outside_schedule';
    elsif v_s03.id is null
      or (
        not v_is_same_boot_running_outage
        and (
          (v_prev_conn_state is not null and v_prev_conn_state <> 'connectivity:online')
          or (
            exists (
              select 1
              from public.sensor_watchdog_transitions transition
              where transition.sensor_id = v_s03.id
                and transition.to_state like 'connectivity:%'
            )
            and v_prev_conn_state is null
            and not exists (
              select 1
              from public.sensor_events s03_event
              where s03_event.sensor_id = v_s03.id
                and s03_event.stale is not true
                and s03_event.event_type in ('pulse', 'recovered', 'idle')
                and s03_event.recorded_at >= p_recorded_at - interval '30 seconds'
                and s03_event.recorded_at <= p_recorded_at + interval '30 seconds'
            )
          )
          or (
            v_s03_watchdog.connectivity_state = 'offline'
            and v_s03_watchdog.last_evaluated_at is not null
            and p_recorded_at >= v_s03_watchdog.last_evaluated_at
            and (v_s03_watchdog.last_device_recorded_at is null or v_s03_watchdog.last_device_recorded_at <= v_s03_watchdog.last_evaluated_at)
            and (v_s03.last_applied_recorded_at is null or v_s03.last_applied_recorded_at <= v_s03_watchdog.last_evaluated_at)
          )
          or not (
            (
              v_s03_watchdog.last_device_recorded_at is not null
              and p_recorded_at <= v_s03_watchdog.last_device_recorded_at + interval '30 seconds'
            )
            or exists (
              select 1
              from public.sensor_events s03_event
              where s03_event.sensor_id = v_s03.id
                and s03_event.stale is not true
                and s03_event.event_type in ('pulse', 'recovered', 'idle')
                and s03_event.recorded_at >= p_recorded_at - interval '30 seconds'
                and s03_event.recorded_at <= p_recorded_at + interval '30 seconds'
            )
            or (
              not (
                v_s03_watchdog.connectivity_state = 'offline'
                and (
                  v_s03_watchdog.last_evaluated_at is null
                  or (
                    (
                      v_s03.last_applied_recorded_at is null
                      or v_s03.updated_at <= v_s03_watchdog.last_evaluated_at
                      or v_s03.last_applied_recorded_at <= v_s03_watchdog.last_evaluated_at
                    )
                    and (
                      v_s03_watchdog.last_activity_received_at is null
                      or v_s03_watchdog.last_activity_received_at <= v_s03_watchdog.last_evaluated_at
                      or v_s03_watchdog.last_activity_received_at < clock_timestamp() - interval '30 seconds'
                    )
                  )
                )
              )
              and (
                (v_s03_watchdog.last_heartbeat_received_at is not null
                  and v_s03_watchdog.last_heartbeat_received_at >= clock_timestamp() - interval '30 seconds')
                or (v_s03_watchdog.last_activity_received_at is not null
                  and v_s03_watchdog.last_activity_received_at >= clock_timestamp() - interval '30 seconds'
                  and (
                    v_s03.last_applied_recorded_at is null
                    or (
                      p_recorded_at >= v_s03.last_applied_recorded_at - interval '5 minutes'
                      and p_recorded_at - v_s03.last_applied_recorded_at <= interval '5 minutes'
                    )
                  ))
                or (v_s03.last_applied_recorded_at is not null
                  and v_s03.updated_at >= clock_timestamp() - interval '30 seconds'
                  and p_recorded_at >= v_s03.last_applied_recorded_at - interval '5 minutes'
                  and p_recorded_at - v_s03.last_applied_recorded_at <= interval '5 minutes')
                or (v_s03_watchdog.connectivity_state = 'online'
                  and v_s03_watchdog.last_heartbeat_received_at is null
                  and v_s03_watchdog.last_activity_received_at is null
                  and v_s03.last_applied_recorded_at is null)
              )
            )
          )
        )
      ) then
      v_output_rejection_reason := 'machine_offline';
    else
      select max(event.recorded_at) into v_last_output_at
      from public.sensor_events event
      where event.sensor_id = p_sensor_id
        and event.event_type = 'pulse'
        and event.output_accepted is true
        and event.stale is not true
        and event.recorded_at <= p_recorded_at;

      if v_last_output_at is not null
        and p_recorded_at < v_last_output_at + interval '100 milliseconds' then
        v_output_rejection_reason := 'server_debounce';
      else
        v_output_accepted := true;
      end if;
    end if;

    if v_output_accepted is not true then
      update public.sensor_events
      set output_accepted = false, output_rejection_reason = v_output_rejection_reason
      where id = v_event.id
      returning * into v_event;
      v_result_event_value := jsonb_set(
        coalesce(v_event.event_value, '{}'::jsonb),
        '{metadata}',
        coalesce(v_event.event_value->'metadata', '{}'::jsonb)
          || jsonb_build_object(
            'outputAccepted', false,
            'outputRejectionReason', v_output_rejection_reason
          ),
        true
      );
      return query select v_event.id, v_event.device_event_id, v_event.event_type,
        v_result_event_value, v_event.recorded_at, v_promoting_existing, false, false,
        v_machine.status, v_machine.status, null::text, null::uuid, null::timestamptz,
        null::timestamptz, null::integer, null::text, null::text, null::jsonb, null::text,
        '[]'::jsonb;
      return;
    end if;

    update public.sensor_events
    set output_accepted = true, output_rejection_reason = null
    where id = v_event.id
    returning * into v_event;
    v_result_event_value := jsonb_set(
      coalesce(v_event.event_value, '{}'::jsonb),
      '{metadata}',
      coalesce(v_event.event_value->'metadata', '{}'::jsonb)
        || jsonb_build_object('outputAccepted', true, 'outputRejectionReason', null),
      true
    );
  else
    v_result_event_value := v_event.event_value;
  end if;

  if v_sensor.sensor_code in ('S-01', 'S-02', 'S-03', 'S-04')
    and v_sensor.fault_source is distinct from 'explicit'
    and not v_is_after_hours_device_recovery
    and not (v_effective_event_type in ('pulse', 'recovered') and coalesce(p_event_value->'metadata'->'recoveryConfirmed' = 'true'::jsonb, false))
    and v_effective_event_type in ('pulse', 'recovered') then
    update public.sensor_watchdog_state
    set last_activity_received_at = clock_timestamp(),
      detection_state = case
        when not v_absence_enabled then 'disabled'
        when detection_state = 'grace' then 'healthy'
        else detection_state
      end,
      absence_baseline_at = case when not v_absence_enabled then null else clock_timestamp() end,
      recovery_started_at = case when not v_absence_enabled then null else recovery_started_at end,
      recovery_observation_count = case when not v_absence_enabled then 0 else recovery_observation_count end,
      open_downtime_id = case when not v_absence_enabled then null else open_downtime_id end
    where sensor_id = p_sensor_id;
  end if;

  if v_sensor.sensor_code in ('S-01', 'S-02', 'S-03', 'S-04')
    and (v_sensor.status <> 'Fault' or not v_absence_enabled)
    and v_effective_event_type = 'idle' then
    update public.sensor_watchdog_state
    set detection_state = case
        when not v_absence_enabled then 'disabled'
        when not v_is_eligible then 'suspended'
        when detection_state = 'healthy' then 'grace'
        else detection_state
      end,
      absence_baseline_at = case
        when not v_absence_enabled or not v_is_eligible then null
        else coalesce(absence_baseline_at, clock_timestamp())
      end,
      recovery_started_at = case when not v_absence_enabled or not v_is_eligible then null else recovery_started_at end,
      recovery_observation_count = case when not v_absence_enabled or not v_is_eligible then 0 else recovery_observation_count end,
      open_downtime_id = case when not v_absence_enabled or not v_is_eligible then null else open_downtime_id end
    where sensor_id = p_sensor_id;
  end if;

  if v_sensor.fault_source = 'absence_watchdog' and v_effective_event_type = 'fault' then
    update public.sensor_watchdog_state
    set recovery_started_at = null, recovery_observation_count = 0, detection_state = 'downtime'
    where sensor_id = p_sensor_id;
  end if;

  if v_effective_event_type in ('pulse', 'recovered')
    and (
      v_sensor.fault_source = 'explicit'
      or v_is_after_hours_device_recovery
      or (v_effective_event_type in ('pulse', 'recovered') and coalesce(p_event_value->'metadata'->'recoveryConfirmed' = 'true'::jsonb, false))
    ) then
    update public.sensor_watchdog_state
    set detection_state = case
        when not v_absence_enabled then 'disabled'
        when not v_is_eligible then 'suspended'
        else 'healthy'
      end,
      recovery_started_at = null,
      recovery_observation_count = 0, last_activity_received_at = clock_timestamp(),
      absence_baseline_at = case when v_absence_enabled and v_is_eligible then clock_timestamp() else null end,
      open_downtime_id = null
    where sensor_id = p_sensor_id;
  end if;

  v_was_fault := v_sensor.status = 'Fault';

  update public.sensors
  set status = case
      when v_sensor.sensor_code = 'S-05' then 'Active'
      when v_effective_event_type in ('pulse', 'recovered') then 'Active'
      when v_effective_event_type = 'idle' and v_sensor.status = 'Fault' and v_absence_enabled then 'Fault'
      when v_effective_event_type = 'idle' then 'Inactive'
      else 'Fault'
    end,
    fault_source = case
      when v_sensor.sensor_code = 'S-05' then null
      when v_effective_event_type = 'fault' then coalesce(v_sensor.fault_source, 'explicit')
      when v_effective_event_type = 'idle' and v_sensor.status = 'Fault' and v_absence_enabled then v_sensor.fault_source
      else null
    end,
    last_applied_recorded_at = case
      when v_sensor.sensor_code = 'S-05'
        then greatest(coalesce(v_sensor.last_applied_recorded_at, p_recorded_at), p_recorded_at)
      else p_recorded_at
    end
  where id = p_sensor_id
  returning * into v_sensor;

  if v_sensor.sensor_code in ('S-01', 'S-02', 'S-04') then
    select * into v_process_alert
    from public.sync_process_sensor_alert(
      p_sensor_id, p_machine_id, p_recorded_at, v_event.id, v_effective_event_type,
      v_effective_signal, v_effective_event_type = 'fault',
      v_effective_event_type in ('pulse', 'recovered')
        or (v_effective_event_type = 'idle' and v_was_fault and not v_absence_enabled),
      'sensor_event'
    );
    if v_process_alert.alert_record is not null then
      v_transition_descriptors := jsonb_build_array(jsonb_build_object(
        'kind', 'alert', 'action', v_process_alert.alert_action,
        'record', v_process_alert.alert_record
      ));
    end if;
  end if;

  select * into v_reconciliation
  from public.reconcile_machine_downtime(
    p_machine_id, p_recorded_at, 'sensor_event', v_sensor.sensor_code,
    jsonb_build_object('eventId', v_event.id, 'eventType', v_effective_event_type)
  );
  v_transition_descriptors := v_transition_descriptors
    || coalesce(v_reconciliation.transition_descriptors, '[]'::jsonb);

  if v_reconciliation.alert_record is not null then
    v_alert_action := v_reconciliation.alert_action;
    v_alert_record := v_reconciliation.alert_record;
  elsif v_sensor.sensor_code in ('S-01', 'S-02', 'S-04') then
    v_alert_action := v_process_alert.alert_action;
    v_alert_record := v_process_alert.alert_record;
  end if;

  if v_effective_event_type in ('fault', 'recovered') then
    insert into public.audit_logs (action, entity_type, entity_id, metadata)
    values ('IOT_EVENT_RECEIVED', 'sensor_event', v_event.id,
      jsonb_build_object('deviceId', v_sensor.esp32_device_id,
        'sensorCode', v_sensor.sensor_code, 'machineCode', v_machine.machine_code,
        'deviceEventId', p_device_event_id, 'eventType', v_effective_event_type,
        'signal', v_effective_signal, 'recordedAt', p_recorded_at,
        'stale', false, 'stateApplied', true));
  end if;

  return query select v_event.id, v_event.device_event_id, v_event.event_type,
    v_result_event_value, v_event.recorded_at, false, false, true,
    v_machine.status, v_reconciliation.machine_status,
    v_reconciliation.downtime_action, v_reconciliation.downtime_id,
    v_reconciliation.downtime_started_at, v_reconciliation.downtime_ended_at,
    v_reconciliation.downtime_duration_seconds, v_reconciliation.downtime_cause,
    v_alert_action, v_alert_record, v_reconciliation.downtime_sensor_code,
    v_transition_descriptors;
end;
$$;

create or replace function public.ingest_iot_heartbeat(
  p_heartbeat_id uuid,
  p_sensor_id uuid,
  p_machine_id uuid,
  p_boot_counter bigint,
  p_boot_id uuid,
  p_sequence bigint,
  p_recorded_at timestamptz,
  p_activity_observed boolean
)
returns table (
  heartbeat_id uuid,
  duplicate boolean,
  stale boolean,
  state_applied boolean,
  received_at timestamptz,
  connectivity_state text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sensor public.sensors%rowtype;
  v_state public.sensor_watchdog_state%rowtype;
  v_received_at timestamptz := clock_timestamp();
  v_payload_hash text;
  v_connectivity text := 'online';
  v_recovery_count integer := 0;
  v_recovery_activity boolean := false;
  v_duplicate boolean := false;
  v_stale boolean := false;
  v_applied boolean := false;
begin
  if p_heartbeat_id is null
    or p_sensor_id is null
    or p_machine_id is null
    or p_boot_counter is null
    or p_boot_counter < 0
    or p_boot_id is null
    or p_sequence is null
    or p_sequence < 1
    or p_recorded_at is null
    or p_activity_observed is null then
    raise exception using errcode = '22023', message = 'Heartbeat fields are invalid.';
  end if;

  if p_recorded_at < '2026-05-01T00:00:00+08:00'::timestamptz then
    raise exception using errcode = '22023', message = 'Heartbeat timestamp is too far in the past.';
  end if;

  if p_recorded_at > v_received_at + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'Heartbeat timestamp is too far in the future.';
  end if;

  select sensor.* into v_sensor
  from public.sensors sensor
  where sensor.id = p_sensor_id and sensor.machine_id = p_machine_id;
  if not found then
    raise exception using errcode = '23503', message = 'Sensor is not assigned to the supplied machine.';
  end if;

  insert into public.sensor_watchdog_state (sensor_id, machine_id)
  values (p_sensor_id, p_machine_id)
  on conflict (sensor_id) do nothing;

  select watchdog.* into v_state
  from public.sensor_watchdog_state watchdog
  where watchdog.sensor_id = p_sensor_id
  for update;

  v_payload_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'heartbeatId', p_heartbeat_id::text,
    'bootCounter', p_boot_counter::text,
    'bootId', p_boot_id::text,
    'sequence', p_sequence::text,
    'recordedAt', p_recorded_at,
    'activityObserved', p_activity_observed
  )::text, 'UTF8'), 'sha256'), 'hex');

  if v_state.boot_counter is not null and p_boot_counter < v_state.boot_counter then
    v_stale := true;
  elsif v_state.boot_counter = p_boot_counter then
    if v_state.boot_id <> p_boot_id then
      raise exception using errcode = '23505', message = 'Boot identity conflicts with the current boot counter.';
    elsif p_sequence < v_state.last_sequence then
      v_stale := true;
    elsif p_sequence = v_state.last_sequence then
      if v_state.last_heartbeat_id = p_heartbeat_id
        and v_state.last_heartbeat_payload_hash = v_payload_hash then
        v_duplicate := true;
      else
        raise exception using errcode = '23505', message = 'Heartbeat sequence was reused with different content.';
      end if;
    end if;
  end if;

  if not v_stale and not v_duplicate then
    if v_state.connectivity_state = 'offline' and v_state.boot_counter = p_boot_counter then
      if v_state.ordered_recovery_heartbeats > 0
        and v_state.last_heartbeat_received_at >= v_received_at - interval '30 seconds'
        and (
          v_state.last_device_recorded_at is null
          or (
            p_recorded_at >= v_state.last_device_recorded_at
            and p_recorded_at <= v_state.last_device_recorded_at + interval '30 seconds'
          )
        ) then
        v_recovery_count := least(2, v_state.ordered_recovery_heartbeats + 1);
        v_recovery_activity := v_state.recovery_activity_observed or p_activity_observed;
      else
        v_recovery_count := 1;
        v_recovery_activity := p_activity_observed;
      end if;
      v_connectivity := case when v_recovery_count >= 2 then 'online' else 'offline' end;
    else
      v_recovery_count := 0;
      v_recovery_activity := false;
      v_connectivity := 'online';
    end if;

    if v_state.connectivity_state = 'offline'
      and v_state.ordered_recovery_heartbeats = 0
      and not exists (
        select 1
        from (
          select transition.to_state
          from public.sensor_watchdog_transitions transition
          where transition.sensor_id = p_sensor_id
            and transition.to_state like 'connectivity:%'
          order by transition.evaluated_at desc, transition.created_at desc
          limit 1
        ) prev_conn
        where prev_conn.to_state = 'connectivity:offline'
      ) then
      insert into public.sensor_watchdog_transitions (
        sensor_id, machine_id, mode, from_state, to_state, reason, evaluated_at, settings_version
      ) values (
        p_sensor_id,
        p_machine_id,
        'enforce',
        'connectivity:online',
        'connectivity:offline',
        'heartbeat_stale',
        least(
          p_recorded_at - interval '1 millisecond',
          case
            when v_state.last_evaluated_at is not null
              and v_state.last_evaluated_at >= greatest(
                coalesce(v_state.last_device_recorded_at, '-infinity'::timestamptz),
                coalesce(v_sensor.last_applied_recorded_at, '-infinity'::timestamptz)
              )
              then v_state.last_evaluated_at
            else coalesce(
              nullif(
                greatest(
                  coalesce(v_state.last_device_recorded_at, '-infinity'::timestamptz),
                  coalesce(v_sensor.last_applied_recorded_at, '-infinity'::timestamptz)
                ),
                '-infinity'::timestamptz
              ) + interval '30 seconds',
              v_state.last_evaluated_at,
              p_recorded_at - interval '1 millisecond'
            )
          end
        ),
        v_state.settings_version
      );
    end if;

    if v_state.connectivity_state is distinct from v_connectivity and v_connectivity = 'online' then
      insert into public.sensor_watchdog_transitions (
        sensor_id, machine_id, mode, from_state, to_state, reason, evaluated_at, settings_version, metadata
      ) values (
        p_sensor_id,
        p_machine_id,
        'enforce',
        'connectivity:' || coalesce(v_state.connectivity_state, 'unknown'),
        'connectivity:online',
        'heartbeat_received',
        greatest(
          p_recorded_at,
          coalesce((
            select max(transition.evaluated_at) + interval '1 millisecond'
            from public.sensor_watchdog_transitions transition
            where transition.sensor_id = p_sensor_id
              and transition.to_state = 'connectivity:offline'
              and transition.evaluated_at <= p_recorded_at + interval '5 minutes'
          ), p_recorded_at)
        ),
        v_state.settings_version,
        jsonb_build_object(
          'sameBootRecovery',
          v_state.connectivity_state = 'offline'
            and v_state.boot_id is not distinct from p_boot_id
            and v_recovery_activity
        )
      );
    end if;

    update public.sensor_watchdog_state
    set machine_id = p_machine_id,
        boot_counter = p_boot_counter,
        boot_id = p_boot_id,
        last_sequence = p_sequence,
        last_heartbeat_id = p_heartbeat_id,
        last_heartbeat_payload_hash = v_payload_hash,
        last_heartbeat_received_at = v_received_at,
        last_device_recorded_at = p_recorded_at,
        last_activity_received_at = case
          when p_activity_observed then greatest(
            case
              when v_state.detection_state in ('downtime', 'recovering')
                and last_activity_received_at is not null
                and (v_state.absence_baseline_at is null or p_recorded_at >= v_state.absence_baseline_at)
                then last_activity_received_at + interval '1 millisecond'
              else coalesce(last_activity_received_at, '-infinity'::timestamptz)
            end,
            least(p_recorded_at, v_received_at + interval '5 seconds')
          )
          else last_activity_received_at end,
        ordered_recovery_heartbeats = v_recovery_count,
        recovery_activity_observed = case when v_connectivity = 'online' then false else v_recovery_activity end,
        connectivity_state = v_connectivity,
        absence_baseline_at = case
          when v_sensor.fault_source = 'absence_watchdog'
            or v_state.detection_state in ('downtime', 'recovering') then absence_baseline_at
          when v_state.boot_counter is distinct from p_boot_counter
            or (v_state.connectivity_state <> 'online' and v_connectivity = 'online')
            then case
              when p_activity_observed then least(p_recorded_at, v_received_at)
              else v_received_at
            end
          else absence_baseline_at end,
        recovery_started_at = case when not p_activity_observed then null else recovery_started_at end,
        updated_at = v_received_at
    where sensor_id = p_sensor_id;
    v_applied := true;
  else
    v_connectivity := v_state.connectivity_state;
  end if;

  return query select p_heartbeat_id, v_duplicate, v_stale, v_applied, v_received_at, v_connectivity;
end;
$$;

create or replace function public.get_backend_readiness_v62()
returns integer
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
begin
  if public.get_backend_readiness_v61() <> 61 then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  return 62;
end;
$$;

create or replace function public.get_backend_readiness()
returns integer
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
begin
  if public.get_backend_readiness_v62() <> 62 then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  if not exists (
    select 1
    from pg_attribute
    where attrelid = 'public.sensor_watchdog_state'::regclass
      and attname = 'recovery_activity_observed'
      and not attisdropped
  ) then
    raise exception using errcode = '55000', message = 'Required WAN recovery tracking column is missing.';
  end if;

  return 63;
end;
$$;

revoke all on function
  public.ingest_iot_grouped_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz),
  public.ingest_iot_heartbeat(uuid,uuid,uuid,bigint,uuid,bigint,timestamptz,boolean),
  public.get_backend_readiness(),
  public.get_backend_readiness_v62()
  from public, anon, authenticated;
grant execute on function
  public.ingest_iot_grouped_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz),
  public.ingest_iot_heartbeat(uuid,uuid,uuid,bigint,uuid,bigint,timestamptz,boolean),
  public.get_backend_readiness(),
  public.get_backend_readiness_v62()
  to service_role;

commit;
