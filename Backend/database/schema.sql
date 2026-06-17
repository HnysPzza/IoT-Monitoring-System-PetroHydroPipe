-- PetroHydroPipe IoT Monitoring System
-- Phase 2 simple Supabase/PostgreSQL database foundation.

create extension if not exists "pgcrypto";

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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Raw sensor readings/events; future IoT ingestion writes here.
create table if not exists sensor_events (
  id uuid primary key default gen_random_uuid(),
  sensor_id uuid not null references sensors(id) on delete cascade,
  machine_id uuid not null references machines(id) on delete cascade,
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
  status text not null default 'Open' check (status in ('Open', 'Resolved')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint downtime_duration_non_negative check (duration_seconds is null or duration_seconds >= 0),
  constraint downtime_end_after_start check (ended_at is null or ended_at >= started_at)
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

-- Indexes keep dashboard and history lookups fast as event data grows.
create index if not exists idx_users_role_id on users(role_id);
create index if not exists idx_machines_status on machines(status);
create index if not exists idx_sensors_machine_id on sensors(machine_id);
create index if not exists idx_sensor_events_sensor_recorded_at on sensor_events(sensor_id, recorded_at desc);
create index if not exists idx_sensor_events_machine_recorded_at on sensor_events(machine_id, recorded_at desc);
create index if not exists idx_downtime_events_machine_started_at on downtime_events(machine_id, started_at desc);
create index if not exists idx_downtime_events_sensor_id on downtime_events(sensor_id);
create index if not exists idx_production_counts_machine_window on production_counts(machine_id, window_start desc);
create index if not exists idx_audit_logs_user_created_at on audit_logs(user_id, created_at desc);

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
