begin;

set local lock_timeout = '2s';

do $$
begin
  if to_regprocedure('public.evaluate_sensor_watchdog(uuid,timestamptz,text,integer)') is null then
    raise exception 'Migration 014 requires migration 012 watchdog evaluation.';
  end if;
end;
$$;

create or replace function public.evaluate_watchdog_cycle(
  p_evaluated_at timestamptz,
  p_mode text,
  p_stale_after_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sensor record;
  v_evaluation record;
  v_evaluations jsonb := '[]'::jsonb;
  v_states jsonb := '{}'::jsonb;
begin
  if p_mode not in ('disabled', 'observe', 'enforce') then
    raise exception using errcode = '22023', message = 'Watchdog mode is invalid.';
  end if;
  if p_evaluated_at is null or p_evaluated_at > clock_timestamp() + interval '5 minutes'
    or p_stale_after_seconds is null or p_stale_after_seconds < 2 then
    raise exception using errcode = '22023', message = 'Watchdog evaluation inputs are invalid.';
  end if;

  for v_sensor in
    select state.sensor_id, sensor.sensor_code, machine.machine_code
    from public.sensor_watchdog_state state
    join public.sensors sensor on sensor.id = state.sensor_id
    join public.machines machine on machine.id = sensor.machine_id
    order by machine.machine_code, sensor.sensor_code, state.sensor_id
  loop
    begin
      select * into strict v_evaluation
      from public.evaluate_sensor_watchdog(
        v_sensor.sensor_id,
        p_evaluated_at,
        p_mode,
        p_stale_after_seconds
      );

      v_evaluations := v_evaluations || jsonb_build_array(jsonb_build_object(
        'evaluated_sensor_id', v_sensor.sensor_id,
        'sensor_code', v_sensor.sensor_code,
        'machine_code', v_sensor.machine_code,
        'succeeded', true,
        'connectivity_state', v_evaluation.connectivity_state,
        'detection_state', v_evaluation.detection_state,
        'transition_descriptors', coalesce(v_evaluation.transition_descriptors, '[]'::jsonb),
        'error_code', null
      ));
    exception when others then
      v_evaluations := v_evaluations || jsonb_build_array(jsonb_build_object(
        'evaluated_sensor_id', v_sensor.sensor_id,
        'sensor_code', v_sensor.sensor_code,
        'machine_code', v_sensor.machine_code,
        'succeeded', false,
        'connectivity_state', null,
        'detection_state', null,
        'transition_descriptors', '[]'::jsonb,
        'error_code', 'WATCHDOG_EVALUATION_FAILED'
      ));
    end;
  end loop;

  select coalesce(jsonb_object_agg(state_name, state_count), '{}'::jsonb)
  into v_states
  from (
    select connectivity_state as state_name, count(*)::integer as state_count
    from public.sensor_watchdog_state
    group by connectivity_state
    union all
    select detection_state as state_name, count(*)::integer as state_count
    from public.sensor_watchdog_state
    group by detection_state
  ) counts;

  return jsonb_build_object(
    'evaluations', v_evaluations,
    'states', v_states
  );
end;
$$;

revoke all on function public.evaluate_watchdog_cycle(timestamptz, text, integer)
from public;
revoke execute on function public.evaluate_watchdog_cycle(timestamptz, text, integer)
from anon, authenticated;
grant execute on function public.evaluate_watchdog_cycle(timestamptz, text, integer)
to service_role;

commit;
