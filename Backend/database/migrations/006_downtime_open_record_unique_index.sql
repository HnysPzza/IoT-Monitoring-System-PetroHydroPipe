-- Phase 33: make IoT event ingestion and downtime transitions atomic and idempotent.
-- Run in staging first. The preflight blocks deployment when duplicate open rows exist.

begin;

do $$
begin
  if exists (
    select 1
    from public.downtime_events
    where status = 'Open'
    group by machine_id, sensor_id
    having count(*) > 1
  ) then
    raise exception 'Migration 006 blocked: resolve duplicate open downtime records before retrying.';
  end if;
end $$;

alter table public.sensor_events
add column if not exists device_event_id uuid;

update public.sensor_events
set device_event_id = id
where device_event_id is null;

alter table public.sensor_events
alter column device_event_id set not null,
alter column device_event_id set default gen_random_uuid();

create unique index if not exists idx_sensor_events_device_event_id
on public.sensor_events(sensor_id, device_event_id);

create unique index if not exists idx_downtime_events_one_open_per_sensor
on public.downtime_events(machine_id, sensor_id)
where status = 'Open';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'downtime_state_fields_consistent'
      and conrelid = 'public.downtime_events'::regclass
  ) then
    alter table public.downtime_events
    add constraint downtime_state_fields_consistent check (
      (status = 'Open' and ended_at is null and duration_seconds is null)
      or
      (status = 'Resolved' and ended_at is not null and duration_seconds is not null)
    );
  end if;
end $$;

create or replace function public.ingest_iot_sensor_event(
  p_device_event_id uuid,
  p_sensor_id uuid,
  p_machine_id uuid,
  p_event_type text,
  p_event_value jsonb,
  p_recorded_at timestamptz
)
returns table (
  sensor_event_id uuid,
  device_event_id uuid,
  event_type text,
  event_value jsonb,
  recorded_at timestamptz,
  duplicate boolean,
  stale boolean,
  state_applied boolean,
  previous_machine_status text,
  new_machine_status text,
  downtime_action text,
  downtime_id uuid,
  downtime_started_at timestamptz,
  downtime_ended_at timestamptz,
  downtime_duration_seconds integer,
  downtime_cause text
)
language plpgsql
set search_path = public
as $$
declare
  v_sensor public.sensors%rowtype;
  v_existing_event public.sensor_events%rowtype;
  v_event public.sensor_events%rowtype;
  v_latest_recorded_at timestamptz;
  v_previous_machine_status text;
  v_new_machine_status text;
  v_downtime public.downtime_events%rowtype;
  v_downtime_action text;
begin
  if p_event_type not in ('pulse', 'idle', 'downtime', 'fault', 'recovered') then
    raise exception using errcode = '22023', message = 'Unsupported sensor event type.';
  end if;

  if not (
    (p_event_type in ('pulse', 'recovered') and p_event_value->>'signal' = 'active')
    or (p_event_type = 'idle' and p_event_value->>'signal' = 'idle')
    or (p_event_type = 'downtime' and p_event_value->>'signal' = 'no_pulse')
    or (p_event_type = 'fault' and p_event_value->>'signal' = 'fault')
  ) then
    raise exception using errcode = '22023', message = 'Signal does not match sensor event type.';
  end if;

  if p_recorded_at > now() + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'Sensor event timestamp is too far in the future.';
  end if;

  select sensor.*
  into v_sensor
  from public.sensors sensor
  where sensor.id = p_sensor_id
    and sensor.machine_id = p_machine_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'Sensor is not assigned to the supplied machine.';
  end if;

  select sensor_event.*
  into v_existing_event
  from public.sensor_events sensor_event
  where sensor_event.sensor_id = p_sensor_id
    and sensor_event.device_event_id = p_device_event_id;

  if found then
    if v_existing_event.event_type is distinct from p_event_type
      or v_existing_event.event_value is distinct from p_event_value
      or v_existing_event.recorded_at is distinct from p_recorded_at then
      raise exception using errcode = '22023', message = 'Device event ID was reused with different event data.';
    end if;

    select machine.status
    into v_new_machine_status
    from public.machines machine
    where machine.id = p_machine_id;

    return query select
      v_existing_event.id,
      v_existing_event.device_event_id,
      v_existing_event.event_type,
      v_existing_event.event_value,
      v_existing_event.recorded_at,
      true,
      false,
      false,
      v_new_machine_status,
      v_new_machine_status,
      null::text,
      null::uuid,
      null::timestamptz,
      null::timestamptz,
      null::integer,
      null::text;
    return;
  end if;

  select max(sensor_event.recorded_at)
  into v_latest_recorded_at
  from public.sensor_events sensor_event
  where sensor_event.sensor_id = p_sensor_id;

  insert into public.sensor_events (
    sensor_id,
    machine_id,
    device_event_id,
    event_type,
    event_value,
    recorded_at
  ) values (
    p_sensor_id,
    p_machine_id,
    p_device_event_id,
    p_event_type,
    p_event_value,
    p_recorded_at
  )
  returning * into v_event;

  if v_latest_recorded_at is not null and p_recorded_at <= v_latest_recorded_at then
    select machine.status
    into v_new_machine_status
    from public.machines machine
    where machine.id = p_machine_id;

    return query select
      v_event.id,
      v_event.device_event_id,
      v_event.event_type,
      v_event.event_value,
      v_event.recorded_at,
      false,
      true,
      false,
      v_new_machine_status,
      v_new_machine_status,
      null::text,
      null::uuid,
      null::timestamptz,
      null::timestamptz,
      null::integer,
      null::text;
    return;
  end if;

  update public.sensors
  set status = case
    when p_event_type in ('pulse', 'recovered') then 'Active'
    when p_event_type = 'idle' then 'Inactive'
    else 'Fault'
  end
  where id = p_sensor_id;

  select machine.status
  into v_previous_machine_status
  from public.machines machine
  where machine.id = p_machine_id
  for update;

  select case
    when bool_or(sensor.status = 'Fault') then 'Downtime'
    when bool_or(sensor.status = 'Active') then 'Running'
    else 'Idle'
  end
  into v_new_machine_status
  from public.sensors sensor
  where sensor.machine_id = p_machine_id;

  if v_previous_machine_status is distinct from v_new_machine_status then
    update public.machines
    set status = v_new_machine_status
    where id = p_machine_id;
  end if;

  if p_event_type in ('downtime', 'fault') then
    select downtime.*
    into v_downtime
    from public.downtime_events downtime
    where downtime.machine_id = p_machine_id
      and downtime.sensor_id = p_sensor_id
      and downtime.status = 'Open'
    for update;

    if not found then
      insert into public.downtime_events (
        machine_id,
        sensor_id,
        started_at,
        cause,
        status,
        notes
      ) values (
        p_machine_id,
        p_sensor_id,
        p_recorded_at,
        case v_sensor.sensor_code
          when 'S-01' then 'Corrective Maintenance'
          when 'S-02' then 'Weld Wire Refill'
          when 'S-04' then 'Flux Refill'
          when 'S-05' then 'Manual Cutting'
          else 'Pending Cause Review'
        end,
        'Open',
        ''
      )
      returning * into v_downtime;
      v_downtime_action := 'created';
    end if;
  elsif p_event_type in ('pulse', 'recovered') then
    update public.downtime_events
    set
      status = 'Resolved',
      ended_at = p_recorded_at,
      duration_seconds = greatest(0, round(extract(epoch from (p_recorded_at - started_at)))::integer)
    where machine_id = p_machine_id
      and sensor_id = p_sensor_id
      and status = 'Open'
      and started_at <= p_recorded_at
    returning * into v_downtime;

    if found then
      v_downtime_action := 'resolved';
    end if;
  end if;

  return query select
    v_event.id,
    v_event.device_event_id,
    v_event.event_type,
    v_event.event_value,
    v_event.recorded_at,
    false,
    false,
    true,
    v_previous_machine_status,
    v_new_machine_status,
    v_downtime_action,
    v_downtime.id,
    v_downtime.started_at,
    v_downtime.ended_at,
    v_downtime.duration_seconds,
    v_downtime.cause;
