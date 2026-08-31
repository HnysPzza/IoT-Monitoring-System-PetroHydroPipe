begin;

set local lock_timeout = '2s';

create table if not exists public.machine_operational_settings_history (
  machine_id uuid not null references public.machines(id) on delete cascade,
  version bigint not null check (version > 0),
  sensor_thresholds jsonb not null check (jsonb_typeof(sensor_thresholds) = 'object'),
  shift_schedule jsonb not null check (jsonb_typeof(shift_schedule) = 'object'),
  effective_from timestamptz,
  effective_to timestamptz,
  changed_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (machine_id, version),
  constraint machine_settings_history_interval_valid
    check (effective_to is null or effective_from is null or effective_to > effective_from)
);

create unique index if not exists idx_machine_settings_history_current
on public.machine_operational_settings_history(machine_id)
where effective_to is null;

create index if not exists idx_machine_settings_history_effective
on public.machine_operational_settings_history(machine_id, effective_from, effective_to);

create table if not exists public.sensor_watchdog_state (
  sensor_id uuid primary key references public.sensors(id) on delete cascade,
  machine_id uuid not null references public.machines(id) on delete cascade,
  boot_counter bigint,
  boot_id uuid,
  last_sequence bigint,
  last_heartbeat_id uuid,
  last_heartbeat_payload_hash text,
  last_heartbeat_received_at timestamptz,
  last_device_recorded_at timestamptz,
  last_activity_received_at timestamptz,
  ordered_recovery_heartbeats integer not null default 0,
  connectivity_state text not null default 'unknown'
    check (connectivity_state in ('unknown', 'online', 'offline')),
  detection_state text not null default 'disabled'
    check (detection_state in ('disabled', 'suspended', 'healthy', 'grace', 'downtime', 'recovering')),
  absence_baseline_at timestamptz,
  recovery_started_at timestamptz,
  open_downtime_id uuid references public.downtime_events(id) on delete set null,
  settings_version bigint,
  last_evaluated_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint watchdog_boot_fields_consistent check (
    (boot_counter is null and boot_id is null and last_sequence is null)
    or
    (boot_counter is not null and boot_counter > 0 and boot_id is not null and last_sequence is not null and last_sequence > 0)
  ),
  constraint watchdog_heartbeat_fields_consistent check (
    (last_heartbeat_id is null and last_heartbeat_payload_hash is null and last_heartbeat_received_at is null)
    or
    (last_heartbeat_id is not null and last_heartbeat_payload_hash is not null and last_heartbeat_received_at is not null)
  ),
  constraint watchdog_recovery_heartbeat_count_valid
    check (ordered_recovery_heartbeats between 0 and 2)
);

create index if not exists idx_sensor_watchdog_machine
on public.sensor_watchdog_state(machine_id, sensor_id);

create index if not exists idx_sensor_watchdog_connectivity
on public.sensor_watchdog_state(connectivity_state, last_heartbeat_received_at);

create table if not exists public.sensor_watchdog_transitions (
  id uuid primary key default gen_random_uuid(),
  sensor_id uuid not null references public.sensors(id) on delete cascade,
  machine_id uuid not null references public.machines(id) on delete cascade,
  mode text not null check (mode in ('observe', 'enforce')),
  from_state text not null,
  to_state text not null,
  reason text not null,
  evaluated_at timestamptz not null,
  settings_version bigint,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  constraint watchdog_transition_changes_state check (from_state <> to_state)
);

create index if not exists idx_watchdog_transitions_sensor_evaluated
on public.sensor_watchdog_transitions(sensor_id, evaluated_at desc);

alter table public.machine_operational_settings_history enable row level security;
alter table public.sensor_watchdog_state enable row level security;
alter table public.sensor_watchdog_transitions enable row level security;

drop policy if exists machine_settings_history_service_role_select
on public.machine_operational_settings_history;
create policy machine_settings_history_service_role_select
on public.machine_operational_settings_history
for select to service_role using (true);

drop policy if exists sensor_watchdog_state_service_role_select
on public.sensor_watchdog_state;
create policy sensor_watchdog_state_service_role_select
on public.sensor_watchdog_state
for select to service_role using (true);

