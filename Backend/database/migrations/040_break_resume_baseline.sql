begin;

-- Never reuse pre-break activity when the resumed eligible window is still empty.

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
        v_baseline := coalesce(public.watchdog_advance_eligible_time(
          v_machine.id, v_state.last_evaluated_at, p_evaluated_at, 1
        ) - interval '1 second', p_evaluated_at);
      end if;
      v_baseline := coalesce(
        v_baseline,
        case when v_sensor.sensor_code in ('S-01', 'S-02', 'S-03', 'S-04')
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


