begin;

-- 1. Add optional explicit tonnage column to public.production_item_specs
alter table public.production_item_specs
  add column if not exists tonnage numeric(12, 4);

-- 2. Add positive check constraint for tonnage idempotently
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'production_item_specs_tonnage_positive') then
    alter table public.production_item_specs
      add constraint production_item_specs_tonnage_positive
      check (tonnage is null or tonnage > 0);
  end if;
end;
$$;

-- 3. Drop legacy 8-arg and 9-arg RPC signatures before replacing with tonnage-aware signatures
drop function if exists public.update_production_log_spec(uuid, text, numeric, numeric, numeric, integer, uuid, timestamptz);
drop function if exists public.batch_update_production_log_specs(uuid[], timestamptz, timestamptz, boolean, text, numeric, numeric, numeric, uuid);

-- 4. Implement public.update_production_log_spec with optional p_tonnage override
create or replace function public.update_production_log_spec(
  p_sensor_event_id uuid,
  p_customer text,
  p_diameter numeric,
  p_thickness numeric,
  p_length numeric,
  p_pipe_number integer,
  p_actor_user_id uuid default null,
  p_expected_updated_at timestamptz default null,
  p_tonnage numeric default null
)
returns table (
  sensor_event_id uuid,
  customer text,
  diameter numeric,
  thickness numeric,
  length numeric,
  pipe_number integer,
  tonnage numeric,
  label text,
  size text,
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
  v_customer text;
  v_diameter numeric(10, 2);
  v_thickness numeric(10, 2);
  v_length numeric(10, 2);
  v_pipe_number integer;
  v_tonnage numeric(12, 4);
  v_event record;
  v_existing public.production_item_specs%rowtype;
  v_has_existing boolean := false;
  v_saved public.production_item_specs%rowtype;
begin
  if p_sensor_event_id is null then
    raise exception using errcode = '22023', message = 'Production event id is required.';
  end if;

  v_customer := nullif(btrim(p_customer), '');

  if v_customer is not null and char_length(v_customer) > 100 then
    raise exception using errcode = '22023', message = 'Customer name cannot exceed 100 characters.';
  end if;

  if p_diameter is not null then
    if p_diameter <> p_diameter or p_diameter <= 0 or round(p_diameter, 2) <= 0 or round(p_diameter, 2) > 99999999.99 then
      raise exception using errcode = '22023', message = 'Diameter must be greater than zero and at most 99999999.99.';
    end if;
    v_diameter := round(p_diameter, 2);
  else
    v_diameter := null;
  end if;

  if p_thickness is not null then
    if p_thickness <> p_thickness or p_thickness <= 0 or round(p_thickness, 2) <= 0 or round(p_thickness, 2) > 99999999.99 then
      raise exception using errcode = '22023', message = 'Thickness must be greater than zero and at most 99999999.99.';
    end if;
    v_thickness := round(p_thickness, 2);
  else
    v_thickness := null;
  end if;

  if p_length is not null then
    if p_length <> p_length or p_length <= 0 or round(p_length, 2) <= 0 or round(p_length, 2) > 99999999.99 then
      raise exception using errcode = '22023', message = 'Length must be greater than zero and at most 99999999.99.';
    end if;
    v_length := round(p_length, 2);
  else
    v_length := null;
  end if;

  if p_pipe_number is not null then
    if p_pipe_number <= 0 then
      raise exception using errcode = '22023', message = 'Pipe number must be greater than zero.';
    end if;
    v_pipe_number := p_pipe_number;
  else
    v_pipe_number := null;
  end if;

  if p_tonnage is not null then
    if p_tonnage <> p_tonnage or p_tonnage <= 0 or round(p_tonnage, 4) <= 0 or round(p_tonnage, 4) > 99999999.99 then
      raise exception using errcode = '22023', message = 'Tonnage must be greater than zero and at most 99999999.99.';
    end if;
    v_tonnage := round(p_tonnage, 4);
  else
    v_tonnage := null;
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

  if v_has_existing and (v_existing.customer, v_existing.diameter, v_existing.thickness, v_existing.length, v_existing.pipe_number, v_existing.tonnage)
    is not distinct from (v_customer, v_diameter, v_thickness, v_length, v_pipe_number, v_tonnage) then
    return query select v_existing.sensor_event_id, v_existing.customer, v_existing.diameter, v_existing.thickness, v_existing.length, v_existing.pipe_number, v_existing.tonnage, v_existing.label, v_existing.size, v_existing.radius, v_existing.circumference, v_existing.updated_at, v_existing.updated_by;
    return;
  end if;

  if not v_has_existing and v_customer is null and v_diameter is null and v_thickness is null and v_length is null and v_pipe_number is null and v_tonnage is null then
    return query select p_sensor_event_id, null::text, null::numeric, null::numeric, null::numeric, null::integer, null::numeric, null::text, null::text, null::numeric, null::numeric, null::timestamptz, null::uuid;
    return;
  end if;

  insert into public.production_item_specs (
    sensor_event_id, customer, diameter, thickness, length, pipe_number, tonnage, updated_at, updated_by
  )
  values (
    p_sensor_event_id, v_customer, v_diameter, v_thickness, v_length, v_pipe_number, v_tonnage, now(), p_actor_user_id
  )
  on conflict (sensor_event_id) do update set
    customer = excluded.customer,
    diameter = excluded.diameter,
    thickness = excluded.thickness,
    length = excluded.length,
    pipe_number = excluded.pipe_number,
    tonnage = excluded.tonnage,
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
      'customer', v_saved.customer,
      'diameter', v_saved.diameter,
      'thickness', v_saved.thickness,
      'length', v_saved.length,
      'pipeNumber', v_saved.pipe_number,
      'tonnage', v_saved.tonnage,
      'previous', case when v_has_existing then
        jsonb_build_object(
          'customer', v_existing.customer,
          'diameter', v_existing.diameter,
          'thickness', v_existing.thickness,
          'length', v_existing.length,
          'pipeNumber', v_existing.pipe_number,
          'tonnage', v_existing.tonnage
        )
        else null end
    )
  );

  return query select v_saved.sensor_event_id, v_saved.customer, v_saved.diameter, v_saved.thickness, v_saved.length, v_saved.pipe_number, v_saved.tonnage, v_saved.label, v_saved.size, v_saved.radius, v_saved.circumference, v_saved.updated_at, v_saved.updated_by;
