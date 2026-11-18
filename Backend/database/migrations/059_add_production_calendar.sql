-- Add per-machine production calendar days, weekly rest days, holiday seeds, and calendar-aware watchdog eligibility.

begin;

set local lock_timeout = '2s';

create table if not exists public.production_calendar_days (
  machine_id uuid not null references public.machines(id) on delete cascade,
  calendar_date date not null,
  name text not null,
  day_type text not null,
  is_working boolean not null default false,
  reason text,
  source text not null default 'manual',
  group_id uuid,
  version bigint not null default 1 check (version > 0),
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (machine_id, calendar_date),
  constraint production_calendar_days_name_not_empty
    check (length(btrim(name)) > 0),
  constraint production_calendar_days_day_type_valid
    check (day_type in ('holiday', 'day_off', 'machine_not_scheduled')),
  constraint production_calendar_days_source_valid
    check (source in ('seeded', 'manual')),
  constraint production_calendar_days_non_working_day_types
    check (day_type = 'holiday' or is_working = false),
  constraint production_calendar_days_reason_required
    check (day_type <> 'machine_not_scheduled' or length(btrim(coalesce(reason, ''))) > 0)
);

create index if not exists idx_production_calendar_days_group
  on public.production_calendar_days (machine_id, group_id)
  where group_id is not null;

create index if not exists idx_production_calendar_days_updated_by
  on public.production_calendar_days (updated_by)
  where updated_by is not null;

alter table public.production_calendar_days enable row level security;

drop policy if exists production_calendar_days_service_role_select
  on public.production_calendar_days;
create policy production_calendar_days_service_role_select
  on public.production_calendar_days
  for select
  to service_role
  using (true);

create or replace function public.get_seeded_production_holidays()
returns table (
  calendar_date date,
  name text,
  default_is_working boolean
)
language sql
immutable
set search_path = pg_catalog, public
as $$
  select
    holiday.calendar_date::date,
    holiday.name::text,
    holiday.default_is_working::boolean
  from (
    values
      ('2026-11-30', 'Bonifacio Day', true),
      ('2026-12-08', 'Feast of the Immaculate Conception', true),
      ('2026-12-24', 'Christmas Eve', false),
      ('2026-12-25', 'Christmas Day', false),
      ('2026-12-30', 'Rizal Day', false),
      ('2026-12-31', 'Last Day of the Year', false),
      ('2027-01-01', 'New Year''s Day', false),
      ('2027-02-06', 'Chinese New Year', true),
      ('2027-02-24', 'Cebu City Charter Day', true),
      ('2027-03-25', 'Maundy Thursday', false),
      ('2027-03-26', 'Good Friday', false),
      ('2027-03-27', 'Black Saturday', false),
      ('2027-04-09', 'Araw ng Kagitingan', true),
      ('2027-05-01', 'Labor Day', true),
      ('2027-06-12', 'Independence Day', true),
      ('2027-08-06', 'Cebu Province Charter Day', true),
      ('2027-08-21', 'Ninoy Aquino Day', true),
      ('2027-08-30', 'National Heroes Day', true),
      ('2027-09-09', 'Sergio Osmena Sr. Day', true),
      ('2027-11-01', 'All Saints'' Day', false),
      ('2027-11-02', 'All Souls'' Day', false),
      ('2027-11-30', 'Bonifacio Day', true),
      ('2027-12-08', 'Feast of the Immaculate Conception', true),
      ('2027-12-24', 'Christmas Eve', false),
      ('2027-12-25', 'Christmas Day', false),
      ('2027-12-30', 'Rizal Day', false),
      ('2027-12-31', 'Last Day of the Year', false)
  ) as holiday(calendar_date, name, default_is_working)
  order by holiday.calendar_date::date asc;
$$;

insert into public.production_calendar_days (
  machine_id,
  calendar_date,
  name,
  day_type,
  is_working,
  reason,
  source,
  group_id,
  version,
  updated_by,
  updated_at
)
select
  machine.id,
  holiday.calendar_date,
  holiday.name,
  'holiday',
  holiday.default_is_working,
  null,
  'seeded',
  null,
  1,
  null,
  clock_timestamp()
from public.machines machine
cross join public.get_seeded_production_holidays() holiday
on conflict (machine_id, calendar_date) do nothing;

alter table public.machine_operational_settings
alter column shift_schedule set default '{
  "workStart":"08:00",
  "workEnd":"17:00",
  "breaks":[
    {"name":"Morning Break","startTime":"10:00","endTime":"10:15"},
    {"name":"Lunch Break","startTime":"12:00","endTime":"13:00"},
    {"name":"Afternoon Break","startTime":"15:00","endTime":"15:15"}
  ],
  "rampUpGraceMinutes":10,
  "restDays":["sunday"]
}'::jsonb;

