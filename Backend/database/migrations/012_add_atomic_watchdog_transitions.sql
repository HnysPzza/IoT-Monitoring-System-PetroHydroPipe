begin;

set local lock_timeout = '2s';

alter table public.downtime_events
add column if not exists detection_source text;

alter table public.downtime_events
add column if not exists settings_version bigint;

update public.downtime_events
set detection_source = 'sensor_event'
where detection_source is null;

alter table public.downtime_events
alter column detection_source set default 'sensor_event';

alter table public.downtime_events
alter column detection_source set not null;

alter table public.downtime_events
drop constraint if exists downtime_detection_source_valid;

alter table public.downtime_events
add constraint downtime_detection_source_valid
check (detection_source in ('sensor_event', 'absence_watchdog'));

alter table public.sensor_watchdog_state
add column if not exists recovery_observation_count integer not null default 0;

alter table public.sensor_watchdog_state
drop constraint if exists watchdog_recovery_observation_count_valid;

alter table public.sensor_watchdog_state
add constraint watchdog_recovery_observation_count_valid
check (recovery_observation_count between 0 and 2);

create or replace function public.watchdog_eligible_seconds(
  p_machine_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz
)
returns bigint
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_history public.machine_operational_settings_history%rowtype;
  v_segment_start timestamptz;
  v_segment_end timestamptz;
  v_covered_until timestamptz := p_started_at;
  v_day date;
  v_work_start timestamptz;
  v_work_end timestamptz;
  v_overlap_start timestamptz;
  v_overlap_end timestamptz;
  v_break jsonb;
  v_break_start timestamptz;
  v_break_end timestamptz;
  v_seconds numeric := 0;
  v_schedule jsonb;
  v_grace integer;
begin
  if p_machine_id is null or p_started_at is null or p_ended_at is null or p_ended_at < p_started_at then
    raise exception using errcode = '22023', message = 'Operational-time interval is invalid.';
  end if;
  if p_ended_at = p_started_at then return 0; end if;

  for v_history in
    select history.*
    from public.machine_operational_settings_history history
    where history.machine_id = p_machine_id
      and (history.effective_to is null or history.effective_to > p_started_at)
      and (history.effective_from is null or history.effective_from < p_ended_at)
    order by history.effective_from nulls first, history.version
  loop
    v_segment_start := greatest(p_started_at, coalesce(v_history.effective_from, p_started_at));
    v_segment_end := least(p_ended_at, coalesce(v_history.effective_to, p_ended_at));

    if v_segment_start <> v_covered_until or v_segment_end <= v_segment_start then
      raise exception using errcode = '55000', message = 'Operational settings history has a gap or overlap.';
    end if;

    v_schedule := v_history.shift_schedule;
    v_grace := (v_schedule->>'rampUpGraceMinutes')::integer;

    for v_day in
      select day_value::date
      from generate_series(
        (v_segment_start at time zone 'Asia/Manila')::date,
        ((v_segment_end - interval '1 microsecond') at time zone 'Asia/Manila')::date,
        interval '1 day'
      ) day_value
    loop
      v_work_start := (v_day + (v_schedule->>'workStart')::time) at time zone 'Asia/Manila';
      v_work_end := (v_day + (v_schedule->>'workEnd')::time) at time zone 'Asia/Manila';
      v_overlap_start := greatest(v_segment_start, v_work_start);
      v_overlap_end := least(v_segment_end, v_work_end);

      if v_overlap_end > v_overlap_start then
        v_seconds := v_seconds + extract(epoch from (v_overlap_end - v_overlap_start));

        for v_break in select value from jsonb_array_elements(v_schedule->'breaks')
        loop
          v_break_start := (v_day + (v_break->>'startTime')::time) at time zone 'Asia/Manila';
          v_break_end := (
            v_day + (v_break->>'endTime')::time + make_interval(mins => v_grace)
          ) at time zone 'Asia/Manila';

          if least(v_overlap_end, v_break_end) > greatest(v_overlap_start, v_break_start) then
            v_seconds := v_seconds - extract(epoch from (
              least(v_overlap_end, v_break_end) - greatest(v_overlap_start, v_break_start)
            ));
          end if;
        end loop;
      end if;
    end loop;

    v_covered_until := v_segment_end;
  end loop;

  if v_covered_until <> p_ended_at then
    raise exception using errcode = '55000', message = 'Operational settings history does not cover the interval.';
  end if;

  return greatest(0, floor(v_seconds))::bigint;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '55000', message = 'Operational settings history is malformed.';
