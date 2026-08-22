begin;

set local lock_timeout = '2s';

do $$
begin
  if to_regclass('public.sensor_watchdog_state') is null then
    raise exception 'Migration 015 requires migration 011 watchdog runtime storage.';
  end if;
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

revoke all on function public.get_machine_live_snapshot(text) from public;
revoke execute on function public.get_machine_live_snapshot(text) from anon, authenticated;
grant execute on function public.get_machine_live_snapshot(text) to service_role;

commit;