do $$
declare
  v_settings public.machine_operational_settings%rowtype;
  v_active_history public.machine_operational_settings_history%rowtype;
  v_migrated_at timestamptz;
  v_new_schedule jsonb;
  v_new_version bigint;
begin
  for v_settings in
    select settings.*
    from public.machine_operational_settings settings
    where not (settings.shift_schedule ? 'restDays')
    for update
  loop
    select history.* into v_active_history
    from public.machine_operational_settings_history history
    where history.machine_id = v_settings.machine_id
      and history.version = v_settings.version
      and history.effective_to is null
    for update;

    if not found then
      raise exception using errcode = '55000', message = 'Current settings history is missing.';
    end if;

    v_migrated_at := greatest(
      clock_timestamp(),
      coalesce(v_active_history.effective_from + interval '1 microsecond', clock_timestamp())
    );
    v_new_schedule := jsonb_set(v_settings.shift_schedule, '{restDays}', '["sunday"]'::jsonb, true);
    v_new_version := v_settings.version + 1;

    update public.machine_operational_settings_history
    set effective_to = v_migrated_at
    where machine_id = v_settings.machine_id
      and version = v_settings.version
      and effective_to is null;

    update public.machine_operational_settings
    set
      shift_schedule = v_new_schedule,
      version = v_new_version,
      updated_at = v_migrated_at
    where machine_id = v_settings.machine_id;

    insert into public.machine_operational_settings_history (
      machine_id,
      version,
      sensor_thresholds,
      shift_schedule,
      effective_from,
      effective_to,
      changed_by,
      created_at
    ) values (
      v_settings.machine_id,
      v_new_version,
      v_settings.sensor_thresholds,
      v_new_schedule,
      v_migrated_at,
      null,
      v_settings.updated_by,
      v_migrated_at
    );

    update public.sensor_watchdog_state
    set settings_version = v_new_version
    where machine_id = v_settings.machine_id;
  end loop;
end;
$$;

