begin;

create index if not exists idx_audit_logs_created_at
  on public.audit_logs (created_at desc);

create index if not exists idx_sensor_events_analytics_pulse
  on public.sensor_events (machine_id, recorded_at, sensor_id, output_accepted)
  where event_type = 'pulse' and stale is not true;

create index if not exists idx_sensor_events_s05_accepted_ordered
  on public.sensor_events (sensor_id, recorded_at asc, id asc)
  where event_type = 'pulse' and output_accepted is true;

create or replace function public.get_analytics_first_recorded_at(p_machine_id uuid)
returns timestamptz
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select min(recorded_at)
  from (
    (
      select event.recorded_at
      from public.sensor_events event
      join public.sensors sensor on sensor.id = event.sensor_id
      where event.machine_id = p_machine_id
        and event.event_type = 'pulse'
        and event.stale is not true
        and sensor.sensor_code in ('S-01', 'S-02', 'S-04', 'S-05')
        and (sensor.sensor_code <> 'S-05' or event.output_accepted is not false)
      order by event.recorded_at asc
      limit 1
    )

    union all

    (
      select downtime.started_at
      from public.downtime_events downtime
      where downtime.machine_id = p_machine_id
      order by downtime.started_at asc
      limit 1
    )
  ) analytics_records;
$$;

revoke all on function public.get_analytics_first_recorded_at(uuid)
  from public, anon, authenticated;
grant execute on function public.get_analytics_first_recorded_at(uuid)
  to service_role;

create or replace function public.get_backend_readiness_v57()
returns integer
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
begin
  if public.get_backend_readiness_v56() <> 56 then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  if to_regprocedure('public.update_user_account_status(uuid,uuid,text)') is null
    or to_regprocedure('public.archive_user_account(uuid,uuid)') is null
    or has_table_privilege('service_role', 'public.users', 'INSERT')
    or has_table_privilege('service_role', 'public.users', 'UPDATE')
    or has_table_privilege('service_role', 'public.users', 'DELETE') then
    raise exception using errcode = '55000', message = 'Required account dependencies are missing.';
  end if;

  return 57;
end;
$$;

create or replace function public.get_backend_readiness()
returns integer
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
begin
  if public.get_backend_readiness_v57() <> 57 then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  if to_regclass('public.idx_audit_logs_created_at') is null
    or to_regclass('public.idx_sensor_events_analytics_pulse') is null
    or to_regclass('public.idx_sensor_events_s05_accepted_ordered') is null
    or to_regprocedure('public.get_analytics_first_recorded_at(uuid)') is null then
    raise exception using errcode = '55000', message = 'Required query optimization indexes or functions are missing.';
  end if;

  return 58;
end;
$$;

revoke all on function
  public.get_backend_readiness(),
  public.get_backend_readiness_v57()
  from public, anon, authenticated;
grant execute on function
  public.get_backend_readiness(),
  public.get_backend_readiness_v57()
  to service_role;

commit;