end;
$$;

-- 5. Implement public.batch_update_production_log_specs with optional p_tonnage override
create or replace function public.batch_update_production_log_specs(
  p_sensor_event_ids uuid[] default null,
  p_started_at timestamptz default null,
  p_ended_at timestamptz default null,
  p_only_unlabeled boolean default false,
  p_customer text default null,
  p_diameter numeric default null,
  p_thickness numeric default null,
  p_length numeric default null,
  p_actor_user_id uuid default null,
  p_tonnage numeric default null
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
  v_customer text;
  v_diameter numeric(10, 2);
  v_thickness numeric(10, 2);
  v_length numeric(10, 2);
  v_tonnage numeric(12, 4);
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
  v_effective_customer text;
  v_effective_diameter numeric(10, 2);
  v_effective_thickness numeric(10, 2);
  v_effective_length numeric(10, 2);
  v_effective_tonnage numeric(12, 4);
begin
  v_customer := nullif(btrim(p_customer), '');

  if v_customer is not null and char_length(v_customer) > 100 then
    raise exception using errcode = '22023', message = 'Customer name cannot exceed 100 characters.';
  end if;

  if p_diameter is not null then
    if p_diameter <> p_diameter or p_diameter <= 0 or round(p_diameter, 2) <= 0 or round(p_diameter, 2) > 99999999.99 then
      raise exception using errcode = '22023', message = 'Diameter must be greater than zero and at most 99999999.99.';
    end if;
    v_diameter := round(p_diameter, 2);
  else
    v_diameter := null;
  end if;

  if p_thickness is not null then
    if p_thickness <> p_thickness or p_thickness <= 0 or round(p_thickness, 2) <= 0 or round(p_thickness, 2) > 99999999.99 then
      raise exception using errcode = '22023', message = 'Thickness must be greater than zero and at most 99999999.99.';
    end if;
    v_thickness := round(p_thickness, 2);
  else
    v_thickness := null;
  end if;

  if p_length is not null then
    if p_length <> p_length or p_length <= 0 or round(p_length, 2) <= 0 or round(p_length, 2) > 99999999.99 then
      raise exception using errcode = '22023', message = 'Length must be greater than zero and at most 99999999.99.';
    end if;
    v_length := round(p_length, 2);
  else
    v_length := null;
  end if;

  if p_tonnage is not null then
    if p_tonnage <> p_tonnage or p_tonnage <= 0 or round(p_tonnage, 4) <= 0 or round(p_tonnage, 4) > 99999999.99 then
      raise exception using errcode = '22023', message = 'Tonnage must be greater than zero and at most 99999999.99.';
    end if;
    v_tonnage := round(p_tonnage, 4);
  else
    v_tonnage := null;
  end if;

  if v_customer is null and v_diameter is null and v_thickness is null and v_length is null and v_tonnage is null then
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
          or (spec.customer is null and spec.diameter is null and spec.thickness is null and spec.length is null and spec.pipe_number is null and spec.tonnage is null and spec.label is null and spec.size is null)
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
          or (spec.customer is null and spec.diameter is null and spec.thickness is null and spec.length is null and spec.pipe_number is null and spec.tonnage is null and spec.label is null and spec.size is null)
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
        v_existing.customer is null and v_existing.diameter is null and v_existing.thickness is null and v_existing.length is null and v_existing.pipe_number is null and v_existing.tonnage is null and v_existing.label is null and v_existing.size is null
      ) then
        continue;
      end if;

      v_effective_customer := coalesce(v_customer, case when v_has_existing then v_existing.customer else null end);
      v_effective_diameter := coalesce(v_diameter, case when v_has_existing then v_existing.diameter else null end);
      v_effective_thickness := coalesce(v_thickness, case when v_has_existing then v_existing.thickness else null end);
      v_effective_length := coalesce(v_length, case when v_has_existing then v_existing.length else null end);

      if v_tonnage is not null then
        v_effective_tonnage := v_tonnage;
      elsif v_diameter is not null or v_thickness is not null or v_length is not null then
        v_effective_tonnage := null;
      else
        v_effective_tonnage := case when v_has_existing then v_existing.tonnage else null end;
      end if;

      if not v_has_existing or (
        (v_existing.customer, v_existing.diameter, v_existing.thickness, v_existing.length, v_existing.tonnage)
        is distinct from
        (v_effective_customer, v_effective_diameter, v_effective_thickness, v_effective_length, v_effective_tonnage)
      ) then
        insert into public.production_item_specs (
          sensor_event_id, customer, diameter, thickness, length, pipe_number, tonnage, updated_at, updated_by
        )
        values (
          v_target_event_id,
          v_effective_customer,
          v_effective_diameter,
          v_effective_thickness,
          v_effective_length,
          case when v_has_existing then v_existing.pipe_number else null end,
          v_effective_tonnage,
          now(),
          p_actor_user_id
        )
        on conflict (sensor_event_id) do update set
          customer = excluded.customer,
          diameter = excluded.diameter,
          thickness = excluded.thickness,
          length = excluded.length,
          tonnage = excluded.tonnage,
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
          'customer', v_customer,
          'diameter', v_diameter,
          'thickness', v_thickness,
          'length', v_length,
          'tonnage', v_tonnage
        ))
      )
    );
  end if;

  return query select v_matched_count, v_updated_count, v_updated_ids;