create or replace function public.update_machine_operational_settings(
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
  v_active_history public.machine_operational_settings_history%rowtype;
  v_changed_sections text[] := array[]::text[];
  v_changed_at timestamptz;
  v_normalized_schedule jsonb;
  v_rest_days jsonb := '[]'::jsonb;
  v_rest_day_item jsonb;
  v_rest_day_text text;
  v_seen_days text[] := array[]::text[];
begin
  if p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode = '22023', message = 'Expected version must be a positive integer.';
  end if;
  if jsonb_typeof(p_sensor_thresholds) is distinct from 'object'
    or jsonb_typeof(p_shift_schedule) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Machine settings must be JSON objects.';
  end if;

  if p_shift_schedule ? 'restDays' then
    if jsonb_typeof(p_shift_schedule->'restDays') is distinct from 'array' then
      raise exception using errcode = '22023', message = 'Shift schedule restDays must be an array.';
    end if;

    for v_rest_day_item in
      select value from jsonb_array_elements(p_shift_schedule->'restDays')
    loop
      if jsonb_typeof(v_rest_day_item) is distinct from 'string' then
        raise exception using errcode = '22023', message = 'Shift schedule restDays must contain lowercase weekday names.';
      end if;

      v_rest_day_text := v_rest_day_item #>> '{}';
      if v_rest_day_text not in ('sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday') then
        raise exception using errcode = '22023', message = 'Shift schedule restDays must contain valid lowercase weekday names.';
      end if;

      if not (v_rest_day_text = any(v_seen_days)) then
        v_seen_days := array_append(v_seen_days, v_rest_day_text);
        v_rest_days := v_rest_days || to_jsonb(v_rest_day_text);
      end if;
    end loop;

    if coalesce(array_length(v_seen_days, 1), 0) > 6 then
      raise exception using errcode = '22023', message = 'At least one working day per week is required.';
    end if;
  end if;

  v_normalized_schedule := jsonb_set(p_shift_schedule, '{restDays}', v_rest_days, true);

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
    and (
      v_previous.shift_schedule is not distinct from v_normalized_schedule
      or (
        not (p_shift_schedule ? 'restDays')
        and (v_previous.shift_schedule - 'restDays') is not distinct from p_shift_schedule
      )
    ) then
    return next v_previous;
    return;
  end if;

  select history.* into v_active_history
  from public.machine_operational_settings_history history
  where history.machine_id = p_machine_id
    and history.version = v_previous.version
    and history.effective_to is null
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'Current settings history is missing.';
  end if;

  v_changed_at := greatest(
    clock_timestamp(),
    coalesce(v_active_history.effective_from + interval '1 microsecond', clock_timestamp())
  );

  if v_previous.sensor_thresholds is distinct from p_sensor_thresholds then
    v_changed_sections := array_append(v_changed_sections, 'sensorThresholds');
  end if;
  if v_previous.shift_schedule is distinct from v_normalized_schedule then
    v_changed_sections := array_append(v_changed_sections, 'shiftSchedule');
  end if;

  update public.machine_operational_settings_history
  set effective_to = v_changed_at
  where machine_id = p_machine_id and version = v_previous.version;

  update public.machine_operational_settings
  set sensor_thresholds = p_sensor_thresholds,
      shift_schedule = v_normalized_schedule,
      version = version + 1,
      updated_at = v_changed_at,
      updated_by = p_actor_user_id
  where machine_id = p_machine_id
  returning * into v_current;

  insert into public.machine_operational_settings_history (
    machine_id, version, sensor_thresholds, shift_schedule,
    effective_from, effective_to, changed_by, created_at
  ) values (
    p_machine_id, v_current.version, v_current.sensor_thresholds, v_current.shift_schedule,
    v_changed_at, null, p_actor_user_id, v_changed_at
  );

  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  values (
    p_actor_user_id, 'SETTINGS_UPDATED', 'machine_settings', p_machine_id,
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

create or replace function public.set_production_calendar_day(
  p_machine_id uuid,
  p_calendar_date date,
  p_day_type text,
  p_name text,
  p_is_working boolean default false,
  p_reason text default null,
  p_expected_version bigint default null,
  p_confirm_overwrite boolean default false,
  p_actor_id uuid default null
)
returns setof public.production_calendar_days
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_manila_today date := (clock_timestamp() at time zone 'Asia/Manila')::date;
  v_existing public.production_calendar_days%rowtype;
  v_current public.production_calendar_days%rowtype;
  v_had_existing boolean := false;
  v_name text;
  v_reason text;
  v_is_working boolean;
  v_source text;
  v_is_seeded_holiday boolean := false;
begin
  if p_machine_id is null then
    raise exception using errcode = '22023', message = 'Machine id is required.';
  end if;
  if not exists (select 1 from public.machines machine where machine.id = p_machine_id) then
    raise exception using errcode = 'P0002', message = 'Machine not found.';
  end if;
  if p_calendar_date is null then
    raise exception using errcode = '22023', message = 'Calendar date is required.';
  end if;
  if p_calendar_date <= v_manila_today then
    raise exception using errcode = '22023', message = 'Production calendar dates can only be modified in advance.';
  end if;
  if p_day_type is null or p_day_type not in ('holiday', 'day_off', 'machine_not_scheduled') then
    raise exception using errcode = '22023', message = 'Calendar day_type must be holiday, day_off, or machine_not_scheduled.';
  end if;
  if p_expected_version is not null and p_expected_version < 1 then
    raise exception using errcode = '22023', message = 'Expected version must be a positive integer.';
  end if;

  select * into v_existing
  from public.production_calendar_days
  where machine_id = p_machine_id and calendar_date = p_calendar_date
  for update;
  v_had_existing := found;

  v_name := btrim(coalesce(nullif(btrim(p_name), ''), case when v_had_existing then v_existing.name else '' end));
  if length(v_name) = 0 then
    raise exception using errcode = '22023', message = 'Calendar entry name is required.';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if p_day_type = 'machine_not_scheduled' and v_reason is null then
    raise exception using errcode = '22023', message = 'A reason is required when day_type is machine_not_scheduled.';
  end if;

  if p_day_type in ('day_off', 'machine_not_scheduled') then
    if p_is_working is true then
      raise exception using errcode = '22023', message = 'Entries with day_type day_off or machine_not_scheduled must have is_working = false.';
    end if;
    v_is_working := false;
  else
    if p_is_working is null then
      raise exception using errcode = '22023', message = 'Holiday entries require is_working to be specified.';
    end if;
    v_is_working := p_is_working;
  end if;

  select exists (
    select 1
    from public.get_seeded_production_holidays() holiday
    where holiday.calendar_date = p_calendar_date
  ) into v_is_seeded_holiday;

  v_source := case
    when p_day_type = 'holiday' and v_is_seeded_holiday then 'seeded'
    else 'manual'
  end;

  if v_had_existing then
    if p_expected_version is not null and v_existing.version <> p_expected_version then
      raise exception using errcode = '40001', message = 'Production calendar entry version conflict.';
    end if;

    if v_existing.day_type = p_day_type
      and v_existing.name = v_name
      and v_existing.is_working = v_is_working
      and v_existing.reason is not distinct from v_reason
      and v_existing.source = v_source then
      return next v_existing;
      return;
    end if;

    if v_existing.source = 'manual'
      and p_expected_version is null
      and not coalesce(p_confirm_overwrite, false) then
      raise exception using
        errcode = '23505',
        message = 'Manual production calendar entry already exists for the selected date.',
        detail = to_jsonb(array[p_calendar_date::text])::text;
    end if;

    update public.production_calendar_days
    set
      name = v_name,
      day_type = p_day_type,
      is_working = v_is_working,
      reason = v_reason,
      source = v_source,
      group_id = null,
      version = version + 1,
      updated_by = p_actor_id,
      updated_at = clock_timestamp()
    where machine_id = p_machine_id
      and calendar_date = p_calendar_date
    returning * into v_current;
  else
    insert into public.production_calendar_days (
      machine_id,
      calendar_date,
      name,
      day_type,
      is_working,
      reason,
      source,
      group_id,
      version,
      updated_by,
      updated_at
    ) values (
      p_machine_id,
      p_calendar_date,
      v_name,
      p_day_type,
      v_is_working,
      v_reason,
      v_source,
      null,
      1,
      p_actor_id,
      clock_timestamp()
    )
    returning * into v_current;
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  values (
    p_actor_id,
    'PRODUCTION_CALENDAR_DAY_SET',
    'production_calendar',
    p_machine_id,
    jsonb_build_object(
      'calendarDate', v_current.calendar_date::text,
      'name', v_current.name,
      'dayType', v_current.day_type,
      'isWorking', v_current.is_working,
      'reason', v_current.reason,
      'source', v_current.source,
      'version', v_current.version::text,
      'previous', case when v_had_existing then jsonb_build_object(
        'name', v_existing.name,
        'dayType', v_existing.day_type,
        'isWorking', v_existing.is_working,
        'reason', v_existing.reason,
        'source', v_existing.source,
        'groupId', v_existing.group_id,
        'version', v_existing.version::text
      ) else null end
    )
  );

  return next v_current;
end;
$$;

create or replace function public.set_production_calendar_range(
  p_machine_id uuid,
  p_start_date date,
  p_end_date date,
  p_day_type text,
  p_name text,
  p_reason text default null,
  p_confirm_overwrite boolean default false,
  p_actor_id uuid default null,
  p_group_id uuid default null
)
returns setof public.production_calendar_days
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_manila_today date := (clock_timestamp() at time zone 'Asia/Manila')::date;
  v_span_days integer;
  v_name text := btrim(coalesce(p_name, ''));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_group_id uuid := coalesce(p_group_id, gen_random_uuid());
  v_existing_group_id uuid;
  v_matching_count integer := 0;
  v_total_group_count integer := 0;
  v_conflicting_dates text[];
  v_replaced_holiday_dates jsonb := '[]'::jsonb;
  v_replaced_holidays jsonb := '[]'::jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_machine_id is null then
    raise exception using errcode = '22023', message = 'Machine id is required.';
  end if;
  if not exists (select 1 from public.machines machine where machine.id = p_machine_id) then
    raise exception using errcode = 'P0002', message = 'Machine not found.';
  end if;
  if p_start_date is null or p_end_date is null then
    raise exception using errcode = '22023', message = 'Start date and end date are required.';
  end if;
  if p_end_date < p_start_date then
    raise exception using errcode = '22023', message = 'End date must be on or after start date.';
  end if;
  if p_start_date <= v_manila_today then
    raise exception using errcode = '22023', message = 'Production calendar ranges can only start on a future date.';
  end if;

  v_span_days := (p_end_date - p_start_date) + 1;
  if v_span_days < 1 or v_span_days > 62 then
    raise exception using errcode = '22023', message = 'Production calendar range must span between 1 and 62 days.';
  end if;
  if p_day_type is null or p_day_type not in ('day_off', 'machine_not_scheduled') then
    raise exception using errcode = '22023', message = 'Range day_type must be day_off or machine_not_scheduled.';
  end if;
  if length(v_name) = 0 then
    raise exception using errcode = '22023', message = 'Range name is required.';
  end if;
  if p_day_type = 'machine_not_scheduled' and v_reason is null then
    raise exception using errcode = '22023', message = 'A reason is required when day_type is machine_not_scheduled.';
  end if;

  perform 1
  from public.production_calendar_days
  where machine_id = p_machine_id
    and calendar_date between p_start_date and p_end_date
  for update;

  select
    count(*)::integer,
    case when count(distinct group_id) = 1 then min(group_id::text)::uuid else null end
  into v_matching_count, v_existing_group_id
  from public.production_calendar_days
  where machine_id = p_machine_id
    and calendar_date between p_start_date and p_end_date
    and source = 'manual'
    and day_type = p_day_type
    and name = v_name
    and is_working = false
    and reason is not distinct from v_reason
    and group_id is not null
    and (p_group_id is null or group_id = p_group_id);

  if v_matching_count = v_span_days and v_existing_group_id is not null then
    select count(*)::integer into v_total_group_count
    from public.production_calendar_days
    where machine_id = p_machine_id
      and group_id = v_existing_group_id;

    if v_total_group_count = v_span_days then
      return query
      select *
      from public.production_calendar_days
      where machine_id = p_machine_id
        and calendar_date between p_start_date and p_end_date
      order by calendar_date asc;
      return;
    end if;
  end if;

  select array_agg(calendar_date::text order by calendar_date asc)
  into v_conflicting_dates
  from public.production_calendar_days
  where machine_id = p_machine_id
    and calendar_date between p_start_date and p_end_date
    and source = 'manual';

  if coalesce(array_length(v_conflicting_dates, 1), 0) > 0
    and not coalesce(p_confirm_overwrite, false) then
    raise exception using
      errcode = '23505',
      message = 'Manual production calendar entries already exist in the selected range.',
      detail = to_jsonb(v_conflicting_dates)::text;
  end if;

  select
    coalesce(
      jsonb_agg(calendar_date::text order by calendar_date asc) filter (where source = 'seeded'),
      '[]'::jsonb
    ),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'calendarDate', calendar_date::text,
          'name', name,
          'dayType', day_type,
          'isWorking', is_working,
          'source', source
        ) order by calendar_date asc
      ) filter (where source = 'seeded'),
      '[]'::jsonb
    )
  into v_replaced_holiday_dates, v_replaced_holidays
  from public.production_calendar_days
  where machine_id = p_machine_id
    and calendar_date between p_start_date and p_end_date;

  insert into public.production_calendar_days (
    machine_id,
    calendar_date,
    name,
    day_type,
    is_working,
    reason,
    source,
    group_id,
    version,
    updated_by,
    updated_at
  )
  select
    p_machine_id,
    day_value::date,
    v_name,
    p_day_type,
    false,
    v_reason,
    'manual',
    v_group_id,
    1,
    p_actor_id,
    v_now
  from generate_series(p_start_date, p_end_date, interval '1 day') as day_value
  on conflict (machine_id, calendar_date) do update
  set
    name = excluded.name,
    day_type = excluded.day_type,
    is_working = false,
    reason = excluded.reason,
    source = 'manual',
    group_id = excluded.group_id,
    version = public.production_calendar_days.version + 1,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  values (
    p_actor_id,
    'PRODUCTION_CALENDAR_RANGE_SET',
    'production_calendar',
    p_machine_id,
    jsonb_build_object(
      'groupId', v_group_id,
      'startDate', p_start_date::text,
      'endDate', p_end_date::text,
      'dayCount', v_span_days,
      'name', v_name,
      'dayType', p_day_type,
      'isWorking', false,
      'reason', v_reason,
      'confirmOverwrite', coalesce(p_confirm_overwrite, false),
      'replacedDates', v_replaced_holiday_dates,
      'replacedHolidays', v_replaced_holidays
    )
  );

  return query
  select *
  from public.production_calendar_days
  where machine_id = p_machine_id
    and calendar_date between p_start_date and p_end_date
  order by calendar_date asc;
