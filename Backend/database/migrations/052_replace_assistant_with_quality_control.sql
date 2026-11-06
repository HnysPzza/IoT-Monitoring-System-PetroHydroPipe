  begin;

  set local lock_timeout = '2s';

  lock table public.roles in share row exclusive mode;
  lock table public.users in share mode;

  -- Rename Asst. Operation Manager in-place to Quality Control.
  update public.roles
  set
    name = 'Quality Control',
    description = 'Quality control and production monitoring access.'
  where name = 'Asst. Operation Manager';

  -- Ensure role catalog strictly matches expected five roles.
  do $$
  begin
    if (select count(*) from public.roles) <> 5
      or exists (
        select 1 from public.roles
        where name not in (
          'Admin',
          'Operation Manager',
          'Quality Control',
          'Engineering Supervisor',
          'Production Supervisor'
        )
      ) then
      raise exception using errcode = '55000', message = 'Role catalog does not match the expected five roles.';
    end if;
  end;
  $$;

  do $$
  begin
    if to_regprocedure('public.get_backend_readiness_v51()') is null then
      alter function public.get_backend_readiness() rename to get_backend_readiness_v51;
    end if;
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
    if public.get_backend_readiness_v51() <> 51 then
      raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
    end if;

    if (select count(*) from public.roles) <> 5
      or exists (
        select 1 from public.roles
        where name not in (
          'Admin',
          'Operation Manager',
          'Quality Control',
          'Engineering Supervisor',
          'Production Supervisor'
        )
      ) then
      raise exception using errcode = '55000', message = 'Role catalog does not match the expected five roles.';
    end if;

    return 52;
  end;
  $$;

  create or replace function public.get_backend_readiness_v46()
  returns integer
  language plpgsql
  stable
  security invoker
  set search_path = pg_catalog, public
  as $$
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
          'Quality Control',
          'Engineering Supervisor',
          'Production Supervisor'
        )
      ) then
      raise exception using errcode = '55000', message = 'Role catalog does not match the expected five roles.';
    end if;

    return 46;
  end;
  $$;

  revoke all on function public.get_backend_readiness(), public.get_backend_readiness_v51(), public.get_backend_readiness_v46()
    from public, anon, authenticated;
  grant execute on function public.get_backend_readiness(), public.get_backend_readiness_v51(), public.get_backend_readiness_v46()
    to service_role;

  commit;