end;
$$;

create or replace function public.get_downtime_summary(
  p_status text,
  p_cause text,
  p_started_from timestamptz,
  p_started_to timestamptz
)
returns table (
  open_count bigint,
  resolved_count bigint,
  total_minutes bigint,
  estimated_loss bigint
)
language sql
stable
set search_path = public
as $$
  with matching as (
    select
      downtime.status,
      round(
        coalesce(
          downtime.duration_seconds,
          greatest(0, extract(epoch from (now() - downtime.started_at)))
        ) / 60.0
      )::bigint as minutes
    from public.downtime_events downtime
    where (p_status is null or p_status = 'All' or downtime.status = p_status)
      and (p_cause is null or p_cause = 'All' or downtime.cause = p_cause)
      and (p_started_from is null or downtime.started_at >= p_started_from)
      and (p_started_to is null or downtime.started_at < p_started_to)
  )
  select
    count(*) filter (where status = 'Open'),
    count(*) filter (where status = 'Resolved'),
    coalesce(sum(minutes), 0)::bigint,
    coalesce(sum(round(minutes * 2.3)), 0)::bigint
  from matching;
$$;

create or replace function public.update_downtime_record(
  p_downtime_id uuid,
  p_cause text,
  p_notes text,
  p_has_notes boolean,
  p_resolve boolean
)
returns table (downtime_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_downtime public.downtime_events%rowtype;
  v_sensor_code text;
  v_ended_at timestamptz;
begin
  select downtime.*
  into v_downtime
  from public.downtime_events downtime
  where downtime.id = p_downtime_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Downtime record not found.';
  end if;

  select sensor.sensor_code
  into v_sensor_code
  from public.sensors sensor
  where sensor.id = v_downtime.sensor_id;

  if p_cause is not null and v_sensor_code is distinct from 'S-03' then
    raise exception using errcode = '22023', message = 'Downtime cause is locked for this sensor.';
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
  where id = p_downtime_id;

  return query select p_downtime_id;
end;
$$;

revoke execute on function public.ingest_iot_sensor_event(uuid, uuid, uuid, text, jsonb, timestamptz)
from public, anon, authenticated;
grant execute on function public.ingest_iot_sensor_event(uuid, uuid, uuid, text, jsonb, timestamptz)
to service_role;

revoke execute on function public.get_downtime_summary(text, text, timestamptz, timestamptz)
from public, anon, authenticated;
grant execute on function public.get_downtime_summary(text, text, timestamptz, timestamptz)
to service_role;

revoke execute on function public.update_downtime_record(uuid, text, text, boolean, boolean)
from public, anon, authenticated;
grant execute on function public.update_downtime_record(uuid, text, text, boolean, boolean)
to service_role;

commit;
