begin;

alter table public.sensors add column if not exists fault_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sensors'::regclass
      and conname = 'sensors_fault_source_valid'
  ) then
    alter table public.sensors
      add constraint sensors_fault_source_valid
      check (fault_source is null or fault_source in ('explicit', 'absence_watchdog'));
  end if;
end;
$$;

create or replace function public.sync_process_sensor_alert(
  p_sensor_id uuid,
  p_machine_id uuid,
  p_recorded_at timestamptz,
  p_event_id uuid,
  p_event_type text,
  p_signal text,
  p_fault boolean,
  p_recovered boolean,
  p_source text
)
returns table (alert_action text, alert_record jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sensor public.sensors%rowtype;
  v_machine public.machines%rowtype;
  v_existing public.alerts%rowtype;
  v_alert public.alerts%rowtype;
  v_metadata jsonb;
  v_action text;
begin
  if not p_fault and not p_recovered then
    return query select null::text, null::jsonb;
    return;
  end if;

  select sensor.* into v_sensor
  from public.sensors sensor
  where sensor.id = p_sensor_id and sensor.machine_id = p_machine_id;
  select machine.* into v_machine
  from public.machines machine
  where machine.id = p_machine_id;
  if not found then
    raise exception using errcode = '23503', message = 'Machine was not found.';
  end if;

  select alert.* into v_existing
  from public.alerts alert
  where alert.source_type = 'sensor' and alert.source_id = p_sensor_id
    and alert.status in ('Active', 'Acknowledged')
  for update;

  if p_fault then
    v_metadata := jsonb_build_object(
      'deviceId', v_sensor.esp32_device_id,
      'sensorCode', v_sensor.sensor_code,
      'sensorLabel', v_sensor.label,
      'machineCode', v_machine.machine_code,
      'eventId', p_event_id,
      'eventType', p_event_type,
      'signal', p_signal,
      'recordedAt', p_recorded_at,
      'detectionSource', p_source,
      'processFault', true
    );

    if v_existing.id is not null then
      update public.alerts
      set severity = 'Warning',
        title = v_sensor.label || ' process issue detected',
        message = case when p_source = 'absence_watchdog'
          then v_sensor.sensor_code || ' sustained activity is absent.'
          else v_sensor.sensor_code || ' reported an explicit physical fault.' end,
        metadata = (v_existing.metadata - array[
          'recoveryPending', 'recoveredAt', 'recoveryEventId',
          'recoveryEventType', 'recoverySignal', 'acknowledgedAfterRecovery'
        ]) || v_metadata
      where id = v_existing.id
      returning * into v_alert;
      v_action := 'updated';
    else
      insert into public.alerts (
        source_type, source_id, machine_id, sensor_id, severity, status,
        title, message, metadata
      ) values (
        'sensor', p_sensor_id, p_machine_id, p_sensor_id, 'Warning', 'Active',
        v_sensor.label || ' process issue detected',
        case when p_source = 'absence_watchdog'
          then v_sensor.sensor_code || ' sustained activity is absent.'
          else v_sensor.sensor_code || ' reported an explicit physical fault.' end,
        v_metadata
      ) returning * into v_alert;
      v_action := 'created';
    end if;

    if v_action = 'created' then
      insert into public.audit_logs (action, entity_type, entity_id, metadata)
      values ('ALERT_CREATED', 'sensor', p_sensor_id,
        jsonb_build_object('alertId', v_alert.id, 'sensorCode', v_sensor.sensor_code,
          'machineCode', v_machine.machine_code, 'alertKind', 'process_issue'));
    end if;
  elsif v_existing.id is not null then
    v_metadata := v_existing.metadata || jsonb_build_object(
      'recoveryPending', true,
      'recoveredAt', p_recorded_at,
      'recoveryEventId', p_event_id,
      'recoveryEventType', p_event_type,
      'recoverySignal', p_signal,
      'recoverySource', p_source
    );
    if v_existing.status = 'Acknowledged' then
      update public.alerts
      set status = 'Resolved', resolved_at = clock_timestamp(), metadata = v_metadata
      where id = v_existing.id
      returning * into v_alert;
      v_action := 'resolved';
      insert into public.audit_logs (action, entity_type, entity_id, metadata)
      values ('ALERT_RESOLVED', 'sensor', p_sensor_id,
        jsonb_build_object('alertId', v_alert.id, 'sensorCode', v_sensor.sensor_code,
          'machineCode', v_machine.machine_code, 'resolutionSource', p_source));
    else
      update public.alerts set metadata = v_metadata
      where id = v_existing.id
      returning * into v_alert;
      v_action := 'updated';
    end if;
  end if;

  return query select v_action,
    case when v_alert.id is null then null else public.alert_to_api_json(v_alert) end;
end;
$$;

create or replace function public.reconcile_machine_downtime(
  p_machine_id uuid,
  p_triggered_at timestamptz,
  p_source text,
  p_trigger_sensor_code text,
  p_context jsonb default '{}'::jsonb
)
returns table (
  machine_status text,
  downtime_action text,
  downtime_id uuid,
  downtime_started_at timestamptz,
  downtime_ended_at timestamptz,
  downtime_duration_seconds integer,
  downtime_cause text,
  downtime_sensor_code text,
  alert_action text,
  alert_record jsonb,
  transition_descriptors jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_machine public.machines%rowtype;
  v_s03 public.sensors%rowtype;
  v_open public.downtime_events%rowtype;
  v_existing_alert public.alerts%rowtype;
  v_alert public.alerts%rowtype;
  v_s03_fault boolean;
  v_process_fault boolean;
  v_should_downtime boolean;
  v_new_machine_status text;
  v_downtime_action text;
  v_alert_action text;
  v_context jsonb := coalesce(p_context, '{}'::jsonb);
  v_notes text;
  v_end_at timestamptz;
  v_descriptors jsonb := '[]'::jsonb;
begin
  if p_source not in ('sensor_event', 'absence_watchdog') then
    raise exception using errcode = '22023', message = 'Downtime detection source is invalid.';
  end if;
  if p_triggered_at is null then
    raise exception using errcode = '22023', message = 'Downtime transition time is required.';
  end if;

  select machine.* into v_machine
  from public.machines machine
  where machine.id = p_machine_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'Machine was not found.';
  end if;

  select sensor.* into v_s03
  from public.sensors sensor
  where sensor.machine_id = p_machine_id and sensor.sensor_code = 'S-03';
  if not found then
    select case when exists (select 1 from public.sensors sensor
      where sensor.machine_id = p_machine_id and sensor.status = 'Active')
      then 'Running' else 'Idle' end into v_new_machine_status;
    return query select v_new_machine_status, null::text, null::uuid,
      null::timestamptz, null::timestamptz, null::integer, null::text, null::text,
      null::text, null::jsonb, '[]'::jsonb;
    return;
  end if;

  select exists (
    select 1 from public.sensors sensor
    where sensor.id = v_s03.id and sensor.status = 'Fault'
  ) into v_s03_fault;

  select count(*) = 3 and bool_and(sensor.status = 'Fault')
  into v_process_fault
  from public.sensors sensor
  where sensor.machine_id = p_machine_id
    and sensor.sensor_code in ('S-01', 'S-02', 'S-04');

  v_should_downtime := v_s03_fault or v_process_fault;

  select downtime.* into v_open
  from public.downtime_events downtime
  where downtime.machine_id = p_machine_id
    and downtime.sensor_id = v_s03.id
    and downtime.status = 'Open'
  for update;

  if v_should_downtime and v_open.id is null then
    v_notes := coalesce(nullif(v_context->>'notes', ''), case
      when v_process_fault then 'Group confirmation: S-01, S-02, and S-04 remained faulted.'
      else 'S-03 machine authority fault confirmed.' end);
    insert into public.downtime_events (
      machine_id, sensor_id, started_at, cause, status, notes,
      detection_source, settings_version
    ) values (
      p_machine_id, v_s03.id, p_triggered_at, 'Pending Cause Review', 'Open', v_notes,
      p_source, nullif(v_context->>'settingsVersion', '')::bigint
    ) returning * into v_open;
    v_downtime_action := 'created';

    insert into public.audit_logs (action, entity_type, entity_id, metadata)
    values ('DOWNTIME_CREATED', 'downtime', v_open.id,
      jsonb_build_object(
        'machineCode', v_machine.machine_code,
        'sensorCode', 'S-03',
        'triggerSensorCode', p_trigger_sensor_code,
        'confirmationRule', 'S-03 fault OR S-01/S-02/S-04 all faulted',
        'contributingSensors', case when v_process_fault
          then jsonb_build_array('S-01', 'S-02', 'S-04')
          else jsonb_build_array('S-03') end,
        'startedAt', v_open.started_at,
        'detectionSource', p_source
      ));

    select alert.* into v_existing_alert
    from public.alerts alert
    where alert.source_type = 'sensor' and alert.source_id = v_s03.id
      and alert.status in ('Active', 'Acknowledged')
    for update;

    v_context := v_context || jsonb_build_object(
      'confirmationRule', 'S-03 fault OR S-01/S-02/S-04 all faulted',
      'contributingSensors', case when v_process_fault
        then jsonb_build_array('S-01', 'S-02', 'S-04')
        else jsonb_build_array('S-03') end,
      'downtimeId', v_open.id,
      'detectionSource', p_source,
      'triggerSensorCode', p_trigger_sensor_code
    );

    if v_existing_alert.id is not null then
      update public.alerts
      set severity = 'Critical',
        title = v_s03.label || ' downtime detected',
        message = case when v_process_fault
          then 'S-01, S-02, and S-04 remained faulted; machine downtime confirmed.'
          else 'S-03 machine authority reported a physical fault.' end,
        metadata = (v_existing_alert.metadata - array[
          'recoveryPending', 'recoveredAt', 'acknowledgedAfterRecovery'
        ]) || v_context
      where id = v_existing_alert.id
      returning * into v_alert;
      v_alert_action := 'updated';
    else
      insert into public.alerts (
        source_type, source_id, machine_id, sensor_id, severity, status,
        title, message, metadata
      ) values (
        'sensor', v_s03.id, p_machine_id, v_s03.id, 'Critical', 'Active',
        v_s03.label || ' downtime detected',
        case when v_process_fault
          then 'S-01, S-02, and S-04 remained faulted; machine downtime confirmed.'
          else 'S-03 machine authority reported a physical fault.' end,
        jsonb_build_object('sensorCode', 'S-03', 'machineCode', v_machine.machine_code) || v_context
      ) returning * into v_alert;
      v_alert_action := 'created';
      insert into public.audit_logs (action, entity_type, entity_id, metadata)
      values ('ALERT_CREATED', 'sensor', v_s03.id,
        jsonb_build_object('alertId', v_alert.id, 'sensorCode', 'S-03',
          'machineCode', v_machine.machine_code, 'alertKind', 'machine_downtime'));
    end if;

    v_descriptors := jsonb_build_array(
      jsonb_build_object('kind', 'downtime', 'action', 'created', 'id', v_open.id,
        'sensorCode', 'S-03', 'machineCode', v_machine.machine_code),
      jsonb_build_object('kind', 'alert', 'action', v_alert_action,
        'record', public.alert_to_api_json(v_alert))
    );
  elsif not v_should_downtime and v_open.id is not null then
    v_end_at := greatest(p_triggered_at, v_open.started_at);
    update public.downtime_events
    set status = 'Resolved', ended_at = v_end_at,
      duration_seconds = greatest(0, round(extract(epoch from (v_end_at - started_at)))::integer)
    where id = v_open.id
    returning * into v_open;
    v_downtime_action := 'resolved';

    insert into public.audit_logs (action, entity_type, entity_id, metadata)
    values ('DOWNTIME_AUTO_RESOLVED', 'downtime', v_open.id,
      jsonb_build_object('machineCode', v_machine.machine_code, 'sensorCode', 'S-03',
        'endedAt', v_open.ended_at, 'durationSeconds', v_open.duration_seconds,
        'confirmationRule', 'S-03 fault OR S-01/S-02/S-04 all faulted'));

    select alert.* into v_existing_alert
    from public.alerts alert
    where alert.source_type = 'sensor' and alert.source_id = v_s03.id
      and alert.status in ('Active', 'Acknowledged')
    for update;
    if v_existing_alert.id is not null then
      if v_existing_alert.status = 'Acknowledged' then
        update public.alerts
        set status = 'Resolved', resolved_at = clock_timestamp(),
          metadata = metadata || jsonb_build_object('recoveredAt', v_end_at)
        where id = v_existing_alert.id
        returning * into v_alert;
        v_alert_action := 'resolved';
      else
        update public.alerts
        set metadata = metadata || jsonb_build_object(
          'recoveryPending', true, 'recoveredAt', v_end_at
        )
        where id = v_existing_alert.id
        returning * into v_alert;
        v_alert_action := 'updated';
      end if;
    end if;
    v_descriptors := jsonb_build_array(
      jsonb_build_object('kind', 'downtime', 'action', 'resolved', 'id', v_open.id,
        'sensorCode', 'S-03', 'machineCode', v_machine.machine_code)
    );
    if v_alert.id is not null then
      v_descriptors := v_descriptors || jsonb_build_array(jsonb_build_object(
        'kind', 'alert', 'action', v_alert_action,
        'record', public.alert_to_api_json(v_alert)
      ));
    end if;
  end if;

  select case
    when v_should_downtime then 'Downtime'
    when exists (select 1 from public.sensors sensor
      where sensor.machine_id = p_machine_id and sensor.status = 'Active') then 'Running'
    else 'Idle'
  end into v_new_machine_status;

  if v_machine.status is distinct from v_new_machine_status then
    update public.machines set status = v_new_machine_status where id = p_machine_id;
    insert into public.audit_logs (action, entity_type, entity_id, metadata)
    values ('IOT_MACHINE_STATUS_UPDATED', 'machine', p_machine_id,
      jsonb_build_object('machineCode', v_machine.machine_code,
        'previousStatus', v_machine.status, 'newStatus', v_new_machine_status,
        'source', 'grouped_downtime_rule'));
  end if;

  return query select
    v_new_machine_status,
    v_downtime_action,
    v_open.id,
    v_open.started_at,
    v_open.ended_at,
    v_open.duration_seconds,
    v_open.cause,
    case when v_open.id is null then null else 'S-03' end,
    v_alert_action,
    case when v_alert.id is null then null else public.alert_to_api_json(v_alert) end,
    v_descriptors;
end;
$$;

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
  alert_record jsonb, downtime_sensor_code text
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
  v_process_alert record;
  v_reconciliation record;
  v_alert_action text;
  v_alert_record jsonb;
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
  if v_sensor.sensor_code not in ('S-01', 'S-02', 'S-03', 'S-04') then
    raise exception using errcode = '22023', message = 'Sensor is not part of the grouped downtime rule.';
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
    return query select v_existing.id, v_existing.device_event_id, v_existing.event_type,
      v_existing.event_value, v_existing.recorded_at, true, false, false,
      v_machine.status, v_machine.status, null::text, null::uuid, null::timestamptz,
      null::timestamptz, null::integer, null::text, null::text, null::jsonb, null::text;
    return;
  end if;

  insert into public.sensor_events (
    sensor_id, machine_id, device_event_id, event_type, event_value, recorded_at
  ) values (
    p_sensor_id, p_machine_id, p_device_event_id, p_event_type, p_event_value, p_recorded_at
  ) returning * into v_event;

  if v_sensor.last_applied_recorded_at is not null
    and p_recorded_at <= v_sensor.last_applied_recorded_at then
    return query select v_event.id, v_event.device_event_id, v_event.event_type,
      v_event.event_value, v_event.recorded_at, false, true, false,
      v_machine.status, v_machine.status, null::text, null::uuid, null::timestamptz,
      null::timestamptz, null::integer, null::text, null::text, null::jsonb, null::text;
    return;
  end if;

  update public.sensors
  set status = case when p_event_type in ('pulse', 'recovered') then 'Active'
      when p_event_type = 'idle' then 'Inactive' else 'Fault' end,
    fault_source = case when p_event_type = 'fault' then 'explicit' else null end,
    last_applied_recorded_at = p_recorded_at
  where id = p_sensor_id
  returning * into v_sensor;

  if v_sensor.sensor_code <> 'S-03' then
    select * into v_process_alert
    from public.sync_process_sensor_alert(
      p_sensor_id, p_machine_id, p_recorded_at, v_event.id, p_event_type,
      p_event_value->>'signal', p_event_type = 'fault',
      p_event_type in ('pulse', 'recovered'), 'sensor_event'
    );
  end if;

  select * into v_reconciliation
  from public.reconcile_machine_downtime(
    p_machine_id, p_recorded_at, 'sensor_event', v_sensor.sensor_code,
    jsonb_build_object('eventId', v_event.id, 'eventType', p_event_type)
  );

  if v_reconciliation.alert_record is not null then
    v_alert_action := v_reconciliation.alert_action;
    v_alert_record := v_reconciliation.alert_record;
  elsif v_sensor.sensor_code <> 'S-03' then
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
    v_event.event_value, v_event.recorded_at, false, false, true,
    v_machine.status, v_reconciliation.machine_status,
    v_reconciliation.downtime_action, v_reconciliation.downtime_id,
    v_reconciliation.downtime_started_at, v_reconciliation.downtime_ended_at,
    v_reconciliation.downtime_duration_seconds, v_reconciliation.downtime_cause,
    v_alert_action, v_alert_record, v_reconciliation.downtime_sensor_code;
end;
$$;

do $$
begin
  if to_regprocedure('public.ingest_iot_sensor_event_legacy_031(uuid,uuid,uuid,text,jsonb,timestamptz)') is null
    and to_regprocedure('public.ingest_iot_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)') is not null then
    alter function public.ingest_iot_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)
      rename to ingest_iot_sensor_event_legacy_031;
  end if;
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
  alert_record jsonb
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

  if v_sensor_code in ('S-01', 'S-02', 'S-03', 'S-04')
    and p_event_type in ('pulse', 'idle', 'fault', 'recovered')
    and not (p_event_type in ('pulse', 'recovered') and v_fault_source = 'absence_watchdog') then
    return query select grouped.sensor_event_id, grouped.device_event_id, grouped.event_type,
      grouped.event_value, grouped.recorded_at, grouped.duplicate, grouped.stale,
      grouped.state_applied, grouped.previous_machine_status, grouped.new_machine_status,
      grouped.downtime_action, grouped.downtime_id, grouped.downtime_started_at,
      grouped.downtime_ended_at, grouped.downtime_duration_seconds, grouped.downtime_cause,
      grouped.alert_action, grouped.alert_record
    from public.ingest_iot_grouped_sensor_event(
      p_device_event_id, p_sensor_id, p_machine_id, p_event_type, p_event_value, p_recorded_at
    ) grouped;
    return;
  end if;

  if (v_sensor_code = 'S-05' and p_event_type in ('downtime', 'fault'))
    or (p_event_type = 'downtime' and p_event_value->>'signal' = 'no_pulse')
    or (v_fault_source = 'absence_watchdog' and p_event_type in ('pulse', 'recovered')
      and p_event_value->>'signal' = 'active')
    or (v_detection_state in ('downtime', 'recovering')
      and p_event_type in ('pulse', 'recovered') and p_event_value->>'signal' = 'active') then
    return query select observed.sensor_event_id, observed.device_event_id,
      observed.event_type, observed.event_value, observed.recorded_at,
      observed.duplicate, observed.stale, observed.state_applied,
      observed.previous_machine_status, observed.new_machine_status,
      observed.downtime_action, observed.downtime_id, observed.downtime_started_at,
      observed.downtime_ended_at, observed.downtime_duration_seconds,
      observed.downtime_cause, observed.alert_action, observed.alert_record
    from public.ingest_iot_watchdog_observation(
      p_device_event_id, p_sensor_id, p_machine_id, p_event_type, p_event_value, p_recorded_at
    ) observed;
    return;
  end if;

  return query select legacy.sensor_event_id, legacy.device_event_id, legacy.event_type,
    legacy.event_value, legacy.recorded_at, legacy.duplicate, legacy.stale,
    legacy.state_applied, legacy.previous_machine_status, legacy.new_machine_status,
    legacy.downtime_action, legacy.downtime_id, legacy.downtime_started_at,
    legacy.downtime_ended_at, legacy.downtime_duration_seconds, legacy.downtime_cause,
    legacy.alert_action, legacy.alert_record
  from public.ingest_iot_sensor_event_legacy_031(
    p_device_event_id, p_sensor_id, p_machine_id, p_event_type, p_event_value, p_recorded_at
  ) legacy;
end;
$$;

create or replace function public.sync_watchdog_connectivity_alert(
  p_sensor_id uuid,
  p_machine_id uuid,
  p_connectivity_state text,
  p_evaluated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sensor public.sensors%rowtype;
  v_machine public.machines%rowtype;
  v_existing public.alerts%rowtype;
  v_alert public.alerts%rowtype;
  v_descriptors jsonb := '[]'::jsonb;
begin
  select sensor.* into v_sensor from public.sensors sensor
  where sensor.id = p_sensor_id and sensor.machine_id = p_machine_id;
  select machine.* into v_machine from public.machines machine where machine.id = p_machine_id;
  select alert.* into v_existing from public.alerts alert
  where alert.source_type = 'sensor_connectivity' and alert.source_id = p_sensor_id
    and alert.status in ('Active', 'Acknowledged') for update;

  if p_connectivity_state = 'offline' and v_existing.id is null then
    insert into public.alerts (
      source_type, source_id, machine_id, sensor_id, severity, status,
      title, message, metadata
    ) values (
      'sensor_connectivity', p_sensor_id, p_machine_id, p_sensor_id, 'Warning', 'Active',
      v_sensor.label || ' device offline',
      v_sensor.sensor_code || ' heartbeat is stale.',
      jsonb_build_object('sensorCode', v_sensor.sensor_code,
        'machineCode', v_machine.machine_code, 'evaluatedAt', p_evaluated_at)
    ) returning * into v_alert;
    insert into public.audit_logs (action, entity_type, entity_id, metadata)
    values ('CONNECTIVITY_ALERT_CREATED', 'sensor_connectivity', p_sensor_id,
      jsonb_build_object('alertId', v_alert.id, 'sensorCode', v_sensor.sensor_code));
    v_descriptors := jsonb_build_array(jsonb_build_object(
      'kind', 'alert', 'action', 'created', 'record', public.alert_to_api_json(v_alert)
    ));
  elsif p_connectivity_state <> 'offline' and v_existing.id is not null then
    update public.alerts
    set status = 'Resolved', resolved_at = clock_timestamp(),
      metadata = metadata || jsonb_build_object('connectivityRecoveredAt', p_evaluated_at)
    where id = v_existing.id returning * into v_alert;
    insert into public.audit_logs (action, entity_type, entity_id, metadata)
    values ('CONNECTIVITY_ALERT_RESOLVED', 'sensor_connectivity', p_sensor_id,
      jsonb_build_object('alertId', v_alert.id, 'sensorCode', v_sensor.sensor_code));
    v_descriptors := jsonb_build_array(jsonb_build_object(
      'kind', 'alert', 'action', 'resolved', 'record', public.alert_to_api_json(v_alert)
    ));
  end if;
  return v_descriptors;
end;
$$;

do $$
begin
  if to_regprocedure('public.evaluate_sensor_watchdog_legacy(uuid,timestamptz,text,integer)') is null
    and to_regprocedure('public.evaluate_sensor_watchdog(uuid,timestamptz,text,integer)') is not null then
    alter function public.evaluate_sensor_watchdog(uuid,timestamptz,text,integer)
      rename to evaluate_sensor_watchdog_legacy;
  end if;
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
begin
  select sensor.* into v_sensor from public.sensors sensor where sensor.id = p_sensor_id;
  if not found then raise exception using errcode = 'P0002', message = 'Watchdog sensor was not found.'; end if;

  select * into v_legacy from public.evaluate_sensor_watchdog_legacy(
    p_sensor_id, p_evaluated_at,
    case when v_sensor.sensor_code = 'S-05' or p_mode <> 'enforce' then p_mode else 'observe' end,
    p_stale_after_seconds
  );

  if v_sensor.sensor_code = 'S-05' or p_mode <> 'enforce' then
    return query select v_legacy.evaluated_sensor_id, v_legacy.connectivity_state,
      v_legacy.detection_state, v_legacy.transition_descriptors;
    return;
  end if;

  select machine.* into v_machine from public.machines machine
  where machine.id = v_sensor.machine_id for update;
  v_previous_machine_status := v_machine.status;
  v_descriptors := coalesce(v_legacy.transition_descriptors, '[]'::jsonb);
  v_connectivity_descriptors := public.sync_watchdog_connectivity_alert(
    p_sensor_id, v_machine.id, v_legacy.connectivity_state, p_evaluated_at
  );
  v_descriptors := v_descriptors || coalesce(v_connectivity_descriptors, '[]'::jsonb);

  v_was_watchdog_fault := v_sensor.status = 'Fault'
    and v_sensor.fault_source = 'absence_watchdog';

  if v_legacy.detection_state = 'downtime' then
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
  elsif v_legacy.detection_state = 'healthy' then
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

  if v_reconcile_called then
    select * into v_reconciliation
    from public.reconcile_machine_downtime(
      v_machine.id, p_evaluated_at, 'absence_watchdog', v_sensor.sensor_code,
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

create or replace function public.override_sensor_recovery(
  p_sensor_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns table (
  sensor_record jsonb,
  machine_record jsonb,
  downtime_action text,
  downtime_id uuid,
  alert_action text,
  alert_record jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sensor public.sensors%rowtype;
  v_machine public.machines%rowtype;
  v_manual_downtime public.downtime_events%rowtype;
  v_reconciliation record;
  v_process_alert record;
  v_previous_sensor_status text;
  v_previous_machine_status text;
  v_manual_action text;
  v_downtime_action text;
  v_downtime_id uuid;
  v_alert_action text;
  v_alert_record jsonb;
  v_reason text := btrim(p_reason);
  v_recovered_at timestamptz := clock_timestamp();
begin
  if v_reason is null or v_reason = '' or char_length(v_reason) > 500 then
    raise exception using errcode = '22023',
      message = 'A recovery override reason between 1 and 500 characters is required.';
  end if;

  select sensor.* into v_sensor from public.sensors sensor
  where sensor.id = p_sensor_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Sensor not found.'; end if;
  select machine.* into v_machine from public.machines machine
  where machine.id = v_sensor.machine_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Machine not found.'; end if;

  v_previous_sensor_status := v_sensor.status;
  v_previous_machine_status := v_machine.status;

  update public.sensors set status = 'Active', fault_source = null
  where id = v_sensor.id returning * into v_sensor;

  if v_sensor.sensor_code <> 'S-03' then
    update public.downtime_events
    set status = 'Resolved', ended_at = v_recovered_at,
      duration_seconds = greatest(0, round(extract(epoch from (v_recovered_at - started_at)))::integer)
    where machine_id = v_machine.id and sensor_id = v_sensor.id and status = 'Open'
    returning * into v_manual_downtime;
    if found then v_manual_action := 'resolved'; end if;
  end if;

  if v_sensor.sensor_code in ('S-01', 'S-02', 'S-04') then
    select * into v_process_alert
    from public.sync_process_sensor_alert(
      v_sensor.id, v_machine.id, v_recovered_at, null, 'manual_override', 'active',
      false, true, 'manual_override'
    );
    v_alert_action := v_process_alert.alert_action;
    v_alert_record := v_process_alert.alert_record;
  end if;

  select * into v_reconciliation
  from public.reconcile_machine_downtime(
    v_machine.id, v_recovered_at, 'sensor_event', v_sensor.sensor_code,
    jsonb_build_object('notes', 'Manual sensor recovery override: ' || v_reason)
  );
  if v_reconciliation.alert_record is not null then
    v_alert_action := v_reconciliation.alert_action;
    v_alert_record := v_reconciliation.alert_record;
  end if;
  v_downtime_action := coalesce(v_reconciliation.downtime_action, v_manual_action);
  v_downtime_id := coalesce(v_reconciliation.downtime_id, v_manual_downtime.id);

  select machine.* into v_machine from public.machines machine where machine.id = v_machine.id;
  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  values (p_actor_user_id, 'SENSOR_MANUAL_RECOVERY_OVERRIDE', 'sensor', v_sensor.id,
    jsonb_build_object(
      'sensorCode', v_sensor.sensor_code, 'machineCode', v_machine.machine_code,
      'previousSensorStatus', v_previous_sensor_status, 'newSensorStatus', v_sensor.status,
      'previousMachineStatus', v_previous_machine_status, 'newMachineStatus', v_machine.status,
      'reason', v_reason, 'recoveredAt', v_recovered_at,
      'downtimeId', v_downtime_id, 'downtimeOwnerSensorCode', 'S-03'
    ));

  return query select
    to_jsonb(v_sensor),
    to_jsonb(v_machine) || jsonb_build_object(
      'sensor_count', (select count(*) from public.sensors sensor where sensor.machine_id = v_machine.id)),
    v_downtime_action, v_downtime_id, v_alert_action, v_alert_record;
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
    or to_regprocedure('public.ingest_iot_heartbeat(uuid,uuid,uuid,bigint,uuid,bigint,timestamptz,boolean)') is null
    or to_regprocedure('public.update_downtime_record(uuid,text,text,boolean,boolean)') is null
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
  return 32;
end;
$$;

revoke all on function public.sync_process_sensor_alert(uuid,uuid,timestamptz,uuid,text,text,boolean,boolean,text)
  from public, anon, authenticated, service_role;
revoke all on function public.reconcile_machine_downtime(uuid,timestamptz,text,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.ingest_iot_grouped_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.sync_watchdog_connectivity_alert(uuid,uuid,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.ingest_iot_sensor_event_legacy_031(uuid,uuid,uuid,text,jsonb,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.evaluate_sensor_watchdog_legacy(uuid,timestamptz,text,integer)
  from public, anon, authenticated, service_role;
revoke all on function public.ingest_iot_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)
  from public, anon, authenticated;
grant execute on function public.ingest_iot_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)
  to service_role;
revoke all on function public.evaluate_sensor_watchdog(uuid,timestamptz,text,integer)
  from public, anon, authenticated;
grant execute on function public.evaluate_sensor_watchdog(uuid,timestamptz,text,integer)
  to service_role;
revoke all on function public.override_sensor_recovery(uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_backend_readiness() from public, anon, authenticated;
grant execute on function public.get_backend_readiness() to service_role;

commit;
