begin;

create or replace function public.update_downtime_record(
  p_downtime_id uuid,
  p_cause text,
  p_notes text,
  p_has_notes boolean,
  p_resolve boolean,
  p_actor_user_id uuid
)
returns table (downtime_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_downtime public.downtime_events%rowtype;
  v_updated public.downtime_events%rowtype;
  v_sensor_code text;
  v_ended_at timestamptz;
begin
  select downtime.* into v_downtime
  from public.downtime_events downtime
  where downtime.id = p_downtime_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Downtime record not found.';
  end if;

  select sensor.sensor_code into v_sensor_code
  from public.sensors sensor where sensor.id = v_downtime.sensor_id;

  if p_cause is not null and v_sensor_code is distinct from 'S-03' then
    raise exception using errcode = '22023', message = 'Downtime cause is locked for this sensor.';
  end if;

  if p_resolve
    and v_sensor_code = 'S-03'
    and coalesce(p_cause, v_downtime.cause, 'Pending Cause Review') = 'Pending Cause Review'
  then
    raise exception using errcode = '23514', message = 'Choose the downtime cause before resolving this record.';
  end if;

  v_ended_at := case
    when p_resolve and v_downtime.status = 'Open' then now()
    else v_downtime.ended_at
  end;

  update public.downtime_events
  set
    cause = coalesce(p_cause, cause),
    notes = case when p_has_notes then p_notes else notes end,
    status = case when p_resolve then 'Resolved' else status end,
    ended_at = v_ended_at,
    duration_seconds = case
      when p_resolve and v_downtime.status = 'Open'
        then greatest(0, round(extract(epoch from (v_ended_at - started_at)))::integer)
      else duration_seconds
    end
  where id = p_downtime_id
  returning * into v_updated;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  values (
    p_actor_user_id,
    'DOWNTIME_UPDATED',
    'downtime',
    v_updated.id,
    jsonb_build_object(
      'cause', v_updated.cause,
      'status', v_updated.status,
      'previousStatus', v_downtime.status,
      'sensorCode', v_sensor_code
    )
  );

  return query select p_downtime_id;
end;
$$;

create or replace function public.update_downtime_record(
  p_downtime_id uuid,
  p_cause text,
  p_notes text,
  p_has_notes boolean,
  p_resolve boolean
)
returns table (downtime_id uuid)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select * from public.update_downtime_record(
    p_downtime_id,
    p_cause,
    p_notes,
    p_has_notes,
    p_resolve,
    null::uuid
  );
$$;

revoke execute on function public.update_downtime_record(uuid, text, text, boolean, boolean, uuid)
from public, anon, authenticated;
grant execute on function public.update_downtime_record(uuid, text, text, boolean, boolean, uuid)
to service_role;

revoke execute on function public.update_downtime_record(uuid, text, text, boolean, boolean)
from public, anon, authenticated;
grant execute on function public.update_downtime_record(uuid, text, text, boolean, boolean)
to service_role;

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
    or to_regprocedure('public.update_downtime_record(uuid,text,text,boolean,boolean,uuid)') is null
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
  return 43;
end;
$$;

revoke all on function public.get_backend_readiness() from public, anon, authenticated;
grant execute on function public.get_backend_readiness() to service_role;

commit;
