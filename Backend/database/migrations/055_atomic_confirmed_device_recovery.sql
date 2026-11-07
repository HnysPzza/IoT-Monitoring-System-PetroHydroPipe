-- Move device recovery confirmation into the atomic database layer:
-- 1. Route confirmed device recovery events (eventType: 'recovered' with metadata.recoveryConfirmed: true)
--    through ingest_iot_grouped_sensor_event instead of observational watchdog ingestion.
-- 2. In ingest_iot_grouped_sensor_event, reset watchdog state and clear fault_source atomically
--    after duplicate and staleness checks pass.
-- 3. Eliminate direct table mutations from the backend API.

begin;

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
  v_existing public.sensor_events%rowtype;
  v_event public.sensor_events%rowtype;
  v_last_output_at timestamptz;
  v_output_accepted boolean;
  v_output_rejection_reason text;
  v_result_event_value jsonb;
  v_absence_enabled boolean := false;
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
    and not (p_event_type = 'recovered' and coalesce(p_event_value->'metadata'->'recoveryConfirmed' = 'true'::jsonb, false))
    and p_event_type in ('pulse', 'recovered') then
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
    and v_sensor.status <> 'Fault'
    and p_event_type = 'idle' then
    update public.sensor_watchdog_state
    set detection_state = case
        when not v_absence_enabled then 'disabled'
        when detection_state = 'healthy' then 'grace'
        else detection_state
      end,
      absence_baseline_at = case
        when not v_absence_enabled then null
        else coalesce(absence_baseline_at, clock_timestamp())
      end
    where sensor_id = p_sensor_id;
  end if;

  if v_sensor.fault_source = 'absence_watchdog' and p_event_type = 'fault' then
    update public.sensor_watchdog_state
    set recovery_started_at = null, recovery_observation_count = 0, detection_state = 'downtime'
    where sensor_id = p_sensor_id;
  end if;

  if p_event_type in ('pulse', 'recovered')
    and (
      v_sensor.fault_source = 'explicit'
      or (p_event_type = 'recovered' and coalesce(p_event_value->'metadata'->'recoveryConfirmed' = 'true'::jsonb, false))
    ) then
    update public.sensor_watchdog_state
    set detection_state = case when v_absence_enabled then 'healthy' else 'disabled' end,
      recovery_started_at = null,
      recovery_observation_count = 0, last_activity_received_at = clock_timestamp(),
      absence_baseline_at = case when v_absence_enabled then clock_timestamp() else null end,
      open_downtime_id = null
    where sensor_id = p_sensor_id;
  end if;

  update public.sensors
  set status = case
      when v_sensor.sensor_code = 'S-05' then 'Active'
      when p_event_type in ('pulse', 'recovered') then 'Active'
      when p_event_type = 'idle' and v_sensor.status = 'Fault' then 'Fault'
      when p_event_type = 'idle' then 'Inactive'
      else 'Fault'
    end,
    fault_source = case
      when v_sensor.sensor_code = 'S-05' then null
      when p_event_type = 'fault' then coalesce(v_sensor.fault_source, 'explicit')
      when p_event_type = 'idle' and v_sensor.status = 'Fault' then v_sensor.fault_source
      else null
    end,
    last_applied_recorded_at = p_recorded_at
  where id = p_sensor_id
  returning * into v_sensor;

  if v_sensor.sensor_code in ('S-01', 'S-02', 'S-04') then
    select * into v_process_alert
    from public.sync_process_sensor_alert(
      p_sensor_id, p_machine_id, p_recorded_at, v_event.id, p_event_type,
      p_event_value->>'signal', p_event_type = 'fault',
      p_event_type in ('pulse', 'recovered'), 'sensor_event'
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
    jsonb_build_object('eventId', v_event.id, 'eventType', p_event_type)
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

  if p_event_type in ('fault', 'recovered') then
    insert into public.audit_logs (action, entity_type, entity_id, metadata)
    values ('IOT_EVENT_RECEIVED', 'sensor_event', v_event.id,
      jsonb_build_object('deviceId', v_sensor.esp32_device_id,
        'sensorCode', v_sensor.sensor_code, 'machineCode', v_machine.machine_code,
        'deviceEventId', p_device_event_id, 'eventType', p_event_type,
        'signal', p_event_value->>'signal', 'recordedAt', p_recorded_at,
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

  v_recovery_confirmed := coalesce(p_event_value->'metadata'->'recoveryConfirmed' = 'true'::jsonb, false);

  if (v_sensor_code = 'S-05' and p_event_type in ('downtime', 'fault'))
    or (p_event_type = 'downtime' and p_event_value->>'signal' = 'no_pulse')
    or (v_sensor_code <> 'S-05'
      and v_absence_enabled
      and not (p_event_type = 'recovered' and p_event_value->>'signal' = 'active' and v_recovery_confirmed)
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

revoke all on function public.ingest_iot_grouped_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)
  from public, anon, authenticated;
grant execute on function public.ingest_iot_grouped_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)
  to service_role;

revoke all on function public.ingest_iot_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)
  from public, anon, authenticated;
grant execute on function public.ingest_iot_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)
  to service_role;

create or replace function public.get_backend_readiness_v52()
returns integer
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
begin
  if public.get_backend_readiness_v51() <> 51 then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  if (select count(*) from public.roles) <> 5
    or exists (
      select 1 from public.roles
      where name not in (
        'Admin',
        'Operation Manager',
        'Quality Control',
        'Engineering Supervisor',
        'Production Supervisor'
      )
    ) then
    raise exception using errcode = '55000', message = 'Role catalog does not match the expected five roles.';
  end if;

  return 52;
end;
$$;

create or replace function public.get_backend_readiness_v53()
returns integer
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
begin
  if public.get_backend_readiness_v52() <> 52 then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  if to_regclass('public.production_item_specs') is null
    or not exists (
      select 1
      from pg_attribute
      where attrelid = 'public.production_item_specs'::regclass
        and attname = 'tonnage'
        and not attisdropped
    )
    or to_regprocedure('public.update_production_log_spec(uuid,text,numeric,numeric,numeric,integer,uuid,timestamptz,numeric)') is null
    or to_regprocedure('public.batch_update_production_log_specs(uuid[],timestamptz,timestamptz,boolean,text,numeric,numeric,numeric,uuid,numeric)') is null then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  return 53;
end;
$$;

create or replace function public.get_backend_readiness_v54()
returns integer
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
begin
  if public.get_backend_readiness_v53() <> 53 then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  if to_regprocedure('public.ingest_iot_grouped_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)') is null then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  return 54;
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
  if public.get_backend_readiness_v54() <> 54 then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  if to_regprocedure('public.ingest_iot_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)') is null
    or to_regprocedure('public.ingest_iot_grouped_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)') is null then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  return 55;
end;
$$;

revoke all on function
  public.get_backend_readiness(),
  public.get_backend_readiness_v54(),
  public.get_backend_readiness_v53(),
  public.get_backend_readiness_v52()
  from public, anon, authenticated;
grant execute on function
  public.get_backend_readiness(),
  public.get_backend_readiness_v54(),
  public.get_backend_readiness_v53(),
  public.get_backend_readiness_v52()
  to service_role;

commit;

