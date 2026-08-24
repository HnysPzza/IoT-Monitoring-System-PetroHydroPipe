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

test('migration 011 defines effective settings history and bounded heartbeat runtime', () => {
  const migration = read('database/migrations/011_add_settings_history_and_watchdog_runtime.sql')

  assert.match(migration, /begin;/i)
  assert.match(migration, /machine_operational_settings_history/i)
  assert.match(migration, /sensor_watchdog_state/i)
  assert.match(migration, /sensor_watchdog_transitions/i)
  assert.match(migration, /idx_machine_settings_history_current/i)
  assert.match(migration, /Settings audit history is not contiguous/i)
  assert.match(migration, /function public\.ingest_iot_heartbeat/i)
  assert.match(migration, /Heartbeat sequence was reused with different content/i)
  assert.match(migration, /clock_timestamp\(\)/i)
  assert.match(migration, /revoke all on table public\.sensor_watchdog_state[\s\S]*service_role/i)
  assert.match(migration, /grant execute on function public\.ingest_iot_heartbeat[\s\S]*to service_role/i)
  assert.match(migration, /commit;/i)
})

test('fresh schema and seed mirror migration 011 runtime storage and RPC', () => {
  const schema = read('database/schema.sql')
  const seed = read('database/seed.sql')

  for (const table of [
    'machine_operational_settings_history',
    'sensor_watchdog_state',
    'sensor_watchdog_transitions',
  ]) {
    assert.match(schema, new RegExp(`create table if not exists ${table}`, 'i'))
  }
  assert.match(schema, /function public\.ingest_iot_heartbeat/i)
  assert.match(schema, /extensions\.digest\(convert_to/i)
  assert.match(schema, /Current settings history is missing/i)
  assert.match(seed, /insert into machine_operational_settings_history/i)
  assert.match(seed, /insert into sensor_watchdog_state/i)
})

test('migration 013 repairs Supabase heartbeat hashing without broadening the search path', () => {
  const migration = read('database/migrations/013_fix_heartbeat_digest_schema.sql')

  assert.match(migration, /begin;/i)
  assert.match(migration, /requires migration 011/i)
  assert.match(migration, /extensions\.digest\(bytea,text\)/i)
  assert.match(migration, /extensions\.digest\(convert_to/i)
  assert.match(migration, /set search_path = pg_catalog, public/i)
  assert.match(migration, /revoke execute[\s\S]*anon, authenticated/i)
  assert.match(migration, /grant execute[\s\S]*service_role/i)
  assert.match(migration, /commit;/i)
})

test('migration 012 defines guarded event ownership and atomic watchdog evaluation', () => {
  const migration = read('database/migrations/012_add_atomic_watchdog_transitions.sql')

  assert.match(migration, /detection_source/i)
  assert.match(migration, /absence_watchdog/i)
  assert.match(migration, /watchdog_eligible_seconds/i)
  assert.match(migration, /watchdog_advance_eligible_time/i)
  assert.match(migration, /ingest_iot_sensor_event_legacy/i)
  assert.match(migration, /ingest_iot_watchdog_observation/i)
  assert.match(migration, /evaluate_sensor_watchdog/i)
  assert.match(migration, /p_mode not in \('disabled', 'observe', 'enforce'\)/i)
  assert.match(migration, /sensor\.sensor_code <> 'S-05'/i)
  assert.match(migration, /revoke execute on function public\.evaluate_sensor_watchdog[\s\S]*authenticated/i)
  assert.match(migration, /grant execute on function public\.evaluate_sensor_watchdog[\s\S]*service_role/i)
})

test('fresh schema mirrors migration 012 downtime ownership and watchdog RPCs', () => {
  const schema = read('database/schema.sql')

  assert.match(schema, /detection_source text not null default 'sensor_event'/i)
  assert.match(schema, /settings_version bigint/i)
  assert.match(schema, /recovery_observation_count integer not null default 0/i)
  assert.match(schema, /function public\.watchdog_eligible_seconds/i)
  assert.match(schema, /function public\.ingest_iot_watchdog_observation/i)
  assert.match(schema, /function public\.evaluate_sensor_watchdog/i)
})

test('migration 014 defines one service-role-only batched watchdog cycle', () => {
  const migration = read('database/migrations/014_add_batched_watchdog_evaluation.sql')
  const schema = read('database/schema.sql')

  for (const content of [migration, schema]) {
    assert.match(content, /function public\.evaluate_watchdog_cycle/i)
    assert.match(content, /public\.evaluate_sensor_watchdog/i)
    assert.match(content, /order by machine\.machine_code, sensor\.sensor_code/i)
    assert.match(content, /WATCHDOG_EVALUATION_FAILED/i)
    assert.match(content, /set search_path = pg_catalog, public/i)
    assert.match(content, /revoke execute[\s\S]*anon, authenticated/i)
    assert.match(content, /grant execute[\s\S]*service_role/i)
  }
})

test('migration 015 defines one service-role-only live monitoring snapshot', () => {
  const migration = read('database/migrations/015_add_live_monitoring_snapshot.sql')
  const schema = read('database/schema.sql')

  for (const content of [migration, schema]) {
    assert.match(content, /function public\.get_machine_live_snapshot/i)
    assert.match(content, /left join lateral[\s\S]*order by event\.recorded_at desc[\s\S]*limit 1/i)
    assert.match(content, /revoke execute on function public\.get_machine_live_snapshot\(text\)[\s\S]*authenticated/i)
    assert.match(content, /grant execute on function public\.get_machine_live_snapshot\(text\)[\s\S]*service_role/i)
  }
})

test('migration 016 and fresh schema protect every base table from client roles', () => {
  const migration = read('database/migrations/016_protect_base_tables.sql')
  const schema = read('database/schema.sql')
  const baseTables = [
    'roles',
    'users',
    'machines',
    'sensors',
    'sensor_events',
    'downtime_events',
    'production_counts',
    'audit_logs',
    'alerts',
  ]

  for (const content of [migration, schema]) {
    for (const table of baseTables) {
      assert.match(content, new RegExp(`alter table (?:public\\.)?${table} enable row level security`, 'i'))
      assert.match(content, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated, service_role`, 'i'))
    }
  }

  assert.match(migration, /grant select, insert, update on table public\.users to service_role/i)
  assert.match(migration, /grant select, update on table public\.machines to service_role/i)
  assert.match(migration, /grant select, update on table public\.sensors to service_role/i)
  assert.match(migration, /grant select, insert on table public\.audit_logs to service_role/i)
  assert.doesNotMatch(migration, /grant[^;]*delete[^;]*to service_role/i)
  assert.match(migration, /commit;/i)
})

test('migration 018 and fresh schema define the guarded manual recovery override', () => {
  const migration = read('database/migrations/018_add_manual_sensor_recovery_override.sql')
  const schema = read('database/schema.sql')

  for (const content of [migration, schema]) {
    assert.match(content, /function public\.override_sensor_recovery/i)
    assert.match(content, /p_reason text/i)
    assert.match(content, /SENSOR_MANUAL_RECOVERY_OVERRIDE/i)
    assert.match(content, /recoveryPending/i)
    assert.match(content, /security definer/i)
    assert.match(content, /revoke execute[\s\S]*anon, authenticated/i)
    assert.match(content, /grant execute[\s\S]*service_role/i)
  }
})
