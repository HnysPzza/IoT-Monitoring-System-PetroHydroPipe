-- S-05 normal telemetry must not call the legacy any-fault machine-status path.

begin;

do $$
begin
  if to_regprocedure('public.reconcile_machine_downtime(uuid,timestamp with time zone,text,text,jsonb)') is null
    or to_regprocedure('public.ingest_iot_sensor_event_legacy_031(uuid,uuid,uuid,text,jsonb,timestamp with time zone)') is null then
    raise exception using errcode = '55000', message = 'Apply migrations through 033 before migration 034.';
  end if;
end;
$$;

drop function public.ingest_iot_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz);
drop function public.ingest_iot_grouped_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz);

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
    return query select v_existing.id, v_existing.device_event_id, v_existing.event_type,
      v_existing.event_value, v_existing.recorded_at, true, false, false,
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

  if v_sensor.last_applied_recorded_at is not null
    and p_recorded_at <= v_sensor.last_applied_recorded_at then
    return query select v_event.id, v_event.device_event_id, v_event.event_type,
      v_event.event_value, v_event.recorded_at, false, true, false,
      v_machine.status, v_machine.status, null::text, null::uuid, null::timestamptz,
      null::timestamptz, null::integer, null::text, null::text, null::jsonb, null::text,
      '[]'::jsonb;
    return;
  end if;

  update public.sensors
  set status = case
      when p_event_type in ('pulse', 'recovered') then 'Active'
      when p_event_type = 'idle' and v_sensor.status = 'Fault' then 'Fault'
      when p_event_type = 'idle' then 'Inactive'
      else 'Fault'
    end,
    fault_source = case
      when p_event_type = 'fault' then 'explicit'
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
    v_event.event_value, v_event.recorded_at, false, false, true,
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
    return query select grouped.sensor_event_id, grouped.device_event_id, grouped.event_type,
      grouped.event_value, grouped.recorded_at, grouped.duplicate, grouped.stale,
      grouped.state_applied, grouped.previous_machine_status, grouped.new_machine_status,
      grouped.downtime_action, grouped.downtime_id, grouped.downtime_started_at,
      grouped.downtime_ended_at, grouped.downtime_duration_seconds, grouped.downtime_cause,
      grouped.alert_action, grouped.alert_record, grouped.downtime_sensor_code,
      grouped.transition_descriptors
    from public.ingest_iot_grouped_sensor_event(
      p_device_event_id, p_sensor_id, p_machine_id, p_event_type, p_event_value, p_recorded_at
    ) grouped;
    return;
  end if;

  raise exception using errcode = '22023', message = 'Unsupported sensor event routing.';
end;
$$;

