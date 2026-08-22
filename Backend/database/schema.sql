-- PetroHydroPipe IoT Monitoring System
-- Phase 2 simple Supabase/PostgreSQL database foundation.

create extension if not exists "pgcrypto";

-- Access roles used by backend authorization and frontend navigation.
create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

-- Application users managed by admins; password_hash is used only by the backend.
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references roles(id),
  name text not null,
  username text not null unique,
  email text unique,
  password_hash text not null,
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  must_change_password boolean not null default true,
  last_login_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Production machines being monitored by ESP32 sensor groups.
create table if not exists machines (
  id uuid primary key default gen_random_uuid(),
  machine_code text not null unique,
  name text not null,
  status text not null default 'Idle' check (status in ('Running', 'Idle', 'Downtime')),
  location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The 5 ESP32-backed sensor records connected to a machine.
create table if not exists sensors (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references machines(id) on delete cascade,
  sensor_code text not null unique,
  esp32_device_id text not null unique,
  device_key_hash text,
  label text not null,
  status text not null default 'Active' check (status in ('Active', 'Inactive', 'Fault')),
  last_applied_recorded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Raw sensor readings/events; future IoT ingestion writes here.
create table if not exists sensor_events (
  id uuid primary key default gen_random_uuid(),
  sensor_id uuid not null references sensors(id) on delete cascade,
  machine_id uuid not null references machines(id) on delete cascade,
  device_event_id uuid not null default gen_random_uuid(),
  event_type text not null,
  event_value jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Downtime records derived from sensor events or manual review.
create table if not exists downtime_events (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references machines(id) on delete cascade,
  sensor_id uuid references sensors(id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds integer,
  cause text,
  status text not null default 'Open' check (status in ('Open', 'Resolved')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint downtime_duration_non_negative check (duration_seconds is null or duration_seconds >= 0),
  constraint downtime_end_after_start check (ended_at is null or ended_at >= started_at),
  constraint downtime_state_fields_consistent check (
    (status = 'Open' and ended_at is null and duration_seconds is null)
    or
    (status = 'Resolved' and ended_at is not null and duration_seconds is not null)
  )
);

-- Production output windows for day/week/month analytics.
create table if not exists production_counts (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references machines(id) on delete cascade,
  count_value integer not null default 0 check (count_value >= 0),
  window_start timestamptz not null,
  window_end timestamptz not null,
  created_at timestamptz not null default now(),
  constraint production_window_valid check (window_end > window_start)
);

-- Tracks important user and system actions for accountability.
create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Persistent machine/sensor alerts that users can acknowledge.
create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id uuid not null,
  machine_id uuid references machines(id) on delete cascade,
  sensor_id uuid references sensors(id) on delete set null,
  severity text not null check (severity in ('Info', 'Warning', 'Critical')),
  status text not null default 'Active' check (status in ('Active', 'Acknowledged', 'Resolved')),
  title text not null,
  message text not null,
  acknowledged_at timestamptz,
  acknowledged_by uuid references users(id) on delete set null,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  revision bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Transactional singleton serializes alert revisions in commit order.
create table if not exists alert_revision_state (
  singleton boolean primary key default true check (singleton),
  current_revision bigint not null check (current_revision >= 0)
);

insert into alert_revision_state (singleton, current_revision)
values (true, 0)
on conflict (singleton) do nothing;

alter table alert_revision_state enable row level security;

create policy alert_revision_service_role
on alert_revision_state
for all
to service_role
using (true)
with check (true);

-- Indexes keep dashboard and history lookups fast as event data grows.
create index if not exists idx_users_role_id on users(role_id);
create index if not exists idx_machines_status on machines(status);
create index if not exists idx_sensors_machine_id on sensors(machine_id);
create index if not exists idx_sensor_events_sensor_recorded_at on sensor_events(sensor_id, recorded_at desc);
create index if not exists idx_sensor_events_machine_recorded_at on sensor_events(machine_id, recorded_at desc);
create unique index if not exists idx_sensor_events_device_event_id on sensor_events(sensor_id, device_event_id);
create index if not exists idx_downtime_events_machine_started_at on downtime_events(machine_id, started_at desc);
create index if not exists idx_downtime_events_sensor_id on downtime_events(sensor_id);
create unique index if not exists idx_downtime_events_one_open_per_sensor on downtime_events(machine_id, sensor_id) where status = 'Open';
create index if not exists idx_production_counts_machine_window on production_counts(machine_id, window_start desc);
create index if not exists idx_audit_logs_user_created_at on audit_logs(user_id, created_at desc);
create unique index if not exists idx_alerts_unresolved_source on alerts(source_type, source_id) where status in ('Active', 'Acknowledged');
create index if not exists idx_alerts_status_created_at on alerts(status, created_at desc);
create index if not exists idx_alerts_machine_id on alerts(machine_id);
create index if not exists idx_alerts_sensor_id on alerts(sensor_id);
create index if not exists idx_alerts_acknowledged_by on alerts(acknowledged_by);
create unique index if not exists idx_alerts_revision on alerts(revision);

-- Shared trigger helper keeps updated_at current after edits.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql
set search_path = public;

drop trigger if exists set_users_updated_at on users;
create trigger set_users_updated_at
before update on users
for each row
execute function set_updated_at();
-- Atomic alert-sync integrity keeps state, alerts, revisions, and audits consistent.
create or replace function public.assign_alert_revision()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_current_revision bigint;
begin
  if tg_op = 'UPDATE'
    and (to_jsonb(new) - array['revision', 'updated_at'])
      is not distinct from (to_jsonb(old) - array['revision', 'updated_at']) then
    new.revision := old.revision;
    return new;
  end if;

  -- ON CONFLICT runs BEFORE INSERT before BEFORE UPDATE. Reuse the revision
  -- already allocated to EXCLUDED instead of consuming a second revision.
  if tg_op = 'UPDATE' and new.revision is distinct from old.revision then
    select current_revision
    into v_current_revision
    from public.alert_revision_state
    where singleton = true;

    if new.revision = v_current_revision and new.revision > old.revision then
      return new;
    end if;
  end if;

  update public.alert_revision_state
  set current_revision = current_revision + 1
  where singleton = true
  returning current_revision into new.revision;

  if new.revision is null then
    raise exception using errcode = '55000', message = 'Alert revision state is unavailable.';
  end if;

  return new;
end;
$$;

drop trigger if exists assign_alert_revision on public.alerts;
create trigger assign_alert_revision
before insert or update on public.alerts
for each row
execute function public.assign_alert_revision();

create or replace function public.alert_to_api_json(p_alert public.alerts)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', p_alert.id,
    'severity', p_alert.severity,
    'status', p_alert.status,
    'title', p_alert.title,
    'message', p_alert.message,
    'sourceType', p_alert.source_type,
    'machine', case when machine.id is null then null else jsonb_build_object(
      'id', machine.id,
      'name', machine.name
    ) end,
    'sensor', case when sensor.id is null then null else jsonb_build_object(
      'id', sensor.id,
      'sensorCode', sensor.sensor_code,
      'label', sensor.label
    ) end,
    'metadata', p_alert.metadata,
    'createdAt', p_alert.created_at,
    'acknowledgedAt', p_alert.acknowledged_at,
    'acknowledgedBy', case when acknowledged_user.id is null then null else jsonb_build_object(
      'id', acknowledged_user.id,
      'name', acknowledged_user.name,
      'username', acknowledged_user.username,
      'role', acknowledged_role.name
    ) end,
    'resolvedAt', p_alert.resolved_at,
    'revision', p_alert.revision::text
  )
  from (select 1) seed
  left join public.machines machine on machine.id = p_alert.machine_id
  left join public.sensors sensor on sensor.id = p_alert.sensor_id
  left join public.users acknowledged_user on acknowledged_user.id = p_alert.acknowledged_by
  left join public.roles acknowledged_role on acknowledged_role.id = acknowledged_user.role_id;
$$;

drop function if exists public.ingest_iot_sensor_event(uuid, uuid, uuid, text, jsonb, timestamptz);
create function public.ingest_iot_sensor_event(
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
  downtime_cause text,
  alert_action text,
  alert_record jsonb
)
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_sensor public.sensors%rowtype;
  v_machine public.machines%rowtype;
  v_existing_event public.sensor_events%rowtype;
  v_event public.sensor_events%rowtype;
  v_previous_machine_status text;
  v_new_machine_status text;
  v_downtime public.downtime_events%rowtype;
  v_downtime_action text;
  v_alert public.alerts%rowtype;
  v_existing_alert public.alerts%rowtype;
  v_alert_action text;
  v_alert_metadata jsonb;
  v_alert_title text;
  v_alert_message text;
  v_new_alert_id uuid;
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

  select machine.*
  into v_machine
  from public.machines machine
  where machine.id = p_machine_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'Machine was not found.';
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

    return query select
      v_existing_event.id,
      v_existing_event.device_event_id,
      v_existing_event.event_type,
      v_existing_event.event_value,
      v_existing_event.recorded_at,
      true,
      false,
      false,
      v_machine.status,
      v_machine.status,
      null::text,
      null::uuid,
      null::timestamptz,
      null::timestamptz,
      null::integer,
      null::text,
      null::text,
      null::jsonb;
    return;
  end if;

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

  if v_sensor.last_applied_recorded_at is not null
    and p_recorded_at <= v_sensor.last_applied_recorded_at then
    return query select
      v_event.id,
      v_event.device_event_id,
      v_event.event_type,
      v_event.event_value,
      v_event.recorded_at,
      false,
      true,
      false,
      v_machine.status,
      v_machine.status,
      null::text,
      null::uuid,
      null::timestamptz,
      null::timestamptz,
      null::integer,
      null::text,
      null::text,
      null::jsonb;
    return;
  end if;

  update public.sensors
  set
    status = case
      when p_event_type in ('pulse', 'recovered') then 'Active'
      when p_event_type = 'idle' then 'Inactive'
      else 'Fault'
    end,
    last_applied_recorded_at = p_recorded_at
  where id = p_sensor_id;

  v_previous_machine_status := v_machine.status;

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

    insert into public.audit_logs (action, entity_type, entity_id, metadata)
    values (
      'IOT_MACHINE_STATUS_UPDATED',
      'machine',
      p_machine_id,
      jsonb_build_object(
        'machineCode', v_machine.machine_code,
        'machineName', v_machine.name,
        'previousStatus', v_previous_machine_status,
        'newStatus', v_new_machine_status,
        'source', 'esp32_event'
      )
    );
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
          when 'S-02' then 'Consumable Shortage'
          when 'S-04' then 'Consumable Shortage'
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

  if v_downtime_action is not null then
    insert into public.audit_logs (action, entity_type, entity_id, metadata)
    values (
      case when v_downtime_action = 'created' then 'DOWNTIME_CREATED' else 'DOWNTIME_AUTO_RESOLVED' end,
      'downtime',
      v_downtime.id,
      jsonb_build_object(
        'sensorCode', v_sensor.sensor_code,
        'machineName', v_machine.name,
        'eventId', v_event.id,
        'deviceEventId', p_device_event_id,
        'eventType', p_event_type,
        'startedAt', v_downtime.started_at,
        'endedAt', v_downtime.ended_at,
        'durationMinutes', case when v_downtime.duration_seconds is null then null
          else round(v_downtime.duration_seconds / 60.0) end,
        'cause', v_downtime.cause,
        'status', case when v_downtime_action = 'created' then 'Open' else 'Resolved' end
      )
    );
  end if;

  if p_event_type in ('downtime', 'fault') then
    v_alert_title := v_sensor.label || ' downtime detected';
    v_alert_message := v_sensor.sensor_code || ' ' || v_sensor.label || ' has no pulse.';
    v_alert_metadata := jsonb_build_object(
      'deviceId', v_sensor.esp32_device_id,
      'sensorCode', v_sensor.sensor_code,
      'sensorLabel', v_sensor.label,
      'machineCode', v_machine.machine_code,
      'machineName', v_machine.name,
      'eventId', v_event.id,
      'eventType', p_event_type,
      'signal', p_event_value->>'signal',
      'recordedAt', p_recorded_at
    );

    select alert.*
    into v_existing_alert
    from public.alerts alert
    where alert.source_type = 'sensor'
      and alert.source_id = p_sensor_id
      and alert.status in ('Active', 'Acknowledged')
    for update;

    if v_existing_alert.id is not null then
      update public.alerts
      set
        severity = 'Critical',
        title = v_alert_title,
        message = v_alert_message,
        metadata = (
          v_existing_alert.metadata
            - array[
              'recoveryPending',
              'recoveredAt',
              'recoveryEventId',
              'recoveryEventType',
              'recoverySignal',
              'acknowledgedAfterRecovery'
            ]
        ) || v_alert_metadata
      where id = v_existing_alert.id
      returning * into v_alert;
      v_alert_action := 'updated';
    else
      v_new_alert_id := gen_random_uuid();
      insert into public.alerts (
        id,
        source_type,
        source_id,
        machine_id,
        sensor_id,
        severity,
        status,
        title,
        message,
        metadata
      ) values (
        v_new_alert_id,
        'sensor',
        p_sensor_id,
        p_machine_id,
        p_sensor_id,
        'Critical',
        'Active',
        v_alert_title,
        v_alert_message,
        v_alert_metadata
      )
      on conflict (source_type, source_id)
        where status in ('Active', 'Acknowledged')
      do update set
        revision = excluded.revision,
        severity = excluded.severity,
        title = excluded.title,
        message = excluded.message,
        metadata = (
          public.alerts.metadata
            - array[
              'recoveryPending',
              'recoveredAt',
              'recoveryEventId',
              'recoveryEventType',
              'recoverySignal',
              'acknowledgedAfterRecovery'
            ]
        ) || excluded.metadata
      returning * into v_alert;

      v_alert_action := case when v_alert.id = v_new_alert_id then 'created' else 'updated' end;
    end if;

    if v_alert_action = 'created' then
      insert into public.audit_logs (action, entity_type, entity_id, metadata)
      values (
        'ALERT_CREATED',
        'sensor',
        p_sensor_id,
        jsonb_build_object(
          'alertId', v_alert.id,
          'title', v_alert.title,
          'sensorCode', v_sensor.sensor_code,
          'machineCode', v_machine.machine_code,
          'eventType', p_event_type,
          'signal', p_event_value->>'signal'
        )
      );
    end if;
  elsif p_event_type in ('pulse', 'recovered') then
    select alert.*
    into v_existing_alert
    from public.alerts alert
    where alert.source_type = 'sensor'
      and alert.source_id = p_sensor_id
      and alert.status in ('Active', 'Acknowledged')
    for update;

    if found then
      v_alert_metadata := v_existing_alert.metadata || jsonb_build_object(
        'recoveryPending', true,
        'recoveredAt', p_recorded_at,
        'recoveryEventId', v_event.id,
        'recoveryEventType', p_event_type,
        'recoverySignal', p_event_value->>'signal'
      );

      if v_existing_alert.status = 'Active' then
        update public.alerts
        set metadata = v_alert_metadata
        where id = v_existing_alert.id
        returning * into v_alert;
        v_alert_action := 'updated';
      else
        update public.alerts
        set
          status = 'Resolved',
          resolved_at = now(),
          metadata = v_alert_metadata
        where id = v_existing_alert.id
        returning * into v_alert;
        v_alert_action := 'resolved';

        insert into public.audit_logs (action, entity_type, entity_id, metadata)
        values (
          'ALERT_RESOLVED',
          'sensor',
          p_sensor_id,
          jsonb_build_object(
            'alertId', v_alert.id,
            'title', v_alert.title,
            'sensorCode', v_sensor.sensor_code,
            'machineCode', v_machine.machine_code,
            'eventId', v_event.id,
            'eventType', p_event_type,
            'signal', p_event_value->>'signal',
            'recordedAt', p_recorded_at
          )
        );
      end if;
    end if;
  end if;

  if p_event_type in ('downtime', 'fault', 'recovered') then
    insert into public.audit_logs (action, entity_type, entity_id, metadata)
    values (
      'IOT_EVENT_RECEIVED',
      'sensor_event',
      v_event.id,
      jsonb_build_object(
        'deviceId', v_sensor.esp32_device_id,
        'sensorCode', v_sensor.sensor_code,
        'machineCode', v_machine.machine_code,
        'deviceEventId', p_device_event_id,
        'eventType', p_event_type,
        'signal', p_event_value->>'signal',
        'recordedAt', p_recorded_at,
        'stale', false,
        'stateApplied', true
      )
    );
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
    v_downtime.cause,
    v_alert_action,
    case when v_alert.id is null then null else public.alert_to_api_json(v_alert) end;
end;
$$;

create or replace function public.acknowledge_alert(
  p_alert_id uuid,
  p_actor_user_id uuid
)
returns table (
  outcome text,
  alert_action text,
  alert_record jsonb
)
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_alert public.alerts%rowtype;
  v_acknowledged_at timestamptz;
  v_has_pending_recovery boolean;
begin
  select alert.*
  into v_alert
  from public.alerts alert
  where alert.id = p_alert_id
  for update;

  if not found then
    return query select 'not_found'::text, null::text, null::jsonb;
    return;
  end if;

  if v_alert.status = 'Resolved' then
    return query select 'already_resolved'::text, null::text, public.alert_to_api_json(v_alert);
    return;
  end if;

  v_has_pending_recovery := coalesce(v_alert.metadata->>'recoveryPending', 'false') = 'true';

  if v_alert.status = 'Acknowledged' and not v_has_pending_recovery then
    return query select 'already_acknowledged'::text, null::text, public.alert_to_api_json(v_alert);
    return;
  end if;

  v_acknowledged_at := now();

  update public.alerts
  set
    status = case when v_has_pending_recovery then 'Resolved' else 'Acknowledged' end,
    acknowledged_at = v_acknowledged_at,
    acknowledged_by = p_actor_user_id,
    resolved_at = case when v_has_pending_recovery then v_acknowledged_at else resolved_at end,
    metadata = case when v_has_pending_recovery
      then metadata || jsonb_build_object('acknowledgedAfterRecovery', true)
      else metadata
    end
  where id = p_alert_id
  returning * into v_alert;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  values (
    p_actor_user_id,
    'ALERT_ACKNOWLEDGED',
    v_alert.source_type,
    v_alert.source_id,
    jsonb_build_object(
      'alertId', v_alert.id,
      'title', v_alert.title,
      'status', v_alert.status
    )
  );

  if v_has_pending_recovery then
    insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    values (
      p_actor_user_id,
      'ALERT_RESOLVED',
      v_alert.source_type,
      v_alert.source_id,
      jsonb_build_object(
        'alertId', v_alert.id,
        'title', v_alert.title,
        'reason', 'acknowledged_after_recovery'
      )
    );

    return query select
      'resolved_after_recovery'::text,
      'resolved'::text,
      public.alert_to_api_json(v_alert);
    return;
  end if;

  return query select
    'acknowledged'::text,
    'acknowledged'::text,
    public.alert_to_api_json(v_alert);
end;
$$;

create or replace function public.get_alerts_snapshot()
returns table (
  alerts jsonb,
  snapshot_revision text
)
language sql
stable
set search_path = pg_catalog, public
as $$
  select
    coalesce(
      jsonb_agg(public.alert_to_api_json(alert) order by alert.created_at desc)
        filter (where alert.id is not null),
      '[]'::jsonb
    ) as alerts,
    revision_state.current_revision::text as snapshot_revision
  from public.alert_revision_state revision_state
  left join public.alerts alert
    on alert.status in ('Active', 'Acknowledged')
  where revision_state.singleton = true
  group by revision_state.current_revision;
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

revoke all on table public.alert_revision_state from public, anon, authenticated;
grant select, update on table public.alert_revision_state to service_role;

revoke execute on function public.assign_alert_revision() from public, anon, authenticated;
revoke execute on function public.alert_to_api_json(public.alerts) from public, anon, authenticated;
revoke execute on function public.acknowledge_alert(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.get_alerts_snapshot() from public, anon, authenticated;
grant execute on function public.alert_to_api_json(public.alerts) to service_role;
grant execute on function public.acknowledge_alert(uuid, uuid) to service_role;
grant execute on function public.get_alerts_snapshot() to service_role;

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

drop trigger if exists set_machines_updated_at on machines;
create trigger set_machines_updated_at
before update on machines
for each row
execute function set_updated_at();

drop trigger if exists set_sensors_updated_at on sensors;
create trigger set_sensors_updated_at
before update on sensors
for each row
execute function set_updated_at();

drop trigger if exists set_downtime_events_updated_at on downtime_events;
create trigger set_downtime_events_updated_at
before update on downtime_events
for each row
execute function set_updated_at();

drop trigger if exists set_alerts_updated_at on alerts;
create trigger set_alerts_updated_at
before update on alerts
for each row
execute function set_updated_at();
