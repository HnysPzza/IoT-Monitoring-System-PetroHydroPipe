-- Reject S-05 output pulses when S-03 (Main Machine sensor) is offline:
-- 1. Expand sensor_events_output_classification check constraint to allow 'machine_offline'.
-- 2. In ingest_iot_grouped_sensor_event, reject S-05 pulse events with 'machine_offline'
--    when S-03 has no active connectivity (connectivity_state is 'offline' without newer
--    event contact, or S-03 has no fresh heartbeat/event contact within the 30s stale window).
-- 3. Advance backend readiness schema version to 60.

begin;

alter table public.sensor_events
  drop constraint if exists sensor_events_output_classification;

alter table public.sensor_events
  add constraint sensor_events_output_classification check (
    (output_accepted is null and output_rejection_reason is null)
    or (output_accepted and output_rejection_reason is null)
    or (
      not output_accepted
      and output_rejection_reason in (
        'stale_event',
        'machine_stationary',
        'machine_downtime',
        'machine_offline',
        'server_debounce'
      )
    )
  );

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
  v_last_output_at timestamptz;
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

  insert into public.sensor_events (
    sensor_id, machine_id, device_event_id, event_type, event_value, recorded_at
  ) values (
    p_sensor_id, p_machine_id, p_device_event_id, p_event_type, p_event_value, p_recorded_at
  ) returning * into v_event;

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
    end if;

    if v_machine.status = 'Downtime' or exists (
      select 1
      from public.downtime_events downtime
      join public.sensors sensor on sensor.id = downtime.sensor_id
      where downtime.machine_id = p_machine_id
        and sensor.sensor_code = 'S-03'
        and (
          downtime.status = 'Open'
          or (
            downtime.started_at <= p_recorded_at
            and (downtime.ended_at is null or downtime.ended_at > p_recorded_at)
          )
        )
    ) then
      v_output_rejection_reason := 'machine_downtime';
    elsif v_s03.id is null
      or (
        v_s03_watchdog.connectivity_state = 'offline'
        and (
          v_s03_watchdog.last_evaluated_at is null
          or (
            (v_s03.last_applied_recorded_at is null or v_s03.updated_at <= v_s03_watchdog.last_evaluated_at)
            and (v_s03_watchdog.last_activity_received_at is null or v_s03_watchdog.last_activity_received_at <= v_s03_watchdog.last_evaluated_at)
          )
        )
      )
      or not (
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
        v_result_event_value, v_event.recorded_at, false, false, false,
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
    last_applied_recorded_at = p_recorded_at
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

revoke all on function public.ingest_iot_grouped_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)
  from public, anon, authenticated;
grant execute on function public.ingest_iot_grouped_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)
  to service_role;