end;
$$;

create or replace function public.remove_production_calendar_day(
  p_machine_id uuid,
  p_calendar_date date,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_manila_today date := (clock_timestamp() at time zone 'Asia/Manila')::date;
  v_existing public.production_calendar_days%rowtype;
  v_restored public.production_calendar_days%rowtype;
  v_has_restored boolean := false;
begin
  if p_machine_id is null then
    raise exception using errcode = '22023', message = 'Machine id is required.';
  end if;
  if not exists (select 1 from public.machines machine where machine.id = p_machine_id) then
    raise exception using errcode = 'P0002', message = 'Machine not found.';
  end if;
  if p_calendar_date is null then
    raise exception using errcode = '22023', message = 'Calendar date is required.';
  end if;
  if p_calendar_date <= v_manila_today then
    raise exception using errcode = '22023', message = 'Today and past production calendar dates are locked and cannot be removed.';
  end if;

  select * into v_existing
  from public.production_calendar_days
  where machine_id = p_machine_id
    and calendar_date = p_calendar_date
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Production calendar entry not found.';
  end if;

  if v_existing.source = 'seeded' then
    raise exception using errcode = '22023', message = 'Seeded holidays cannot be removed; toggle is_working instead.';
  end if;

  delete from public.production_calendar_days
  where machine_id = p_machine_id
    and calendar_date = p_calendar_date;

  insert into public.production_calendar_days (
    machine_id,
    calendar_date,
    name,
    day_type,
    is_working,
    reason,
    source,
    group_id,
    version,
    updated_by,
    updated_at
  )
  select
    p_machine_id,
    holiday.calendar_date,
    holiday.name,
    'holiday',
    holiday.default_is_working,
    null,
    'seeded',
    null,
    v_existing.version + 1,
    p_actor_id,
    clock_timestamp()
  from public.get_seeded_production_holidays() holiday
  where holiday.calendar_date = p_calendar_date
  returning * into v_restored;

  v_has_restored := found;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  values (
    p_actor_id,
    'PRODUCTION_CALENDAR_ENTRY_REMOVED',
    'production_calendar',
    p_machine_id,
    jsonb_build_object(
      'mode', 'single',
      'calendarDate', p_calendar_date::text,
      'removedCount', 1,
      'removedDates', jsonb_build_array(p_calendar_date::text),
      'lockedDates', '[]'::jsonb,
      'previous', jsonb_build_object(
        'name', v_existing.name,
        'dayType', v_existing.day_type,
        'isWorking', v_existing.is_working,
        'reason', v_existing.reason,
        'groupId', v_existing.group_id,
        'version', v_existing.version::text
      ),
      'restoredDates', case when v_has_restored then jsonb_build_array(v_restored.calendar_date::text) else '[]'::jsonb end,
      'restoredHolidays', case when v_has_restored then jsonb_build_array(
        jsonb_build_object(
          'calendarDate', v_restored.calendar_date::text,
          'name', v_restored.name,
          'dayType', v_restored.day_type,
          'isWorking', v_restored.is_working,
          'source', v_restored.source,
          'version', v_restored.version
        )
      ) else '[]'::jsonb end
    )
  );

  return jsonb_build_object(
    'machineId', p_machine_id,
    'calendarDate', p_calendar_date::text,
    'removedCount', 1,
    'removedDates', jsonb_build_array(p_calendar_date::text),
    'lockedDates', '[]'::jsonb,
    'restoredDates', case when v_has_restored then jsonb_build_array(v_restored.calendar_date::text) else '[]'::jsonb end,
    'restoredHolidays', case when v_has_restored then jsonb_build_array(
      jsonb_build_object(
        'calendarDate', v_restored.calendar_date::text,
        'name', v_restored.name,
        'dayType', v_restored.day_type,
        'isWorking', v_restored.is_working,
        'source', v_restored.source,
        'version', v_restored.version
      )
    ) else '[]'::jsonb end
  );
end;
$$;

create or replace function public.remove_production_calendar_range(
  p_machine_id uuid,
  p_group_id uuid,
  p_actor_id uuid default null,
  p_as_of timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_manila_today date := (coalesce(p_as_of, clock_timestamp()) at time zone 'Asia/Manila')::date;
  v_sample public.production_calendar_days%rowtype;
  v_removable_dates date[];
  v_removable_dates_text text[];
  v_locked_dates_text text[];
  v_restored_dates jsonb := '[]'::jsonb;
  v_restored_holidays jsonb := '[]'::jsonb;
begin
  if p_machine_id is null or p_group_id is null then
    raise exception using errcode = '22023', message = 'Machine id and group id are required.';
  end if;
  if not exists (select 1 from public.machines machine where machine.id = p_machine_id) then
    raise exception using errcode = 'P0002', message = 'Machine not found.';
  end if;

  select * into v_sample
  from public.production_calendar_days
  where machine_id = p_machine_id
    and group_id = p_group_id
  order by calendar_date asc
  limit 1
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Production calendar range not found.';
  end if;

  perform 1
  from public.production_calendar_days
  where machine_id = p_machine_id
    and group_id = p_group_id
  for update;

  select
    array_agg(calendar_date order by calendar_date asc) filter (where calendar_date > v_manila_today),
    array_agg(calendar_date::text order by calendar_date asc) filter (where calendar_date > v_manila_today),
    array_agg(calendar_date::text order by calendar_date asc) filter (where calendar_date <= v_manila_today)
  into v_removable_dates, v_removable_dates_text, v_locked_dates_text
  from public.production_calendar_days
  where machine_id = p_machine_id
    and group_id = p_group_id;

  if coalesce(array_length(v_removable_dates, 1), 0) = 0 then
    raise exception using errcode = '22023', message = 'All dates in this production calendar range are locked and cannot be removed.';
  end if;

  delete from public.production_calendar_days
  where machine_id = p_machine_id
    and group_id = p_group_id
    and calendar_date > v_manila_today;

  insert into public.production_calendar_days (
    machine_id,
    calendar_date,
    name,
    day_type,
    is_working,
    reason,
    source,
    group_id,
    version,
    updated_by,
    updated_at
  )
  select
    p_machine_id,
    holiday.calendar_date,
    holiday.name,
    'holiday',
    holiday.default_is_working,
    null,
    'seeded',
    null,
    1,
    p_actor_id,
    clock_timestamp()
  from public.get_seeded_production_holidays() holiday
  where holiday.calendar_date = any(v_removable_dates)
  on conflict (machine_id, calendar_date) do nothing;

  select
    coalesce(jsonb_agg(calendar.calendar_date::text order by calendar.calendar_date asc), '[]'::jsonb),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'calendarDate', calendar.calendar_date::text,
          'name', calendar.name,
          'dayType', calendar.day_type,
          'isWorking', calendar.is_working,
          'source', calendar.source,
          'version', calendar.version
        ) order by calendar.calendar_date asc
      ),
      '[]'::jsonb
    )
  into v_restored_dates, v_restored_holidays
  from public.production_calendar_days calendar
  where calendar.machine_id = p_machine_id
    and calendar.calendar_date = any(v_removable_dates)
    and calendar.source = 'seeded';

  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  values (
    p_actor_id,
    'PRODUCTION_CALENDAR_ENTRY_REMOVED',
    'production_calendar',
    p_machine_id,
    jsonb_build_object(
      'mode', 'range',
      'groupId', p_group_id,
      'name', v_sample.name,
      'dayType', v_sample.day_type,
      'reason', v_sample.reason,
      'removedCount', coalesce(array_length(v_removable_dates, 1), 0),
      'removedDates', coalesce(to_jsonb(v_removable_dates_text), '[]'::jsonb),
      'lockedDates', coalesce(to_jsonb(v_locked_dates_text), '[]'::jsonb),
      'restoredDates', v_restored_dates,
      'restoredHolidays', v_restored_holidays
    )
  );

  return jsonb_build_object(
    'machineId', p_machine_id,
    'groupId', p_group_id,
    'removedCount', coalesce(array_length(v_removable_dates, 1), 0),
    'removedDates', coalesce(to_jsonb(v_removable_dates_text), '[]'::jsonb),
    'lockedDates', coalesce(to_jsonb(v_locked_dates_text), '[]'::jsonb),
    'restoredDates', v_restored_dates,
    'restoredHolidays', v_restored_holidays
  );
