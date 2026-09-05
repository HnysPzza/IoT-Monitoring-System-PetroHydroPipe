-- PetroHydroPipe IoT Monitoring System
-- Phase 2 simple Supabase/PostgreSQL database foundation.

create schema if not exists extensions;
create extension if not exists "pgcrypto" with schema extensions;

-- Access roles used by backend authorization and frontend navigation.
create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

-- Application users managed by admins; password_hash is used only by the backend.
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references roles(id),
  name text not null,
  username text not null unique,
  email text unique,
  password_hash text not null,
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  must_change_password boolean not null default true,
  last_login_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Production machines being monitored by ESP32 sensor groups.
create table if not exists machines (
  id uuid primary key default gen_random_uuid(),
  machine_code text not null unique,
  name text not null,
  status text not null default 'Idle' check (status in ('Running', 'Idle', 'Downtime')),
  location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The 5 ESP32-backed sensor records connected to a machine.
create table if not exists sensors (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references machines(id) on delete cascade,
  sensor_code text not null unique,
  esp32_device_id text not null unique,
  device_key_hash text,
  label text not null,
  status text not null default 'Active' check (status in ('Active', 'Inactive', 'Fault')),
  last_applied_recorded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Raw sensor readings/events; future IoT ingestion writes here.
create table if not exists sensor_events (
  id uuid primary key default gen_random_uuid(),
  sensor_id uuid not null references sensors(id) on delete cascade,
  machine_id uuid not null references machines(id) on delete cascade,
  device_event_id uuid not null default gen_random_uuid(),
  event_type text not null,
  event_value jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Downtime records derived from sensor events or manual review.
create table if not exists downtime_events (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references machines(id) on delete cascade,
  sensor_id uuid references sensors(id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds integer,
  cause text,
  detection_source text not null default 'sensor_event'
    check (detection_source in ('sensor_event', 'absence_watchdog')),
  settings_version bigint,
  status text not null default 'Open' check (status in ('Open', 'Resolved')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint downtime_duration_non_negative check (duration_seconds is null or duration_seconds >= 0),
  constraint downtime_end_after_start check (ended_at is null or ended_at >= started_at),
  constraint downtime_state_fields_consistent check (
    (status = 'Open' and ended_at is null and duration_seconds is null)
    or
    (status = 'Resolved' and ended_at is not null and duration_seconds is not null)
  )
);

-- Production output windows for day/week/month analytics.
create table if not exists production_counts (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references machines(id) on delete cascade,
  count_value integer not null default 0 check (count_value >= 0),
  window_start timestamptz not null,
  window_end timestamptz not null,
  created_at timestamptz not null default now(),
  constraint production_window_valid check (window_end > window_start)
);

-- Tracks important user and system actions for accountability.
create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Versioned operational settings for each explicitly provisioned machine.
create table if not exists machine_operational_settings (
  machine_id uuid primary key references machines(id) on delete cascade,
  sensor_thresholds jsonb not null default '{
    "S-01":{"absenceDetectionEnabled":false,"triggerSeconds":600,"recoverySeconds":null},
    "S-02":{"absenceDetectionEnabled":false,"triggerSeconds":300,"recoverySeconds":null},
    "S-03":{"absenceDetectionEnabled":false,"triggerSeconds":60,"recoverySeconds":null},
    "S-04":{"absenceDetectionEnabled":false,"triggerSeconds":300,"recoverySeconds":null},
    "S-05":{"absenceDetectionEnabled":false,"triggerSeconds":null,"recoverySeconds":null}
  }'::jsonb,
  shift_schedule jsonb not null default '{
    "workStart":"08:00",
    "workEnd":"17:00",
    "breaks":[
      {"name":"Morning Break","startTime":"10:00","endTime":"10:15"},
      {"name":"Lunch Break","startTime":"12:00","endTime":"13:00"},
      {"name":"Afternoon Break","startTime":"15:00","endTime":"15:15"}
    ],
    "rampUpGraceMinutes":10
  }'::jsonb,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id) on delete set null,
  constraint machine_settings_sensor_thresholds_object
    check (jsonb_typeof(sensor_thresholds) = 'object'),
  constraint machine_settings_shift_schedule_object
    check (jsonb_typeof(shift_schedule) = 'object')
);

alter table machine_operational_settings enable row level security;

create policy machine_settings_service_role_select
on machine_operational_settings
for select
to service_role
using (true);

-- Effective-dated settings preserve the schedule used by historical calculations.
create table if not exists machine_operational_settings_history (
  machine_id uuid not null references machines(id) on delete cascade,
  version bigint not null check (version > 0),
  sensor_thresholds jsonb not null check (jsonb_typeof(sensor_thresholds) = 'object'),
  shift_schedule jsonb not null check (jsonb_typeof(shift_schedule) = 'object'),
  effective_from timestamptz,
  effective_to timestamptz,
  changed_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (machine_id, version),
  constraint machine_settings_history_interval_valid
    check (effective_to is null or effective_from is null or effective_to > effective_from)
);

create unique index if not exists idx_machine_settings_history_current
on machine_operational_settings_history(machine_id)
where effective_to is null;

create index if not exists idx_machine_settings_history_effective
on machine_operational_settings_history(machine_id, effective_from, effective_to);

-- One bounded runtime row per sensor makes heartbeat/watchdog state restart-safe.
create table if not exists sensor_watchdog_state (
  sensor_id uuid primary key references sensors(id) on delete cascade,
  machine_id uuid not null references machines(id) on delete cascade,
  boot_counter bigint,
  boot_id uuid,
  last_sequence bigint,
  last_heartbeat_id uuid,
  last_heartbeat_payload_hash text,
  last_heartbeat_received_at timestamptz,
  last_device_recorded_at timestamptz,
  last_activity_received_at timestamptz,
  recovery_observation_count integer not null default 0,
  ordered_recovery_heartbeats integer not null default 0,
  connectivity_state text not null default 'unknown'
    check (connectivity_state in ('unknown', 'online', 'offline')),
  detection_state text not null default 'disabled'
    check (detection_state in ('disabled', 'suspended', 'healthy', 'grace', 'downtime', 'recovering')),
  absence_baseline_at timestamptz,
  recovery_started_at timestamptz,
  open_downtime_id uuid references downtime_events(id) on delete set null,
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
    check (ordered_recovery_heartbeats between 0 and 2),
  constraint watchdog_recovery_observation_count_valid
    check (recovery_observation_count between 0 and 2)
);

create index if not exists idx_sensor_watchdog_machine
on sensor_watchdog_state(machine_id, sensor_id);

create index if not exists idx_sensor_watchdog_connectivity
on sensor_watchdog_state(connectivity_state, last_heartbeat_received_at);

create table if not exists sensor_watchdog_transitions (
  id uuid primary key default gen_random_uuid(),
  sensor_id uuid not null references sensors(id) on delete cascade,
  machine_id uuid not null references machines(id) on delete cascade,
  mode text not null check (mode in ('observe', 'enforce')),
  from_state text not null,
  to_state text not null,
  reason text not null,
  evaluated_at timestamptz not null,
  settings_version bigint,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  constraint watchdog_transition_changes_state check (from_state <> to_state)
);

create index if not exists idx_watchdog_transitions_sensor_evaluated
on sensor_watchdog_transitions(sensor_id, evaluated_at desc);

alter table machine_operational_settings_history enable row level security;
alter table sensor_watchdog_state enable row level security;
alter table sensor_watchdog_transitions enable row level security;

create policy machine_settings_history_service_role_select
on machine_operational_settings_history for select to service_role using (true);

create policy sensor_watchdog_state_service_role_select
on sensor_watchdog_state for select to service_role using (true);

create policy sensor_watchdog_transitions_service_role_select
on sensor_watchdog_transitions for select to service_role using (true);

-- Persistent machine/sensor alerts that users can acknowledge.
create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id uuid not null,
  machine_id uuid references machines(id) on delete cascade,
  sensor_id uuid references sensors(id) on delete set null,
  severity text not null check (severity in ('Info', 'Warning', 'Critical')),
  status text not null default 'Active' check (status in ('Active', 'Acknowledged', 'Resolved')),
  title text not null,
  message text not null,
  acknowledged_at timestamptz,
  acknowledged_by uuid references users(id) on delete set null,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  revision bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Transactional singleton serializes alert revisions in commit order.
create table if not exists alert_revision_state (
  singleton boolean primary key default true check (singleton),
  current_revision bigint not null check (current_revision >= 0)
);

insert into alert_revision_state (singleton, current_revision)
values (true, 0)
on conflict (singleton) do nothing;

alter table alert_revision_state enable row level security;

create policy alert_revision_service_role
on alert_revision_state
for all
to service_role
using (true)
with check (true);

-- Base tables are backend-only. Browser-facing Supabase roles have neither
-- table privileges nor RLS policies; the server-side service role receives
-- only the direct operations used by the Express application.
alter table roles enable row level security;
alter table users enable row level security;
alter table machines enable row level security;
alter table sensors enable row level security;
alter table sensor_events enable row level security;
alter table downtime_events enable row level security;
alter table production_counts enable row level security;
alter table audit_logs enable row level security;
alter table alerts enable row level security;

revoke all on table public.roles from public, anon, authenticated, service_role;
revoke all on table public.users from public, anon, authenticated, service_role;
revoke all on table public.machines from public, anon, authenticated, service_role;
revoke all on table public.sensors from public, anon, authenticated, service_role;
revoke all on table public.sensor_events from public, anon, authenticated, service_role;
revoke all on table public.downtime_events from public, anon, authenticated, service_role;
revoke all on table public.production_counts from public, anon, authenticated, service_role;
revoke all on table public.audit_logs from public, anon, authenticated, service_role;
revoke all on table public.alerts from public, anon, authenticated, service_role;

grant select on table public.roles to service_role;
grant select, insert, update on table public.users to service_role;
grant select, update on table public.machines to service_role;
grant select, update on table public.sensors to service_role;
grant select on table public.sensor_events to service_role;
grant select on table public.downtime_events to service_role;
grant select on table public.production_counts to service_role;
grant select, insert on table public.audit_logs to service_role;
grant select on table public.alerts to service_role;

-- Indexes keep dashboard and history lookups fast as event data grows.
create index if not exists idx_users_role_id on users(role_id);
create index if not exists idx_machines_status on machines(status);
create index if not exists idx_sensors_machine_id on sensors(machine_id);
create index if not exists idx_sensor_events_sensor_recorded_at on sensor_events(sensor_id, recorded_at desc);
create index if not exists idx_sensor_events_machine_recorded_at on sensor_events(machine_id, recorded_at desc);
create unique index if not exists idx_sensor_events_device_event_id on sensor_events(sensor_id, device_event_id);
create index if not exists idx_downtime_events_machine_started_at on downtime_events(machine_id, started_at desc);
create index if not exists idx_downtime_events_sensor_id on downtime_events(sensor_id);
create unique index if not exists idx_downtime_events_one_open_per_sensor on downtime_events(machine_id, sensor_id) where status = 'Open';
create index if not exists idx_production_counts_machine_window on production_counts(machine_id, window_start desc);
create index if not exists idx_audit_logs_user_created_at on audit_logs(user_id, created_at desc);
create unique index if not exists idx_alerts_unresolved_source on alerts(source_type, source_id) where status in ('Active', 'Acknowledged');
create index if not exists idx_alerts_status_created_at on alerts(status, created_at desc);
create index if not exists idx_alerts_machine_id on alerts(machine_id);
create index if not exists idx_alerts_sensor_id on alerts(sensor_id);
create index if not exists idx_alerts_acknowledged_by on alerts(acknowledged_by);
create unique index if not exists idx_alerts_revision on alerts(revision);

-- S-05 measures production output and must never own a downtime record.
create or replace function public.prevent_s05_downtime()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and new.sensor_id is not distinct from old.sensor_id then
    return new;
  end if;

  if exists (
    select 1 from public.sensors sensor
    where sensor.id = new.sensor_id and sensor.sensor_code = 'S-05'
  ) then
    raise exception using
      errcode = '23514',
      message = 'S-05 cannot create downtime records.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_s05_downtime on public.downtime_events;
create trigger prevent_s05_downtime
before insert or update of sensor_id on public.downtime_events
for each row execute function public.prevent_s05_downtime();

-- Shared trigger helper keeps updated_at current after edits.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql
set search_path = public;

drop trigger if exists set_users_updated_at on users;
create trigger set_users_updated_at
before update on users
for each row
execute function set_updated_at();
-- Atomic alert-sync integrity keeps state, alerts, revisions, and audits consistent.
create or replace function public.assign_alert_revision()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_current_revision bigint;
begin
  if tg_op = 'UPDATE'
    and (to_jsonb(new) - array['revision', 'updated_at'])
      is not distinct from (to_jsonb(old) - array['revision', 'updated_at']) then
    new.revision := old.revision;
    return new;
  end if;

  -- ON CONFLICT runs BEFORE INSERT before BEFORE UPDATE. Reuse the revision
  -- already allocated to EXCLUDED instead of consuming a second revision.
  if tg_op = 'UPDATE' and new.revision is distinct from old.revision then
    select current_revision
    into v_current_revision
    from public.alert_revision_state
    where singleton = true;

    if new.revision = v_current_revision and new.revision > old.revision then
      return new;
    end if;
  end if;

  update public.alert_revision_state
  set current_revision = current_revision + 1
  where singleton = true
  returning current_revision into new.revision;

  if new.revision is null then
    raise exception using errcode = '55000', message = 'Alert revision state is unavailable.';
  end if;

  return new;
end;
$$;

drop trigger if exists assign_alert_revision on public.alerts;
create trigger assign_alert_revision
before insert or update on public.alerts
for each row
execute function public.assign_alert_revision();

create or replace function public.alert_to_api_json(p_alert public.alerts)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', p_alert.id,
    'severity', p_alert.severity,
    'status', p_alert.status,
    'title', p_alert.title,
    'message', p_alert.message,
    'sourceType', p_alert.source_type,
    'machine', case when machine.id is null then null else jsonb_build_object(
      'id', machine.id,
      'name', machine.name
    ) end,
    'sensor', case when sensor.id is null then null else jsonb_build_object(
      'id', sensor.id,
      'sensorCode', sensor.sensor_code,
      'label', sensor.label
    ) end,
    'metadata', p_alert.metadata,
    'createdAt', p_alert.created_at,
    'acknowledgedAt', p_alert.acknowledged_at,
    'acknowledgedBy', case when acknowledged_user.id is null then null else jsonb_build_object(
      'id', acknowledged_user.id,
      'name', acknowledged_user.name,
      'username', acknowledged_user.username,
      'role', acknowledged_role.name
    ) end,
    'resolvedAt', p_alert.resolved_at,
    'revision', p_alert.revision::text
  )
  from (select 1) seed
  left join public.machines machine on machine.id = p_alert.machine_id
  left join public.sensors sensor on sensor.id = p_alert.sensor_id
  left join public.users acknowledged_user on acknowledged_user.id = p_alert.acknowledged_by
  left join public.roles acknowledged_role on acknowledged_role.id = acknowledged_user.role_id;
$$;

drop function if exists public.ingest_iot_sensor_event(uuid, uuid, uuid, text, jsonb, timestamptz);
create function public.ingest_iot_sensor_event(
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
set search_path = pg_catalog, public
as $$
declare
  v_sensor public.sensors%rowtype;
  v_machine public.machines%rowtype;
  v_existing_event public.sensor_events%rowtype;
  v_event public.sensor_events%rowtype;
  v_previous_machine_status text;
  v_new_machine_status text;
  v_downtime public.downtime_events%rowtype;
  v_downtime_action text;
  v_alert public.alerts%rowtype;
  v_existing_alert public.alerts%rowtype;
  v_alert_action text;
  v_alert_metadata jsonb;
  v_alert_title text;
  v_alert_message text;
  v_new_alert_id uuid;
begin
  if p_event_type not in ('pulse', 'idle', 'downtime', 'fault', 'recovered') then
    raise exception using errcode = '22023', message = 'Unsupported sensor event type.';
  end if;

  if not (
    (p_event_type in ('pulse', 'recovered') and p_event_value->>'signal' = 'active')
    or (p_event_type = 'idle' and p_event_value->>'signal' = 'idle')
    or (p_event_type = 'downtime' and p_event_value->>'signal' = 'no_pulse')
    or (p_event_type = 'fault' and p_event_value->>'signal' = 'fault')
  ) then
    raise exception using errcode = '22023', message = 'Signal does not match sensor event type.';
  end if;

  if p_recorded_at > now() + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'Sensor event timestamp is too far in the future.';
  end if;

  select sensor.*
  into v_sensor
  from public.sensors sensor
  where sensor.id = p_sensor_id
    and sensor.machine_id = p_machine_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'Sensor is not assigned to the supplied machine.';
  end if;

  select machine.*
  into v_machine
  from public.machines machine
  where machine.id = p_machine_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'Machine was not found.';
  end if;

  select sensor_event.*
  into v_existing_event
  from public.sensor_events sensor_event
  where sensor_event.sensor_id = p_sensor_id
    and sensor_event.device_event_id = p_device_event_id;

  if found then
    if v_existing_event.event_type is distinct from p_event_type
      or v_existing_event.event_value is distinct from p_event_value
      or v_existing_event.recorded_at is distinct from p_recorded_at then
      raise exception using errcode = '22023', message = 'Device event ID was reused with different event data.';
    end if;

    return query select
      v_existing_event.id,
      v_existing_event.device_event_id,
      v_existing_event.event_type,
      v_existing_event.event_value,
      v_existing_event.recorded_at,
      true,
      false,
      false,
      v_machine.status,
      v_machine.status,
      null::text,
      null::uuid,
      null::timestamptz,
      null::timestamptz,
      null::integer,
      null::text,
      null::text,
      null::jsonb;
    return;
  end if;

  insert into public.sensor_events (
    sensor_id,
    machine_id,
    device_event_id,
    event_type,
    event_value,
    recorded_at
  ) values (
    p_sensor_id,
    p_machine_id,
    p_device_event_id,
    p_event_type,
    p_event_value,
    p_recorded_at
  )
  returning * into v_event;

  if v_sensor.last_applied_recorded_at is not null
    and p_recorded_at <= v_sensor.last_applied_recorded_at then
    return query select
      v_event.id,
      v_event.device_event_id,
      v_event.event_type,
      v_event.event_value,
      v_event.recorded_at,
      false,
      true,
      false,
      v_machine.status,
      v_machine.status,
      null::text,
      null::uuid,
      null::timestamptz,
      null::timestamptz,
      null::integer,
      null::text,
      null::text,
      null::jsonb;
    return;
  end if;

  update public.sensors
  set
    status = case
      when p_event_type in ('pulse', 'recovered') then 'Active'
      when p_event_type = 'idle' then 'Inactive'
      else 'Fault'
    end,
    last_applied_recorded_at = p_recorded_at
  where id = p_sensor_id;

  v_previous_machine_status := v_machine.status;

  select case
    when bool_or(sensor.status = 'Fault') then 'Downtime'
    when bool_or(sensor.status = 'Active') then 'Running'
    else 'Idle'
  end
  into v_new_machine_status
  from public.sensors sensor
  where sensor.machine_id = p_machine_id;

  if v_previous_machine_status is distinct from v_new_machine_status then
    update public.machines
    set status = v_new_machine_status
    where id = p_machine_id;

    insert into public.audit_logs (action, entity_type, entity_id, metadata)
    values (
      'IOT_MACHINE_STATUS_UPDATED',
      'machine',
      p_machine_id,
      jsonb_build_object(
        'machineCode', v_machine.machine_code,
        'machineName', v_machine.name,
        'previousStatus', v_previous_machine_status,
        'newStatus', v_new_machine_status,
        'source', 'esp32_event'
      )
    );
  end if;

  if p_event_type in ('downtime', 'fault') then
    select downtime.*
    into v_downtime
    from public.downtime_events downtime
    where downtime.machine_id = p_machine_id
      and downtime.sensor_id = p_sensor_id
      and downtime.status = 'Open'
    for update;

    if not found then
      insert into public.downtime_events (
        machine_id,
        sensor_id,
        started_at,
        cause,
        status,
        notes
      ) values (
        p_machine_id,
        p_sensor_id,
        p_recorded_at,
        case v_sensor.sensor_code
          when 'S-01' then 'Corrective Maintenance'
          when 'S-02' then 'Consumable Shortage'
          when 'S-04' then 'Consumable Shortage'
          when 'S-05' then 'Manual Cutting'
          else 'Pending Cause Review'
        end,
        'Open',
        ''
      )
      returning * into v_downtime;
      v_downtime_action := 'created';
    end if;
  elsif p_event_type in ('pulse', 'recovered') then
    update public.downtime_events
    set
      status = 'Resolved',
      ended_at = p_recorded_at,
      duration_seconds = greatest(0, round(extract(epoch from (p_recorded_at - started_at)))::integer)
    where machine_id = p_machine_id
      and sensor_id = p_sensor_id
      and status = 'Open'
      and started_at <= p_recorded_at
    returning * into v_downtime;

    if found then
      v_downtime_action := 'resolved';
    end if;
  end if;

  if v_downtime_action is not null then
    insert into public.audit_logs (action, entity_type, entity_id, metadata)
    values (
      case when v_downtime_action = 'created' then 'DOWNTIME_CREATED' else 'DOWNTIME_AUTO_RESOLVED' end,
      'downtime',
      v_downtime.id,
      jsonb_build_object(
        'sensorCode', v_sensor.sensor_code,
        'machineName', v_machine.name,
        'eventId', v_event.id,
        'deviceEventId', p_device_event_id,
        'eventType', p_event_type,
        'startedAt', v_downtime.started_at,
        'endedAt', v_downtime.ended_at,
        'durationMinutes', case when v_downtime.duration_seconds is null then null
          else round(v_downtime.duration_seconds / 60.0) end,
        'cause', v_downtime.cause,
        'status', case when v_downtime_action = 'created' then 'Open' else 'Resolved' end
      )
    );
  end if;

  if p_event_type in ('downtime', 'fault') then
    v_alert_title := v_sensor.label || ' downtime detected';
    v_alert_message := v_sensor.sensor_code || ' ' || v_sensor.label || ' has no pulse.';
    v_alert_metadata := jsonb_build_object(
      'deviceId', v_sensor.esp32_device_id,
      'sensorCode', v_sensor.sensor_code,
      'sensorLabel', v_sensor.label,
      'machineCode', v_machine.machine_code,
      'machineName', v_machine.name,
      'eventId', v_event.id,
      'eventType', p_event_type,
      'signal', p_event_value->>'signal',
      'recordedAt', p_recorded_at
    );

    select alert.*
    into v_existing_alert
    from public.alerts alert
    where alert.source_type = 'sensor'
      and alert.source_id = p_sensor_id
      and alert.status in ('Active', 'Acknowledged')
    for update;

    if v_existing_alert.id is not null then
      update public.alerts
      set
        severity = 'Critical',
        title = v_alert_title,
        message = v_alert_message,
        metadata = (
          v_existing_alert.metadata
            - array[
              'recoveryPending',
              'recoveredAt',
              'recoveryEventId',
              'recoveryEventType',
              'recoverySignal',
              'acknowledgedAfterRecovery'
            ]
        ) || v_alert_metadata
      where id = v_existing_alert.id
      returning * into v_alert;
      v_alert_action := 'updated';
    else
      v_new_alert_id := gen_random_uuid();
      insert into public.alerts (
        id,
        source_type,
        source_id,
        machine_id,
        sensor_id,
        severity,
        status,
        title,
        message,
        metadata
      ) values (
        v_new_alert_id,
        'sensor',
        p_sensor_id,
        p_machine_id,
        p_sensor_id,
        'Critical',
        'Active',
        v_alert_title,
        v_alert_message,
        v_alert_metadata
      )
      on conflict (source_type, source_id)
        where status in ('Active', 'Acknowledged')
      do update set
        revision = excluded.revision,
        severity = excluded.severity,
        title = excluded.title,
        message = excluded.message,
        metadata = (
          public.alerts.metadata
            - array[
              'recoveryPending',
              'recoveredAt',
              'recoveryEventId',
              'recoveryEventType',
              'recoverySignal',
              'acknowledgedAfterRecovery'
            ]
        ) || excluded.metadata
      returning * into v_alert;

      v_alert_action := case when v_alert.id = v_new_alert_id then 'created' else 'updated' end;
    end if;

    if v_alert_action = 'created' then
      insert into public.audit_logs (action, entity_type, entity_id, metadata)
      values (
        'ALERT_CREATED',
        'sensor',
        p_sensor_id,
        jsonb_build_object(
          'alertId', v_alert.id,
          'title', v_alert.title,
          'sensorCode', v_sensor.sensor_code,
          'machineCode', v_machine.machine_code,
          'eventType', p_event_type,
          'signal', p_event_value->>'signal'
        )
      );
    end if;
  elsif p_event_type in ('pulse', 'recovered') then
    select alert.*
    into v_existing_alert
    from public.alerts alert
    where alert.source_type = 'sensor'
      and alert.source_id = p_sensor_id
      and alert.status in ('Active', 'Acknowledged')
    for update;

    if found then
      v_alert_metadata := v_existing_alert.metadata || jsonb_build_object(
        'recoveryPending', true,
        'recoveredAt', p_recorded_at,
        'recoveryEventId', v_event.id,
        'recoveryEventType', p_event_type,
        'recoverySignal', p_event_value->>'signal'
      );

      if v_existing_alert.status = 'Active' then
        update public.alerts
        set metadata = v_alert_metadata
        where id = v_existing_alert.id
        returning * into v_alert;
        v_alert_action := 'updated';
      else
        update public.alerts
        set
          status = 'Resolved',
          resolved_at = now(),
          metadata = v_alert_metadata
        where id = v_existing_alert.id
        returning * into v_alert;
        v_alert_action := 'resolved';

        insert into public.audit_logs (action, entity_type, entity_id, metadata)
        values (
          'ALERT_RESOLVED',
          'sensor',
          p_sensor_id,
          jsonb_build_object(
            'alertId', v_alert.id,
            'title', v_alert.title,
            'sensorCode', v_sensor.sensor_code,
            'machineCode', v_machine.machine_code,
            'eventId', v_event.id,
            'eventType', p_event_type,
            'signal', p_event_value->>'signal',
            'recordedAt', p_recorded_at
          )
        );
      end if;
    end if;
  end if;

  if p_event_type in ('downtime', 'fault', 'recovered') then
    insert into public.audit_logs (action, entity_type, entity_id, metadata)
    values (
      'IOT_EVENT_RECEIVED',
      'sensor_event',
      v_event.id,
      jsonb_build_object(
        'deviceId', v_sensor.esp32_device_id,
        'sensorCode', v_sensor.sensor_code,
        'machineCode', v_machine.machine_code,
        'deviceEventId', p_device_event_id,
        'eventType', p_event_type,
        'signal', p_event_value->>'signal',
        'recordedAt', p_recorded_at,
        'stale', false,
        'stateApplied', true
      )
    );
  end if;

  return query select
    v_event.id,
    v_event.device_event_id,
    v_event.event_type,
    v_event.event_value,
    v_event.recorded_at,
    false,
    false,
    true,
    v_previous_machine_status,
    v_new_machine_status,
    v_downtime_action,
    v_downtime.id,
    v_downtime.started_at,
    v_downtime.ended_at,
    v_downtime.duration_seconds,
    v_downtime.cause,
    v_alert_action,
    case when v_alert.id is null then null else public.alert_to_api_json(v_alert) end;
end;
$$;

create or replace function public.acknowledge_alert(
  p_alert_id uuid,
  p_actor_user_id uuid
)
returns table (
  outcome text,
  alert_action text,
  alert_record jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_alert public.alerts%rowtype;
  v_acknowledged_at timestamptz;
  v_has_pending_recovery boolean;
begin
  select alert.*
  into v_alert
  from public.alerts alert
  where alert.id = p_alert_id
  for update;

  if not found then
    return query select 'not_found'::text, null::text, null::jsonb;
    return;
  end if;

  if v_alert.status = 'Resolved' then
    return query select 'already_resolved'::text, null::text, public.alert_to_api_json(v_alert);
    return;
  end if;

  v_has_pending_recovery := coalesce(v_alert.metadata->>'recoveryPending', 'false') = 'true';

  if v_alert.status = 'Acknowledged' and not v_has_pending_recovery then
    return query select 'already_acknowledged'::text, null::text, public.alert_to_api_json(v_alert);
    return;
  end if;

  v_acknowledged_at := now();

  update public.alerts
  set
    status = case when v_has_pending_recovery then 'Resolved' else 'Acknowledged' end,
    acknowledged_at = v_acknowledged_at,
    acknowledged_by = p_actor_user_id,
    resolved_at = case when v_has_pending_recovery then v_acknowledged_at else resolved_at end,
    metadata = case when v_has_pending_recovery
      then metadata || jsonb_build_object('acknowledgedAfterRecovery', true)
      else metadata
    end
  where id = p_alert_id
  returning * into v_alert;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  values (
    p_actor_user_id,
    'ALERT_ACKNOWLEDGED',
    v_alert.source_type,
    v_alert.source_id,
    jsonb_build_object(
      'alertId', v_alert.id,
      'title', v_alert.title,
      'status', v_alert.status
    )
  );

  if v_has_pending_recovery then
    insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    values (
      p_actor_user_id,
      'ALERT_RESOLVED',
      v_alert.source_type,
      v_alert.source_id,
      jsonb_build_object(
        'alertId', v_alert.id,
        'title', v_alert.title,
        'reason', 'acknowledged_after_recovery'
      )
    );

    return query select
      'resolved_after_recovery'::text,
      'resolved'::text,
      public.alert_to_api_json(v_alert);
    return;
  end if;

  return query select
    'acknowledged'::text,
    'acknowledged'::text,
    public.alert_to_api_json(v_alert);
end;
$$;

create or replace function public.get_alerts_snapshot()
returns table (
  alerts jsonb,
  snapshot_revision text
)
language sql
stable
set search_path = pg_catalog, public
as $$
  select
    coalesce(
      jsonb_agg(public.alert_to_api_json(alert) order by alert.created_at desc)
        filter (where alert.id is not null),
      '[]'::jsonb
    ) as alerts,
    revision_state.current_revision::text as snapshot_revision
  from public.alert_revision_state revision_state
  left join public.alerts alert
    on alert.status in ('Active', 'Acknowledged')
  where revision_state.singleton = true
  group by revision_state.current_revision;
$$;

create or replace function public.update_machine_operational_settings(
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
    p_actor_user_id,
    'SETTINGS_UPDATED',
    'machine_settings',
    p_machine_id,
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

create or replace function public.ingest_iot_heartbeat(
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

  v_payload_hash := encode(extensions.digest(convert_to(jsonb_build_object(
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

create or replace function public.get_downtime_summary(
  p_status text,
  p_cause text,
  p_started_from timestamptz,
  p_started_to timestamptz
)
returns table (
  open_count bigint,
  resolved_count bigint,
  total_minutes bigint,
  estimated_loss bigint
)
language sql
stable
set search_path = public
as $$
  with matching as (
    select
      downtime.status,
      round(
        coalesce(
          downtime.duration_seconds,
          greatest(0, extract(epoch from (now() - downtime.started_at)))
        ) / 60.0
      )::bigint as minutes
    from public.downtime_events downtime
    where (p_status is null or p_status = 'All' or downtime.status = p_status)
      and (p_cause is null or p_cause = 'All' or downtime.cause = p_cause)
      and (p_started_from is null or downtime.started_at >= p_started_from)
      and (p_started_to is null or downtime.started_at < p_started_to)
  )
  select
    count(*) filter (where status = 'Open'),
    count(*) filter (where status = 'Resolved'),
    coalesce(sum(minutes), 0)::bigint,
    coalesce(sum(round(minutes * 2.3)), 0)::bigint
  from matching;
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
set search_path = public
as $$
declare
  v_downtime public.downtime_events%rowtype;
  v_sensor_code text;
  v_ended_at timestamptz;
begin
  select downtime.* into v_downtime
  from public.downtime_events downtime
  where downtime.id = p_downtime_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Downtime record not found.';
  end if;

  select sensor.sensor_code into v_sensor_code
  from public.sensors sensor where sensor.id = v_downtime.sensor_id;

  if p_cause is not null and v_sensor_code is distinct from 'S-03' then
    raise exception using errcode = '22023', message = 'Downtime cause is locked for this sensor.';
  end if;

  if p_resolve
    and v_sensor_code = 'S-03'
    and coalesce(p_cause, v_downtime.cause, 'Pending Cause Review') = 'Pending Cause Review'
  then
    raise exception using errcode = '23514', message = 'Choose the downtime cause before resolving this record.';
  end if;

  v_ended_at := case
    when p_resolve and v_downtime.status = 'Open' then now()
    else v_downtime.ended_at
  end;

  update public.downtime_events
  set
    cause = coalesce(p_cause, cause),
    notes = case when p_has_notes then p_notes else notes end,
    status = case when p_resolve then 'Resolved' else status end,
    ended_at = v_ended_at,
    duration_seconds = case
      when p_resolve and v_downtime.status = 'Open'
        then greatest(0, round(extract(epoch from (v_ended_at - started_at)))::integer)
      else duration_seconds
    end
  where id = p_downtime_id;

  return query select p_downtime_id;
end;
$$;

revoke all on table public.alert_revision_state from public, anon, authenticated;
grant select, update on table public.alert_revision_state to service_role;

revoke all on table public.machine_operational_settings
from public, anon, authenticated, service_role;
grant select on table public.machine_operational_settings to service_role;

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

revoke execute on function public.assign_alert_revision() from public, anon, authenticated;
revoke execute on function public.alert_to_api_json(public.alerts) from public, anon, authenticated;
revoke execute on function public.acknowledge_alert(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.get_alerts_snapshot() from public, anon, authenticated;
grant execute on function public.alert_to_api_json(public.alerts) to service_role;
grant execute on function public.acknowledge_alert(uuid, uuid) to service_role;
grant execute on function public.get_alerts_snapshot() to service_role;

revoke execute on function public.ingest_iot_sensor_event(uuid, uuid, uuid, text, jsonb, timestamptz)
from public, anon, authenticated;
grant execute on function public.ingest_iot_sensor_event(uuid, uuid, uuid, text, jsonb, timestamptz)
to service_role;

revoke execute on function public.get_downtime_summary(text, text, timestamptz, timestamptz)
from public, anon, authenticated;
grant execute on function public.get_downtime_summary(text, text, timestamptz, timestamptz)
to service_role;

revoke execute on function public.update_downtime_record(uuid, text, text, boolean, boolean)
from public, anon, authenticated;
grant execute on function public.update_downtime_record(uuid, text, text, boolean, boolean)
to service_role;

drop trigger if exists set_machines_updated_at on machines;
create trigger set_machines_updated_at
before update on machines
for each row
execute function set_updated_at();

drop trigger if exists set_sensors_updated_at on sensors;
create trigger set_sensors_updated_at
before update on sensors
for each row
execute function set_updated_at();

drop trigger if exists set_downtime_events_updated_at on downtime_events;
create trigger set_downtime_events_updated_at
before update on downtime_events
for each row
execute function set_updated_at();

drop trigger if exists set_alerts_updated_at on alerts;
create trigger set_alerts_updated_at
before update on alerts
for each row
execute function set_updated_at();

-- Phase 3 operational-time and atomic watchdog functions.
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
  v_watchdog_open boolean := false;
begin
  select sensor.sensor_code
  into v_sensor_code
  from public.sensors sensor
  where sensor.id = p_sensor_id and sensor.machine_id = p_machine_id;

  select exists (
    select 1 from public.downtime_events downtime
    where downtime.machine_id = p_machine_id and downtime.sensor_id = p_sensor_id
      and downtime.status = 'Open' and downtime.detection_source = 'absence_watchdog'
  ) into v_watchdog_open;

  if (v_sensor_code = 'S-05' and p_event_type in ('downtime', 'fault'))
    or (p_event_type = 'downtime' and p_event_value->>'signal' = 'no_pulse')
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

-- Phase 3 batched watchdog evaluation.
create or replace function public.evaluate_watchdog_cycle(
  p_evaluated_at timestamptz,
  p_mode text,
  p_stale_after_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sensor record;
  v_evaluation record;
  v_evaluations jsonb := '[]'::jsonb;
  v_states jsonb := '{}'::jsonb;
begin
  if p_mode not in ('disabled', 'observe', 'enforce') then
    raise exception using errcode = '22023', message = 'Watchdog mode is invalid.';
  end if;
  if p_evaluated_at is null or p_evaluated_at > clock_timestamp() + interval '5 minutes'
    or p_stale_after_seconds is null or p_stale_after_seconds < 2 then
    raise exception using errcode = '22023', message = 'Watchdog evaluation inputs are invalid.';
  end if;

  for v_sensor in
    select state.sensor_id, sensor.sensor_code, machine.machine_code
    from public.sensor_watchdog_state state
    join public.sensors sensor on sensor.id = state.sensor_id
    join public.machines machine on machine.id = sensor.machine_id
    order by machine.machine_code, sensor.sensor_code, state.sensor_id
  loop
    begin
      select * into strict v_evaluation
      from public.evaluate_sensor_watchdog(
        v_sensor.sensor_id,
        p_evaluated_at,
        p_mode,
        p_stale_after_seconds
      );

      v_evaluations := v_evaluations || jsonb_build_array(jsonb_build_object(
        'evaluated_sensor_id', v_sensor.sensor_id,
        'sensor_code', v_sensor.sensor_code,
        'machine_code', v_sensor.machine_code,
        'succeeded', true,
        'connectivity_state', v_evaluation.connectivity_state,
        'detection_state', v_evaluation.detection_state,
        'transition_descriptors', coalesce(v_evaluation.transition_descriptors, '[]'::jsonb),
        'error_code', null
      ));
    exception when others then
      v_evaluations := v_evaluations || jsonb_build_array(jsonb_build_object(
        'evaluated_sensor_id', v_sensor.sensor_id,
        'sensor_code', v_sensor.sensor_code,
        'machine_code', v_sensor.machine_code,
        'succeeded', false,
        'connectivity_state', null,
        'detection_state', null,
        'transition_descriptors', '[]'::jsonb,
        'error_code', 'WATCHDOG_EVALUATION_FAILED'
      ));
    end;
  end loop;

  select coalesce(jsonb_object_agg(state_name, state_count), '{}'::jsonb)
  into v_states
  from (
    select connectivity_state as state_name, count(*)::integer as state_count
    from public.sensor_watchdog_state
    group by connectivity_state
    union all
    select detection_state as state_name, count(*)::integer as state_count
    from public.sensor_watchdog_state
    group by detection_state
  ) counts;

  return jsonb_build_object(
    'evaluations', v_evaluations,
    'states', v_states
  );
end;
$$;

revoke all on function public.evaluate_watchdog_cycle(timestamptz, text, integer)
from public;
revoke execute on function public.evaluate_watchdog_cycle(timestamptz, text, integer)
from anon, authenticated;
grant execute on function public.evaluate_watchdog_cycle(timestamptz, text, integer)
to service_role;

-- Phase 4 consistent live monitoring snapshot.
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

revoke all on function public.get_machine_live_snapshot(text) from public;
revoke execute on function public.get_machine_live_snapshot(text) from anon, authenticated;
grant execute on function public.get_machine_live_snapshot(text) to service_role;

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
  v_downtime public.downtime_events%rowtype;
  v_alert public.alerts%rowtype;
  v_previous_sensor_status text;
  v_previous_machine_status text;
  v_new_machine_status text;
  v_recovered_at timestamptz := clock_timestamp();
  v_reason text := btrim(p_reason);
  v_downtime_action text;
  v_alert_action text;
begin
  if v_reason is null or v_reason = '' or char_length(v_reason) > 500 then
    raise exception using errcode = '22023', message = 'A recovery override reason between 1 and 500 characters is required.';
  end if;

  select sensor.* into v_sensor
  from public.sensors sensor
  where sensor.id = p_sensor_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Sensor not found.';
  end if;

  select machine.* into v_machine
  from public.machines machine
  where machine.id = v_sensor.machine_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Machine not found.';
  end if;

  v_previous_sensor_status := v_sensor.status;
  v_previous_machine_status := v_machine.status;

  update public.sensors set status = 'Active'
  where id = v_sensor.id
  returning * into v_sensor;

  select case
    when bool_or(sensor.status = 'Fault') then 'Downtime'
    when bool_or(sensor.status = 'Active') then 'Running'
    else 'Idle'
  end into v_new_machine_status
  from public.sensors sensor
  where sensor.machine_id = v_machine.id;

  update public.machines set status = v_new_machine_status
  where id = v_machine.id
  returning * into v_machine;

  update public.downtime_events
  set status = 'Resolved', ended_at = v_recovered_at,
    duration_seconds = greatest(0, round(extract(epoch from (v_recovered_at - started_at)))::integer)
  where machine_id = v_machine.id and sensor_id = v_sensor.id and status = 'Open'
  returning * into v_downtime;

  if found then v_downtime_action := 'resolved'; end if;

  select alert.* into v_alert
  from public.alerts alert
  where alert.source_type = 'sensor' and alert.source_id = v_sensor.id
    and alert.status in ('Active', 'Acknowledged')
  for update;

  if found then
    if v_alert.status = 'Acknowledged' then
      update public.alerts
      set status = 'Resolved', resolved_at = v_recovered_at,
        metadata = metadata || jsonb_build_object(
          'recoveryPending', true, 'recoverySource', 'manual_override',
          'recoveredAt', v_recovered_at, 'recoveredBy', p_actor_user_id,
          'overrideReason', v_reason, 'acknowledgedAfterRecovery', true)
      where id = v_alert.id returning * into v_alert;
      v_alert_action := 'resolved';
    else
      update public.alerts
      set metadata = metadata || jsonb_build_object(
        'recoveryPending', true, 'recoverySource', 'manual_override',
        'recoveredAt', v_recovered_at, 'recoveredBy', p_actor_user_id,
        'overrideReason', v_reason)
      where id = v_alert.id returning * into v_alert;
      v_alert_action := 'updated';
    end if;
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  values (p_actor_user_id, 'SENSOR_MANUAL_RECOVERY_OVERRIDE', 'sensor', v_sensor.id,
    jsonb_build_object(
      'sensorCode', v_sensor.sensor_code, 'machineCode', v_machine.machine_code,
      'previousSensorStatus', v_previous_sensor_status, 'newSensorStatus', v_sensor.status,
      'previousMachineStatus', v_previous_machine_status, 'newMachineStatus', v_machine.status,
      'reason', v_reason, 'recoveredAt', v_recovered_at,
      'downtimeId', v_downtime.id, 'alertId', v_alert.id));

  return query select
    to_jsonb(v_sensor),
    to_jsonb(v_machine) || jsonb_build_object(
      'sensor_count', (select count(*) from public.sensors sensor where sensor.machine_id = v_machine.id)),
    v_downtime_action, v_downtime.id, v_alert_action,
    case when v_alert.id is null then null else public.alert_to_api_json(v_alert) end;
end;
$$;

revoke all on function public.override_sensor_recovery(uuid, uuid, text) from public;
revoke execute on function public.override_sensor_recovery(uuid, uuid, text) from anon, authenticated;
grant execute on function public.override_sensor_recovery(uuid, uuid, text) to service_role;

-- Backend-only aggregate for Analytics avoids raw event pagination limits.
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
    and event.recorded_at >= p_started_at
    and event.recorded_at < p_ended_at
    and sensor.sensor_code in ('S-01', 'S-02', 'S-04', 'S-05')
  group by 1, sensor.sensor_code, sensor.label
  order by 1, sensor.sensor_code;
end;
$$;

revoke all on function public.aggregate_analytics_sensor_events(uuid, timestamptz, timestamptz, integer)
from public;
revoke execute on function public.aggregate_analytics_sensor_events(uuid, timestamptz, timestamptz, integer)
from anon, authenticated;
grant execute on function public.aggregate_analytics_sensor_events(uuid, timestamptz, timestamptz, integer)
to service_role;

-- Backend-only lookup for the first record that contributes to Analytics.
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
      and sensor.sensor_code in ('S-01', 'S-02', 'S-04', 'S-05')

    union all

    select downtime.started_at
    from public.downtime_events downtime
    where downtime.machine_id = p_machine_id
  ) analytics_records;
$$;

revoke all on function public.get_analytics_first_recorded_at(uuid) from public;
revoke execute on function public.get_analytics_first_recorded_at(uuid) from anon, authenticated;
grant execute on function public.get_analytics_first_recorded_at(uuid) to service_role;

-- Backend-only schema compatibility probe for deployment readiness checks.
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
    or to_regprocedure('public.aggregate_analytics_sensor_events(uuid,timestamptz,timestamptz,integer)') is null then
    raise exception using
      errcode = '55000',
      message = 'Required database dependencies are missing.';
  end if;

  return 24;
end;
$$;

revoke all on function public.get_backend_readiness() from public;
revoke execute on function public.get_backend_readiness() from anon, authenticated;
grant execute on function public.get_backend_readiness() to service_role;


create table if not exists public.refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists refresh_tokens_user_id_idx on public.refresh_tokens (user_id);
create index if not exists refresh_tokens_active_user_id_idx
  on public.refresh_tokens (user_id)
  where revoked_at is null;

alter table public.refresh_tokens enable row level security;

begin;

create table if not exists public.auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists auth_sessions_user_id_idx on public.auth_sessions(user_id);
alter table public.auth_sessions enable row level security;
alter table public.refresh_tokens add column if not exists session_id uuid references public.auth_sessions(id) on delete cascade;

insert into public.auth_sessions(id, user_id, expires_at, revoked_at)
select token.id, token.user_id, token.expires_at, clock_timestamp()
from public.refresh_tokens token where token.session_id is null
on conflict (id) do nothing;
update public.refresh_tokens set session_id = id, revoked_at = coalesce(revoked_at, clock_timestamp()) where session_id is null;
alter table public.refresh_tokens alter column session_id set not null;
create index if not exists refresh_tokens_session_id_idx on public.refresh_tokens(session_id);

create or replace function public.issue_refresh_token(p_user_id uuid, p_token_hash text, p_expires_at timestamptz)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_session_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at is null or p_expires_at <= clock_timestamp()
    or p_expires_at > clock_timestamp() + interval '24 hours' then
    raise exception 'Invalid session parameters.' using errcode = '22023';
  end if;
  perform 1 from public.users where id = p_user_id and status = 'Active' and deleted_at is null for update;
  if not found then raise exception 'Account unavailable.' using errcode = '28000'; end if;
  insert into public.auth_sessions(user_id, expires_at) values (p_user_id, p_expires_at) returning id into v_session_id;
  insert into public.refresh_tokens(user_id, token_hash, expires_at, session_id)
  values (p_user_id, p_token_hash, p_expires_at, v_session_id);
  return v_session_id;
end;
$$;

create or replace function public.revoke_refresh_token(p_token_hash text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_session_id uuid;
  v_user_id uuid;
begin
  select token.session_id, token.user_id into v_session_id, v_user_id from public.refresh_tokens token where token.token_hash = p_token_hash;
  if not found then return; end if;
  perform 1 from public.users where id = v_user_id for update;
  update public.auth_sessions set revoked_at = coalesce(revoked_at, clock_timestamp()) where id = v_session_id;
  update public.refresh_tokens set revoked_at = coalesce(revoked_at, clock_timestamp()) where session_id = v_session_id;
end;
$$;

drop function if exists public.rotate_refresh_token(text, text);
create function public.rotate_refresh_token(p_token_hash text, p_replacement_token_hash text)
returns table(outcome text, user_id uuid, expires_at timestamptz, session_id uuid, auth_user jsonb)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_token public.refresh_tokens%rowtype;
  v_session public.auth_sessions%rowtype;
  v_auth_user jsonb;
begin
  if p_token_hash is null or p_replacement_token_hash is null
    or p_token_hash = p_replacement_token_hash
    or p_token_hash !~ '^[0-9a-f]{64}$' or p_replacement_token_hash !~ '^[0-9a-f]{64}$' then
    return query select 'invalid'::text, null::uuid, null::timestamptz, null::uuid, null::jsonb;
    return;
  end if;
  select token.* into v_token from public.refresh_tokens token where token.token_hash = p_token_hash;
  if not found then
    return query select 'invalid'::text, null::uuid, null::timestamptz, null::uuid, null::jsonb;
    return;
  end if;
  perform 1 from public.users where id = v_token.user_id for update;
  select session.* into v_session from public.auth_sessions session where session.id = v_token.session_id for update;
  if v_session.revoked_at is not null or v_session.expires_at <= clock_timestamp() or v_token.expires_at <= clock_timestamp() then
    return query select 'invalid'::text, v_token.user_id, v_token.expires_at, v_token.session_id, null::jsonb;
    return;
  end if;
  select token.* into v_token from public.refresh_tokens token where token.token_hash = p_token_hash for update;
  if v_token.revoked_at is not null then
    update public.auth_sessions session set revoked_at = clock_timestamp() where session.user_id = v_token.user_id and session.revoked_at is null;
    update public.refresh_tokens token set revoked_at = clock_timestamp() where token.user_id = v_token.user_id and token.revoked_at is null;
    insert into public.audit_logs(user_id, action, entity_type, metadata)
    values (v_token.user_id, 'REFRESH_TOKEN_REUSED', 'auth', jsonb_build_object('sessionId', v_token.session_id));
    return query select 'reused'::text, v_token.user_id, v_token.expires_at, v_token.session_id, null::jsonb;
    return;
  end if;
  select jsonb_build_object('id', account.id, 'name', account.name, 'username', account.username,
    'email', account.email, 'role', role.name, 'mustChangePassword', account.must_change_password)
  into v_auth_user from public.users account join public.roles role on role.id = account.role_id
  where account.id = v_token.user_id and account.status = 'Active' and account.deleted_at is null;
  if not found then
    return query select 'invalid'::text, v_token.user_id, v_token.expires_at, v_token.session_id, null::jsonb;
    return;
  end if;
  update public.refresh_tokens set revoked_at = clock_timestamp() where id = v_token.id;
  insert into public.refresh_tokens(user_id, token_hash, expires_at, session_id)
  values (v_token.user_id, p_replacement_token_hash, v_token.expires_at, v_token.session_id);
  return query select 'rotated'::text, v_token.user_id, v_token.expires_at, v_token.session_id, v_auth_user;
end;
$$;

revoke all on public.auth_sessions, public.refresh_tokens from public, anon, authenticated, service_role;
grant select on public.auth_sessions, public.refresh_tokens to service_role;
revoke all on function public.issue_refresh_token(uuid,text,timestamptz), public.revoke_refresh_token(text), public.rotate_refresh_token(text,text) from public, anon, authenticated;
grant execute on function public.issue_refresh_token(uuid,text,timestamptz), public.revoke_refresh_token(text), public.rotate_refresh_token(text,text) to service_role;

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
    or to_regclass('public.refresh_tokens') is null
    or to_regclass('public.auth_sessions') is null
    or to_regprocedure('public.issue_refresh_token(uuid,text,timestamptz)') is null
    or to_regprocedure('public.revoke_refresh_token(text)') is null
    or to_regprocedure('public.rotate_refresh_token(text,text)') is null then
    raise exception using
      errcode = '55000',
      message = 'Required database dependencies are missing.';
  end if;

  return 27;
end;
$$;

revoke all on function public.get_backend_readiness() from public;
revoke execute on function public.get_backend_readiness() from anon, authenticated;
grant execute on function public.get_backend_readiness() to service_role;

commit;
