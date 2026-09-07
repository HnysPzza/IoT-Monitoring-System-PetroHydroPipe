begin;

do $$
declare admin_role uuid;
begin
  select id into admin_role from public.roles where name = 'Admin';
  if admin_role is null or (select count(*) from public.users where role_id = admin_role) <> 1 then
    raise exception 'Onboarding requires exactly one existing Admin; resolve accounts before migration.';
  end if;
  if exists (select 1 from public.users where role_id = admin_role and (status <> 'Active' or deleted_at is not null)) then
    raise exception 'Existing Admin must be active and not archived.';
  end if;
  execute format('create unique index if not exists users_single_admin on public.users(role_id) where role_id = %L::uuid', admin_role);
end $$;

alter table public.users add column if not exists onboarding_state text not null default 'Ready'
  check (onboarding_state in ('Invited', 'Ready'));
alter table public.users alter column password_hash drop not null;
alter table public.users drop constraint if exists users_onboarding_password;
alter table public.users add constraint users_onboarding_password check (
  (onboarding_state='Invited' and password_hash is null and not must_change_password)
  or (onboarding_state='Ready' and password_hash is not null)
);
create unique index if not exists users_username_normalized on public.users(lower(username));
create unique index if not exists users_email_normalized on public.users(lower(email));

create table if not exists public.password_setup_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null default (now() + interval '1 hour'),
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists password_setup_one_unused on public.password_setup_tokens(user_id) where used_at is null;
alter table public.password_setup_tokens enable row level security;
revoke all on public.password_setup_tokens from public, anon, authenticated, service_role;
grant select on public.password_setup_tokens to service_role;

create or replace function public.protect_administrator()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if exists (select 1 from public.roles where id = old.role_id and name = 'Admin') then
    if tg_op = 'DELETE' then raise exception 'Protected administrator.' using errcode = '42501'; end if;
    if new.id <> old.id or new.role_id <> old.role_id or new.status <> 'Active' or new.deleted_at is not null or new.onboarding_state <> 'Ready' then
      raise exception 'Protected administrator.' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists protect_administrator on public.users;
create trigger protect_administrator before update or delete on public.users
for each row execute function public.protect_administrator();

create or replace function public.protect_admin_role()
returns trigger language plpgsql as $$
begin
  if old.name = 'Admin' then
    if tg_op = 'DELETE' then raise exception 'Protected administrator role.' using errcode = '42501'; end if;
    if new.id <> old.id or new.name <> old.name then raise exception 'Protected administrator role.' using errcode = '42501'; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists protect_admin_role on public.roles;
create trigger protect_admin_role before update or delete on public.roles
for each row execute function public.protect_admin_role();

create or replace function public.guard_onboarding_session()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if not exists (select 1 from public.users where id = new.user_id and onboarding_state = 'Ready') then
    raise exception 'Account setup required.' using errcode = '28000';
  end if;
  return new;
end $$;
drop trigger if exists guard_onboarding_session on public.auth_sessions;
create trigger guard_onboarding_session before insert on public.auth_sessions
for each row execute function public.guard_onboarding_session();