end;
$$;

create or replace function public.watchdog_eligible_seconds(
  p_machine_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz
)
returns bigint
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_history public.machine_operational_settings_history%rowtype;
  v_segment_start timestamptz;
  v_segment_end timestamptz;
  v_covered_until timestamptz := p_started_at;
  v_day date;
  v_calendar_is_working boolean;
  v_weekday text;
  v_work_start timestamptz;
  v_work_end timestamptz;
  v_overlap_start timestamptz;
  v_overlap_end timestamptz;
  v_break jsonb;
  v_break_start timestamptz;
  v_break_end timestamptz;
  v_seconds numeric := 0;
  v_schedule jsonb;
  v_grace integer;
begin
  if p_machine_id is null or p_started_at is null or p_ended_at is null or p_ended_at < p_started_at then
    raise exception using errcode = '22023', message = 'Operational-time interval is invalid.';
  end if;
  if p_ended_at = p_started_at then return 0; end if;

  for v_history in
    select history.*
    from public.machine_operational_settings_history history
    where history.machine_id = p_machine_id
      and (history.effective_to is null or history.effective_to > p_started_at)
      and (history.effective_from is null or history.effective_from < p_ended_at)
    order by history.effective_from nulls first, history.version
  loop
    v_segment_start := greatest(p_started_at, coalesce(v_history.effective_from, p_started_at));
    v_segment_end := least(p_ended_at, coalesce(v_history.effective_to, p_ended_at));

    if v_segment_start <> v_covered_until or v_segment_end <= v_segment_start then
      raise exception using errcode = '55000', message = 'Operational settings history has a gap or overlap.';
    end if;

    v_schedule := v_history.shift_schedule;
    v_grace := (v_schedule->>'rampUpGraceMinutes')::integer;

    if v_schedule ? 'restDays' and jsonb_typeof(v_schedule->'restDays') is distinct from 'array' then
      raise exception using errcode = '55000', message = 'Operational settings history is malformed.';
    end if;

    for v_day in
      select day_value::date
      from generate_series(
        (v_segment_start at time zone 'Asia/Manila')::date,
        ((v_segment_end - interval '1 microsecond') at time zone 'Asia/Manila')::date,
        interval '1 day'
      ) day_value
    loop
      v_calendar_is_working := null;
      select calendar.is_working
      into v_calendar_is_working
      from public.production_calendar_days calendar
      where calendar.machine_id = p_machine_id
        and calendar.calendar_date = v_day;

      if found then
        if not v_calendar_is_working then
          continue;
        end if;
      else
        v_weekday := case extract(isodow from v_day)::integer
          when 1 then 'monday'
          when 2 then 'tuesday'
          when 3 then 'wednesday'
          when 4 then 'thursday'
          when 5 then 'friday'
          when 6 then 'saturday'
          when 7 then 'sunday'
        end;

        if jsonb_typeof(v_schedule->'restDays') = 'array'
          and (v_schedule->'restDays') ? v_weekday then
          continue;
        end if;
      end if;

      v_work_start := (v_day + (v_schedule->>'workStart')::time) at time zone 'Asia/Manila';
      v_work_end := (v_day + (v_schedule->>'workEnd')::time) at time zone 'Asia/Manila';
      v_overlap_start := greatest(v_segment_start, v_work_start);
      v_overlap_end := least(v_segment_end, v_work_end);

      if v_overlap_end > v_overlap_start then
        v_seconds := v_seconds + extract(epoch from (v_overlap_end - v_overlap_start));

        for v_break in select value from jsonb_array_elements(v_schedule->'breaks')
        loop
          v_break_start := (v_day + (v_break->>'startTime')::time) at time zone 'Asia/Manila';
          v_break_end := (
            v_day + (v_break->>'endTime')::time + make_interval(mins => v_grace)
          ) at time zone 'Asia/Manila';

          if least(v_overlap_end, v_break_end) > greatest(v_overlap_start, v_break_start) then
            v_seconds := v_seconds - extract(epoch from (
              least(v_overlap_end, v_break_end) - greatest(v_overlap_start, v_break_start)
            ));
          end if;
        end loop;
      end if;
    end loop;

    v_covered_until := v_segment_end;
  end loop;

  if v_covered_until <> p_ended_at then
    raise exception using errcode = '55000', message = 'Operational settings history does not cover the interval.';
  end if;

  return greatest(0, floor(v_seconds))::bigint;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '55000', message = 'Operational settings history is malformed.';
