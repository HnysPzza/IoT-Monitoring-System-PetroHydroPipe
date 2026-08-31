-- Add an audited manual recovery path without weakening physical IoT recovery.
-- Apply after migration 017.

begin;

create or replace function public.override_sensor_recovery(
  p_sensor_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns table (
  sensor_record jsonb,
  machine_record jsonb,
  downtime_action text,
  downtime_id uuid,
  alert_action text,
  alert_record jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sensor public.sensors%rowtype;
  v_machine public.machines%rowtype;
  v_downtime public.downtime_events%rowtype;
  v_alert public.alerts%rowtype;
  v_previous_sensor_status text;
  v_previous_machine_status text;
  v_new_machine_status text;
  v_recovered_at timestamptz := clock_timestamp();
  v_reason text := btrim(p_reason);
  v_downtime_action text;
  v_alert_action text;
begin
  if v_reason is null or v_reason = '' or char_length(v_reason) > 500 then
    raise exception using errcode = '22023', message = 'A recovery override reason between 1 and 500 characters is required.';
  end if;

  select sensor.* into v_sensor
  from public.sensors sensor
  where sensor.id = p_sensor_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Sensor not found.';
  end if;

  select machine.* into v_machine
  from public.machines machine
  where machine.id = v_sensor.machine_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Machine not found.';
  end if;

  v_previous_sensor_status := v_sensor.status;
  v_previous_machine_status := v_machine.status;

  update public.sensors
  set status = 'Active'
  where id = v_sensor.id
  returning * into v_sensor;

  select case
    when bool_or(sensor.status = 'Fault') then 'Downtime'
    when bool_or(sensor.status = 'Active') then 'Running'
    else 'Idle'
  end into v_new_machine_status
  from public.sensors sensor
  where sensor.machine_id = v_machine.id;

  update public.machines
  set status = v_new_machine_status
  where id = v_machine.id
  returning * into v_machine;

  update public.downtime_events
  set
    status = 'Resolved',
    ended_at = v_recovered_at,
    duration_seconds = greatest(0, round(extract(epoch from (v_recovered_at - started_at)))::integer)
  where machine_id = v_machine.id
    and sensor_id = v_sensor.id
    and status = 'Open'
  returning * into v_downtime;

  if found then
    v_downtime_action := 'resolved';
  end if;

  select alert.* into v_alert
  from public.alerts alert
  where alert.source_type = 'sensor'
    and alert.source_id = v_sensor.id
    and alert.status in ('Active', 'Acknowledged')
  for update;

  if found then
    if v_alert.status = 'Acknowledged' then
      update public.alerts
      set
        status = 'Resolved',
        resolved_at = v_recovered_at,
        metadata = metadata || jsonb_build_object(
          'recoveryPending', true,
          'recoverySource', 'manual_override',
          'recoveredAt', v_recovered_at,
          'recoveredBy', p_actor_user_id,
          'overrideReason', v_reason,
          'acknowledgedAfterRecovery', true
        )
      where id = v_alert.id
      returning * into v_alert;
      v_alert_action := 'resolved';
    else
      update public.alerts
      set metadata = metadata || jsonb_build_object(
        'recoveryPending', true,
        'recoverySource', 'manual_override',
        'recoveredAt', v_recovered_at,
        'recoveredBy', p_actor_user_id,
        'overrideReason', v_reason
      )
      where id = v_alert.id
      returning * into v_alert;
      v_alert_action := 'updated';
    end if;
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  values (
    p_actor_user_id,
    'SENSOR_MANUAL_RECOVERY_OVERRIDE',
    'sensor',
    v_sensor.id,
    jsonb_build_object(
      'sensorCode', v_sensor.sensor_code,
      'machineCode', v_machine.machine_code,
      'previousSensorStatus', v_previous_sensor_status,
      'newSensorStatus', v_sensor.status,
      'previousMachineStatus', v_previous_machine_status,
      'newMachineStatus', v_machine.status,
      'reason', v_reason,
      'recoveredAt', v_recovered_at,
      'downtimeId', v_downtime.id,
      'alertId', v_alert.id
    )
  );

  return query select
    to_jsonb(v_sensor),
    to_jsonb(v_machine) || jsonb_build_object(
      'sensor_count', (select count(*) from public.sensors sensor where sensor.machine_id = v_machine.id)
    ),
    v_downtime_action,
    v_downtime.id,
    v_alert_action,
    case when v_alert.id is null then null else public.alert_to_api_json(v_alert) end;
end;
$$;

revoke all on function public.override_sensor_recovery(uuid, uuid, text) from public;
revoke execute on function public.override_sensor_recovery(uuid, uuid, text) from anon, authenticated;
grant execute on function public.override_sensor_recovery(uuid, uuid, text) to service_role;

alter function public.acknowledge_alert(uuid, uuid) security definer;
revoke all on function public.acknowledge_alert(uuid, uuid) from public;
revoke execute on function public.acknowledge_alert(uuid, uuid) from anon, authenticated;
grant execute on function public.acknowledge_alert(uuid, uuid) to service_role;

commit;