drop policy if exists sensor_watchdog_transitions_service_role_select
on public.sensor_watchdog_transitions;
create policy sensor_watchdog_transitions_service_role_select
on public.sensor_watchdog_transitions
for select to service_role using (true);

do $$
declare
  v_settings public.machine_operational_settings%rowtype;
  v_audit public.audit_logs%rowtype;
  v_first_audit public.audit_logs%rowtype;
  v_audit_count integer;
  v_history_count integer;
  v_expected_current_version bigint;
  v_expected_previous_version bigint;
  v_next_effective_to timestamptz;
begin
  for v_settings in
    select settings.* from public.machine_operational_settings settings
  loop
    select count(*)::integer into v_history_count
    from public.machine_operational_settings_history history
    where history.machine_id = v_settings.machine_id;

    if v_history_count > 0 then
      if not exists (
        select 1 from public.machine_operational_settings_history history
        where history.machine_id = v_settings.machine_id
          and history.version = v_settings.version
          and history.effective_to is null
          and history.sensor_thresholds = v_settings.sensor_thresholds
          and history.shift_schedule = v_settings.shift_schedule
      ) then
        raise exception using errcode = '55000', message = 'Existing settings history does not match current settings.';
      end if;
      continue;
    end if;

    select count(*)::integer into v_audit_count
    from public.audit_logs audit
    where audit.action = 'SETTINGS_UPDATED'
      and audit.entity_type = 'machine_settings'
      and audit.entity_id = v_settings.machine_id;

    if v_audit_count = 0 then
      insert into public.machine_operational_settings_history (
        machine_id, version, sensor_thresholds, shift_schedule,
        effective_from, effective_to, changed_by, created_at
      ) values (
        v_settings.machine_id, v_settings.version, v_settings.sensor_thresholds,
        v_settings.shift_schedule, null, null, v_settings.updated_by, v_settings.updated_at
      );
      continue;
    end if;

    if v_settings.version <> v_audit_count + 1 then
      raise exception using errcode = '55000', message = 'Settings audit history is not contiguous.';
    end if;

    select audit.* into v_first_audit
    from public.audit_logs audit
    where audit.action = 'SETTINGS_UPDATED'
      and audit.entity_type = 'machine_settings'
      and audit.entity_id = v_settings.machine_id
    order by (audit.metadata #>> '{current,version}')::bigint, audit.created_at, audit.id
    limit 1;

    if v_first_audit.metadata #>> '{previous,version}' <> '1'
      or jsonb_typeof(v_first_audit.metadata #> '{previous,sensorThresholds}') is distinct from 'object'
      or jsonb_typeof(v_first_audit.metadata #> '{previous,shiftSchedule}') is distinct from 'object' then
      raise exception using errcode = '55000', message = 'Settings audit baseline is malformed.';
    end if;

    insert into public.machine_operational_settings_history (
      machine_id, version, sensor_thresholds, shift_schedule,
      effective_from, effective_to, changed_by, created_at
    ) values (
      v_settings.machine_id,
      1,
      v_first_audit.metadata #> '{previous,sensorThresholds}',
      v_first_audit.metadata #> '{previous,shiftSchedule}',
      null,
      v_first_audit.created_at,
      null,
      v_first_audit.created_at
    );

    v_expected_previous_version := 1;
    for v_audit in
      select audit.*
      from public.audit_logs audit
      where audit.action = 'SETTINGS_UPDATED'
        and audit.entity_type = 'machine_settings'
        and audit.entity_id = v_settings.machine_id
      order by (audit.metadata #>> '{current,version}')::bigint, audit.created_at, audit.id
    loop
      begin
        v_expected_current_version := (v_audit.metadata #>> '{current,version}')::bigint;
      exception when others then
        raise exception using errcode = '55000', message = 'Settings audit version is malformed.';
      end;

      if (v_audit.metadata #>> '{previous,version}')::bigint <> v_expected_previous_version
        or v_expected_current_version <> v_expected_previous_version + 1
        or jsonb_typeof(v_audit.metadata #> '{current,sensorThresholds}') is distinct from 'object'
        or jsonb_typeof(v_audit.metadata #> '{current,shiftSchedule}') is distinct from 'object' then
        raise exception using errcode = '55000', message = 'Settings audit history is not contiguous.';
      end if;

      select min(next_audit.created_at) into v_next_effective_to
      from public.audit_logs next_audit
      where next_audit.action = 'SETTINGS_UPDATED'
        and next_audit.entity_type = 'machine_settings'
        and next_audit.entity_id = v_settings.machine_id
        and (next_audit.metadata #>> '{current,version}')::bigint = v_expected_current_version + 1;

      if v_next_effective_to is not null and v_next_effective_to <= v_audit.created_at then
        raise exception using errcode = '55000', message = 'Settings audit timestamps are not ordered.';
      end if;

      insert into public.machine_operational_settings_history (
        machine_id, version, sensor_thresholds, shift_schedule,
        effective_from, effective_to, changed_by, created_at
      ) values (
        v_settings.machine_id,
        v_expected_current_version,
        v_audit.metadata #> '{current,sensorThresholds}',
        v_audit.metadata #> '{current,shiftSchedule}',
        v_audit.created_at,
        v_next_effective_to,
        v_audit.user_id,
        v_audit.created_at
      );

      v_expected_previous_version := v_expected_current_version;
    end loop;

    if v_expected_previous_version <> v_settings.version
      or not exists (
        select 1 from public.machine_operational_settings_history history
        where history.machine_id = v_settings.machine_id
          and history.version = v_settings.version
          and history.effective_to is null
          and history.sensor_thresholds = v_settings.sensor_thresholds
          and history.shift_schedule = v_settings.shift_schedule
      ) then
      raise exception using errcode = '55000', message = 'Settings audit history does not match current settings.';
    end if;
  end loop;
end;
$$;

insert into public.sensor_watchdog_state (sensor_id, machine_id, settings_version)
select sensor.id, sensor.machine_id, settings.version
from public.sensors sensor
left join public.machine_operational_settings settings on settings.machine_id = sensor.machine_id
on conflict (sensor_id) do nothing;

drop function if exists public.update_machine_operational_settings(uuid, bigint, jsonb, jsonb, uuid);

create function public.update_machine_operational_settings(
  p_machine_id uuid,
  p_expected_version bigint,
  p_sensor_thresholds jsonb,
  p_shift_schedule jsonb,
  p_actor_user_id uuid
)
returns setof public.machine_operational_settings
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_previous public.machine_operational_settings%rowtype;
  v_current public.machine_operational_settings%rowtype;
  v_changed_sections text[] := array[]::text[];
  v_changed_at timestamptz := clock_timestamp();
begin
  if p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode = '22023', message = 'Expected version must be a positive integer.';
  end if;
  if jsonb_typeof(p_sensor_thresholds) is distinct from 'object'
    or jsonb_typeof(p_shift_schedule) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Machine settings must be JSON objects.';
  end if;
  if not exists (select 1 from public.machines machine where machine.id = p_machine_id) then
    raise exception using errcode = 'P0002', message = 'Machine not found.';
  end if;

  select settings.* into v_previous
  from public.machine_operational_settings settings
  where settings.machine_id = p_machine_id
  for update;

  if not found then
    raise exception using errcode = '55000', message = 'Machine settings are not configured.';
  end if;
  if v_previous.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'Settings version conflict.';
  end if;
  if v_previous.sensor_thresholds is not distinct from p_sensor_thresholds
    and v_previous.shift_schedule is not distinct from p_shift_schedule then
    return next v_previous;
    return;
  end if;

  perform 1 from public.machine_operational_settings_history history
  where history.machine_id = p_machine_id
    and history.version = v_previous.version
    and history.effective_to is null
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'Current settings history is missing.';
  end if;

  if v_previous.sensor_thresholds is distinct from p_sensor_thresholds then
    v_changed_sections := array_append(v_changed_sections, 'sensorThresholds');
  end if;
  if v_previous.shift_schedule is distinct from p_shift_schedule then
    v_changed_sections := array_append(v_changed_sections, 'shiftSchedule');
  end if;

  update public.machine_operational_settings_history
  set effective_to = v_changed_at
  where machine_id = p_machine_id and version = v_previous.version;

  update public.machine_operational_settings
  set sensor_thresholds = p_sensor_thresholds,
      shift_schedule = p_shift_schedule,
      version = version + 1,
      updated_at = v_changed_at,
      updated_by = p_actor_user_id
  where machine_id = p_machine_id
  returning * into v_current;

  insert into public.machine_operational_settings_history (
    machine_id, version, sensor_thresholds, shift_schedule,
    effective_from, effective_to, changed_by, created_at
  ) values (
    p_machine_id, v_current.version, v_current.sensor_thresholds, v_current.shift_schedule,
    v_changed_at, null, p_actor_user_id, v_changed_at
  );

  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  values (
    p_actor_user_id, 'SETTINGS_UPDATED', 'machine_settings', p_machine_id,
    jsonb_build_object(
      'changedSections', to_jsonb(v_changed_sections),
      'previous', jsonb_build_object(
        'sensorThresholds', v_previous.sensor_thresholds,
        'shiftSchedule', v_previous.shift_schedule,
        'version', v_previous.version::text
      ),
      'current', jsonb_build_object(
        'sensorThresholds', v_current.sensor_thresholds,
        'shiftSchedule', v_current.shift_schedule,
        'version', v_current.version::text
      )
    )
  );

  return next v_current;
end;
$$;

drop function if exists public.ingest_iot_heartbeat(uuid, uuid, uuid, bigint, uuid, bigint, timestamptz, boolean);

create function public.ingest_iot_heartbeat(
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
  v_duplicate boolean := false;
  v_stale boolean := false;
  v_applied boolean := false;
  v_connectivity text;
  v_recovery_count integer;
begin
  if p_heartbeat_id is null or p_boot_id is null or p_recorded_at is null or p_activity_observed is null
    or p_boot_counter is null or p_boot_counter < 1 or p_sequence is null or p_sequence < 1 then
    raise exception using errcode = '22023', message = 'Heartbeat fields are invalid.';
  end if;
  if p_recorded_at > v_received_at + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'Heartbeat timestamp is too far in the future.';
  end if;

  select sensor.* into v_sensor
  from public.sensors sensor
  where sensor.id = p_sensor_id
  for update;
  if not found or v_sensor.machine_id <> p_machine_id then
    raise exception using errcode = 'P0002', message = 'Heartbeat sensor assignment was not found.';
  end if;

  select state.* into v_state
  from public.sensor_watchdog_state state
  where state.sensor_id = p_sensor_id
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'Heartbeat runtime state is not configured.';
  end if;

  v_payload_hash := encode(digest(convert_to(jsonb_build_object(
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
      v_recovery_count := least(2, v_state.ordered_recovery_heartbeats + 1);
      v_connectivity := case when v_recovery_count >= 2 then 'online' else 'offline' end;
    else
      v_recovery_count := 0;
      v_connectivity := 'online';
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
        last_activity_received_at = case when p_activity_observed then v_received_at else last_activity_received_at end,
        ordered_recovery_heartbeats = v_recovery_count,
        connectivity_state = v_connectivity,
        absence_baseline_at = case when v_state.boot_counter is distinct from p_boot_counter then null else absence_baseline_at end,
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

revoke all on table public.machine_operational_settings_history
from public, anon, authenticated, service_role;
grant select on table public.machine_operational_settings_history to service_role;

revoke all on table public.sensor_watchdog_state
from public, anon, authenticated, service_role;
grant select on table public.sensor_watchdog_state to service_role;

revoke all on table public.sensor_watchdog_transitions
from public, anon, authenticated, service_role;
grant select on table public.sensor_watchdog_transitions to service_role;

revoke execute on function public.update_machine_operational_settings(uuid, bigint, jsonb, jsonb, uuid)
from public, anon, authenticated;
grant execute on function public.update_machine_operational_settings(uuid, bigint, jsonb, jsonb, uuid)
to service_role;

revoke execute on function public.ingest_iot_heartbeat(uuid, uuid, uuid, bigint, uuid, bigint, timestamptz, boolean)
from public, anon, authenticated;
grant execute on function public.ingest_iot_heartbeat(uuid, uuid, uuid, bigint, uuid, bigint, timestamptz, boolean)
to service_role;

commit;