end;
$$;

create or replace function public.watchdog_advance_eligible_time(
  p_machine_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_eligible_seconds bigint
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_low bigint := 0;
  v_high bigint;
  v_mid bigint;
begin
  if p_eligible_seconds is null or p_eligible_seconds < 0 then
    raise exception using errcode = '22023', message = 'Eligible duration is invalid.';
  end if;
  if p_eligible_seconds = 0 then return p_started_at; end if;
  if public.watchdog_eligible_seconds(p_machine_id, p_started_at, p_ended_at) < p_eligible_seconds then
    return null;
  end if;

  v_high := floor(extract(epoch from (p_ended_at - p_started_at)))::bigint;
  while v_low < v_high loop
    v_mid := (v_low + v_high) / 2;
    if public.watchdog_eligible_seconds(
      p_machine_id, p_started_at, p_started_at + make_interval(secs => v_mid::double precision)
    ) >= p_eligible_seconds then
      v_high := v_mid;
    else
      v_low := v_mid + 1;
    end if;
  end loop;
  return p_started_at + make_interval(secs => v_low::double precision);
end;
$$;

do $$
begin
  if to_regprocedure('public.ingest_iot_sensor_event_legacy(uuid,uuid,uuid,text,jsonb,timestamp with time zone)') is null then
    alter function public.ingest_iot_sensor_event(uuid, uuid, uuid, text, jsonb, timestamptz)
    rename to ingest_iot_sensor_event_legacy;
  end if;
end;
$$;

create or replace function public.ingest_iot_watchdog_observation(
  p_device_event_id uuid,
  p_sensor_id uuid,
  p_machine_id uuid,
  p_event_type text,
  p_event_value jsonb,
  p_recorded_at timestamptz
)
returns table (
  sensor_event_id uuid,
  device_event_id uuid,
  event_type text,
  event_value jsonb,
  recorded_at timestamptz,
  duplicate boolean,
  stale boolean,
  state_applied boolean,
  previous_machine_status text,
  new_machine_status text,
  downtime_action text,
  downtime_id uuid,
  downtime_started_at timestamptz,
  downtime_ended_at timestamptz,
  downtime_duration_seconds integer,
  downtime_cause text,
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
  v_event public.sensor_events%rowtype;
  v_existing public.sensor_events%rowtype;
  v_state public.sensor_watchdog_state%rowtype;
  v_is_activity boolean := p_event_type in ('pulse', 'recovered');
  v_received_at timestamptz := clock_timestamp();
begin
  select sensor.* into v_sensor from public.sensors sensor
  where sensor.id = p_sensor_id and sensor.machine_id = p_machine_id for update;
  if not found then
    raise exception using errcode = '23503', message = 'Sensor is not assigned to the supplied machine.';
  end if;
  select machine.* into v_machine from public.machines machine
  where machine.id = p_machine_id for update;
  if not found then raise exception using errcode = '23503', message = 'Machine was not found.'; end if;
  select state.* into v_state from public.sensor_watchdog_state state
  where state.sensor_id = p_sensor_id for update;
  if not found then raise exception using errcode = '55000', message = 'Watchdog runtime state is missing.'; end if;

  select event.* into v_existing from public.sensor_events event
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
      null::timestamptz, null::integer, null::text, null::text, null::jsonb;
    return;
  end if;

  insert into public.sensor_events (
    sensor_id, machine_id, device_event_id, event_type, event_value, recorded_at
  ) values (p_sensor_id, p_machine_id, p_device_event_id, p_event_type, p_event_value, p_recorded_at)
  returning * into v_event;

  if v_sensor.last_applied_recorded_at is not null and p_recorded_at <= v_sensor.last_applied_recorded_at then
    return query select v_event.id, v_event.device_event_id, v_event.event_type,
      v_event.event_value, v_event.recorded_at, false, true, false,
      v_machine.status, v_machine.status, null::text, null::uuid, null::timestamptz,
      null::timestamptz, null::integer, null::text, null::text, null::jsonb;
    return;
  end if;

  update public.sensors set last_applied_recorded_at = p_recorded_at where id = p_sensor_id;
  update public.sensor_watchdog_state
  set last_activity_received_at = case when v_is_activity then v_received_at else last_activity_received_at end,
      recovery_started_at = case
        when v_is_activity and detection_state in ('downtime', 'recovering') then coalesce(recovery_started_at, v_received_at)
        when not v_is_activity then null else recovery_started_at end,
      recovery_observation_count = case
        when v_is_activity and detection_state in ('downtime', 'recovering')
          then least(2, recovery_observation_count + 1)
        when not v_is_activity then 0 else recovery_observation_count end,
      detection_state = case
        when v_is_activity and detection_state = 'downtime' then 'recovering'
        else detection_state end,
      updated_at = v_received_at
  where sensor_id = p_sensor_id;

  insert into public.audit_logs (action, entity_type, entity_id, metadata)
  values (
    'IOT_EVENT_RECEIVED', 'sensor_event', v_event.id,
    jsonb_build_object(
      'deviceId', v_sensor.esp32_device_id,
      'sensorCode', v_sensor.sensor_code,
      'machineCode', v_machine.machine_code,
      'deviceEventId', p_device_event_id,
      'eventType', p_event_type,
      'signal', p_event_value->>'signal',
      'recordedAt', p_recorded_at,
      'stateApplied', true,
      'watchdogObservation', true
    )
  );

  return query select v_event.id, v_event.device_event_id, v_event.event_type,
    v_event.event_value, v_event.recorded_at, false, false, true,
    v_machine.status, v_machine.status, null::text, null::uuid, null::timestamptz,
    null::timestamptz, null::integer, null::text, null::text, null::jsonb;
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
  downtime_duration_seconds integer, downtime_cause text, alert_action text, alert_record jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sensor_code text;
  v_enabled boolean := false;
  v_watchdog_open boolean := false;
begin
  select sensor.sensor_code,
    coalesce((settings.sensor_thresholds->sensor.sensor_code->>'absenceDetectionEnabled')::boolean, false)
  into v_sensor_code, v_enabled
  from public.sensors sensor
  left join public.machine_operational_settings settings on settings.machine_id = sensor.machine_id
  where sensor.id = p_sensor_id and sensor.machine_id = p_machine_id;

  select exists (
    select 1 from public.downtime_events downtime
    where downtime.machine_id = p_machine_id and downtime.sensor_id = p_sensor_id
      and downtime.status = 'Open' and downtime.detection_source = 'absence_watchdog'
  ) into v_watchdog_open;

  if (v_enabled and v_sensor_code <> 'S-05' and p_event_type = 'downtime'
      and p_event_value->>'signal' = 'no_pulse')
    or (v_watchdog_open and p_event_type in ('pulse', 'recovered')
      and p_event_value->>'signal' = 'active') then
    return query select * from public.ingest_iot_watchdog_observation(
      p_device_event_id, p_sensor_id, p_machine_id, p_event_type, p_event_value, p_recorded_at
    );
    return;
  end if;

  if v_watchdog_open and p_event_type = 'fault' and p_event_value->>'signal' = 'fault' then
    insert into public.audit_logs (action, entity_type, entity_id, metadata)
    select 'WATCHDOG_DOWNTIME_CONFIRMED', 'downtime', downtime.id,
      jsonb_build_object('sensorCode', v_sensor_code, 'deviceEventId', p_device_event_id)
    from public.downtime_events downtime
    where downtime.machine_id = p_machine_id and downtime.sensor_id = p_sensor_id
      and downtime.status = 'Open' and downtime.detection_source = 'absence_watchdog';
  end if;

  return query select * from public.ingest_iot_sensor_event_legacy(
    p_device_event_id, p_sensor_id, p_machine_id, p_event_type, p_event_value, p_recorded_at
  );
end;
$$;

create or replace function public.track_watchdog_recovery_observation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.detection_state in ('downtime', 'recovering') then
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

drop trigger if exists track_watchdog_recovery_observation on public.sensor_watchdog_state;
create trigger track_watchdog_recovery_observation
before update of last_activity_received_at, recovery_started_at
on public.sensor_watchdog_state
for each row execute function public.track_watchdog_recovery_observation();

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
  v_settings public.machine_operational_settings%rowtype;
  v_state public.sensor_watchdog_state%rowtype;
  v_open public.downtime_events%rowtype;
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
  v_machine_status text;
  v_alert_action text;
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

  select downtime.* into v_open from public.downtime_events downtime
  where downtime.machine_id = v_machine.id and downtime.sensor_id = p_sensor_id
    and downtime.status = 'Open' for update;

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
      v_detection := case when v_open.id is null then 'suspended' else 'downtime' end;
      update public.sensor_watchdog_state set connectivity_state = v_connectivity,
        detection_state = v_detection, absence_baseline_at = case when v_open.id is null then null else absence_baseline_at end,
        recovery_started_at = null, recovery_observation_count = 0,
        settings_version = v_settings.version, last_evaluated_at = p_evaluated_at,
        updated_at = clock_timestamp() where sensor_id = p_sensor_id;
    elsif not v_is_eligible then
      v_detection := case when v_open.id is null then 'suspended' else 'downtime' end;
      update public.sensor_watchdog_state set connectivity_state = v_connectivity,
        detection_state = v_detection, absence_baseline_at = case when v_open.id is null then null else absence_baseline_at end,
        recovery_started_at = null, recovery_observation_count = 0,
        settings_version = v_settings.version, last_evaluated_at = p_evaluated_at,
        updated_at = clock_timestamp() where sensor_id = p_sensor_id;
    elsif v_open.id is null then
      if v_previous_detection = 'suspended' and v_state.absence_baseline_at is null
        and v_state.last_evaluated_at is not null then
        v_baseline := public.watchdog_advance_eligible_time(
          v_machine.id, v_state.last_evaluated_at, p_evaluated_at, 1
        ) - interval '1 second';
      end if;
      v_baseline := coalesce(
        v_baseline, v_state.last_activity_received_at, v_state.last_heartbeat_received_at, p_evaluated_at
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

        if p_mode = 'enforce' then
          insert into public.downtime_events (
            machine_id, sensor_id, started_at, cause, status, notes,
            detection_source, settings_version
          ) values (
            v_machine.id, p_sensor_id, v_transition_at,
            case v_sensor.sensor_code
              when 'S-01' then 'Corrective Maintenance'
              when 'S-02' then 'Consumable Shortage'
              when 'S-04' then 'Consumable Shortage'
              else 'Pending Cause Review' end,
            'Open', '', 'absence_watchdog', v_settings.version
          ) returning * into v_open;

          update public.sensors set status = 'Fault' where id = p_sensor_id;
          select case when bool_or(status = 'Fault') then 'Downtime'
            when bool_or(status = 'Active') then 'Running' else 'Idle' end
          into v_machine_status from public.sensors where machine_id = v_machine.id;
          update public.machines set status = v_machine_status where id = v_machine.id;

          insert into public.audit_logs (action, entity_type, entity_id, metadata)
          values ('WATCHDOG_DOWNTIME_CREATED', 'downtime', v_open.id,
            jsonb_build_object('sensorCode', v_sensor.sensor_code, 'startedAt', v_transition_at,
              'settingsVersion', v_settings.version::text));

          select alert.* into v_existing_alert from public.alerts alert
          where alert.source_type = 'sensor' and alert.source_id = p_sensor_id
            and alert.status in ('Active', 'Acknowledged') for update;
          if found then
            update public.alerts set severity = 'Critical',
              title = v_sensor.label || ' downtime detected',
              message = v_sensor.sensor_code || ' sustained activity is absent.',
              metadata = metadata || jsonb_build_object('detectionSource', 'absence_watchdog',
                'downtimeId', v_open.id, 'settingsVersion', v_settings.version::text)
            where id = v_existing_alert.id returning * into v_alert;
            v_alert_action := 'updated';
          else
            insert into public.alerts (
              source_type, source_id, machine_id, sensor_id, severity, status, title, message, metadata
            ) values (
              'sensor', p_sensor_id, v_machine.id, p_sensor_id, 'Critical', 'Active',
              v_sensor.label || ' downtime detected',
              v_sensor.sensor_code || ' sustained activity is absent.',
              jsonb_build_object('sensorCode', v_sensor.sensor_code, 'machineCode', v_machine.machine_code,
                'detectionSource', 'absence_watchdog', 'downtimeId', v_open.id,
                'settingsVersion', v_settings.version::text)
            ) returning * into v_alert;
            v_alert_action := 'created';
          end if;

          v_descriptors := v_descriptors || jsonb_build_array(
            jsonb_build_object('kind', 'downtime', 'action', 'created', 'id', v_open.id,
              'sensorCode', v_sensor.sensor_code, 'machineCode', v_machine.machine_code),
            jsonb_build_object('kind', 'alert', 'action', v_alert_action,
              'record', public.alert_to_api_json(v_alert))
          );
        end if;
      end if;

      update public.sensor_watchdog_state set connectivity_state = v_connectivity,
        detection_state = v_detection, absence_baseline_at = v_baseline,
        open_downtime_id = v_open.id, settings_version = v_settings.version,
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

        if p_mode = 'enforce' and v_open.detection_source = 'absence_watchdog' then
          update public.downtime_events set status = 'Resolved', ended_at = v_transition_at,
            duration_seconds = greatest(0, floor(extract(epoch from (v_transition_at - started_at)))::integer)
          where id = v_open.id returning * into v_open;
          update public.sensors set status = 'Active' where id = p_sensor_id;
          select case when bool_or(status = 'Fault') then 'Downtime'
            when bool_or(status = 'Active') then 'Running' else 'Idle' end
          into v_machine_status from public.sensors where machine_id = v_machine.id;
          update public.machines set status = v_machine_status where id = v_machine.id;

          insert into public.audit_logs (action, entity_type, entity_id, metadata)
          values ('WATCHDOG_DOWNTIME_RESOLVED', 'downtime', v_open.id,
            jsonb_build_object('sensorCode', v_sensor.sensor_code, 'endedAt', v_transition_at,
              'durationSeconds', v_open.duration_seconds));

          select alert.* into v_existing_alert from public.alerts alert
          where alert.source_type = 'sensor' and alert.source_id = p_sensor_id
            and alert.status in ('Active', 'Acknowledged') for update;
          if found then
            if v_existing_alert.status = 'Acknowledged' then
              update public.alerts set status = 'Resolved', resolved_at = clock_timestamp(),
                metadata = metadata || jsonb_build_object('recoveredAt', v_transition_at)
              where id = v_existing_alert.id returning * into v_alert;
              v_alert_action := 'resolved';
            else
              update public.alerts set metadata = metadata || jsonb_build_object(
                'recoveryPending', true, 'recoveredAt', v_transition_at
              ) where id = v_existing_alert.id returning * into v_alert;
              v_alert_action := 'updated';
            end if;
          end if;

          v_descriptors := v_descriptors || jsonb_build_array(
            jsonb_build_object('kind', 'downtime', 'action', 'resolved', 'id', v_open.id,
              'sensorCode', v_sensor.sensor_code, 'machineCode', v_machine.machine_code)
          );
          if v_alert.id is not null then
            v_descriptors := v_descriptors || jsonb_build_array(jsonb_build_object(
              'kind', 'alert', 'action', v_alert_action, 'record', public.alert_to_api_json(v_alert)
            ));
          end if;
        end if;
      end if;

      update public.sensor_watchdog_state set connectivity_state = v_connectivity,
        detection_state = v_detection,
        absence_baseline_at = case when v_detection = 'healthy' then p_evaluated_at else absence_baseline_at end,
        recovery_started_at = case when v_detection = 'healthy' then null else recovery_started_at end,
        recovery_observation_count = case when v_detection = 'healthy' then 0 else recovery_observation_count end,
        open_downtime_id = case when v_detection = 'healthy' and p_mode = 'enforce' then null else v_open.id end,
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

revoke execute on function public.watchdog_eligible_seconds(uuid, timestamptz, timestamptz)
from public, anon, authenticated;
revoke execute on function public.watchdog_advance_eligible_time(uuid, timestamptz, timestamptz, bigint)
from public, anon, authenticated;
revoke execute on function public.ingest_iot_sensor_event_legacy(uuid, uuid, uuid, text, jsonb, timestamptz)
from public, anon, authenticated, service_role;
revoke execute on function public.ingest_iot_watchdog_observation(uuid, uuid, uuid, text, jsonb, timestamptz)
from public, anon, authenticated, service_role;
revoke execute on function public.ingest_iot_sensor_event(uuid, uuid, uuid, text, jsonb, timestamptz)
from public, anon, authenticated;
grant execute on function public.ingest_iot_sensor_event(uuid, uuid, uuid, text, jsonb, timestamptz)
to service_role;
revoke execute on function public.evaluate_sensor_watchdog(uuid, timestamptz, text, integer)
from public, anon, authenticated;
grant execute on function public.evaluate_sensor_watchdog(uuid, timestamptz, text, integer)
to service_role;

commit;
