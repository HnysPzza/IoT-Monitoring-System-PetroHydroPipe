begin;

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
    or to_regprocedure('public.ingest_iot_grouped_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)') is null
    or to_regprocedure('public.ingest_iot_heartbeat(uuid,uuid,uuid,bigint,uuid,bigint,timestamptz,boolean)') is null
    or to_regprocedure('public.evaluate_sensor_watchdog(uuid,timestamptz,text,integer)') is null
    or to_regprocedure('public.update_downtime_record(uuid,text,text,boolean,boolean)') is null
    or to_regprocedure('public.aggregate_analytics_sensor_events(uuid,timestamptz,timestamptz,integer)') is null
    or to_regprocedure('public.reconcile_machine_downtime(uuid,timestamptz,text,text,jsonb)') is null
    or to_regclass('public.refresh_tokens') is null
    or to_regclass('public.auth_sessions') is null
    or to_regprocedure('public.issue_refresh_token(uuid,text,timestamptz,text)') is null
    or to_regprocedure('public.revoke_refresh_token(text)') is null
    or to_regprocedure('public.rotate_refresh_token(text,text)') is null then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.sensors'::regclass
      and attname = 'fault_source' and atttypid = 'text'::regtype and not attisdropped
  ) then
    raise exception using errcode = '55000', message = 'Required grouped downtime column is missing.';
  end if;
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.sensor_events'::regclass
      and attname = 'stale' and atttypid = 'boolean'::regtype and not attisdropped
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.sensor_events'::regclass
      and tgname = 'classify_sensor_event_staleness'
      and tgfoid = to_regprocedure('public.classify_sensor_event_staleness()')
      and tgenabled in ('O', 'A')
  ) then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;
  if to_regclass('public.password_setup_tokens') is null
    or to_regprocedure('public.add_invited_user(uuid,text,text,text,text,text)') is null
    or to_regprocedure('public.resend_user_invitation(uuid,uuid,text)') is null
    or to_regprocedure('public.complete_password_setup(text,text)') is null
    or to_regprocedure('public.change_account_password(uuid,text,text)') is null
    or to_regprocedure('public.list_user_accounts(integer,integer,text,text,text,text,text,text)') is null then
    raise exception using errcode = '55000', message = 'Required account dependencies are missing.';
  end if;
  if to_regprocedure('public.issue_refresh_token(uuid,text,timestamptz,text)') is null
    or has_function_privilege('service_role', 'public.issue_refresh_token(uuid,text,timestamptz)', 'execute') then
    raise exception using errcode = '55000', message = 'Required login protection is missing.';
  end if;
  if not exists (select 1 from public.machines where machine_code = 'M-01')
    or exists (
      select machine.id from public.machines machine
      left join public.sensors sensor on sensor.machine_id = machine.id
        and sensor.sensor_code in ('S-01','S-02','S-03','S-04','S-05')
      group by machine.id having count(distinct sensor.sensor_code) <> 5
    ) then
    raise exception using errcode = '55000', message = 'Required machine sensor identities are missing.';
  end if;
  return 42;
end;
$$;

revoke all on function public.get_backend_readiness() from public, anon, authenticated;
grant execute on function public.get_backend_readiness() to service_role;

commit;
