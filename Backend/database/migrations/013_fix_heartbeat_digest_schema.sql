begin;

do $$
begin
  if to_regprocedure('public.ingest_iot_heartbeat(uuid,uuid,uuid,bigint,uuid,bigint,timestamptz,boolean)') is null then
    raise exception 'Migration 013 requires migration 011 before it can repair heartbeat ingestion.';
  end if;

  if to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'Migration 013 requires pgcrypto digest in the extensions schema.';
  end if;
end;
$$;

create or replace function public.ingest_iot_heartbeat(
  p_heartbeat_id uuid,
  p_sensor_id uuid,
  p_machine_id uuid,
  p_boot_counter bigint,
  p_boot_id uuid,
  p_sequence bigint,
  p_recorded_at timestamptz,
  p_activity_observed boolean
)
returns table (
  heartbeat_id uuid,
  duplicate boolean,
  stale boolean,
  state_applied boolean,
  received_at timestamptz,
  connectivity_state text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sensor public.sensors%rowtype;
  v_state public.sensor_watchdog_state%rowtype;
  v_received_at timestamptz := clock_timestamp();
  v_payload_hash text;
  v_duplicate boolean := false;
  v_stale boolean := false;
  v_applied boolean := false;
  v_connectivity text;
  v_recovery_count integer;
begin
  if p_heartbeat_id is null or p_boot_id is null or p_recorded_at is null or p_activity_observed is null
    or p_boot_counter is null or p_boot_counter < 1 or p_sequence is null or p_sequence < 1 then
    raise exception using errcode = '22023', message = 'Heartbeat fields are invalid.';
  end if;
  if p_recorded_at > v_received_at + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'Heartbeat timestamp is too far in the future.';
  end if;

  select sensor.* into v_sensor
  from public.sensors sensor
  where sensor.id = p_sensor_id
  for update;
  if not found or v_sensor.machine_id <> p_machine_id then
    raise exception using errcode = 'P0002', message = 'Heartbeat sensor assignment was not found.';
  end if;

  select state.* into v_state
  from public.sensor_watchdog_state state
  where state.sensor_id = p_sensor_id
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'Heartbeat runtime state is not configured.';
  end if;

  v_payload_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'heartbeatId', p_heartbeat_id::text,
    'bootCounter', p_boot_counter::text,
    'bootId', p_boot_id::text,
    'sequence', p_sequence::text,
    'recordedAt', p_recorded_at,
    'activityObserved', p_activity_observed
  )::text, 'UTF8'), 'sha256'), 'hex');

  if v_state.boot_counter is not null and p_boot_counter < v_state.boot_counter then
    v_stale := true;
  elsif v_state.boot_counter = p_boot_counter then
    if v_state.boot_id <> p_boot_id then
      raise exception using errcode = '23505', message = 'Boot identity conflicts with the current boot counter.';
    elsif p_sequence < v_state.last_sequence then
      v_stale := true;
    elsif p_sequence = v_state.last_sequence then
      if v_state.last_heartbeat_id = p_heartbeat_id
        and v_state.last_heartbeat_payload_hash = v_payload_hash then
        v_duplicate := true;
      else
        raise exception using errcode = '23505', message = 'Heartbeat sequence was reused with different content.';
      end if;
    end if;
  end if;

  if not v_stale and not v_duplicate then
    if v_state.connectivity_state = 'offline' and v_state.boot_counter = p_boot_counter then
      v_recovery_count := least(2, v_state.ordered_recovery_heartbeats + 1);
      v_connectivity := case when v_recovery_count >= 2 then 'online' else 'offline' end;
    else
      v_recovery_count := 0;
      v_connectivity := 'online';
    end if;

    update public.sensor_watchdog_state
    set machine_id = p_machine_id,
        boot_counter = p_boot_counter,
        boot_id = p_boot_id,
        last_sequence = p_sequence,
        last_heartbeat_id = p_heartbeat_id,
        last_heartbeat_payload_hash = v_payload_hash,
        last_heartbeat_received_at = v_received_at,
        last_device_recorded_at = p_recorded_at,
        last_activity_received_at = case when p_activity_observed then v_received_at else last_activity_received_at end,
        ordered_recovery_heartbeats = v_recovery_count,
        connectivity_state = v_connectivity,
        absence_baseline_at = case when v_state.boot_counter is distinct from p_boot_counter then null else absence_baseline_at end,
        recovery_started_at = case when not p_activity_observed then null else recovery_started_at end,
        updated_at = v_received_at
    where sensor_id = p_sensor_id;
    v_applied := true;
  else
    v_connectivity := v_state.connectivity_state;
  end if;

  return query select p_heartbeat_id, v_duplicate, v_stale, v_applied, v_received_at, v_connectivity;
end;
$$;

revoke execute on function public.ingest_iot_heartbeat(uuid, uuid, uuid, bigint, uuid, bigint, timestamptz, boolean)
from public, anon, authenticated;
grant execute on function public.ingest_iot_heartbeat(uuid, uuid, uuid, bigint, uuid, bigint, timestamptz, boolean)
to service_role;

commit;
