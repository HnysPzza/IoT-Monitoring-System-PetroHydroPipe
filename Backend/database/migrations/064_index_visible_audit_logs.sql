begin;

create index if not exists idx_audit_logs_visible_created_at
  on public.audit_logs (created_at desc)
  where action <> 'SENSOR_PULSE'
    and (
      action <> 'IOT_EVENT_RECEIVED'
      or (
        (metadata->>'eventType' is null or metadata->>'eventType' not ilike 'pulse')
        and (metadata->>'event_type' is null or metadata->>'event_type' not ilike 'pulse')
        and (metadata->>'signal' is null or metadata->>'signal' not ilike 'pulse')
      )
    );

create or replace function public.get_backend_readiness_v63()
returns integer
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
begin
  if public.get_backend_readiness_v62() <> 62 then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  if not exists (
    select 1
    from pg_attribute
    where attrelid = 'public.sensor_watchdog_state'::regclass
      and attname = 'recovery_activity_observed'
      and not attisdropped
  ) then
    raise exception using errcode = '55000', message = 'Required WAN recovery tracking column is missing.';
  end if;

  return 63;
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
  if public.get_backend_readiness_v63() <> 63 then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  if to_regclass('public.idx_audit_logs_visible_created_at') is null then
    raise exception using errcode = '55000', message = 'Required audit log pagination index is missing.';
  end if;

  return 64;
end;
$$;

revoke all on function
  public.get_backend_readiness(),
  public.get_backend_readiness_v63()
  from public, anon, authenticated;
grant execute on function
  public.get_backend_readiness(),
  public.get_backend_readiness_v63()
  to service_role;

commit;
