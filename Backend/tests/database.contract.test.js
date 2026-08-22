const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(backendRoot, relativePath), 'utf8')
}

test('migration 006 defines atomic, idempotent, service-role-only downtime operations', () => {
  const migration = read('database/migrations/006_downtime_open_record_unique_index.sql')

  assert.match(migration, /begin;/i)
  assert.match(migration, /having count\(\*\) > 1/i)
  assert.match(migration, /device_event_id uuid/i)
  assert.match(migration, /create unique index if not exists idx_sensor_events_device_event_id/i)
  assert.match(migration, /constraint downtime_state_fields_consistent/i)
  assert.match(migration, /function public\.ingest_iot_sensor_event/i)
  assert.match(migration, /Device event ID was reused with different event data/i)
  assert.match(migration, /for update/i)
  assert.match(migration, /function public\.get_downtime_summary/i)
  assert.match(migration, /function public\.update_downtime_record/i)
  assert.match(migration, /revoke execute[\s\S]*from public, anon, authenticated/i)
  assert.match(migration, /grant execute[\s\S]*to service_role/i)
  assert.match(migration, /commit;/i)
})

test('fresh schema includes the same downtime invariants and RPCs as migration 006', () => {
  const schema = read('database/schema.sql')

  assert.match(schema, /device_event_id uuid not null default gen_random_uuid\(\)/i)
  assert.match(schema, /constraint downtime_state_fields_consistent/i)
  assert.match(schema, /function public\.ingest_iot_sensor_event/i)
  assert.match(schema, /function public\.get_downtime_summary/i)
  assert.match(schema, /function public\.update_downtime_record/i)
  assert.match(schema, /idx_downtime_events_one_open_per_sensor/i)
})

test('migration 010 defines versioned service-role-only machine settings', () => {
  const migration = read('database/migrations/010_create_machine_operational_settings.sql')

  assert.match(migration, /begin;/i)
  assert.match(migration, /create table if not exists public\.machine_operational_settings/i)
  assert.match(migration, /version bigint not null default 1/i)
  assert.match(migration, /alter table public\.machine_operational_settings enable row level security/i)
  assert.match(migration, /function public\.update_machine_operational_settings/i)
  assert.match(migration, /for update/i)
  assert.match(migration, /Settings version conflict/i)
  assert.match(migration, /SETTINGS_UPDATED/i)
  assert.match(migration, /security definer/i)
  assert.match(migration, /revoke all on table[\s\S]*service_role/i)
  assert.match(migration, /grant select on table[\s\S]*to service_role/i)
  assert.match(migration, /revoke execute[\s\S]*from public, anon, authenticated/i)
  assert.match(migration, /grant execute[\s\S]*to service_role/i)
  assert.match(migration, /commit;/i)
})

test('fresh schema mirrors migration 010 machine settings storage and RPC', () => {
  const schema = read('database/schema.sql')
  const seed = read('database/seed.sql')

  assert.match(schema, /create table if not exists machine_operational_settings/i)
  assert.match(schema, /function public\.update_machine_operational_settings/i)
  assert.match(schema, /machine_settings_service_role_select/i)
  assert.match(seed, /insert into machine_operational_settings[\s\S]*machine_code = 'M-01'/i)
})
