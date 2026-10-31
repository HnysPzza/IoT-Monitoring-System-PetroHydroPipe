const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '../database')

async function database(t, migrationEnd = 50) {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  t.after(() => db.close())
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  await db.exec(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'))
  await db.exec(fs.readFileSync(path.join(root, 'seed.sql'), 'utf8'))
  await db.query(`insert into users(name, username, password_hash, role_id)
    select 'Absence Admin', 'absence-admin', 'hash', id from roles where name='Admin'`)

  const migrationFiles = fs.readdirSync(path.join(root, 'migrations'))
    .filter((name) => {
      const match = /^(\d{3})_.*\.sql$/.exec(name)
      return match && Number(match[1]) >= 29 && Number(match[1]) <= migrationEnd
    })
    .sort()

  for (const name of migrationFiles) {
    await db.exec(fs.readFileSync(path.join(root, 'migrations', name), 'utf8'))
  }

  return db
}

test('S-01 enters grace and Inactive status when absence detection is enabled with stale past activity', async (t) => {
  const db = await database(t)

  const { rows: [settings] } = await db.query('select * from machine_operational_settings limit 1')
  settings.sensor_thresholds['S-01'] = {
    absenceDetectionEnabled: false,
    triggerSeconds: 15,
    recoverySeconds: 10,
  }
  await db.query(
    'select * from update_machine_operational_settings($1,$2,$3::jsonb,$4::jsonb,null)',
    [settings.machine_id, settings.version, JSON.stringify(settings.sensor_thresholds), JSON.stringify(settings.shift_schedule)],
  )

  const { rows: [sensor] } = await db.query("select id from sensors where sensor_code = 'S-01'")

  await db.query(`
    update sensor_watchdog_state
    set last_heartbeat_id = gen_random_uuid(),
        last_heartbeat_payload_hash = 'absence-fixture',
        last_heartbeat_received_at = '2026-08-21T01:00:00Z',
        last_activity_received_at = '2026-08-21T00:00:00Z',
        connectivity_state = 'online',
        detection_state = 'disabled',
        absence_baseline_at = null
    where sensor_id = $1
  `, [sensor.id])

  const { rows: [updatedSettings] } = await db.query('select * from machine_operational_settings limit 1')
  updatedSettings.sensor_thresholds['S-01'] = {
    absenceDetectionEnabled: true,
    triggerSeconds: 15,
    recoverySeconds: 10,
  }
  await db.query(
    'select * from update_machine_operational_settings($1,$2,$3::jsonb,$4::jsonb,null)',
    [updatedSettings.machine_id, updatedSettings.version, JSON.stringify(updatedSettings.sensor_thresholds), JSON.stringify(updatedSettings.shift_schedule)],
  )

  const tick1 = (await db.query(
    'select * from evaluate_sensor_watchdog($1, $2, $3, 300)',
    [sensor.id, '2026-08-21T01:00:00Z', 'enforce'],
  )).rows[0]

  assert.equal(tick1.detection_state, 'healthy', 'Initial tick on enabling detection must establish healthy baseline')

  const tick2 = (await db.query(
    'select * from evaluate_sensor_watchdog($1, $2, $3, 300)',
    [sensor.id, '2026-08-21T01:00:05Z', 'enforce'],
  )).rows[0]

  assert.equal(tick2.detection_state, 'grace', 'Detection state at 5s must be grace')

  const sensorAfterGrace = (await db.query('select status, fault_source from sensors where id = $1', [sensor.id])).rows[0]
  assert.equal(sensorAfterGrace.status, 'Inactive', 'Sensor status during grace must be Inactive (Idle)')
  assert.equal(sensorAfterGrace.fault_source, null)

  const tick3 = (await db.query(
    'select * from evaluate_sensor_watchdog($1, $2, $3, 300)',
    [sensor.id, '2026-08-21T01:00:15Z', 'enforce'],
  )).rows[0]

  assert.equal(tick3.detection_state, 'downtime', 'Detection state at 15s must transition to downtime')

  const sensorAfterDowntime = (await db.query('select status, fault_source from sensors where id = $1', [sensor.id])).rows[0]
  assert.equal(sensorAfterDowntime.status, 'Fault', 'Sensor status after trigger limit must be Fault')
  assert.equal(sensorAfterDowntime.fault_source, 'absence_watchdog')
})

test('enabling absence detection resets baseline even if prior state had dirty non-null baseline', async (t) => {
  const db = await database(t)

  const { rows: [settings] } = await db.query('select * from machine_operational_settings limit 1')
  settings.sensor_thresholds['S-01'] = {
    absenceDetectionEnabled: false,
    triggerSeconds: 15,
    recoverySeconds: 10,
  }
  await db.query(
    'select * from update_machine_operational_settings($1,$2,$3::jsonb,$4::jsonb,null)',
    [settings.machine_id, settings.version, JSON.stringify(settings.sensor_thresholds), JSON.stringify(settings.shift_schedule)],
  )

  const { rows: [sensor] } = await db.query("select id from sensors where sensor_code = 'S-01'")

  // Populate dirty non-null absence_baseline_at from a stale prior session
  await db.query(`
    update sensor_watchdog_state
    set last_heartbeat_id = gen_random_uuid(),
        last_heartbeat_payload_hash = 'absence-dirty-fixture',
        last_heartbeat_received_at = '2026-08-21T01:00:00Z',
        last_activity_received_at = '2026-08-20T00:00:00Z',
        connectivity_state = 'online',
        detection_state = 'disabled',
        absence_baseline_at = '2026-08-20T00:00:00Z'
    where sensor_id = $1
  `, [sensor.id])

  const { rows: [updatedSettings] } = await db.query('select * from machine_operational_settings limit 1')
  updatedSettings.sensor_thresholds['S-01'] = {
    absenceDetectionEnabled: true,
    triggerSeconds: 15,
    recoverySeconds: 10,
  }
  await db.query(
    'select * from update_machine_operational_settings($1,$2,$3::jsonb,$4::jsonb,null)',
    [updatedSettings.machine_id, updatedSettings.version, JSON.stringify(updatedSettings.sensor_thresholds), JSON.stringify(updatedSettings.shift_schedule)],
  )

  const tick1 = (await db.query(
    'select * from evaluate_sensor_watchdog($1, $2, $3, 300)',
    [sensor.id, '2026-08-21T01:00:00Z', 'enforce'],
  )).rows[0]

  assert.equal(tick1.detection_state, 'healthy', 'Dirty non-null baseline must be overwritten on enable')
})

test('observe mode records healthy then grace then downtime without mutating sensor status or creating downtime', async (t) => {
  const db = await database(t)

  const { rows: [settings] } = await db.query('select * from machine_operational_settings limit 1')
  settings.sensor_thresholds['S-01'] = {
    absenceDetectionEnabled: false,
    triggerSeconds: 15,
    recoverySeconds: 10,
  }
  await db.query(
    'select * from update_machine_operational_settings($1,$2,$3::jsonb,$4::jsonb,null)',
    [settings.machine_id, settings.version, JSON.stringify(settings.sensor_thresholds), JSON.stringify(settings.shift_schedule)],
  )

  const { rows: [sensor] } = await db.query("select id from sensors where sensor_code = 'S-01'")

  await db.query(`
    update sensor_watchdog_state
    set last_heartbeat_id = gen_random_uuid(),
        last_heartbeat_payload_hash = 'absence-observe-fixture',
        last_heartbeat_received_at = '2026-08-21T01:00:00Z',
        last_activity_received_at = '2026-08-21T00:00:00Z',
        connectivity_state = 'online',
        detection_state = 'disabled',
        absence_baseline_at = null
    where sensor_id = $1
  `, [sensor.id])

  const { rows: [updatedSettings] } = await db.query('select * from machine_operational_settings limit 1')
  updatedSettings.sensor_thresholds['S-01'] = {
    absenceDetectionEnabled: true,
    triggerSeconds: 15,
    recoverySeconds: 10,
  }
  await db.query(
    'select * from update_machine_operational_settings($1,$2,$3::jsonb,$4::jsonb,null)',
    [updatedSettings.machine_id, updatedSettings.version, JSON.stringify(updatedSettings.sensor_thresholds), JSON.stringify(updatedSettings.shift_schedule)],
  )

  const tick1 = (await db.query(
    'select * from evaluate_sensor_watchdog($1, $2, $3, 300)',
    [sensor.id, '2026-08-21T01:00:00Z', 'observe'],
  )).rows[0]
  assert.equal(tick1.detection_state, 'healthy')

  const tick2 = (await db.query(
    'select * from evaluate_sensor_watchdog($1, $2, $3, 300)',
    [sensor.id, '2026-08-21T01:00:05Z', 'observe'],
  )).rows[0]
  assert.equal(tick2.detection_state, 'grace')

  const tick3 = (await db.query(
    'select * from evaluate_sensor_watchdog($1, $2, $3, 300)',
    [sensor.id, '2026-08-21T01:00:15Z', 'observe'],
  )).rows[0]
  assert.equal(tick3.detection_state, 'downtime')

  const sensorState = (await db.query('select status, fault_source from sensors where id = $1', [sensor.id])).rows[0]
  assert.equal(sensorState.status, 'Active', 'Sensor status must remain Active in observe mode')
  assert.equal(sensorState.fault_source, null)

  const { rows: [counts] } = await db.query(`
    select (select count(*)::int from downtime_events) as downtime_count,
           (select count(*)::int from alerts) as alert_count
  `)
  assert.equal(counts.downtime_count, 0)
  assert.equal(counts.alert_count, 0)
})

test('sensor starting in Inactive status stays Inactive during grace and faults at threshold', async (t) => {
  const db = await database(t)

  const { rows: [settings] } = await db.query('select * from machine_operational_settings limit 1')
  settings.sensor_thresholds['S-01'] = {
    absenceDetectionEnabled: false,
    triggerSeconds: 15,
    recoverySeconds: 10,
  }
  await db.query(
    'select * from update_machine_operational_settings($1,$2,$3::jsonb,$4::jsonb,null)',
    [settings.machine_id, settings.version, JSON.stringify(settings.sensor_thresholds), JSON.stringify(settings.shift_schedule)],
  )

  const { rows: [sensor] } = await db.query("select id from sensors where sensor_code = 'S-01'")

  await db.query("update sensors set status = 'Inactive', fault_source = null where id = $1", [sensor.id])

  await db.query(`
    update sensor_watchdog_state
    set last_heartbeat_id = gen_random_uuid(),
        last_heartbeat_payload_hash = 'absence-inactive-fixture',
        last_heartbeat_received_at = '2026-08-21T01:00:00Z',
        last_activity_received_at = '2026-08-21T00:00:00Z',
        connectivity_state = 'online',
        detection_state = 'disabled',
        absence_baseline_at = null
    where sensor_id = $1
  `, [sensor.id])

  const { rows: [updatedSettings] } = await db.query('select * from machine_operational_settings limit 1')
  updatedSettings.sensor_thresholds['S-01'] = {
    absenceDetectionEnabled: true,
    triggerSeconds: 15,
    recoverySeconds: 10,
  }
  await db.query(
    'select * from update_machine_operational_settings($1,$2,$3::jsonb,$4::jsonb,null)',
    [updatedSettings.machine_id, updatedSettings.version, JSON.stringify(updatedSettings.sensor_thresholds), JSON.stringify(updatedSettings.shift_schedule)],
  )

  const tick1 = (await db.query(
    'select * from evaluate_sensor_watchdog($1, $2, $3, 300)',
    [sensor.id, '2026-08-21T01:00:00Z', 'enforce'],
  )).rows[0]
  assert.equal(tick1.detection_state, 'healthy')

  const sensorAfterTick1 = (await db.query('select status, fault_source from sensors where id = $1', [sensor.id])).rows[0]
  assert.equal(sensorAfterTick1.status, 'Inactive', 'Sensor must remain Inactive without new activity')

  const tick2 = (await db.query(
    'select * from evaluate_sensor_watchdog($1, $2, $3, 300)',
    [sensor.id, '2026-08-21T01:00:05Z', 'enforce'],
  )).rows[0]
  assert.equal(tick2.detection_state, 'grace')

  const sensorAfterTick2 = (await db.query('select status, fault_source from sensors where id = $1', [sensor.id])).rows[0]
  assert.equal(sensorAfterTick2.status, 'Inactive')

  const tick3 = (await db.query(
    'select * from evaluate_sensor_watchdog($1, $2, $3, 300)',
    [sensor.id, '2026-08-21T01:00:15Z', 'enforce'],
  )).rows[0]
  assert.equal(tick3.detection_state, 'downtime')

  const sensorAfterTick3 = (await db.query('select status, fault_source from sensors where id = $1', [sensor.id])).rows[0]
  assert.equal(sensorAfterTick3.status, 'Fault')
  assert.equal(sensorAfterTick3.fault_source, 'absence_watchdog')
})

test('migration 050 reports readiness 50 and is safe to reapply', async (t) => {
  const db = await database(t)

  assert.equal((await db.query('select public.get_backend_readiness() as version')).rows[0].version, 50)

  const migration = fs.readFileSync(path.join(root, 'migrations', '050_fix_absence_enable_baseline.sql'), 'utf8')
  await db.exec(migration)

  assert.equal((await db.query('select public.get_backend_readiness() as version')).rows[0].version, 50)
})

