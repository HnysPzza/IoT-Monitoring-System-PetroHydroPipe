begin;

create table if not exists public.production_item_specs (
  sensor_event_id uuid primary key references public.sensor_events(id) on delete cascade,
  label text,
  size text,
  diameter numeric(10, 2),
  radius numeric(10, 2),
  circumference numeric(10, 2),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  constraint production_item_specs_label_valid check (label is null or (btrim(label) <> '' and char_length(label) <= 100)),
  constraint production_item_specs_size_valid check (size is null or (btrim(size) <> '' and char_length(size) <= 50)),
  constraint production_item_specs_diameter_positive check (diameter is null or diameter > 0),
  constraint production_item_specs_radius_positive check (radius is null or radius > 0),
  constraint production_item_specs_circumference_positive check (circumference is null or circumference > 0)
);

create index if not exists idx_production_item_specs_updated_by on public.production_item_specs(updated_by);
create index if not exists idx_sensor_events_s05_recorded_at on public.sensor_events(sensor_id, recorded_at desc, id desc) where event_type = 'pulse';
create index if not exists idx_sensor_events_s05_output_accepted on public.sensor_events(sensor_id, output_accepted, recorded_at desc) where event_type = 'pulse';

alter table public.production_item_specs enable row level security;
revoke all on table public.production_item_specs from public, anon, authenticated, service_role;
grant select on table public.production_item_specs to service_role;
drop policy if exists production_item_specs_service_role_select on public.production_item_specs;
create policy production_item_specs_service_role_select on public.production_item_specs for select to service_role using (true);

