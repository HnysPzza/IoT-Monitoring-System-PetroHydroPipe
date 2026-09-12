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
