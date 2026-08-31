-- Migration 008: Align sensor labels with canonical sensor-registry.json
begin;

-- Protect deployment pipeline against blocking on active IoT ingestion row locks
set local lock_timeout = '2s';

-- 1. Harmonize sensor labels
update public.sensors
set label = case sensor_code
  when 'S-01' then 'Raw Material & Coil Joint'
  when 'S-02' then 'Inside Filler Wire'
  when 'S-03' then 'Machine Main Sensor'
  when 'S-04' then 'Outside Filler Wire'
  when 'S-05' then 'Production Output Cutting'
  else label
end
where sensor_code in ('S-01', 'S-02', 'S-03', 'S-04', 'S-05')
  and label is distinct from (
    case sensor_code
      when 'S-01' then 'Raw Material & Coil Joint'
      when 'S-02' then 'Inside Filler Wire'
      when 'S-03' then 'Machine Main Sensor'
      when 'S-04' then 'Outside Filler Wire'
      when 'S-05' then 'Production Output Cutting'
      else label
    end
  );

commit;
