begin;

alter table public.sensor_events
  add column if not exists output_accepted boolean,
  add column if not exists output_rejection_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sensor_events'::regclass
      and conname = 'sensor_events_output_classification'
  ) then
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
            'server_debounce'
          )
        )
      );
  end if;
end;
$$;

-- ponytail: 100ms server floor matches the documented firmware debounce example; replace with measured machine settings after hardware calibration.
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
  v_s03_event_type text;
  v_last_output_at timestamptz;
  v_output_accepted boolean;
  v_output_rejection_reason text;
  v_result_event_value jsonb;
  v_process_alert record;
  v_reconciliation record;
  v_alert_action text;
  v_alert_record jsonb;
  v_transition_descriptors jsonb := '[]'::jsonb;
begin
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
    select event.event_type into v_s03_event_type
    from public.sensor_events event
    join public.sensors sensor on sensor.id = event.sensor_id
    where event.machine_id = p_machine_id
      and sensor.sensor_code = 'S-03'
      and event.recorded_at <= p_recorded_at
      and event.stale is not true
    order by event.recorded_at desc, event.id desc
    limit 1;

    if exists (
      select 1
      from public.downtime_events downtime
      join public.sensors sensor on sensor.id = downtime.sensor_id
      where downtime.machine_id = p_machine_id
        and sensor.sensor_code = 'S-03'
        and downtime.started_at <= p_recorded_at
        and (downtime.ended_at is null or downtime.ended_at > p_recorded_at)
    ) then
      v_output_rejection_reason := 'machine_downtime';
    elsif v_s03_event_type is not null
      and v_s03_event_type not in ('pulse', 'recovered') then
      v_output_rejection_reason := 'machine_stationary';
    elsif v_s03_event_type is null and v_machine.status <> 'Running' then
      v_output_rejection_reason := 'machine_stationary';
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
    and p_event_type in ('pulse', 'recovered') then
    update public.sensor_watchdog_state
    set last_activity_received_at = clock_timestamp(),
      detection_state = case when detection_state = 'grace' then 'healthy' else detection_state end
    where sensor_id = p_sensor_id;
  end if;

  if v_sensor.fault_source = 'absence_watchdog' and p_event_type = 'fault' then
    update public.sensor_watchdog_state
    set recovery_started_at = null, recovery_observation_count = 0, detection_state = 'downtime'
    where sensor_id = p_sensor_id;
  end if;

  if v_sensor.fault_source = 'explicit' and p_event_type in ('pulse', 'recovered') then
    update public.sensor_watchdog_state
    set detection_state = 'healthy', recovery_started_at = null,
      recovery_observation_count = 0, last_activity_received_at = clock_timestamp(),
      absence_baseline_at = clock_timestamp(), open_downtime_id = null
    where sensor_id = p_sensor_id;
  end if;

  update public.sensors
  set status = case
      when p_event_type in ('pulse', 'recovered') then 'Active'
      when p_event_type = 'idle' and v_sensor.status = 'Fault' then 'Fault'
      when p_event_type = 'idle' then 'Inactive'
      else 'Fault'
    end,
    fault_source = case
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
begin
  select sensor.sensor_code, sensor.fault_source, watchdog.detection_state
  into v_sensor_code, v_fault_source, v_detection_state
  from public.sensors sensor
  left join public.sensor_watchdog_state watchdog on watchdog.sensor_id = sensor.id
  where sensor.id = p_sensor_id and sensor.machine_id = p_machine_id;

  if (v_sensor_code = 'S-05' and p_event_type in ('downtime', 'fault'))
    or (p_event_type = 'downtime' and p_event_value->>'signal' = 'no_pulse')
    or (v_sensor_code <> 'S-05'
      and v_fault_source = 'absence_watchdog' and p_event_type in ('pulse', 'recovered')
      and p_event_value->>'signal' = 'active')
    or (v_sensor_code <> 'S-05'
      and v_detection_state in ('downtime', 'recovering')
      and p_event_type in ('pulse', 'recovered')
      and p_event_value->>'signal' = 'active') then
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