create or replace function public.ingest_iot_sensor_event(
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
  v_sensor_code text;
  v_fault_source text;
  v_detection_state text;
  v_absence_enabled boolean := false;
  v_is_eligible boolean := true;
  v_is_device_running boolean := false;
  v_recovery_confirmed boolean := false;
begin
  if jsonb_typeof(p_event_value->'metadata') = 'object'
    and p_event_value->'metadata' ?| array['outputAccepted', 'outputRejectionReason'] then
    raise exception using errcode = '22023', message = 'Sensor event metadata uses server-reserved keys.';
  end if;
  if p_recorded_at is null or p_recorded_at < '2026-05-01T00:00:00+08:00'::timestamptz then
    raise exception using errcode = '22023', message = 'Sensor event timestamp is too far in the past.';
  end if;
  if p_recorded_at > clock_timestamp() + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'Sensor event timestamp is too far in the future.';
  end if;

  select sensor.sensor_code, sensor.fault_source, watchdog.detection_state,
    coalesce((settings.sensor_thresholds->sensor.sensor_code->>'absenceDetectionEnabled')::boolean, false)
      and sensor.sensor_code <> 'S-05'
  into v_sensor_code, v_fault_source, v_detection_state, v_absence_enabled
  from public.sensors sensor
  left join public.sensor_watchdog_state watchdog on watchdog.sensor_id = sensor.id
  left join public.machine_operational_settings settings on settings.machine_id = sensor.machine_id
  where sensor.id = p_sensor_id and sensor.machine_id = p_machine_id;

  v_is_device_running := v_sensor_code <> 'S-05'
    and v_absence_enabled
    and p_event_type in ('pulse', 'recovered')
    and p_event_value->>'signal' = 'active'
    and coalesce(p_event_value->'metadata'->>'detectionState' = 'RUNNING', false)
    and (v_fault_source = 'absence_watchdog' or v_detection_state in ('downtime', 'recovering'));

  if v_is_device_running then
    v_is_eligible := public.watchdog_eligible_seconds(
      p_machine_id,
      p_recorded_at,
      p_recorded_at + interval '1 second'
    ) = 1;
  end if;

  v_recovery_confirmed := coalesce(p_event_value->'metadata'->'recoveryConfirmed' = 'true'::jsonb, false)
    or (v_is_device_running and not v_is_eligible);

  if (v_sensor_code = 'S-05' and p_event_type in ('downtime', 'fault'))
    or (p_event_type = 'downtime' and p_event_value->>'signal' = 'no_pulse')
    or (v_sensor_code <> 'S-05'
      and v_absence_enabled
      and not (p_event_type in ('pulse', 'recovered') and p_event_value->>'signal' = 'active' and v_recovery_confirmed)
      and (
        (v_fault_source = 'absence_watchdog' and p_event_type in ('pulse', 'recovered') and p_event_value->>'signal' = 'active')
        or (v_detection_state in ('downtime', 'recovering') and p_event_type in ('pulse', 'recovered') and p_event_value->>'signal' = 'active')
      )) then
    return query select observed.sensor_event_id, observed.device_event_id,
      observed.event_type, observed.event_value, observed.recorded_at,
      observed.duplicate, observed.stale, observed.state_applied,
      observed.previous_machine_status, observed.new_machine_status,
      observed.downtime_action, observed.downtime_id, observed.downtime_started_at,
      observed.downtime_ended_at, observed.downtime_duration_seconds,
      observed.downtime_cause, observed.alert_action, observed.alert_record,
      null::text, '[]'::jsonb
    from public.ingest_iot_watchdog_observation(
      p_device_event_id, p_sensor_id, p_machine_id, p_event_type, p_event_value, p_recorded_at
    ) observed;
    return;
  end if;

  if (
    (v_sensor_code in ('S-01', 'S-02', 'S-03', 'S-04')
      and p_event_type in ('pulse', 'idle', 'fault', 'recovered'))
    or (v_sensor_code = 'S-05' and p_event_type in ('pulse', 'idle', 'recovered'))
  ) then
    return query select grouped.sensor_event_id, grouped.device_event_id,
      grouped.event_type, grouped.event_value, grouped.recorded_at,
      grouped.duplicate, grouped.stale, grouped.state_applied,
      grouped.previous_machine_status, grouped.new_machine_status,
      grouped.downtime_action, grouped.downtime_id, grouped.downtime_started_at,
      grouped.downtime_ended_at, grouped.downtime_duration_seconds,
      grouped.downtime_cause, grouped.alert_action, grouped.alert_record,
      grouped.downtime_sensor_code, grouped.transition_descriptors
    from public.ingest_iot_grouped_sensor_event(
      p_device_event_id, p_sensor_id, p_machine_id, p_event_type, p_event_value, p_recorded_at
    ) grouped;
    return;
  end if;

  raise exception using errcode = '22023', message = 'Unsupported sensor event routing.';
end;
$$;

revoke all on function public.ingest_iot_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)
  from public, anon, authenticated;
grant execute on function public.ingest_iot_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)
  to service_role;

