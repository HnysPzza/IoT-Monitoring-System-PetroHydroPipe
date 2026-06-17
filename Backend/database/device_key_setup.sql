-- PetroHydroPipe IoT Monitoring System
-- Phase 6 ESP32 device key setup.
--
-- Paste bcrypt hashes generated locally for each ESP32 device key.
-- Do not paste plaintext ESP32 keys into Supabase or this repository.

update sensors
set device_key_hash = case sensor_code
  when 'S-01' then 'PASTE_BCRYPT_HASH_FOR_S_01'
  when 'S-02' then 'PASTE_BCRYPT_HASH_FOR_S_02'
  when 'S-03' then 'PASTE_BCRYPT_HASH_FOR_S_03'
  when 'S-04' then 'PASTE_BCRYPT_HASH_FOR_S_04'
  when 'S-05' then 'PASTE_BCRYPT_HASH_FOR_S_05'
  else device_key_hash
end
where sensor_code in ('S-01', 'S-02', 'S-03', 'S-04', 'S-05');

-- Verify all five sensors are ready for ESP32 ingestion.
select sensor_code, esp32_device_id, device_key_hash is not null as has_device_key
from sensors
where sensor_code in ('S-01', 'S-02', 'S-03', 'S-04', 'S-05')
order by sensor_code;