create or replace function public.aggregate_analytics_sensor_events(
  p_machine_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_bucket_seconds integer
)
returns table (
  bucket_start timestamptz,
  sensor_code text,
  sensor_label text,
  event_count bigint
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if p_machine_id is null
    or p_started_at is null
    or p_ended_at is null
    or p_ended_at <= p_started_at
    or p_ended_at - p_started_at > interval '100 years'
    or p_bucket_seconds is null
    or (p_bucket_seconds <> 0 and (p_bucket_seconds < 3600 or p_bucket_seconds > 2678400)) then
    raise exception using errcode = '22023', message = 'Analytics aggregation inputs are invalid.';
  end if;

  return query
  select
    case
      when p_bucket_seconds = 0 then
        date_trunc('month', event.recorded_at at time zone 'Asia/Manila') at time zone 'Asia/Manila'
      else p_started_at
        + (
          floor(
            extract(epoch from (event.recorded_at - p_started_at))
            / p_bucket_seconds
          ) * p_bucket_seconds
        ) * interval '1 second'
    end as bucket_start,
    sensor.sensor_code,
    sensor.label as sensor_label,
    count(*)::bigint as event_count
  from public.sensor_events event
  join public.sensors sensor on sensor.id = event.sensor_id
  where event.machine_id = p_machine_id
    and event.event_type = 'pulse'
    and event.stale is not true
    and event.recorded_at >= p_started_at
    and event.recorded_at < p_ended_at
    and sensor.sensor_code in ('S-01', 'S-02', 'S-04', 'S-05')
    and (sensor.sensor_code <> 'S-05' or event.output_accepted is not false)
  group by 1, sensor.sensor_code, sensor.label
  order by 1, sensor.sensor_code;
end;
$$;

create or replace function public.get_analytics_first_recorded_at(p_machine_id uuid)
returns timestamptz
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select min(recorded_at)
  from (
    select event.recorded_at
    from public.sensor_events event
    join public.sensors sensor on sensor.id = event.sensor_id
    where event.machine_id = p_machine_id
      and event.event_type = 'pulse'
      and event.stale is not true
      and sensor.sensor_code in ('S-01', 'S-02', 'S-04', 'S-05')
      and (sensor.sensor_code <> 'S-05' or event.output_accepted is not false)

    union all

    select downtime.started_at
    from public.downtime_events downtime
    where downtime.machine_id = p_machine_id
  ) analytics_records;
$$;

create or replace function public.get_machine_live_snapshot(p_machine_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_snapshot jsonb;
begin
  if p_machine_code is null or p_machine_code !~ '^M-[0-9]{2}$' then
    raise exception using errcode = '22023', message = 'Machine code is invalid.';
  end if;

  select jsonb_build_object(
    'snapshot_at', clock_timestamp(),
    'machine', jsonb_build_object(
      'id', machine.id,
      'machine_code', machine.machine_code,
      'name', machine.name,
      'status', machine.status,
      'location', machine.location,
      'updated_at', machine.updated_at
    ),
    'sensors', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', sensor.id,
          'sensor_code', sensor.sensor_code,
          'esp32_device_id', sensor.esp32_device_id,
          'label', sensor.label,
          'status', sensor.status,
          'updated_at', sensor.updated_at,
          'latest_event', case when latest_event.id is null then null else jsonb_build_object(
            'id', latest_event.id,
            'event_type', latest_event.event_type,
            'signal', latest_event.event_value ->> 'signal',
            'recorded_at', latest_event.recorded_at
          ) end,
          'watchdog', case when watchdog.sensor_id is null then null else jsonb_build_object(
            'connectivity_state', watchdog.connectivity_state,
            'detection_state', watchdog.detection_state,
            'last_heartbeat_received_at', watchdog.last_heartbeat_received_at,
            'last_activity_received_at', watchdog.last_activity_received_at,
            'last_evaluated_at', watchdog.last_evaluated_at
          ) end
        ) order by sensor.sensor_code, sensor.id
      )
      from public.sensors sensor
      left join lateral (
        select event.id, event.event_type, event.event_value, event.recorded_at
        from public.sensor_events event
        where event.sensor_id = sensor.id
          and event.stale is not true
          and (sensor.sensor_code <> 'S-05' or event.output_accepted is not false)
        order by event.recorded_at desc, event.id desc
        limit 1
      ) latest_event on true
      left join public.sensor_watchdog_state watchdog on watchdog.sensor_id = sensor.id
      where sensor.machine_id = machine.id
    ), '[]'::jsonb)
  ) into v_snapshot
  from public.machines machine
  where machine.machine_code = p_machine_code;

  if v_snapshot is null then
    raise exception using errcode = 'P0002', message = 'Machine was not found.';
  end if;

  return v_snapshot;
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
  if to_regclass('public.machines') is null
    or to_regclass('public.sensors') is null
    or to_regclass('public.sensor_events') is null
    or to_regclass('public.downtime_events') is null
    or to_regclass('public.alerts') is null
    or to_regprocedure('public.get_machine_live_snapshot(text)') is null
    or to_regprocedure('public.ingest_iot_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)') is null
    or to_regprocedure('public.ingest_iot_grouped_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)') is null
    or to_regprocedure('public.ingest_iot_heartbeat(uuid,uuid,uuid,bigint,uuid,bigint,timestamptz,boolean)') is null
    or to_regprocedure('public.evaluate_sensor_watchdog(uuid,timestamptz,text,integer)') is null
    or to_regprocedure('public.update_downtime_record(uuid,text,text,boolean,boolean,uuid)') is null
    or to_regprocedure('public.aggregate_analytics_sensor_events(uuid,timestamptz,timestamptz,integer)') is null
    or to_regprocedure('public.reconcile_machine_downtime(uuid,timestamptz,text,text,jsonb)') is null
    or to_regclass('public.refresh_tokens') is null
    or to_regclass('public.auth_sessions') is null
    or to_regprocedure('public.issue_refresh_token(uuid,text,timestamptz,text)') is null
    or to_regprocedure('public.revoke_refresh_token(text)') is null
    or to_regprocedure('public.rotate_refresh_token(text,text)') is null then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.sensors'::regclass
      and attname = 'fault_source' and atttypid = 'text'::regtype and not attisdropped
  ) then
    raise exception using errcode = '55000', message = 'Required grouped downtime column is missing.';
  end if;
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.sensor_events'::regclass
      and attname = 'stale' and atttypid = 'boolean'::regtype and not attisdropped
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.sensor_events'::regclass
      and tgname = 'classify_sensor_event_staleness'
      and tgfoid = to_regprocedure('public.classify_sensor_event_staleness()')
      and tgenabled in ('O', 'A')
  ) then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.sensor_events'::regclass
      and attname = 'output_accepted' and atttypid = 'boolean'::regtype and not attisdropped
  ) or not exists (
    select 1 from pg_attribute
    where attrelid = 'public.sensor_events'::regclass
      and attname = 'output_rejection_reason' and atttypid = 'text'::regtype and not attisdropped
  ) then
    raise exception using errcode = '55000', message = 'Required output validation columns are missing.';
  end if;
  if to_regclass('public.password_setup_tokens') is null
    or to_regprocedure('public.add_invited_user(uuid,text,text,text,text,text)') is null
    or to_regprocedure('public.resend_user_invitation(uuid,uuid,text)') is null
    or to_regprocedure('public.complete_password_setup(text,text)') is null
    or to_regprocedure('public.change_account_password(uuid,text,text)') is null
    or to_regprocedure('public.list_user_accounts(integer,integer,text,text,text,text,text,text)') is null then
    raise exception using errcode = '55000', message = 'Required account dependencies are missing.';
  end if;
  if to_regprocedure('public.issue_refresh_token(uuid,text,timestamptz,text)') is null
    or has_function_privilege('service_role', 'public.issue_refresh_token(uuid,text,timestamptz)', 'execute') then
    raise exception using errcode = '55000', message = 'Required login protection is missing.';
  end if;
  if not exists (select 1 from public.machines where machine_code = 'M-01')
    or exists (
      select machine.id from public.machines machine
      left join public.sensors sensor on sensor.machine_id = machine.id
        and sensor.sensor_code in ('S-01','S-02','S-03','S-04','S-05')
      group by machine.id having count(distinct sensor.sensor_code) <> 5
    ) then
    raise exception using errcode = '55000', message = 'Required machine sensor identities are missing.';
  end if;
  return 44;
end;
$$;

revoke all on function public.ingest_iot_grouped_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)
from public, anon, authenticated;
grant execute on function public.ingest_iot_grouped_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)
to service_role;

revoke all on function public.aggregate_analytics_sensor_events(uuid,timestamptz,timestamptz,integer)
from public, anon, authenticated;
grant execute on function public.aggregate_analytics_sensor_events(uuid,timestamptz,timestamptz,integer)
to service_role;

revoke all on function public.get_analytics_first_recorded_at(uuid) from public, anon, authenticated;
grant execute on function public.get_analytics_first_recorded_at(uuid) to service_role;

revoke all on function public.get_machine_live_snapshot(text) from public, anon, authenticated;
grant execute on function public.get_machine_live_snapshot(text) to service_role;

revoke all on function public.get_backend_readiness() from public, anon, authenticated;
grant execute on function public.get_backend_readiness() to service_role;

commit;
