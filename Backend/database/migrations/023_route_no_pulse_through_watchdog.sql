-- Keep every no-pulse event observational. Only watchdog evaluation may create absence downtime.

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
  downtime_duration_seconds integer, downtime_cause text, alert_action text, alert_record jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sensor_code text;
  v_watchdog_open boolean := false;
begin
  select sensor.sensor_code
  into v_sensor_code
  from public.sensors sensor
  where sensor.id = p_sensor_id and sensor.machine_id = p_machine_id;

  select exists (
    select 1 from public.downtime_events downtime
    where downtime.machine_id = p_machine_id and downtime.sensor_id = p_sensor_id
      and downtime.status = 'Open' and downtime.detection_source = 'absence_watchdog'
  ) into v_watchdog_open;

  if (p_event_type = 'downtime' and p_event_value->>'signal' = 'no_pulse')
    or (v_watchdog_open and p_event_type in ('pulse', 'recovered')
      and p_event_value->>'signal' = 'active') then
    return query select * from public.ingest_iot_watchdog_observation(
      p_device_event_id, p_sensor_id, p_machine_id, p_event_type, p_event_value, p_recorded_at
    );
    return;
  end if;

  if v_watchdog_open and p_event_type = 'fault' and p_event_value->>'signal' = 'fault' then
    insert into public.audit_logs (action, entity_type, entity_id, metadata)
    select 'WATCHDOG_DOWNTIME_CONFIRMED', 'downtime', downtime.id,
      jsonb_build_object('sensorCode', v_sensor_code, 'deviceEventId', p_device_event_id)
    from public.downtime_events downtime
    where downtime.machine_id = p_machine_id and downtime.sensor_id = p_sensor_id
      and downtime.status = 'Open' and downtime.detection_source = 'absence_watchdog';
  end if;

  return query select * from public.ingest_iot_sensor_event_legacy(
    p_device_event_id, p_sensor_id, p_machine_id, p_event_type, p_event_value, p_recorded_at
  );
end;
$$;

revoke execute on function public.ingest_iot_sensor_event(uuid, uuid, uuid, text, jsonb, timestamptz)
from public, anon, authenticated;

grant execute on function public.ingest_iot_sensor_event(uuid, uuid, uuid, text, jsonb, timestamptz)
to service_role;

commit;