end;
$$;

revoke all on table public.production_calendar_days
  from public, anon, authenticated, service_role;
grant select on table public.production_calendar_days
  to service_role;

revoke execute on function public.watchdog_eligible_seconds(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;

revoke all on function
  public.update_machine_operational_settings(uuid, bigint, jsonb, jsonb, uuid),
  public.get_seeded_production_holidays(),
  public.set_production_calendar_day(uuid, date, text, text, boolean, text, bigint, boolean, uuid),
  public.set_production_calendar_range(uuid, date, date, text, text, text, boolean, uuid, uuid),
  public.remove_production_calendar_day(uuid, date, uuid),
  public.remove_production_calendar_range(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated;

grant execute on function
  public.update_machine_operational_settings(uuid, bigint, jsonb, jsonb, uuid),
  public.get_seeded_production_holidays(),
  public.set_production_calendar_day(uuid, date, text, text, boolean, text, bigint, boolean, uuid),
  public.set_production_calendar_range(uuid, date, date, text, text, text, boolean, uuid, uuid),
  public.remove_production_calendar_day(uuid, date, uuid),
  public.remove_production_calendar_range(uuid, uuid, uuid, timestamptz)
  to service_role;

create or replace function public.get_backend_readiness_v58()
returns integer
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
begin
  if public.get_backend_readiness_v57() <> 57 then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  if to_regclass('public.idx_audit_logs_created_at') is null
    or to_regclass('public.idx_sensor_events_analytics_pulse') is null
    or to_regclass('public.idx_sensor_events_s05_accepted_ordered') is null
    or to_regprocedure('public.get_analytics_first_recorded_at(uuid)') is null then
    raise exception using errcode = '55000', message = 'Required query optimization indexes or functions are missing.';
  end if;

  return 58;
end;
$$;

create or replace function public.get_backend_readiness()
returns integer
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
begin
  if public.get_backend_readiness_v58() <> 58 then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  if to_regclass('public.production_calendar_days') is null
    or to_regprocedure('public.get_seeded_production_holidays()') is null
    or to_regprocedure('public.set_production_calendar_day(uuid,date,text,text,boolean,text,bigint,boolean,uuid)') is null
    or to_regprocedure('public.set_production_calendar_range(uuid,date,date,text,text,text,boolean,uuid,uuid)') is null
    or to_regprocedure('public.remove_production_calendar_day(uuid,date,uuid)') is null
    or to_regprocedure('public.remove_production_calendar_range(uuid,uuid,uuid,timestamptz)') is null
    or has_table_privilege('service_role', 'public.production_calendar_days', 'INSERT')
    or has_table_privilege('service_role', 'public.production_calendar_days', 'UPDATE')
    or has_table_privilege('service_role', 'public.production_calendar_days', 'DELETE') then
    raise exception using errcode = '55000', message = 'Required production calendar dependencies are missing.';
  end if;

  return 59;
end;
$$;

revoke all on function
  public.get_backend_readiness(),
  public.get_backend_readiness_v58()
  from public, anon, authenticated;
grant execute on function
  public.get_backend_readiness(),
  public.get_backend_readiness_v58()
  to service_role;

commit;