create or replace function public.track_watchdog_recovery_observation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.detection_state in ('downtime', 'recovering')
    and new.detection_state not in ('healthy', 'disabled', 'suspended') then
    if new.last_activity_received_at is distinct from old.last_activity_received_at then
      new.recovery_started_at := coalesce(old.recovery_started_at, new.last_activity_received_at);
      new.recovery_observation_count := least(2, old.recovery_observation_count + 1);
      new.detection_state := 'recovering';
    elsif new.recovery_started_at is null then
      new.recovery_observation_count := 0;
      new.detection_state := 'downtime';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.evaluate_sensor_watchdog(
  p_sensor_id uuid,
  p_evaluated_at timestamptz,
  p_mode text,
  p_stale_after_seconds integer
)
returns table (
  evaluated_sensor_id uuid,
  connectivity_state text,
  detection_state text,
  transition_descriptors jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sensor public.sensors%rowtype;
  v_machine public.machines%rowtype;
  v_legacy record;
  v_reconciliation record;
  v_process_alert record;
  v_descriptors jsonb;
  v_connectivity_descriptors jsonb;
  v_previous_machine_status text;
  v_machine_status text;
  v_was_watchdog_fault boolean := false;
  v_reconcile_called boolean := false;
  v_downtime_action text;
  v_downtime_id uuid;
  v_downtime_started_at timestamptz;
  v_downtime_ended_at timestamptz;
  v_downtime_duration_seconds integer;
  v_downtime_cause text;
  v_downtime_sensor_code text;
  v_alert_action text;
  v_alert_record jsonb;
  v_triggered_at timestamptz := p_evaluated_at;
begin
  select sensor.* into v_sensor from public.sensors sensor where sensor.id = p_sensor_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Watchdog sensor was not found.'; end if;

  select * into v_legacy from public.evaluate_sensor_watchdog_legacy(
    p_sensor_id, p_evaluated_at,
    case when v_sensor.sensor_code = 'S-05' or p_mode <> 'enforce' then p_mode else 'observe' end,
    p_stale_after_seconds
  );

  if v_sensor.sensor_code = 'S-05'
    or p_mode = 'disabled'
    or (
      p_mode = 'observe'
      and not (
        v_sensor.status = 'Fault'
        and v_sensor.fault_source = 'absence_watchdog'
        and v_legacy.detection_state in ('healthy', 'disabled')
      )
    ) then
    return query select v_legacy.evaluated_sensor_id, v_legacy.connectivity_state,
      v_legacy.detection_state, v_legacy.transition_descriptors;
    return;
  end if;

  select machine.* into v_machine from public.machines machine
  where machine.id = v_sensor.machine_id for update;
  v_previous_machine_status := v_machine.status;
  v_descriptors := coalesce(v_legacy.transition_descriptors, '[]'::jsonb);
  if p_mode = 'enforce' then
    v_connectivity_descriptors := public.sync_watchdog_connectivity_alert(
      p_sensor_id, v_machine.id, v_legacy.connectivity_state, p_evaluated_at
    );
    v_descriptors := v_descriptors || coalesce(v_connectivity_descriptors, '[]'::jsonb);
  end if;

  v_was_watchdog_fault := v_sensor.status = 'Fault'
    and v_sensor.fault_source = 'absence_watchdog';

  if p_mode = 'enforce' and v_legacy.detection_state = 'downtime' then
    update public.sensors
    set status = 'Fault',
      fault_source = case
        when status = 'Fault' and fault_source is distinct from 'absence_watchdog'
          then coalesce(fault_source, 'explicit')
        else 'absence_watchdog' end
    where id = p_sensor_id
    returning * into v_sensor;
    if v_sensor.sensor_code in ('S-01', 'S-02', 'S-04') then
      select * into v_process_alert
      from public.sync_process_sensor_alert(
        p_sensor_id, v_machine.id, p_evaluated_at, null, 'downtime', 'no_pulse',
        true, false, 'absence_watchdog'
      );
      if v_process_alert.alert_record is not null then
        v_descriptors := v_descriptors || jsonb_build_array(jsonb_build_object(
          'kind', 'alert', 'action', v_process_alert.alert_action,
          'record', v_process_alert.alert_record
        ));
        v_alert_action := v_process_alert.alert_action;
        v_alert_record := v_process_alert.alert_record;
      end if;
    end if;
    v_reconcile_called := true;
  elsif (
    v_legacy.detection_state = 'disabled'
    or (
      p_mode = 'enforce'
      and v_legacy.detection_state = 'suspended'
      and v_sensor.fault_source = 'explicit'
      and coalesce((
        select event.event_value->'metadata'->>'detectionState' = 'FAULT'
          and public.watchdog_eligible_seconds(
            v_machine.id,
            event.recorded_at,
            event.recorded_at + interval '1 second'
          ) = 0
        from public.sensor_events event
        where event.sensor_id = p_sensor_id
          and event.event_type = 'fault'
          and event.stale is not true
        order by event.recorded_at desc, event.created_at desc
        limit 1
      ), false)
      and (
        (
          v_sensor.sensor_code in ('S-01', 'S-02', 'S-04')
          and exists (
            select 1
            from public.sensors s03
            where s03.machine_id = v_machine.id
              and s03.sensor_code = 'S-03'
              and s03.status = 'Fault'
          )
        )
        or not exists (
          select 1
          from public.downtime_events downtime
          where downtime.machine_id = v_machine.id
            and downtime.status = 'Open'
            and public.watchdog_eligible_seconds(
              v_machine.id,
              downtime.started_at,
              downtime.started_at + interval '1 second'
            ) = 1
        )
      )
    )
  ) and v_sensor.status = 'Fault' then
    update public.sensors
    set status = 'Inactive', fault_source = null
    where id = p_sensor_id
    returning * into v_sensor;
    if v_sensor.sensor_code in ('S-01', 'S-02', 'S-04') then
      select * into v_process_alert
      from public.sync_process_sensor_alert(
        p_sensor_id, v_machine.id, p_evaluated_at, null, 'idle', 'idle',
        false, true, 'absence_watchdog'
      );
      if v_process_alert.alert_record is not null then
        v_descriptors := v_descriptors || jsonb_build_array(jsonb_build_object(
          'kind', 'alert', 'action', v_process_alert.alert_action,
          'record', v_process_alert.alert_record
        ));
        v_alert_action := v_process_alert.alert_action;
        v_alert_record := v_process_alert.alert_record;
      end if;
    end if;
    v_reconcile_called := true;
  elsif p_mode = 'enforce'
    and v_legacy.detection_state = 'grace'
    and v_sensor.sensor_code in ('S-01', 'S-02', 'S-03', 'S-04')
    and v_sensor.status = 'Active' and v_sensor.fault_source is null then
    update public.sensors set status = 'Inactive' where id = p_sensor_id
    returning * into v_sensor;
    v_reconcile_called := true;
  elsif v_legacy.detection_state = 'healthy' then
    if p_mode = 'enforce'
      and v_sensor.sensor_code in ('S-01', 'S-02', 'S-03', 'S-04')
      and v_sensor.status = 'Inactive' and v_sensor.fault_source is null
      and exists (select 1 from public.sensor_watchdog_state state
        where state.sensor_id = p_sensor_id
          and state.last_activity_received_at >= state.absence_baseline_at) then
      update public.sensors set status = 'Active' where id = p_sensor_id
      returning * into v_sensor;
    end if;
    if v_was_watchdog_fault then
      update public.sensors set status = 'Active', fault_source = null
      where id = p_sensor_id returning * into v_sensor;
      if v_sensor.sensor_code in ('S-01', 'S-02', 'S-04') then
        select * into v_process_alert
        from public.sync_process_sensor_alert(
          p_sensor_id, v_machine.id, p_evaluated_at, null, 'recovered', 'active',
          false, true, 'absence_watchdog'
        );
        if v_process_alert.alert_record is not null then
          v_descriptors := v_descriptors || jsonb_build_array(jsonb_build_object(
            'kind', 'alert', 'action', v_process_alert.alert_action,
            'record', v_process_alert.alert_record
          ));
          v_alert_action := v_process_alert.alert_action;
          v_alert_record := v_process_alert.alert_record;
        end if;
      end if;
    end if;
    v_reconcile_called := true;
  end if;

  if v_sensor.sensor_code = 'S-03' and v_legacy.detection_state = 'downtime'
    and v_sensor.fault_source = 'absence_watchdog' and not v_was_watchdog_fault then
    select public.watchdog_advance_eligible_time(
      v_machine.id, state.absence_baseline_at, p_evaluated_at,
      (settings.sensor_thresholds->'S-03'->>'triggerSeconds')::integer
    ) into v_triggered_at
    from public.sensor_watchdog_state state
    join public.machine_operational_settings settings on settings.machine_id = v_machine.id
    where state.sensor_id = p_sensor_id;
    if v_triggered_at is null then
      raise exception using errcode = '55000', message = 'Watchdog threshold crossing is missing.';
    end if;
  end if;

  if v_reconcile_called then
    select * into v_reconciliation
    from public.reconcile_machine_downtime(
      v_machine.id, v_triggered_at, 'absence_watchdog', v_sensor.sensor_code,
      jsonb_build_object('notes', case when v_sensor.sensor_code = 'S-03'
        then 'S-03 watchdog confirmed the machine authority condition.'
        else 'Process watchdog confirmation is tracked through the S-03 group owner.' end)
    );
    v_downtime_action := v_reconciliation.downtime_action;
    v_downtime_id := v_reconciliation.downtime_id;
    v_downtime_started_at := v_reconciliation.downtime_started_at;
    v_downtime_ended_at := v_reconciliation.downtime_ended_at;
    v_downtime_duration_seconds := v_reconciliation.downtime_duration_seconds;
    v_downtime_cause := v_reconciliation.downtime_cause;
    v_downtime_sensor_code := v_reconciliation.downtime_sensor_code;
    if v_reconciliation.downtime_action = 'created' then
      insert into public.audit_logs (action, entity_type, entity_id, metadata)
      values ('WATCHDOG_DOWNTIME_CREATED', 'downtime', v_reconciliation.downtime_id,
        jsonb_build_object('sensorCode', v_sensor.sensor_code,
          'ownerSensorCode', 'S-03', 'evaluatedAt', p_evaluated_at));
    elsif v_reconciliation.downtime_action = 'resolved' then
      insert into public.audit_logs (action, entity_type, entity_id, metadata)
      values ('WATCHDOG_DOWNTIME_RESOLVED', 'downtime', v_reconciliation.downtime_id,
        jsonb_build_object('sensorCode', v_sensor.sensor_code,
          'ownerSensorCode', 'S-03', 'evaluatedAt', p_evaluated_at));
    end if;
    v_descriptors := v_descriptors || coalesce(v_reconciliation.transition_descriptors, '[]'::jsonb);
    if v_reconciliation.alert_record is not null then
      v_alert_action := v_reconciliation.alert_action;
      v_alert_record := v_reconciliation.alert_record;
    end if;
    v_machine_status := v_reconciliation.machine_status;
  else
    v_machine_status := v_machine.status;
  end if;

  return query select v_legacy.evaluated_sensor_id, v_legacy.connectivity_state,
    v_legacy.detection_state, v_descriptors;
end;
$$;

revoke all on function public.evaluate_sensor_watchdog(uuid,timestamptz,text,integer)
  from public, anon, authenticated;
grant execute on function public.evaluate_sensor_watchdog(uuid,timestamptz,text,integer)
  to service_role;

create or replace function public.get_backend_readiness_v59()
returns integer
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
begin
  if public.get_backend_readiness_v58() <> 58 then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  if to_regclass('public.production_calendar_days') is null
    or to_regprocedure('public.get_seeded_production_holidays()') is null
    or to_regprocedure('public.set_production_calendar_day(uuid,date,text,text,boolean,text,bigint,boolean,uuid)') is null
    or to_regprocedure('public.set_production_calendar_range(uuid,date,date,text,text,text,boolean,uuid,uuid)') is null
    or to_regprocedure('public.remove_production_calendar_day(uuid,date,uuid)') is null
    or to_regprocedure('public.remove_production_calendar_range(uuid,uuid,uuid,timestamptz)') is null
    or has_table_privilege('service_role', 'public.production_calendar_days', 'INSERT')
    or has_table_privilege('service_role', 'public.production_calendar_days', 'UPDATE')
    or has_table_privilege('service_role', 'public.production_calendar_days', 'DELETE') then
    raise exception using errcode = '55000', message = 'Required production calendar dependencies are missing.';
  end if;

  return 59;
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
  if public.get_backend_readiness_v59() <> 59 then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sensor_events'::regclass
      and conname = 'sensor_events_output_classification'
      and pg_get_constraintdef(oid) like '%machine_offline%'
  ) then
    raise exception using errcode = '55000', message = 'Required S-05 offline output validation constraint is missing.';
  end if;

  return 60;
end;
$$;

revoke all on function
  public.get_backend_readiness(),
  public.get_backend_readiness_v59()
  from public, anon, authenticated;
grant execute on function
  public.get_backend_readiness(),
  public.get_backend_readiness_v59()
  to service_role;

commit;
