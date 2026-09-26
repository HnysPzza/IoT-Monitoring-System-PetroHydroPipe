begin;

alter table public.password_setup_tokens
  add column if not exists purpose text not null default 'setup'
  check (purpose in ('setup', 'reset'));

create or replace function public.request_user_password_reset(p_actor uuid, p_user_id uuid, p_token_hash text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform 1 from public.users account
    join public.roles role on role.id = account.role_id
    where account.id = p_actor and role.name = 'Admin' and account.status = 'Active'
      and account.deleted_at is null and not account.must_change_password
    for update of account;
  if not found then raise exception 'Admin access required.' using errcode = '42501'; end if;

  perform 1 from public.users account
    join public.roles role on role.id = account.role_id
    where account.id = p_user_id and role.name <> 'Admin' and account.onboarding_state = 'Ready'
      and account.status = 'Active' and account.deleted_at is null
    for update of account;
  if not found then raise exception 'Account is not eligible for password reset.' using errcode = '22023'; end if;

  if exists (
    select 1 from public.password_setup_tokens
    where user_id = p_user_id and purpose = 'reset'
      and created_at > clock_timestamp() - interval '1 minute'
  ) then
    raise exception 'Wait one minute before requesting another password reset.' using errcode = 'P0001';
  end if;

  update public.password_setup_tokens
    set used_at = clock_timestamp()
    where user_id = p_user_id and used_at is null;
  insert into public.password_setup_tokens(user_id, token_hash, purpose)
    values (p_user_id, p_token_hash, 'reset');
  insert into public.audit_logs(user_id, action, entity_type, entity_id)
    values (p_actor, 'USER_PASSWORD_RESET_REQUESTED', 'user', p_user_id);
end;
$$;

create or replace function public.complete_password_setup(p_token_hash text, p_password_hash text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare account_id uuid; token_purpose text; setup_token public.password_setup_tokens%rowtype;
begin
  select user_id, purpose into account_id, token_purpose
    from public.password_setup_tokens where token_hash = p_token_hash;
  if not found then raise exception 'Invalid or expired password link.' using errcode = '22023'; end if;

  perform 1 from public.users account
    join public.roles role on role.id = account.role_id
    where account.id = account_id and account.status = 'Active' and account.deleted_at is null
      and ((token_purpose = 'setup' and account.onboarding_state = 'Invited')
        or (token_purpose = 'reset' and account.onboarding_state = 'Ready' and role.name <> 'Admin'))
    for update of account;
  if not found then raise exception 'Invalid or expired password link.' using errcode = '22023'; end if;

  select * into setup_token from public.password_setup_tokens where token_hash = p_token_hash for update;
  if not found or setup_token.used_at is not null or setup_token.expires_at <= clock_timestamp() then
    raise exception 'Invalid or expired password link.' using errcode = '22023';
  end if;
  if p_password_hash is null or p_password_hash !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' then
    raise exception 'Invalid password hash.' using errcode = '22023';
  end if;

  update public.users
    set password_hash = p_password_hash,
        onboarding_state = case when token_purpose = 'setup' then 'Ready' else onboarding_state end,
        must_change_password = false
    where id = account_id;
  update public.password_setup_tokens set used_at = clock_timestamp() where id = setup_token.id;
  update public.auth_sessions set revoked_at = clock_timestamp() where user_id = account_id and revoked_at is null;
  update public.refresh_tokens set revoked_at = clock_timestamp() where user_id = account_id and revoked_at is null;
  insert into public.audit_logs(user_id, action, entity_type, entity_id)
    values (account_id, case when token_purpose = 'reset' then 'PASSWORD_RESET_COMPLETED' else 'PASSWORD_SETUP_COMPLETED' end, 'user', account_id);
end;
$$;

revoke all on function public.request_user_password_reset(uuid, uuid, text), public.complete_password_setup(text, text)
  from public, anon, authenticated;
grant execute on function public.request_user_password_reset(uuid, uuid, text), public.complete_password_setup(text, text)
  to service_role;

do $$
begin
  if to_regprocedure('public.get_backend_readiness_v44()') is null then
    alter function public.get_backend_readiness() rename to get_backend_readiness_v44;
  end if;
end;
$$;

create or replace function public.get_backend_readiness()
returns integer language plpgsql stable security invoker set search_path = pg_catalog, public as $$
begin
  if public.get_backend_readiness_v44() <> 44 then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.password_setup_tokens'::regclass
      and attname = 'purpose' and atttypid = 'text'::regtype and not attisdropped
  ) or to_regprocedure('public.request_user_password_reset(uuid,uuid,text)') is null
    or has_function_privilege('anon', 'public.request_user_password_reset(uuid,uuid,text)', 'execute')
    or has_function_privilege('authenticated', 'public.request_user_password_reset(uuid,uuid,text)', 'execute')
    or not has_function_privilege('service_role', 'public.request_user_password_reset(uuid,uuid,text)', 'execute') then
    raise exception using errcode = '55000', message = 'Required account reset dependencies are missing.';
  end if;
  return 45;
end;
$$;

revoke all on function public.get_backend_readiness(), public.get_backend_readiness_v44()
  from public, anon, authenticated;
grant execute on function public.get_backend_readiness(), public.get_backend_readiness_v44()
  to service_role;

commit;
