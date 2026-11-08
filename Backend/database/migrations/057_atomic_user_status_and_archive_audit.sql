-- Move user status updates and account archiving into atomic security definer RPCs:
-- 1. Define public.update_user_account_status(uuid, uuid, text) to atomically update users.status and write USER_STATUS_UPDATED to audit_logs.
-- 2. Define public.archive_user_account(uuid, uuid) to atomically archive the user and write USER_ARCHIVED to audit_logs.
-- 3. Revoke direct INSERT, UPDATE, and DELETE on public.users from service_role so all user mutations must go through audited RPCs.
-- 4. Bump backend readiness schema version to 57.

begin;

create or replace function public.update_user_account_status(
  p_actor uuid,
  p_user_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_target record;
  v_updated public.users%rowtype;
  v_setup_expires_at timestamptz;
begin
  if p_user_id is not null and p_actor is not null and p_user_id = p_actor and p_status = 'Inactive' then
    raise exception 'Admin cannot deactivate their own account.' using errcode = '22023';
  end if;

  if p_status is null or p_status not in ('Active', 'Inactive') then
    raise exception 'Invalid account status.' using errcode = '22023';
  end if;

  perform 1
  from public.users account
  join public.roles role on role.id = account.role_id
  where account.id = p_actor
    and role.name = 'Admin'
    and account.status = 'Active'
    and account.deleted_at is null
    and not account.must_change_password
  for update of account;

  if not found then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  select account.*, role.name as role_name
  into v_target
  from public.users account
  join public.roles role on role.id = account.role_id
  where account.id = p_user_id
    and account.deleted_at is null
  for update of account;

  if not found then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;

  if v_target.role_name = 'Admin' then
    raise exception 'Admin account cannot be deactivated.' using errcode = '42501';
  end if;

  if v_target.status is distinct from p_status then
    update public.users
    set status = p_status
    where id = p_user_id
      and deleted_at is null
    returning * into v_updated;

    insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    values (
      p_actor,
      'USER_STATUS_UPDATED',
      'user',
      v_updated.id,
      jsonb_build_object(
        'targetUsername', v_updated.username,
        'targetRole', v_target.role_name,
        'newStatus', v_updated.status
      )
    );
  else
    select * into v_updated
    from public.users
    where id = p_user_id;
  end if;

  select setup.expires_at
  into v_setup_expires_at
  from public.password_setup_tokens setup
  where setup.user_id = v_updated.id
    and setup.used_at is null
  limit 1;

  return jsonb_build_object(
    'id', v_updated.id,
    'name', v_updated.name,
    'username', v_updated.username,
    'email', v_updated.email,
    'role', v_target.role_name,
    'status', v_updated.status,
    'mustChangePassword', v_updated.must_change_password,
    'onboarding', case
      when v_updated.onboarding_state = 'Ready' then 'Ready'
      when v_setup_expires_at > now() then 'Invited'
      else 'Expired'
    end,
    'setupExpiresAt', v_setup_expires_at,
    'createdAt', v_updated.created_at,
    'lastLoginAt', v_updated.last_login_at,
    'deletedAt', v_updated.deleted_at
  );
end;
$$;

create or replace function public.archive_user_account(
  p_actor uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_target record;
  v_updated public.users%rowtype;
  v_archived_at timestamptz;
begin
  if p_user_id is not null and p_actor is not null and p_user_id = p_actor then
    raise exception 'Admin cannot archive their own account.' using errcode = '22023';
  end if;

  perform 1
  from public.users account
  join public.roles role on role.id = account.role_id
  where account.id = p_actor
    and role.name = 'Admin'
    and account.status = 'Active'
    and account.deleted_at is null
    and not account.must_change_password
  for update of account;

  if not found then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  select account.*, role.name as role_name
  into v_target
  from public.users account
  join public.roles role on role.id = account.role_id
  where account.id = p_user_id
    and account.deleted_at is null
  for update of account;

  if not found then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;

  if v_target.role_name = 'Admin' then
    raise exception 'Admin account cannot be archived.' using errcode = '42501';
  end if;

  v_archived_at := clock_timestamp();

  update public.users
  set
    status = 'Inactive',
    deleted_at = v_archived_at,
    deleted_by = p_actor
  where id = p_user_id
    and deleted_at is null
  returning * into v_updated;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  values (
    p_actor,
    'USER_ARCHIVED',
    'user',
    v_updated.id,
    jsonb_build_object(
      'targetUsername', v_updated.username,
      'targetRole', v_target.role_name,
      'previousStatus', v_target.status,
      'newStatus', v_updated.status,
      'archivedAt', v_archived_at
    )
  );

  return jsonb_build_object(
    'id', v_updated.id,
    'name', v_updated.name,
    'username', v_updated.username,
    'email', v_updated.email,
    'role', v_target.role_name,
    'status', v_updated.status,
    'mustChangePassword', v_updated.must_change_password,
    'onboarding', case
      when v_updated.onboarding_state = 'Ready' then 'Ready'
      else 'Expired'
    end,
    'setupExpiresAt', null,
    'createdAt', v_updated.created_at,
    'lastLoginAt', v_updated.last_login_at,
    'deletedAt', v_updated.deleted_at
  );
end;
$$;

revoke all on function
  public.update_user_account_status(uuid, uuid, text),
  public.archive_user_account(uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  public.update_user_account_status(uuid, uuid, text),
  public.archive_user_account(uuid, uuid)
  to service_role;

revoke insert, update, delete on public.users
  from public, anon, authenticated, service_role;
grant select on public.users
  to service_role;

create or replace function public.get_backend_readiness_v56()
returns integer
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
begin
  if public.get_backend_readiness_v55() <> 55 then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  if to_regprocedure('public.evaluate_sensor_watchdog(uuid,timestamptz,text,integer)') is null
    or to_regprocedure('public.ingest_iot_grouped_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)') is null then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  return 56;
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

revoke all on function
  public.get_backend_readiness(),
  public.get_backend_readiness_v56()
  from public, anon, authenticated;
grant execute on function
  public.get_backend_readiness(),
  public.get_backend_readiness_v56()
  to service_role;

commit;
