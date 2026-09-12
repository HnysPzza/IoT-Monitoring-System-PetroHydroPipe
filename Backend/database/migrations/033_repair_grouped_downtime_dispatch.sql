begin;

create or replace function public.ingest_iot_sensor_event(
  p_device_event_id uuid,
  p_sensor_id uuid,
  p_machine_id uuid,
  p_event_type text,
  p_event_value jsonb,
  p_recorded_at timestamptz
)
returns table (
  sensor_event_id uuid, device_event_id uuid, event_type text, event_value jsonb,
  recorded_at timestamptz, duplicate boolean, stale boolean, state_applied boolean,
  previous_machine_status text, new_machine_status text, downtime_action text,
  downtime_id uuid, downtime_started_at timestamptz, downtime_ended_at timestamptz,
  downtime_duration_seconds integer, downtime_cause text, alert_action text,
  alert_record jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sensor_code text;
  v_fault_source text;
  v_detection_state text;
begin
  select sensor.sensor_code, sensor.fault_source, watchdog.detection_state
  into v_sensor_code, v_fault_source, v_detection_state
  from public.sensors sensor
  left join public.sensor_watchdog_state watchdog on watchdog.sensor_id = sensor.id
  where sensor.id = p_sensor_id and sensor.machine_id = p_machine_id;

  if v_sensor_code in ('S-01', 'S-02', 'S-03', 'S-04')
    and p_event_type in ('pulse', 'idle', 'fault', 'recovered')
    and not (p_event_type in ('pulse', 'recovered') and v_fault_source = 'absence_watchdog') then
    return query select grouped.sensor_event_id, grouped.device_event_id, grouped.event_type,
      grouped.event_value, grouped.recorded_at, grouped.duplicate, grouped.stale,
      grouped.state_applied, grouped.previous_machine_status, grouped.new_machine_status,
      grouped.downtime_action, grouped.downtime_id, grouped.downtime_started_at,
      grouped.downtime_ended_at, grouped.downtime_duration_seconds, grouped.downtime_cause,
      grouped.alert_action, grouped.alert_record
    from public.ingest_iot_grouped_sensor_event(
      p_device_event_id, p_sensor_id, p_machine_id, p_event_type, p_event_value, p_recorded_at
    ) grouped;
    return;
  end if;

  if (v_sensor_code = 'S-05' and p_event_type in ('downtime', 'fault'))
    or (p_event_type = 'downtime' and p_event_value->>'signal' = 'no_pulse')
    or (v_fault_source = 'absence_watchdog' and p_event_type in ('pulse', 'recovered')
      and p_event_value->>'signal' = 'active')
    or (v_detection_state in ('downtime', 'recovering')
      and p_event_type in ('pulse', 'recovered') and p_event_value->>'signal' = 'active') then
    return query select observed.sensor_event_id, observed.device_event_id,
      observed.event_type, observed.event_value, observed.recorded_at,
      observed.duplicate, observed.stale, observed.state_applied,
      observed.previous_machine_status, observed.new_machine_status,
      observed.downtime_action, observed.downtime_id, observed.downtime_started_at,
      observed.downtime_ended_at, observed.downtime_duration_seconds,
      observed.downtime_cause, observed.alert_action, observed.alert_record
    from public.ingest_iot_watchdog_observation(
      p_device_event_id, p_sensor_id, p_machine_id, p_event_type, p_event_value, p_recorded_at
    ) observed;
    return;
  end if;

  return query select legacy.sensor_event_id, legacy.device_event_id, legacy.event_type,
    legacy.event_value, legacy.recorded_at, legacy.duplicate, legacy.stale,
    legacy.state_applied, legacy.previous_machine_status, legacy.new_machine_status,
    legacy.downtime_action, legacy.downtime_id, legacy.downtime_started_at,
    legacy.downtime_ended_at, legacy.downtime_duration_seconds, legacy.downtime_cause,
    legacy.alert_action, legacy.alert_record
  from public.ingest_iot_sensor_event_legacy_031(
    p_device_event_id, p_sensor_id, p_machine_id, p_event_type, p_event_value, p_recorded_at
  ) legacy;
end;
$$;

with desired as (
  select machine.id, machine.machine_code, machine.status as previous_status,
    case
      when exists (
        select 1 from public.sensors sensor
        where sensor.machine_id = machine.id and sensor.sensor_code = 'S-03' and sensor.status = 'Fault'
      ) or (
        select count(*) = 3 and bool_and(sensor.status = 'Fault')
        from public.sensors sensor
        where sensor.machine_id = machine.id and sensor.sensor_code in ('S-01', 'S-02', 'S-04')
      ) then 'Downtime'
      when exists (
        select 1 from public.sensors sensor
        where sensor.machine_id = machine.id and sensor.status = 'Active'
      ) then 'Running'
      else 'Idle'
    end as new_status
  from public.machines machine
), changed as (
  update public.machines machine
  set status = desired.new_status, updated_at = clock_timestamp()
  from desired
  where machine.id = desired.id and machine.status is distinct from desired.new_status
  returning machine.id, desired.machine_code, desired.previous_status, desired.new_status
)
insert into public.audit_logs (action, entity_type, entity_id, metadata)
select 'MACHINE_STATUS_RECONCILED', 'machine', changed.id,
  jsonb_build_object('machineCode', changed.machine_code, 'previousStatus', changed.previous_status,
    'newStatus', changed.new_status, 'source', 'migration_033_grouped_dispatch_repair')
from changed;

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
  return 33;
end;
$$;

revoke all on function public.ingest_iot_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)
  from public, anon, authenticated;
grant execute on function public.ingest_iot_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)
  to service_role;
revoke all on function public.get_backend_readiness() from public, anon, authenticated;
grant execute on function public.get_backend_readiness() to service_role;

commit;
