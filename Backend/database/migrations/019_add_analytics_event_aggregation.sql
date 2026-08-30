begin;

set local lock_timeout = '2s';

create or replace function public.aggregate_analytics_sensor_events(
  p_machine_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_bucket_seconds integer
)
returns table (
  bucket_start timestamptz,
  sensor_code text,
  sensor_label text,
  event_count bigint
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if p_machine_id is null
    or p_started_at is null
    or p_ended_at is null
    or p_ended_at <= p_started_at
    or p_ended_at - p_started_at > interval '367 days'
    or p_bucket_seconds is null
    or (p_bucket_seconds <> 0 and (p_bucket_seconds < 3600 or p_bucket_seconds > 2678400)) then
    raise exception using errcode = '22023', message = 'Analytics aggregation inputs are invalid.';
  end if;

  return query
  select
    case
      when p_bucket_seconds = 0 then
        date_trunc('month', event.recorded_at at time zone 'Asia/Manila') at time zone 'Asia/Manila'
      else p_started_at
        + (
          floor(
            extract(epoch from (event.recorded_at - p_started_at))
            / p_bucket_seconds
          ) * p_bucket_seconds
        ) * interval '1 second'
    end as bucket_start,
    sensor.sensor_code,
    sensor.label as sensor_label,
    count(*)::bigint as event_count
  from public.sensor_events event
  join public.sensors sensor on sensor.id = event.sensor_id
  where event.machine_id = p_machine_id
    and event.event_type = 'pulse'
    and event.recorded_at >= p_started_at
    and event.recorded_at < p_ended_at
    and sensor.sensor_code in ('S-01', 'S-02', 'S-04', 'S-05')
  group by 1, sensor.sensor_code, sensor.label
  order by 1, sensor.sensor_code;
end;
$$;

revoke all on function public.aggregate_analytics_sensor_events(uuid, timestamptz, timestamptz, integer)
from public;
revoke execute on function public.aggregate_analytics_sensor_events(uuid, timestamptz, timestamptz, integer)
from anon, authenticated;
grant execute on function public.aggregate_analytics_sensor_events(uuid, timestamptz, timestamptz, integer)
to service_role;

commit;
