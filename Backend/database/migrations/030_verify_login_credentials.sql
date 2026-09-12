begin;

create or replace function public.issue_refresh_token(p_user_id uuid, p_token_hash text, p_expires_at timestamptz, p_verified_hash text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare account public.users%rowtype; session_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at is null or p_expires_at <= clock_timestamp()
    or p_expires_at > clock_timestamp() + interval '24 hours' then
    raise exception 'Invalid session parameters.' using errcode='22023';
  end if;
  select * into account from public.users where id=p_user_id for update;
  if not found or account.password_hash is distinct from p_verified_hash or p_verified_hash is null
    or account.status <> 'Active' or account.deleted_at is not null or account.onboarding_state <> 'Ready' then
    raise exception 'Credentials changed; sign in again.' using errcode='28000';
  end if;
  insert into public.auth_sessions(user_id,expires_at) values(p_user_id,p_expires_at) returning id into session_id;
  insert into public.refresh_tokens(user_id,token_hash,expires_at,session_id) values(p_user_id,p_token_hash,p_expires_at,session_id);
  return session_id;
end $$;
revoke all on function public.issue_refresh_token(uuid,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.issue_refresh_token(uuid,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.issue_refresh_token(uuid,text,timestamptz,text) to service_role;

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
    raise exception using errcode='55000', message='Required account dependencies are missing.';
  end if;
  if to_regprocedure('public.issue_refresh_token(uuid,text,timestamptz,text)') is null
    or has_function_privilege('service_role', 'public.issue_refresh_token(uuid,text,timestamptz)', 'execute') then
    raise exception using errcode='55000', message='Required login protection is missing.';
  end if;
  return 30;
end;
$$;
revoke all on function public.get_backend_readiness() from public,anon,authenticated;
grant execute on function public.get_backend_readiness() to service_role;
commit;
