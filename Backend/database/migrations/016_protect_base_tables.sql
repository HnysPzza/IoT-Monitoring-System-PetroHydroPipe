-- Protect legacy base tables from direct Supabase Data API access.
-- Apply after migration 015.

begin;

do $$
declare
  required_table text;
begin
  foreach required_table in array array[
    'roles',
    'users',
    'machines',
    'sensors',
    'sensor_events',
    'downtime_events',
    'production_counts',
    'audit_logs',
    'alerts'
  ]
  loop
    if to_regclass(format('public.%I', required_table)) is null then
      raise exception 'Required base table public.% is missing', required_table;
    end if;
  end loop;
end $$;

alter table public.roles enable row level security;
alter table public.users enable row level security;
alter table public.machines enable row level security;
alter table public.sensors enable row level security;
alter table public.sensor_events enable row level security;
alter table public.downtime_events enable row level security;
alter table public.production_counts enable row level security;
alter table public.audit_logs enable row level security;
alter table public.alerts enable row level security;

revoke all on table public.roles from public, anon, authenticated, service_role;
revoke all on table public.users from public, anon, authenticated, service_role;
revoke all on table public.machines from public, anon, authenticated, service_role;
revoke all on table public.sensors from public, anon, authenticated, service_role;
revoke all on table public.sensor_events from public, anon, authenticated, service_role;
revoke all on table public.downtime_events from public, anon, authenticated, service_role;
revoke all on table public.production_counts from public, anon, authenticated, service_role;
revoke all on table public.audit_logs from public, anon, authenticated, service_role;
revoke all on table public.alerts from public, anon, authenticated, service_role;

-- The Express backend is the only application data-access path. Grant its
-- server-side service role only the direct operations used by current code;
-- security-definer RPCs retain ownership of atomic domain writes.
grant select on table public.roles to service_role;
grant select, insert, update on table public.users to service_role;
grant select, update on table public.machines to service_role;
grant select, update on table public.sensors to service_role;
grant select on table public.sensor_events to service_role;
grant select on table public.downtime_events to service_role;
grant select on table public.production_counts to service_role;
grant select, insert on table public.audit_logs to service_role;
grant select on table public.alerts to service_role;

commit;
