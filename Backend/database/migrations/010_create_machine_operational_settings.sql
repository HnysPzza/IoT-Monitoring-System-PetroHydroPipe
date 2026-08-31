begin;

set local lock_timeout = '2s';

create table if not exists public.machine_operational_settings (
  machine_id uuid primary key references public.machines(id) on delete cascade,
  sensor_thresholds jsonb not null default '{
    "S-01":{"absenceDetectionEnabled":false,"triggerSeconds":600,"recoverySeconds":null},
    "S-02":{"absenceDetectionEnabled":false,"triggerSeconds":300,"recoverySeconds":null},
    "S-03":{"absenceDetectionEnabled":false,"triggerSeconds":60,"recoverySeconds":null},
    "S-04":{"absenceDetectionEnabled":false,"triggerSeconds":300,"recoverySeconds":null},
    "S-05":{"absenceDetectionEnabled":false,"triggerSeconds":null,"recoverySeconds":null}
  }'::jsonb,
  shift_schedule jsonb not null default '{
    "workStart":"08:00",
    "workEnd":"17:00",
    "breaks":[
      {"name":"Morning Break","startTime":"10:00","endTime":"10:15"},
      {"name":"Lunch Break","startTime":"12:00","endTime":"13:00"},
      {"name":"Afternoon Break","startTime":"15:00","endTime":"15:15"}
    ],
    "rampUpGraceMinutes":10
  }'::jsonb,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  constraint machine_settings_sensor_thresholds_object
    check (jsonb_typeof(sensor_thresholds) = 'object'),
  constraint machine_settings_shift_schedule_object
    check (jsonb_typeof(shift_schedule) = 'object')
);

alter table public.machine_operational_settings enable row level security;

drop policy if exists machine_settings_service_role_select
on public.machine_operational_settings;
create policy machine_settings_service_role_select
on public.machine_operational_settings
for select
to service_role
using (true);

do $$
declare
  v_machine_id uuid;
begin
  select machine.id into v_machine_id
  from public.machines machine
  where machine.machine_code = 'M-01';

  if v_machine_id is null then
    raise exception using errcode = 'P0002', message = 'Machine M-01 not found.';
  end if;

  insert into public.machine_operational_settings (machine_id)
  values (v_machine_id)
  on conflict (machine_id) do nothing;
end;
$$;

drop function if exists public.update_machine_operational_settings(uuid, bigint, jsonb, jsonb, uuid);

create function public.update_machine_operational_settings(
  p_machine_id uuid,
  p_expected_version bigint,
  p_sensor_thresholds jsonb,
  p_shift_schedule jsonb,
  p_actor_user_id uuid
)
returns setof public.machine_operational_settings
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_previous public.machine_operational_settings%rowtype;
  v_current public.machine_operational_settings%rowtype;
  v_changed_sections text[] := array[]::text[];
begin
  if p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode = '22023', message = 'Expected version must be a positive integer.';
  end if;

  if jsonb_typeof(p_sensor_thresholds) is distinct from 'object'
    or jsonb_typeof(p_shift_schedule) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Machine settings must be JSON objects.';
  end if;

  if not exists (select 1 from public.machines machine where machine.id = p_machine_id) then
    raise exception using errcode = 'P0002', message = 'Machine not found.';
  end if;

  select settings.* into v_previous
  from public.machine_operational_settings settings
  where settings.machine_id = p_machine_id
  for update;

  if not found then
    raise exception using errcode = '55000', message = 'Machine settings are not configured.';
  end if;

  if v_previous.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'Settings version conflict.';
  end if;

  if v_previous.sensor_thresholds is not distinct from p_sensor_thresholds
    and v_previous.shift_schedule is not distinct from p_shift_schedule then
    return next v_previous;
    return;
  end if;

  if v_previous.sensor_thresholds is distinct from p_sensor_thresholds then
    v_changed_sections := array_append(v_changed_sections, 'sensorThresholds');
  end if;
  if v_previous.shift_schedule is distinct from p_shift_schedule then
    v_changed_sections := array_append(v_changed_sections, 'shiftSchedule');
  end if;

  update public.machine_operational_settings
  set
    sensor_thresholds = p_sensor_thresholds,
    shift_schedule = p_shift_schedule,
    version = version + 1,
    updated_at = now(),
    updated_by = p_actor_user_id
  where machine_id = p_machine_id
  returning * into v_current;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  values (
    p_actor_user_id,
    'SETTINGS_UPDATED',
    'machine_settings',
    p_machine_id,
    jsonb_build_object(
      'changedSections', to_jsonb(v_changed_sections),
      'previous', jsonb_build_object(
        'sensorThresholds', v_previous.sensor_thresholds,
        'shiftSchedule', v_previous.shift_schedule,
        'version', v_previous.version::text
      ),
      'current', jsonb_build_object(
        'sensorThresholds', v_current.sensor_thresholds,
        'shiftSchedule', v_current.shift_schedule,
        'version', v_current.version::text
      )
    )
  );

  return next v_current;
end;
$$;

revoke all on table public.machine_operational_settings
from public, anon, authenticated, service_role;
grant select on table public.machine_operational_settings to service_role;

revoke execute on function public.update_machine_operational_settings(uuid, bigint, jsonb, jsonb, uuid)
from public, anon, authenticated;
grant execute on function public.update_machine_operational_settings(uuid, bigint, jsonb, jsonb, uuid)
to service_role;

commit;