create or replace function public.add_invited_user(p_actor uuid, p_name text, p_username text, p_email text, p_role text, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare account_id uuid; selected_role uuid;
begin
  perform 1 from public.users account join public.roles role on role.id = account.role_id
    where account.id = p_actor and role.name = 'Admin' and account.status = 'Active'
      and account.deleted_at is null and not account.must_change_password for update of account;
  if not found then raise exception 'Admin access required.' using errcode = '42501'; end if;
  select id into selected_role from public.roles where name = p_role and name <> 'Admin';
  if selected_role is null then raise exception 'Role cannot be assigned.' using errcode = '22023'; end if;
  insert into public.users(name,username,email,role_id,password_hash,status,must_change_password,onboarding_state)
    values (trim(p_name),lower(trim(p_username)),lower(trim(p_email)),selected_role,null,'Active',false,'Invited') returning id into account_id;
  insert into public.password_setup_tokens(user_id,token_hash) values (account_id,p_token_hash);
  insert into public.audit_logs(user_id,action,entity_type,entity_id)
    values (p_actor,'USER_INVITED','user',account_id);
  return jsonb_build_object('id',account_id);
end $$;

create or replace function public.resend_user_invitation(p_actor uuid,p_user_id uuid,p_token_hash text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform 1 from public.users account join public.roles role on role.id=account.role_id
    where account.id=p_actor and role.name='Admin' and account.status='Active' and account.deleted_at is null
      and not account.must_change_password for update of account;
  if not found then raise exception 'Admin access required.' using errcode='42501'; end if;
  perform 1 from public.users where id=p_user_id and onboarding_state='Invited' and status='Active' and deleted_at is null for update;
  if not found then raise exception 'Account is not eligible for invitation.' using errcode='22023'; end if;
  if exists(select 1 from public.password_setup_tokens where user_id=p_user_id and created_at > clock_timestamp()-interval '1 minute') then
    raise exception 'Wait one minute before resending.' using errcode='P0001';
  end if;
  update public.password_setup_tokens set used_at=clock_timestamp() where user_id=p_user_id and used_at is null;
  insert into public.password_setup_tokens(user_id,token_hash) values(p_user_id,p_token_hash);
  insert into public.audit_logs(user_id,action,entity_type,entity_id) values(p_actor,'USER_INVITATION_RESENT','user',p_user_id);
end $$;

create or replace function public.complete_password_setup(p_token_hash text,p_password_hash text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare account_id uuid; setup_token public.password_setup_tokens%rowtype;
begin
  select user_id into account_id from public.password_setup_tokens where token_hash=p_token_hash;
  perform 1 from public.users where id=account_id and onboarding_state='Invited' and status='Active' and deleted_at is null for update;
  if not found then raise exception 'Invalid or expired setup link.' using errcode='22023'; end if;
  select * into setup_token from public.password_setup_tokens where token_hash=p_token_hash for update;
  if setup_token.used_at is not null or setup_token.expires_at <= clock_timestamp() then
    raise exception 'Invalid or expired setup link.' using errcode='22023';
  end if;
  if p_password_hash is null or p_password_hash !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' then
    raise exception 'Invalid password hash.' using errcode='22023';
  end if;
  update public.users set password_hash=p_password_hash,onboarding_state='Ready',must_change_password=false where id=account_id;
  update public.password_setup_tokens set used_at=clock_timestamp() where id=setup_token.id;
  update public.auth_sessions set revoked_at=clock_timestamp() where user_id=account_id and revoked_at is null;
  update public.refresh_tokens set revoked_at=clock_timestamp() where user_id=account_id and revoked_at is null;
  insert into public.audit_logs(user_id,action,entity_type,entity_id) values(account_id,'PASSWORD_SETUP_COMPLETED','user',account_id);
end $$;

create or replace function public.change_account_password(p_user_id uuid,p_old_hash text,p_new_hash text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform 1 from public.users where id=p_user_id and password_hash=p_old_hash and status='Active' and deleted_at is null and onboarding_state='Ready' for update;
  if not found then raise exception 'Account or password changed; sign in again.' using errcode='22023'; end if;
  if p_new_hash is null or p_new_hash !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' then raise exception 'Invalid password hash.' using errcode='22023'; end if;
  update public.users set password_hash=p_new_hash,must_change_password=false where id=p_user_id;
  update public.auth_sessions set revoked_at=clock_timestamp() where user_id=p_user_id and revoked_at is null;
  update public.refresh_tokens set revoked_at=clock_timestamp() where user_id=p_user_id and revoked_at is null;
  insert into public.audit_logs(user_id,action,entity_type,entity_id) values(p_user_id,'PASSWORD_CHANGED','user',p_user_id);
end $$;

revoke all on function public.add_invited_user(uuid,text,text,text,text,text), public.resend_user_invitation(uuid,uuid,text), public.complete_password_setup(text,text), public.change_account_password(uuid,text,text) from public,anon,authenticated;
grant execute on function public.add_invited_user(uuid,text,text,text,text,text), public.resend_user_invitation(uuid,uuid,text), public.complete_password_setup(text,text), public.change_account_password(uuid,text,text) to service_role;
create or replace function public.list_user_accounts(p_page integer default 1,p_limit integer default 10,p_search text default '',p_role text default '',p_status text default '',p_onboarding text default '',p_sort text default 'created',p_direction text default 'desc')
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if p_page not between 1 and 100000 or p_limit not between 1 and 50 or p_sort not in ('created','name','role','status') or p_direction not in ('asc','desc') then
    raise exception 'Invalid directory query.' using errcode='22023';
  end if;
  with accounts as (
    select account.id,account.name,account.username,account.email,role.name as role,account.status,
      account.must_change_password as "mustChangePassword",account.created_at as "createdAt",account.last_login_at as "lastLoginAt",
      case when account.onboarding_state='Ready' then 'Ready'
        when setup.expires_at > now() then 'Invited' else 'Expired' end as onboarding,
      setup.expires_at as "setupExpiresAt"
    from public.users account join public.roles role on role.id=account.role_id
    left join public.password_setup_tokens setup on setup.user_id=account.id and setup.used_at is null
    where account.deleted_at is null
  ), filtered as (
    select * from accounts where (p_role='' or role=p_role) and (p_status='' or status=p_status)
      and (p_onboarding='' or onboarding=p_onboarding)
      and (p_search='' or strpos(lower(name || ' ' || username || ' ' || coalesce(email,'')),lower(p_search))>0)
  ), page_rows as (
    select * from filtered order by
      case when p_direction='asc' then case p_sort when 'name' then lower(name) when 'role' then role when 'status' then status else "createdAt"::text end end asc,
      case when p_direction='desc' then case p_sort when 'name' then lower(name) when 'role' then role when 'status' then status else "createdAt"::text end end desc,
      id limit p_limit offset ((p_page-1)*p_limit)
  ) select jsonb_build_object('users',coalesce((select jsonb_agg(to_jsonb(page_rows)) from page_rows),'[]'::jsonb),
      'total',(select count(*) from filtered),'page',p_page,'limit',p_limit,
      'summary',(select jsonb_build_object('total',count(*),'active',count(*) filter(where status='Active'),
        'inactive',count(*) filter(where status='Inactive'),'pending',count(*) filter(where onboarding<>'Ready')) from accounts)) into result;
  return result;
end $$;
revoke all on function public.list_user_accounts(integer,integer,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.list_user_accounts(integer,integer,text,text,text,text,text,text) to service_role;

create or replace function public.revoke_disabled_account_access()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.status='Inactive' or new.deleted_at is not null then
    update public.auth_sessions set revoked_at=clock_timestamp() where user_id=new.id and revoked_at is null;
    update public.refresh_tokens set revoked_at=clock_timestamp() where user_id=new.id and revoked_at is null;
    update public.password_setup_tokens set used_at=clock_timestamp() where user_id=new.id and used_at is null;
  end if;
  return new;
end $$;
drop trigger if exists revoke_disabled_account_access on public.users;
create trigger revoke_disabled_account_access after update of status,deleted_at on public.users
for each row execute function public.revoke_disabled_account_access();
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
  return 29;
end;
$$;
revoke all on function public.get_backend_readiness() from public,anon,authenticated;
grant execute on function public.get_backend_readiness() to service_role;
commit;
