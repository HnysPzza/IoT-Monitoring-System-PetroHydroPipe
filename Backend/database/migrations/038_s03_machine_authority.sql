-- S-03 activity determines Running; direct and grouped faults still determine Downtime.
begin;

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
  elsif v_legacy.detection_state = 'grace'
    and v_sensor.sensor_code in ('S-01', 'S-02', 'S-03', 'S-04')
    and v_sensor.status = 'Active' and v_sensor.fault_source is null then
    update public.sensors set status = 'Inactive' where id = p_sensor_id
    returning * into v_sensor;
    v_reconcile_called := true;
  elsif v_legacy.detection_state = 'healthy' then
    if v_sensor.sensor_code in ('S-01', 'S-02', 'S-03', 'S-04')
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

  if v_sensor.sensor_code in ('S-01', 'S-02', 'S-03', 'S-04')
    and v_sensor.fault_source is distinct from 'explicit'
    and p_event_type in ('pulse', 'recovered') then
    update public.sensor_watchdog_state
    set last_activity_received_at = clock_timestamp(),
      detection_state = case when detection_state = 'grace' then 'healthy' else detection_state end
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
    raise exception using errcode = '55000', message = 'S-03 downtime authority sensor is missing.';
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
    when v_s03.status = 'Active' then 'Running'
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

commit;
