begin;

set local lock_timeout = '2s';

alter table public.sensor_events add column if not exists stale boolean;

create or replace function public.classify_sensor_event_staleness()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_watermark timestamptz;
begin
  select sensor.last_applied_recorded_at into v_watermark
  from public.sensors sensor
  where sensor.id = new.sensor_id and sensor.machine_id = new.machine_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'Sensor is not assigned to the supplied machine.';
  end if;

  new.stale := v_watermark is not null and new.recorded_at <= v_watermark;
  return new;
end;
$$;

revoke all on function public.classify_sensor_event_staleness() from public, anon, authenticated, service_role;

drop trigger if exists classify_sensor_event_staleness on public.sensor_events;
create trigger classify_sensor_event_staleness
before insert on public.sensor_events
for each row execute function public.classify_sensor_event_staleness();

create or replace function public.aggregate_analytics_sensor_events(
  p_machine_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_bucket_seconds integer
)
returns table (
  bucket_start timestamptz,
  sensor_code text,
  sensor_label text,
  event_count bigint
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if p_machine_id is null
    or p_started_at is null
    or p_ended_at is null
    or p_ended_at <= p_started_at
    or p_ended_at - p_started_at > interval '100 years'
    or p_bucket_seconds is null
    or (p_bucket_seconds <> 0 and (p_bucket_seconds < 3600 or p_bucket_seconds > 2678400)) then
    raise exception using errcode = '22023', message = 'Analytics aggregation inputs are invalid.';
  end if;

  return query
  select
    case
      when p_bucket_seconds = 0 then
        date_trunc('month', event.recorded_at at time zone 'Asia/Manila') at time zone 'Asia/Manila'
      else p_started_at
        + (
          floor(
            extract(epoch from (event.recorded_at - p_started_at))
            / p_bucket_seconds
          ) * p_bucket_seconds
        ) * interval '1 second'
    end as bucket_start,
    sensor.sensor_code,
    sensor.label as sensor_label,
    count(*)::bigint as event_count
  from public.sensor_events event
  join public.sensors sensor on sensor.id = event.sensor_id
  where event.machine_id = p_machine_id
    and event.event_type = 'pulse'
    and event.stale is not true
    and event.recorded_at >= p_started_at
    and event.recorded_at < p_ended_at
    and sensor.sensor_code in ('S-01', 'S-02', 'S-04', 'S-05')
  group by 1, sensor.sensor_code, sensor.label
  order by 1, sensor.sensor_code;
end;
$$;

create or replace function public.get_analytics_first_recorded_at(p_machine_id uuid)
returns timestamptz
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select min(recorded_at)
  from (
    select event.recorded_at
    from public.sensor_events event
    join public.sensors sensor on sensor.id = event.sensor_id
    where event.machine_id = p_machine_id
      and event.event_type = 'pulse'
      and event.stale is not true
      and sensor.sensor_code in ('S-01', 'S-02', 'S-04', 'S-05')

    union all

    select downtime.started_at
    from public.downtime_events downtime
    where downtime.machine_id = p_machine_id
  ) analytics_records;
$$;

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

  return 28;
end;
$$;

create or replace function public.get_machine_live_snapshot(p_machine_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_snapshot jsonb;
begin
  if p_machine_code is null or p_machine_code !~ '^M-[0-9]{2}$' then
    raise exception using errcode = '22023', message = 'Machine code is invalid.';
  end if;

  select jsonb_build_object(
    'snapshot_at', clock_timestamp(),
    'machine', jsonb_build_object(
      'id', machine.id,
      'machine_code', machine.machine_code,
      'name', machine.name,
      'status', machine.status,
      'location', machine.location,
      'updated_at', machine.updated_at
    ),
    'sensors', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', sensor.id,
          'sensor_code', sensor.sensor_code,
          'esp32_device_id', sensor.esp32_device_id,
          'label', sensor.label,
          'status', sensor.status,
          'updated_at', sensor.updated_at,
          'latest_event', case when latest_event.id is null then null else jsonb_build_object(
            'id', latest_event.id,
            'event_type', latest_event.event_type,
            'signal', latest_event.event_value ->> 'signal',
            'recorded_at', latest_event.recorded_at
          ) end,
          'watchdog', case when watchdog.sensor_id is null then null else jsonb_build_object(
            'connectivity_state', watchdog.connectivity_state,
            'detection_state', watchdog.detection_state,
            'last_heartbeat_received_at', watchdog.last_heartbeat_received_at,
            'last_activity_received_at', watchdog.last_activity_received_at,
            'last_evaluated_at', watchdog.last_evaluated_at
          ) end
        ) order by sensor.sensor_code, sensor.id
      )
      from public.sensors sensor
      left join lateral (
        select event.id, event.event_type, event.event_value, event.recorded_at
        from public.sensor_events event
        where event.sensor_id = sensor.id
          and event.stale is not true
        order by event.recorded_at desc, event.id desc
        limit 1
      ) latest_event on true
      left join public.sensor_watchdog_state watchdog on watchdog.sensor_id = sensor.id
      where sensor.machine_id = machine.id
    ), '[]'::jsonb)
  ) into v_snapshot
  from public.machines machine
  where machine.machine_code = p_machine_code;

  if v_snapshot is null then
    raise exception using errcode = 'P0002', message = 'Machine was not found.';
  end if;

  return v_snapshot;
end;
$$;

commit;
