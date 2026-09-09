-- Persist process grace as Idle without clearing an existing fault.
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
    and v_sensor.sensor_code in ('S-01', 'S-02', 'S-04')
    and v_sensor.status = 'Active' and v_sensor.fault_source is null then
    update public.sensors set status = 'Inactive' where id = p_sensor_id
    returning * into v_sensor;
    v_reconcile_called := true;
  elsif v_legacy.detection_state = 'healthy' then
    if v_sensor.sensor_code in ('S-01', 'S-02', 'S-04')
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

  if v_sensor.sensor_code in ('S-01', 'S-02', 'S-04')
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

create or replace function public.evaluate_sensor_watchdog_legacy(
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
  v_settings public.machine_operational_settings%rowtype;
  v_state public.sensor_watchdog_state%rowtype;
  v_incident boolean;
  v_alert public.alerts%rowtype;
  v_existing_alert public.alerts%rowtype;
  v_previous_connectivity text;
  v_previous_detection text;
  v_connectivity text;
  v_detection text;
  v_threshold jsonb;
  v_enabled boolean;
  v_trigger_seconds integer;
  v_recovery_seconds integer;
  v_is_eligible boolean;
  v_baseline timestamptz;
  v_accumulated bigint;
  v_transition_at timestamptz;
  v_descriptors jsonb := '[]'::jsonb;
begin
  if p_mode not in ('disabled', 'observe', 'enforce') then
    raise exception using errcode = '22023', message = 'Watchdog mode is invalid.';
  end if;
  if p_evaluated_at is null or p_evaluated_at > clock_timestamp() + interval '5 minutes'
    or p_stale_after_seconds is null or p_stale_after_seconds < 2 then
    raise exception using errcode = '22023', message = 'Watchdog evaluation inputs are invalid.';
  end if;

  select sensor.* into v_sensor from public.sensors sensor
  where sensor.id = p_sensor_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Watchdog sensor was not found.'; end if;

  select machine.* into v_machine from public.machines machine
  where machine.id = v_sensor.machine_id for update;
  if not found then raise exception using errcode = '55000', message = 'Watchdog machine is missing.'; end if;

  select settings.* into v_settings from public.machine_operational_settings settings
  where settings.machine_id = v_machine.id for update;
  if not found then raise exception using errcode = '55000', message = 'Watchdog settings are missing.'; end if;

  perform 1 from public.machine_operational_settings_history history
  where history.machine_id = v_machine.id and history.version = v_settings.version
    and history.effective_to is null for share;
  if not found then raise exception using errcode = '55000', message = 'Current watchdog settings history is missing.'; end if;

  select state.* into v_state from public.sensor_watchdog_state state
  where state.sensor_id = p_sensor_id for update;
  if not found then raise exception using errcode = '55000', message = 'Watchdog runtime state is missing.'; end if;

  v_previous_connectivity := v_state.connectivity_state;
  v_previous_detection := v_state.detection_state;

  if p_mode = 'disabled' then
    return query select p_sensor_id, v_previous_connectivity, v_previous_detection, v_descriptors;
    return;
  end if;

  v_threshold := v_settings.sensor_thresholds->v_sensor.sensor_code;
  if jsonb_typeof(v_threshold) is distinct from 'object' then
    raise exception using errcode = '55000', message = 'Watchdog sensor settings are malformed.';
  end if;

  v_enabled := coalesce((v_threshold->>'absenceDetectionEnabled')::boolean, false)
    and v_sensor.sensor_code <> 'S-05';
  v_trigger_seconds := nullif(v_threshold->>'triggerSeconds', '')::integer;
  v_recovery_seconds := nullif(v_threshold->>'recoverySeconds', '')::integer;

  v_connectivity := case
    when v_state.last_heartbeat_received_at is null then 'unknown'
    when p_evaluated_at - v_state.last_heartbeat_received_at > make_interval(secs => p_stale_after_seconds)
      then 'offline'
    else v_state.connectivity_state
  end;

  if v_connectivity is distinct from v_previous_connectivity then
    insert into public.sensor_watchdog_transitions (
      sensor_id, machine_id, mode, from_state, to_state, reason, evaluated_at, settings_version
    ) values (
      p_sensor_id, v_machine.id, p_mode,
      'connectivity:' || v_previous_connectivity, 'connectivity:' || v_connectivity,
      case when v_connectivity = 'offline' then 'heartbeat_stale' else 'heartbeat_received' end,
      p_evaluated_at, v_settings.version
    );
  end if;

  if p_mode = 'enforce' then
    select alert.* into v_existing_alert from public.alerts alert
    where alert.source_type = 'sensor_connectivity' and alert.source_id = p_sensor_id
      and alert.status in ('Active', 'Acknowledged') for update;

    if v_connectivity = 'offline' then
      if not found then
        insert into public.alerts (
          source_type, source_id, machine_id, sensor_id, severity, status, title, message, metadata
        ) values (
          'sensor_connectivity', p_sensor_id, v_machine.id, p_sensor_id,
          'Warning', 'Active', v_sensor.label || ' device offline',
          v_sensor.sensor_code || ' heartbeat is stale.',
          jsonb_build_object('sensorCode', v_sensor.sensor_code, 'machineCode', v_machine.machine_code)
        ) returning * into v_alert;
        insert into public.audit_logs (action, entity_type, entity_id, metadata)
        values ('CONNECTIVITY_ALERT_CREATED', 'sensor_connectivity', p_sensor_id,
          jsonb_build_object('alertId', v_alert.id, 'sensorCode', v_sensor.sensor_code));
        v_descriptors := v_descriptors || jsonb_build_array(jsonb_build_object(
          'kind', 'alert', 'action', 'created', 'record', public.alert_to_api_json(v_alert)
        ));
      end if;
    elsif v_existing_alert.id is not null then
      update public.alerts set status = 'Resolved', resolved_at = clock_timestamp(),
        metadata = metadata || jsonb_build_object('connectivityRecoveredAt', p_evaluated_at)
      where id = v_existing_alert.id returning * into v_alert;
      insert into public.audit_logs (action, entity_type, entity_id, metadata)
      values ('CONNECTIVITY_ALERT_RESOLVED', 'sensor_connectivity', p_sensor_id,
        jsonb_build_object('alertId', v_alert.id, 'sensorCode', v_sensor.sensor_code));
      v_descriptors := v_descriptors || jsonb_build_array(jsonb_build_object(
        'kind', 'alert', 'action', 'resolved', 'record', public.alert_to_api_json(v_alert)
      ));
    end if;
  end if;

  v_incident := v_sensor.fault_source = 'absence_watchdog'
    or v_state.detection_state in ('downtime', 'recovering');
  v_incident := coalesce(v_incident, false);

  if not v_enabled then
    v_detection := 'disabled';
    update public.sensor_watchdog_state set connectivity_state = v_connectivity,
      detection_state = v_detection, absence_baseline_at = null,
      recovery_started_at = null, recovery_observation_count = 0,
      settings_version = v_settings.version, last_evaluated_at = p_evaluated_at,
      updated_at = clock_timestamp() where sensor_id = p_sensor_id;
  else
    if v_trigger_seconds is null or v_trigger_seconds < 1
      or v_recovery_seconds is null or v_recovery_seconds < 1 then
      raise exception using errcode = '55000', message = 'Enabled watchdog thresholds are invalid.';
    end if;

    v_is_eligible := public.watchdog_eligible_seconds(
      v_machine.id, p_evaluated_at, p_evaluated_at + interval '1 second'
    ) = 1;

    if v_connectivity <> 'online' then
      v_detection := case when not v_incident then 'suspended' else 'downtime' end;
      update public.sensor_watchdog_state set connectivity_state = v_connectivity,
        detection_state = v_detection, absence_baseline_at = case when not v_incident then null else absence_baseline_at end,
        recovery_started_at = null, recovery_observation_count = 0,
        settings_version = v_settings.version, last_evaluated_at = p_evaluated_at,
        updated_at = clock_timestamp() where sensor_id = p_sensor_id;
    elsif not v_is_eligible then
      v_detection := case when not v_incident then 'suspended' else 'downtime' end;
      update public.sensor_watchdog_state set connectivity_state = v_connectivity,
        detection_state = v_detection, absence_baseline_at = case when not v_incident then null else absence_baseline_at end,
        recovery_started_at = null, recovery_observation_count = 0,
        settings_version = v_settings.version, last_evaluated_at = p_evaluated_at,
        updated_at = clock_timestamp() where sensor_id = p_sensor_id;
    elsif not v_incident then
      if v_previous_detection = 'suspended' and v_state.absence_baseline_at is null
        and v_state.last_evaluated_at is not null then
        v_baseline := public.watchdog_advance_eligible_time(
          v_machine.id, v_state.last_evaluated_at, p_evaluated_at, 1
        ) - interval '1 second';
      end if;
      v_baseline := coalesce(
        v_baseline,
        case when v_sensor.sensor_code in ('S-01', 'S-02', 'S-04')
          then greatest(v_state.absence_baseline_at, v_state.last_activity_received_at)
          else v_state.last_activity_received_at end,
        v_state.last_heartbeat_received_at, p_evaluated_at
      );
      if v_baseline > p_evaluated_at then v_baseline := p_evaluated_at; end if;
      v_accumulated := public.watchdog_eligible_seconds(v_machine.id, v_baseline, p_evaluated_at);

      if v_accumulated < v_trigger_seconds then
        v_detection := case when v_accumulated = 0 then 'healthy' else 'grace' end;
      else
        v_detection := 'downtime';
        v_transition_at := public.watchdog_advance_eligible_time(
          v_machine.id, v_baseline, p_evaluated_at, v_trigger_seconds
        );


      end if;

      update public.sensor_watchdog_state set connectivity_state = v_connectivity,
        detection_state = v_detection, absence_baseline_at = v_baseline,
        open_downtime_id = null, settings_version = v_settings.version,
        last_evaluated_at = p_evaluated_at, updated_at = clock_timestamp()
      where sensor_id = p_sensor_id;
    else
      v_detection := case when v_state.recovery_observation_count > 0 then 'recovering' else 'downtime' end;
      if v_state.recovery_observation_count >= 2 and v_state.recovery_started_at is not null
        and public.watchdog_eligible_seconds(v_machine.id, v_state.recovery_started_at, p_evaluated_at) >= v_recovery_seconds then
        v_detection := 'healthy';
        v_transition_at := public.watchdog_advance_eligible_time(
          v_machine.id, v_state.recovery_started_at, p_evaluated_at, v_recovery_seconds
        );


      end if;

      update public.sensor_watchdog_state set connectivity_state = v_connectivity,
        detection_state = v_detection,
        absence_baseline_at = case when v_detection = 'healthy' then p_evaluated_at else absence_baseline_at end,
        recovery_started_at = case when v_detection = 'healthy' then null else recovery_started_at end,
        recovery_observation_count = case when v_detection = 'healthy' then 0 else recovery_observation_count end,
        open_downtime_id = null,
        settings_version = v_settings.version, last_evaluated_at = p_evaluated_at,
        updated_at = clock_timestamp() where sensor_id = p_sensor_id;
    end if;
  end if;

  if v_detection is distinct from v_previous_detection then
    insert into public.sensor_watchdog_transitions (
      sensor_id, machine_id, mode, from_state, to_state, reason, evaluated_at, settings_version
    ) values (
      p_sensor_id, v_machine.id, p_mode,
      'detection:' || v_previous_detection, 'detection:' || v_detection,
      case v_detection when 'downtime' then 'absence_threshold_reached'
        when 'recovering' then 'activity_recovery_observed'
        when 'healthy' then 'activity_healthy' when 'disabled' then 'detection_disabled'
        else 'detection_suspended' end,
      p_evaluated_at, v_settings.version
    );
  end if;

  return query select p_sensor_id, v_connectivity, v_detection, v_descriptors;
end;
$$;

revoke all on function public.evaluate_sensor_watchdog_legacy(uuid,timestamptz,text,integer)
  from public, anon, authenticated, service_role;

commit;