create or replace function public.update_downtime_record(
  p_downtime_id uuid,
  p_cause text,
  p_notes text,
  p_has_notes boolean,
  p_resolve boolean
)
returns table (downtime_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_downtime public.downtime_events%rowtype;
  v_sensor_code text;
begin
  select downtime.* into v_downtime
  from public.downtime_events downtime
  where downtime.id = p_downtime_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Downtime record not found.';
  end if;

  if p_resolve then
    raise exception using errcode = '22023',
      message = 'Sensor-managed downtime must be resolved by accepted sensor recovery.';
  end if;

  select sensor.sensor_code into v_sensor_code
  from public.sensors sensor where sensor.id = v_downtime.sensor_id;

  if p_cause is not null and v_sensor_code is distinct from 'S-03' then
    raise exception using errcode = '22023', message = 'Downtime cause is locked for this sensor.';
  end if;

  update public.downtime_events
  set cause = coalesce(p_cause, cause),
    notes = case when p_has_notes then p_notes else notes end
  where id = p_downtime_id;

  return query select p_downtime_id;
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
  v_current_confirmation_rule text;
  v_current_contributing_sensors jsonb;
  v_current_message text;
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
  v_current_confirmation_rule := case when v_s03_fault
    then 'S-03 fault' else 'S-01/S-02/S-04 all faulted' end;
  v_current_contributing_sensors := case when v_s03_fault
    then jsonb_build_array('S-03')
    else jsonb_build_array('S-01', 'S-02', 'S-04') end;
  v_current_message := case when v_s03_fault
    then 'S-03 machine authority reported a physical fault.'
    else 'S-01, S-02, and S-04 remained faulted; machine downtime confirmed.' end;

  select downtime.* into v_open
  from public.downtime_events downtime
  where downtime.machine_id = p_machine_id
    and downtime.sensor_id = v_s03.id
    and downtime.status = 'Open'
  for update;

  if v_should_downtime and v_open.id is null then
    v_notes := coalesce(nullif(v_context->>'notes', ''), case
      when v_s03_fault then 'S-03 machine authority fault confirmed.'
      else 'Group confirmation: S-01, S-02, and S-04 remained faulted.' end);
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
        'contributingSensors', v_current_contributing_sensors,
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
      'contributingSensors', v_current_contributing_sensors,
      'downtimeId', v_open.id,
      'detectionSource', p_source,
      'triggerSensorCode', p_trigger_sensor_code,
      'currentConfirmationRule', v_current_confirmation_rule,
      'currentContributingSensors', v_current_contributing_sensors,
      'currentDetectionSource', p_source
    );

    if v_existing_alert.id is not null then
      update public.alerts
      set severity = 'Critical',
        title = v_s03.label || ' downtime detected',
        message = v_current_message,
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
        v_current_message,
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
  elsif v_should_downtime and v_open.id is not null then
    select alert.* into v_existing_alert
    from public.alerts alert
    where alert.source_type = 'sensor' and alert.source_id = v_s03.id
      and alert.status in ('Active', 'Acknowledged')
    for update;
    if v_existing_alert.id is not null and (
      v_existing_alert.metadata->>'currentConfirmationRule' is distinct from v_current_confirmation_rule
      or coalesce(v_existing_alert.metadata->'currentContributingSensors', 'null'::jsonb)
        is distinct from v_current_contributing_sensors
      or v_existing_alert.message is distinct from v_current_message
    ) then
      update public.alerts
      set severity = 'Critical',
        title = v_s03.label || ' downtime detected',
        message = v_current_message,
        metadata = (v_existing_alert.metadata - array[
          'recoveryPending', 'recoveredAt', 'acknowledgedAfterRecovery'
        ]) || jsonb_build_object(
          'currentConfirmationRule', v_current_confirmation_rule,
          'currentContributingSensors', v_current_contributing_sensors,
          'currentDetectionSource', p_source
        )
      where id = v_existing_alert.id
      returning * into v_alert;
      v_alert_action := 'updated';
      v_descriptors := jsonb_build_array(jsonb_build_object(
        'kind', 'alert', 'action', v_alert_action,
        'record', public.alert_to_api_json(v_alert)
      ));
    end if;
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

with desired as (
  select machine.id, machine.machine_code, machine.status as previous_status,
    case
      when exists (
        select 1 from public.sensors sensor
        where sensor.machine_id = machine.id and sensor.sensor_code = 'S-03' and sensor.status = 'Fault'
      ) or (
        select count(*) = 3 and bool_and(sensor.status = 'Fault')
        from public.sensors sensor
        where sensor.machine_id = machine.id and sensor.sensor_code in ('S-01', 'S-02', 'S-04')
      ) then 'Downtime'
      when exists (
        select 1 from public.sensors sensor
        where sensor.machine_id = machine.id and sensor.status = 'Active'
      ) then 'Running'
      else 'Idle'
    end as new_status
  from public.machines machine
), changed as (
  update public.machines machine
  set status = desired.new_status, updated_at = clock_timestamp()
  from desired
  where machine.id = desired.id and machine.status is distinct from desired.new_status
  returning machine.id, desired.machine_code, desired.previous_status, desired.new_status
)
insert into public.audit_logs (action, entity_type, entity_id, metadata)
select 'MACHINE_STATUS_RECONCILED', 'machine', changed.id,
  jsonb_build_object('machineCode', changed.machine_code, 'previousStatus', changed.previous_status,
    'newStatus', changed.new_status, 'source', 'migration_034_output_telemetry_repair')
from changed;

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
  return 34;
end;
$$;

revoke all on function public.ingest_iot_grouped_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.ingest_iot_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)
  from public, anon, authenticated;
grant execute on function public.ingest_iot_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)
  to service_role;
revoke all on function public.get_backend_readiness() from public, anon, authenticated;
grant execute on function public.get_backend_readiness() to service_role;

commit;
