begin;

set local lock_timeout = '2s';

lock table public.roles in share row exclusive mode;
lock table public.users in share mode;

do $$
declare director_role_id uuid;
begin
  select id into director_role_id
  from public.roles
  where name = 'Managing Director';

  if director_role_id is not null and exists (
    select 1 from public.users where role_id = director_role_id
  ) then
    raise exception 'Managing Director role is assigned to a user account; migration stopped.';
  end if;

  delete from public.roles where id = director_role_id;

  if (select count(*) from public.roles) <> 5
    or exists (
      select 1 from public.roles
      where name not in (
        'Admin',
        'Operation Manager',
        'Asst. Operation Manager',
        'Engineering Supervisor',
        'Production Supervisor'
      )
    ) then
    raise exception 'Expected role catalog of five roles; migration stopped.';
  end if;
end;
$$;

do $$
begin
  if to_regprocedure('public.get_backend_readiness_v45()') is null then
    alter function public.get_backend_readiness() rename to get_backend_readiness_v45;
  end if;
end;
$$;

create or replace function public.get_backend_readiness()
returns integer language plpgsql stable security invoker set search_path = pg_catalog, public as $$
begin
  if public.get_backend_readiness_v45() <> 45 then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  if (select count(*) from public.roles) <> 5
    or exists (
      select 1 from public.roles
      where name not in (
        'Admin',
        'Operation Manager',
        'Asst. Operation Manager',
        'Engineering Supervisor',
        'Production Supervisor'
      )
    ) then
    raise exception using errcode = '55000', message = 'Role catalog does not match the expected five roles.';
  end if;

  return 46;
end;
$$;

revoke all on function public.get_backend_readiness(), public.get_backend_readiness_v45()
  from public, anon, authenticated;
grant execute on function public.get_backend_readiness(), public.get_backend_readiness_v45()
  to service_role;

commit;
