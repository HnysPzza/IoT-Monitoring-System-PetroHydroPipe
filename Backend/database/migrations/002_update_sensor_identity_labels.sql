-- Phase 9 migration: align the 5 ESP32 sensor labels with the operational sensor identity map.
update sensors
set label = case sensor_code
  when 'S-01' then 'Raw Material Detection'
  when 'S-02' then 'Outside Filler'
  when 'S-03' then 'Coil Joint'
  when 'S-04' then 'Inside Filler'
  when 'S-05' then 'Production Output Cutting'
  else label
end
where sensor_code in ('S-01', 'S-02', 'S-03', 'S-04', 'S-05');