create or replace function public.update_production_log_spec(
  p_sensor_event_id uuid,
  p_label text,
  p_size text,
  p_diameter numeric,
  p_radius numeric,
  p_circumference numeric,
  p_actor_user_id uuid,
  p_expected_updated_at timestamptz default null
)
returns table (
  sensor_event_id uuid,
  label text,
  size text,
  diameter numeric,
  radius numeric,
  circumference numeric,
  updated_at timestamptz,
  updated_by uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_column
declare
  v_label text;
  v_size text;
  v_diameter numeric(10, 2);
  v_radius numeric(10, 2);
  v_circumference numeric(10, 2);
  v_event record;
  v_existing public.production_item_specs%rowtype;
  v_has_existing boolean := false;
  v_saved public.production_item_specs%rowtype;
begin
  if p_sensor_event_id is null then
    raise exception using errcode = '22023', message = 'Production event id is required.';
  end if;

  v_label := nullif(btrim(p_label), '');
  v_size := nullif(btrim(p_size), '');

  if v_label is not null and char_length(v_label) > 100 then
    raise exception using errcode = '22023', message = 'Specification label cannot exceed 100 characters.';
  end if;
  if v_size is not null and char_length(v_size) > 50 then
    raise exception using errcode = '22023', message = 'Specification size cannot exceed 50 characters.';
  end if;

  if p_diameter is not null then
    if p_diameter <> p_diameter or p_diameter <= 0 or round(p_diameter, 2) <= 0 or round(p_diameter, 2) > 99999999.99 then
      raise exception using errcode = '22023', message = 'Diameter must be greater than zero and at most 99999999.99.';
    end if;
    v_diameter := round(p_diameter, 2);
  else
    v_diameter := null;
  end if;

  if p_radius is not null then
    if p_radius <> p_radius or p_radius <= 0 or round(p_radius, 2) <= 0 or round(p_radius, 2) > 99999999.99 then
      raise exception using errcode = '22023', message = 'Radius must be greater than zero and at most 99999999.99.';
    end if;
    v_radius := round(p_radius, 2);
  else
    v_radius := null;
  end if;

  if p_circumference is not null then
    if p_circumference <> p_circumference or p_circumference <= 0 or round(p_circumference, 2) <= 0 or round(p_circumference, 2) > 99999999.99 then
      raise exception using errcode = '22023', message = 'Circumference must be greater than zero and at most 99999999.99.';
    end if;
    v_circumference := round(p_circumference, 2);
  else
    v_circumference := null;
  end if;

  select event.id, event.sensor_id, event.machine_id, event.event_type, event.output_accepted, event.recorded_at,
         sensor.sensor_code, machine.machine_code
  into v_event
  from public.sensor_events event
  join public.sensors sensor on sensor.id = event.sensor_id
  join public.machines machine on machine.id = event.machine_id
  where event.id = p_sensor_event_id
  for update of event;

  if not found then
    raise exception using errcode = 'P0002', message = 'Production log record not found.';
  end if;

  if v_event.sensor_code is distinct from 'S-05' or v_event.event_type is distinct from 'pulse' then
    raise exception using errcode = '22023', message = 'Specifications can only be assigned to S-05 production cut events.';
  end if;

  if v_event.output_accepted is not true then
    raise exception using errcode = '22023', message = 'Rejected production events are view-only and cannot be edited.';
  end if;

  select spec.* into v_existing
  from public.production_item_specs spec
  where spec.sensor_event_id = p_sensor_event_id
  for update;
  v_has_existing := found;

  if p_expected_updated_at is not null and (not v_has_existing or v_existing.updated_at is distinct from p_expected_updated_at) then
    raise exception using errcode = '40001', message = 'Production specification was modified by another user.';
  end if;

  if v_has_existing and (v_existing.label, v_existing.size, v_existing.diameter, v_existing.radius, v_existing.circumference)
    is not distinct from (v_label, v_size, v_diameter, v_radius, v_circumference) then
    return query select v_existing.sensor_event_id, v_existing.label, v_existing.size, v_existing.diameter, v_existing.radius, v_existing.circumference, v_existing.updated_at, v_existing.updated_by;
    return;
  end if;

  if not v_has_existing and v_label is null and v_size is null and v_diameter is null and v_radius is null and v_circumference is null then
    return query select p_sensor_event_id, null::text, null::text, null::numeric, null::numeric, null::numeric, null::timestamptz, null::uuid;
    return;
  end if;

  insert into public.production_item_specs (
    sensor_event_id, label, size, diameter, radius, circumference, updated_at, updated_by
  )
  values (
    p_sensor_event_id, v_label, v_size, v_diameter, v_radius, v_circumference, now(), p_actor_user_id
  )
  on conflict (sensor_event_id) do update set
    label = excluded.label,
    size = excluded.size,
    diameter = excluded.diameter,
    radius = excluded.radius,
    circumference = excluded.circumference,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by
  returning production_item_specs.* into v_saved;

  insert into public.audit_logs (
    user_id, action, entity_type, entity_id, metadata
  )
  values (
    p_actor_user_id,
    'PRODUCTION_SPEC_UPDATED',
    'sensor_event',
    p_sensor_event_id,
    jsonb_build_object(
      'sensorCode', v_event.sensor_code,
      'machineCode', v_event.machine_code,
      'recordedAt', v_event.recorded_at,
      'label', v_saved.label,
      'size', v_saved.size,
      'diameter', v_saved.diameter,
      'radius', v_saved.radius,
      'circumference', v_saved.circumference,
      'previous', case when v_has_existing then
        jsonb_build_object(
          'label', v_existing.label,
          'size', v_existing.size,
          'diameter', v_existing.diameter,
          'radius', v_existing.radius,
          'circumference', v_existing.circumference
        )
        else null end
    )
  );

  return query select v_saved.sensor_event_id, v_saved.label, v_saved.size, v_saved.diameter, v_saved.radius, v_saved.circumference, v_saved.updated_at, v_saved.updated_by;
end;
$$;

create or replace function public.batch_update_production_log_specs(
  p_sensor_event_ids uuid[],
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_only_unlabeled boolean,
  p_label text,
  p_size text,
  p_diameter numeric,
  p_radius numeric,
  p_circumference numeric,
  p_actor_user_id uuid
)
returns table (
  matched_count integer,
  updated_count integer,
  sensor_event_ids uuid[]
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_column
declare
  v_label text;
  v_size text;
  v_diameter numeric(10, 2);
  v_radius numeric(10, 2);
  v_circumference numeric(10, 2);
  v_has_ids boolean;
  v_has_window boolean;
  v_target_ids uuid[];
  v_candidate_ids uuid[];
  v_matched_count integer := 0;
  v_updated_count integer := 0;
  v_updated_ids uuid[] := '{}'::uuid[];
  v_target_event_id uuid;
  v_existing public.production_item_specs%rowtype;
  v_has_existing boolean;
  v_effective_label text;
  v_effective_size text;
  v_effective_diameter numeric(10, 2);
  v_effective_radius numeric(10, 2);
  v_effective_circumference numeric(10, 2);
begin
  v_label := nullif(btrim(p_label), '');
  v_size := nullif(btrim(p_size), '');

  if v_label is not null and char_length(v_label) > 100 then
    raise exception using errcode = '22023', message = 'Specification label cannot exceed 100 characters.';
  end if;
  if v_size is not null and char_length(v_size) > 50 then
    raise exception using errcode = '22023', message = 'Specification size cannot exceed 50 characters.';
  end if;

  if p_diameter is not null then
    if p_diameter <> p_diameter or p_diameter <= 0 or round(p_diameter, 2) <= 0 or round(p_diameter, 2) > 99999999.99 then
      raise exception using errcode = '22023', message = 'Diameter must be greater than zero and at most 99999999.99.';
    end if;
    v_diameter := round(p_diameter, 2);
  else
    v_diameter := null;
  end if;

  if p_radius is not null then
    if p_radius <> p_radius or p_radius <= 0 or round(p_radius, 2) <= 0 or round(p_radius, 2) > 99999999.99 then
      raise exception using errcode = '22023', message = 'Radius must be greater than zero and at most 99999999.99.';
    end if;
    v_radius := round(p_radius, 2);
  else
    v_radius := null;
  end if;

  if p_circumference is not null then
    if p_circumference <> p_circumference or p_circumference <= 0 or round(p_circumference, 2) <= 0 or round(p_circumference, 2) > 99999999.99 then
      raise exception using errcode = '22023', message = 'Circumference must be greater than zero and at most 99999999.99.';
    end if;
    v_circumference := round(p_circumference, 2);
  else
    v_circumference := null;
  end if;

  if v_label is null and v_size is null and v_diameter is null and v_radius is null and v_circumference is null then
    raise exception using errcode = '22023', message = 'Provide at least one specification field to update.';
  end if;

  v_has_ids := p_sensor_event_ids is not null and array_length(p_sensor_event_ids, 1) > 0;
  v_has_window := p_started_at is not null or p_ended_at is not null;

  if (v_has_ids and v_has_window) or (not v_has_ids and not v_has_window) then
    raise exception using errcode = '22023', message = 'Provide either a non-empty array of sensor event ids or a time range, but not both.';
  end if;

  if v_has_ids then
    if array_position(p_sensor_event_ids, null) is not null then
      raise exception using errcode = '22023', message = 'Sensor event ids cannot contain null values.';
    end if;

    select coalesce(array_agg(distinct id), '{}'::uuid[])
    into v_target_ids
    from unnest(p_sensor_event_ids) as id;

    if cardinality(v_target_ids) > 500 then
      raise exception using errcode = '22023', message = 'Batch specification update cannot exceed 500 records.';
    end if;

    select coalesce(array_agg(locked.id), '{}'::uuid[])
    into v_candidate_ids
    from (
      select event.id
      from public.sensor_events event
      where event.id = any(v_target_ids)
      order by event.recorded_at asc, event.id asc
      for update of event
    ) locked;

    if cardinality(v_candidate_ids) <> cardinality(v_target_ids) then
      raise exception using errcode = 'P0002', message = 'One or more production log records were not found.';
    end if;

    if exists (
      select 1
      from public.sensor_events event
      join public.sensors sensor on sensor.id = event.sensor_id
      where event.id = any(v_target_ids)
        and (sensor.sensor_code is distinct from 'S-05' or event.event_type is distinct from 'pulse')
    ) then
      raise exception using errcode = '22023', message = 'Specifications can only be assigned to S-05 production cut events.';
    end if;

    if exists (
      select 1
      from public.sensor_events event
      where event.id = any(v_target_ids)
        and event.output_accepted is not true
    ) then
      raise exception using errcode = '22023', message = 'Rejected production events are view-only and cannot be edited.';
    end if;

    if coalesce(p_only_unlabeled, false) then
      select coalesce(array_agg(unlabeled.id), '{}'::uuid[])
      into v_candidate_ids
      from (
        select event.id
        from unnest(v_candidate_ids) as event(id)
        left join public.production_item_specs spec on spec.sensor_event_id = event.id
        where spec.sensor_event_id is null
          or (spec.label is null and spec.size is null and spec.diameter is null and spec.radius is null and spec.circumference is null)
      ) unlabeled;
    end if;

    v_matched_count := cardinality(v_candidate_ids);
  else
    if p_started_at is null or p_ended_at is null or p_started_at >= p_ended_at then
      raise exception using errcode = '22023', message = 'A valid time range with started_at earlier than ended_at is required.';
    end if;

    select coalesce(array_agg(candidate.id order by candidate.recorded_at asc, candidate.id asc), '{}'::uuid[])
    into v_candidate_ids
    from (
      select event.id, event.recorded_at
      from public.sensor_events event
      join public.sensors sensor on sensor.id = event.sensor_id
      left join public.production_item_specs spec on spec.sensor_event_id = event.id
      where sensor.sensor_code = 'S-05'
        and event.event_type = 'pulse'
        and event.output_accepted is true
        and event.recorded_at >= p_started_at
        and event.recorded_at <= p_ended_at
        and (
          not coalesce(p_only_unlabeled, false)
          or spec.sensor_event_id is null
          or (spec.label is null and spec.size is null and spec.diameter is null and spec.radius is null and spec.circumference is null)
        )
      order by event.recorded_at asc, event.id asc
      limit 501
      for update of event
    ) candidate;

    if cardinality(v_candidate_ids) > 500 then
      raise exception using errcode = '22023', message = 'Batch specification update cannot exceed 500 records.';
    end if;

    v_matched_count := cardinality(v_candidate_ids);
  end if;

  if v_matched_count > 0 then
    for v_target_event_id in select unnest(v_candidate_ids) loop
      v_existing := null;
      select spec.* into v_existing
      from public.production_item_specs spec
      where spec.sensor_event_id = v_target_event_id
      for update;
      v_has_existing := found;

      if coalesce(p_only_unlabeled, false) and v_has_existing and not (
        v_existing.label is null and v_existing.size is null and v_existing.diameter is null and v_existing.radius is null and v_existing.circumference is null
      ) then
        continue;
      end if;

      v_effective_label := coalesce(v_label, case when v_has_existing then v_existing.label else null end);
      v_effective_size := coalesce(v_size, case when v_has_existing then v_existing.size else null end);
      v_effective_diameter := coalesce(v_diameter, case when v_has_existing then v_existing.diameter else null end);
      v_effective_radius := coalesce(v_radius, case when v_has_existing then v_existing.radius else null end);
      v_effective_circumference := coalesce(v_circumference, case when v_has_existing then v_existing.circumference else null end);

      if not v_has_existing or (
        (v_existing.label, v_existing.size, v_existing.diameter, v_existing.radius, v_existing.circumference)
        is distinct from
        (v_effective_label, v_effective_size, v_effective_diameter, v_effective_radius, v_effective_circumference)
      ) then
        insert into public.production_item_specs (
          sensor_event_id, label, size, diameter, radius, circumference, updated_at, updated_by
        )
        values (
          v_target_event_id, v_effective_label, v_effective_size, v_effective_diameter, v_effective_radius, v_effective_circumference, now(), p_actor_user_id
        )
        on conflict (sensor_event_id) do update set
          label = excluded.label,
          size = excluded.size,
          diameter = excluded.diameter,
          radius = excluded.radius,
          circumference = excluded.circumference,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by;

        v_updated_count := v_updated_count + 1;
        v_updated_ids := array_append(v_updated_ids, v_target_event_id);
      end if;
    end loop;
  end if;

  if v_updated_count > 0 then
    insert into public.audit_logs (
      user_id, action, entity_type, entity_id, metadata
    )
    values (
      p_actor_user_id,
      'PRODUCTION_SPEC_BATCH_UPDATED',
      'sensor_event',
      case when array_length(v_updated_ids, 1) = 1 then v_updated_ids[1] else null end,
      jsonb_build_object(
        'sensorCode', 'S-05',
        'matchedCount', v_matched_count,
        'updatedCount', v_updated_count,
        'onlyUnlabeled', coalesce(p_only_unlabeled, false),
        'sensorEventIds', to_jsonb(v_updated_ids),
        'appliedSpec', jsonb_strip_nulls(jsonb_build_object(
          'label', v_label,
          'size', v_size,
          'diameter', v_diameter,
          'radius', v_radius,
          'circumference', v_circumference
        ))
      )
    );
  end if;

  return query select v_matched_count, v_updated_count, v_updated_ids;
end;
$$;

do $$
begin
  if to_regprocedure('public.get_backend_readiness_v48()') is null then
    alter function public.get_backend_readiness() rename to get_backend_readiness_v48;
  end if;
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
  if public.get_backend_readiness_v48() <> 48 then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  if to_regclass('public.production_item_specs') is null
    or to_regprocedure('public.update_production_log_spec(uuid,text,text,numeric,numeric,numeric,uuid,timestamptz)') is null
    or to_regprocedure('public.batch_update_production_log_specs(uuid[],timestamptz,timestamptz,boolean,text,text,numeric,numeric,numeric,uuid)') is null then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  return 49;
end;
$$;

revoke all on function public.update_production_log_spec(uuid,text,text,numeric,numeric,numeric,uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.update_production_log_spec(uuid,text,text,numeric,numeric,numeric,uuid,timestamptz)
  to service_role;

revoke all on function public.batch_update_production_log_specs(uuid[],timestamptz,timestamptz,boolean,text,text,numeric,numeric,numeric,uuid)
  from public, anon, authenticated;
grant execute on function public.batch_update_production_log_specs(uuid[],timestamptz,timestamptz,boolean,text,text,numeric,numeric,numeric,uuid)
  to service_role;

revoke all on function public.get_backend_readiness(), public.get_backend_readiness_v48()
  from public, anon, authenticated;
grant execute on function public.get_backend_readiness(), public.get_backend_readiness_v48()
  to service_role;

commit;
