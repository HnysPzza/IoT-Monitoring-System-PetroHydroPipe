-- Phase 17: Supabase security cleanup.
-- Run this after the previous migrations in Supabase SQL Editor.

-- Pin the trigger helper search path so Supabase does not flag it as mutable.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- If the optional RLS helper exists, keep it away from public/client roles.
do $$
declare
  helper record;
begin
  for helper in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as function_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'rls_auto_enable'
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from anon, authenticated, public',
      helper.schema_name,
      helper.function_name,
      helper.function_args
    );
  end loop;
end $$;

-- Cover the downtime_events.sensor_id foreign key for sensor-level downtime lookups.
create index if not exists idx_downtime_events_sensor_id on public.downtime_events(sensor_id);