end;
$$;

-- 6. Readiness bump: chain from v52 to v53
-- Update get_backend_readiness_v51 so it does not require the dropped 8-arg and 9-arg signatures
create or replace function public.get_backend_readiness_v51()
returns integer
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
begin
  if public.get_backend_readiness_v50() <> 50 then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  if to_regclass('public.production_item_specs') is null then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  return 51;
end;
$$;

do $$
begin
  if to_regprocedure('public.get_backend_readiness_v52()') is null then
    alter function public.get_backend_readiness() rename to get_backend_readiness_v52;
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
  if public.get_backend_readiness_v52() <> 52 then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  if to_regclass('public.production_item_specs') is null
    or not exists (
      select 1
      from pg_attribute
      where attrelid = 'public.production_item_specs'::regclass
        and attname = 'tonnage'
        and not attisdropped
    )
    or to_regprocedure('public.update_production_log_spec(uuid,text,numeric,numeric,numeric,integer,uuid,timestamptz,numeric)') is null
    or to_regprocedure('public.batch_update_production_log_specs(uuid[],timestamptz,timestamptz,boolean,text,numeric,numeric,numeric,uuid,numeric)') is null then
    raise exception using errcode = '55000', message = 'Required database dependencies are missing.';
  end if;

  return 53;
end;
$$;

-- 7. Execution grants: exclusively service_role
revoke all on function public.update_production_log_spec(uuid,text,numeric,numeric,numeric,integer,uuid,timestamptz,numeric)
  from public, anon, authenticated;
grant execute on function public.update_production_log_spec(uuid,text,numeric,numeric,numeric,integer,uuid,timestamptz,numeric)
  to service_role;

revoke all on function public.batch_update_production_log_specs(uuid[],timestamptz,timestamptz,boolean,text,numeric,numeric,numeric,uuid,numeric)
  from public, anon, authenticated;
grant execute on function public.batch_update_production_log_specs(uuid[],timestamptz,timestamptz,boolean,text,numeric,numeric,numeric,uuid,numeric)
  to service_role;

revoke all on function public.get_backend_readiness(), public.get_backend_readiness_v52(), public.get_backend_readiness_v51()
  from public, anon, authenticated;
grant execute on function public.get_backend_readiness(), public.get_backend_readiness_v52(), public.get_backend_readiness_v51()
  to service_role;

commit;
