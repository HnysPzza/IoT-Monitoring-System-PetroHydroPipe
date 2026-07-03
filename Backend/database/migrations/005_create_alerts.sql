-- Phase 30: persistent alert acknowledgement and realtime notification support.

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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_alerts_unresolved_source
on alerts(source_type, source_id)
where status in ('Active', 'Acknowledged');

create index if not exists idx_alerts_status_created_at on alerts(status, created_at desc);
create index if not exists idx_alerts_machine_id on alerts(machine_id);
create index if not exists idx_alerts_sensor_id on alerts(sensor_id);
create index if not exists idx_alerts_acknowledged_by on alerts(acknowledged_by);

drop trigger if exists set_alerts_updated_at on alerts;
create trigger set_alerts_updated_at
before update on alerts
for each row
execute function set_updated_at();
