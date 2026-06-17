-- Phase 6 migration: add backend-only ESP32 device key hashes.
alter table sensors
add column if not exists device_key_hash text;
