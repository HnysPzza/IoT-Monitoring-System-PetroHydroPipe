const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const schema = fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8')
const migration = fs.readFileSync(
  path.join(root, 'database/migrations/032_grouped_downtime_rule.sql'),
  'utf8',
)
const repairMigration = fs.readFileSync(
  path.join(root, 'database/migrations/033_repair_grouped_downtime_dispatch.sql'),
  'utf8',
)
const outputTelemetryMigration = fs.readFileSync(
  path.join(root, 'database/migrations/034_route_output_telemetry_through_grouped_reconciliation.sql'),
  'utf8',
)
const PROCESS_SENSOR_CODES = ['S-01', 'S-02', 'S-04']
async function database(t) {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'), import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  t.after(() => db.close())
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  await db.exec(schema)
  await db.exec(fs.readFileSync(path.join(root, 'database/seed.sql'), 'utf8'))
  await db.exec(migration)
  return db
}
async function event(db, code, type = 'fault', at = '2026-08-21T16:53:00+08:00', id = randomUUID()) {
  const signal = type === 'fault' ? 'fault' : type === 'idle' ? 'idle' : 'active'
  return (await db.query(`select result.* from sensors s cross join lateral
    ingest_iot_sensor_event($1,s.id,s.machine_id,$2,$3::jsonb,$4) result where s.sensor_code=$5`,
  [id, type, JSON.stringify({ signal }), at, code])).rows[0]
}
async function intervals(db) {
  return (await db.query(`select d.*,s.sensor_code from downtime_events d
    join sensors s on s.id=d.sensor_id order by d.started_at`)).rows
}

async function enableProcessWatchdogs(db) {
  const { rows } = await db.query(`select machine_id, sensor_thresholds, shift_schedule, version
    from machine_operational_settings limit 1`)
  const settings = rows[0]
  const thresholds = structuredClone(settings.sensor_thresholds)
  for (const code of ['S-01', 'S-02', 'S-04']) {
    thresholds[code] = { absenceDetectionEnabled: true, triggerSeconds: 60, recoverySeconds: 30 }
  }
  await db.query(`select * from update_machine_operational_settings(
    $1, $2, $3::jsonb, $4::jsonb, null
  )`, [
    settings.machine_id,
    settings.version,
    JSON.stringify(thresholds),
    JSON.stringify(settings.shift_schedule),
  ])
}

async function primeWatchdog(db, code) {
  const { rows } = await db.query('select id from sensors where sensor_code=$1', [code])
  await db.exec('alter table sensor_watchdog_state disable trigger track_watchdog_recovery_observation')
  await db.query(`update sensor_watchdog_state set
    boot_counter=1, boot_id=gen_random_uuid(), last_sequence=1,
    last_heartbeat_id=gen_random_uuid(), last_heartbeat_payload_hash='test',
    last_heartbeat_received_at='2026-08-21T00:00:55Z',
    last_activity_received_at='2026-08-20T23:59:00Z',
    connectivity_state='online', detection_state='healthy'
    where sensor_id=$1`, [rows[0].id])
  await db.exec('alter table sensor_watchdog_state enable trigger track_watchdog_recovery_observation')
  return rows[0].id
}

test('a single process fault stays visible without machine downtime', async (t) => {
  const db = await database(t)
  const result = await event(db, 'S-01')
  assert.equal(result.downtime_action, null)
  assert.equal((await intervals(db)).length, 0)
  assert.equal((await db.query("select status from sensors where sensor_code='S-01'")).rows[0].status, 'Fault')
  assert.notEqual((await db.query('select status from machines')).rows[0].status, 'Downtime')
  assert.equal(result.alert_record.sourceType, 'sensor')
})

test('migration 032 is safe to reapply after the upgrade', async (t) => {
  const db = await database(t)
  await db.exec(migration)
  const { rows } = await db.query(`select count(*)::integer as count
    from pg_proc
    where oid = to_regprocedure('public.ingest_iot_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)')`)
  assert.equal(rows[0].count, 1)
})

test('migration 033 restores grouped dispatch after an outdated event wrapper', async (t) => {
  const db = await database(t)
  await db.exec(`create or replace function public.ingest_iot_sensor_event(
    p_device_event_id uuid, p_sensor_id uuid, p_machine_id uuid, p_event_type text,
    p_event_value jsonb, p_recorded_at timestamptz
  ) returns table (
    sensor_event_id uuid, device_event_id uuid, event_type text, event_value jsonb,
    recorded_at timestamptz, duplicate boolean, stale boolean, state_applied boolean,
    previous_machine_status text, new_machine_status text, downtime_action text,
    downtime_id uuid, downtime_started_at timestamptz, downtime_ended_at timestamptz,
    downtime_duration_seconds integer, downtime_cause text, alert_action text, alert_record jsonb
  ) language sql security definer set search_path = pg_catalog, public as $$
    select * from public.ingest_iot_sensor_event_legacy_031(
      p_device_event_id, p_sensor_id, p_machine_id, p_event_type, p_event_value, p_recorded_at
    )
  $$;`)

  await event(db, 'S-01')
  assert.equal((await db.query('select status from machines')).rows[0].status, 'Downtime')
  const legacyDowntimeCount = (await intervals(db)).length

  await db.exec(repairMigration)
  const functionDefinition = (await db.query(`select pg_get_functiondef(
    'public.ingest_iot_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)'::regprocedure
  ) as definition`)).rows[0].definition
  assert.match(functionDefinition, /ingest_iot_grouped_sensor_event/)
  const sensorStates = (await db.query(`select sensor_code, status
    from sensors where sensor_code in ('S-01', 'S-02', 'S-03', 'S-04') order by sensor_code`)).rows
  assert.deepEqual(sensorStates, [
    { sensor_code: 'S-01', status: 'Fault' },
    { sensor_code: 'S-02', status: 'Active' },
    { sensor_code: 'S-03', status: 'Active' },
    { sensor_code: 'S-04', status: 'Active' },
  ])

  assert.equal((await intervals(db)).length, legacyDowntimeCount)
  assert.notEqual((await db.query('select status from machines')).rows[0].status, 'Downtime')
})

test('migration 034 keeps normal S-05 telemetry from reviving legacy machine downtime logic', async (t) => {
  const db = await database(t)
  await db.exec(repairMigration)
  await db.exec(outputTelemetryMigration)

  await event(db, 'S-04', 'fault', '2026-08-21T16:53:00+08:00')
  const normalEvents = [
    await event(db, 'S-01', 'pulse', '2026-08-21T16:54:00+08:00'),
    await event(db, 'S-02', 'pulse', '2026-08-21T16:55:00+08:00'),
    await event(db, 'S-03', 'pulse', '2026-08-21T16:56:00+08:00'),
  ]
  const outputPulse = await event(db, 'S-05', 'pulse', '2026-08-21T16:57:00+08:00')

  assert.deepEqual(normalEvents.map((event) => event.new_machine_status), ['Running', 'Running', 'Running'])
  assert.equal(outputPulse.new_machine_status, 'Running')
  assert.equal((await db.query('select status from machines')).rows[0].status, 'Running')
  assert.equal((await intervals(db)).length, 0)
})

test('migration 034 preserves S-03 and grouped downtime authority', async (t) => {
  const db = await database(t)
  await db.exec(repairMigration)
  await db.exec(outputTelemetryMigration)

  const directFault = await event(db, 'S-03', 'fault', '2026-08-21T16:53:00+08:00')
  assert.equal(directFault.downtime_action, 'created')
  assert.equal((await intervals(db))[0].sensor_code, 'S-03')

  const directRecovery = await event(db, 'S-03', 'recovered', '2026-08-21T16:54:00+08:00')
  assert.equal(directRecovery.downtime_action, 'resolved')

  await event(db, 'S-01', 'fault', '2026-08-21T16:55:00+08:00')
  await event(db, 'S-04', 'fault', '2026-08-21T16:56:00+08:00')
  const groupFault = await event(db, 'S-02', 'fault', '2026-08-21T16:57:00+08:00')
  assert.equal(groupFault.downtime_action, 'created')

  const groupRecovery = await event(db, 'S-01', 'recovered', '2026-08-21T16:58:00+08:00')
  assert.equal(groupRecovery.downtime_action, 'resolved')
  assert.equal((await db.query('select status from machines')).rows[0].status, 'Running')
})

for (const sensorCode of PROCESS_SENSOR_CODES) {
  test(`migration 034 keeps ${sensorCode} explicit fault after a watchdog fault at process level`, async (t) => {
    const db = await database(t)
    await db.exec(repairMigration)
    await db.exec(outputTelemetryMigration)
    await db.query(`update sensors set status='Fault', fault_source='absence_watchdog'
      where sensor_code=$1`, [sensorCode])
    await db.query(`update sensor_watchdog_state set detection_state='downtime', connectivity_state='online'
      where sensor_id=(select id from sensors where sensor_code=$1)`, [sensorCode])

    const result = await event(db, sensorCode, 'fault', '2026-08-21T16:53:00+08:00')

    assert.equal(result.downtime_action, null)
    assert.equal(result.new_machine_status, 'Running')
    assert.equal((await intervals(db)).length, 0)
    assert.equal((await db.query('select status from sensors where sensor_code=$1', [sensorCode])).rows[0].status, 'Fault')
  })
}

test('migration 034 rejects manual resolution of sensor-managed downtime', async (t) => {
  const db = await database(t)
  await db.exec(repairMigration)
  await db.exec(outputTelemetryMigration)
  const created = await event(db, 'S-03', 'fault', '2026-08-21T16:53:00+08:00')

  await assert.rejects(
    db.query(`select * from update_downtime_record($1, 'Other', null, false, true)`, [created.downtime_id]),
    /Sensor-managed downtime must be resolved by accepted sensor recovery/,
  )

  assert.equal((await intervals(db))[0].status, 'Open')
})

test('migration 034 keeps an explicit process fault and alert current after idle', async (t) => {
  const db = await database(t)
  await db.exec(repairMigration)
  await db.exec(outputTelemetryMigration)
  await event(db, 'S-01', 'fault', '2026-08-21T16:53:00+08:00')
  const idle = await event(db, 'S-01', 'idle', '2026-08-21T16:54:00+08:00')

  assert.equal(idle.downtime_action, null)
  const { rows } = await db.query(`select sensor.status as sensor_status, sensor.fault_source,
    alert.status as alert_status
    from sensors sensor
    left join alerts alert on alert.source_type='sensor' and alert.source_id=sensor.id
      and alert.status in ('Active', 'Acknowledged')
    where sensor.sensor_code='S-01'`)
  assert.deepEqual(rows, [{ sensor_status: 'Fault', fault_source: 'explicit', alert_status: 'Active' }])
})

test('migration 034 keeps a watchdog process fault and alert current after idle', async (t) => {
  const db = await database(t)
  await db.exec(repairMigration)
  await db.exec(outputTelemetryMigration)
  await enableProcessWatchdogs(db)
  const sensorId = await primeWatchdog(db, 'S-01')
  await db.query("select * from evaluate_sensor_watchdog($1, '2026-08-21T00:02:00Z', 'enforce', 300)", [sensorId])
  const idle = await event(db, 'S-01', 'idle', '2026-08-21T00:02:05Z')

  assert.equal(idle.downtime_action, null)
  const { rows } = await db.query(`select sensor.status as sensor_status, sensor.fault_source,
    alert.status as alert_status
    from sensors sensor
    left join alerts alert on alert.source_type='sensor' and alert.source_id=sensor.id
      and alert.status in ('Active', 'Acknowledged')
    where sensor.sensor_code='S-01'`)
  assert.deepEqual(rows, [{ sensor_status: 'Fault', fault_source: 'absence_watchdog', alert_status: 'Active' }])
})

test('migration 034 does not resolve grouped downtime when a contributor sends idle', async (t) => {
  const db = await database(t)
  await db.exec(repairMigration)
  await db.exec(outputTelemetryMigration)
  await event(db, 'S-01', 'fault', '2026-08-21T16:53:00+08:00')
  await event(db, 'S-04', 'fault', '2026-08-21T16:54:00+08:00')
  await event(db, 'S-02', 'fault', '2026-08-21T16:55:00+08:00')
  const idle = await event(db, 'S-01', 'idle', '2026-08-21T16:56:00+08:00')

  assert.equal(idle.downtime_action, null)
  assert.equal((await intervals(db))[0].status, 'Open')
  assert.equal((await db.query('select status from machines')).rows[0].status, 'Downtime')
  assert.deepEqual((await db.query(`select status, fault_source from sensors where sensor_code='S-01'`)).rows,
    [{ status: 'Fault', fault_source: 'explicit' }])
})

test('migration 034 returns every grouped transition in order with the S-03 owner', async (t) => {
  const db = await database(t)
  await db.exec(repairMigration)
  await db.exec(outputTelemetryMigration)
  await event(db, 'S-01', 'fault', '2026-08-21T16:53:00+08:00')
  await event(db, 'S-04', 'fault', '2026-08-21T16:54:00+08:00')
  const opened = await event(db, 'S-02', 'fault', '2026-08-21T16:55:00+08:00')

  assert.equal(opened.downtime_sensor_code, 'S-03')
  assert.deepEqual(opened.transition_descriptors.map((descriptor) => ({
    kind: descriptor.kind,
    action: descriptor.action,
    sensorCode: descriptor.sensorCode || descriptor.record?.sensor?.sensorCode,
  })), [
    { kind: 'alert', action: 'created', sensorCode: 'S-02' },
    { kind: 'downtime', action: 'created', sensorCode: 'S-03' },
    { kind: 'alert', action: 'created', sensorCode: 'S-03' },
  ])

  const recovered = await event(db, 'S-01', 'recovered', '2026-08-21T16:56:00+08:00')
  assert.equal(recovered.downtime_sensor_code, 'S-03')
  assert.deepEqual(recovered.transition_descriptors.map((descriptor) => ({
    kind: descriptor.kind,
    action: descriptor.action,
    sensorCode: descriptor.sensorCode || descriptor.record?.sensor?.sensorCode,
  })), [
    { kind: 'alert', action: 'updated', sensorCode: 'S-01' },
    { kind: 'downtime', action: 'resolved', sensorCode: 'S-03' },
    { kind: 'alert', action: 'updated', sensorCode: 'S-03' },
  ])
})

test('migration 034 preserves group opening evidence when S-03 becomes the current cause', async (t) => {
  const db = await database(t)
  await db.exec(repairMigration)
  await db.exec(outputTelemetryMigration)
  await event(db, 'S-01', 'fault', '2026-08-21T16:53:00+08:00')
  await event(db, 'S-04', 'fault', '2026-08-21T16:54:00+08:00')
  await event(db, 'S-02', 'fault', '2026-08-21T16:55:00+08:00')
  const opening = (await db.query(`select id, started_at, notes, detection_source
    from downtime_events where status='Open'`)).rows[0]
  const openingAudit = (await db.query(`select metadata from audit_logs
    where action='DOWNTIME_CREATED' and entity_id=$1`, [opening.id])).rows[0].metadata

  const directFault = await event(db, 'S-03', 'fault', '2026-08-21T16:56:00+08:00')
  const alert = (await db.query(`select message, metadata from alerts alert
    join sensors sensor on sensor.id=alert.sensor_id
    where sensor.sensor_code='S-03' and alert.status in ('Active', 'Acknowledged')`)).rows[0]
  const intervalAfterHandoff = (await db.query(`select id, started_at, notes, detection_source
    from downtime_events where status='Open'`)).rows[0]

  assert.equal(directFault.downtime_action, null)
  assert.deepEqual(directFault.transition_descriptors.map((descriptor) => ({
    kind: descriptor.kind,
    action: descriptor.action,
    sensorCode: descriptor.record?.sensor?.sensorCode,
  })), [{ kind: 'alert', action: 'updated', sensorCode: 'S-03' }])
  assert.equal(alert.message, 'S-03 machine authority reported a physical fault.')
  assert.deepEqual(alert.metadata.contributingSensors, ['S-01', 'S-02', 'S-04'])
  assert.equal(alert.metadata.currentConfirmationRule, 'S-03 fault')
  assert.deepEqual(alert.metadata.currentContributingSensors, ['S-03'])
  assert.deepEqual(intervalAfterHandoff, opening)
  assert.deepEqual((await db.query(`select metadata from audit_logs
    where action='DOWNTIME_CREATED' and entity_id=$1`, [opening.id])).rows[0].metadata, openingAudit)

  const repeatedDirectFault = await event(db, 'S-03', 'fault', '2026-08-21T16:57:00+08:00')
  assert.deepEqual(repeatedDirectFault.transition_descriptors, [])
})

test('migration 034 preserves direct S-03 opening evidence when the process group becomes current', async (t) => {
  const db = await database(t)
  await db.exec(repairMigration)
  await db.exec(outputTelemetryMigration)
  await event(db, 'S-03', 'fault', '2026-08-21T16:53:00+08:00')
  const opening = (await db.query(`select id, started_at, notes, detection_source
    from downtime_events where status='Open'`)).rows[0]
  await event(db, 'S-01', 'fault', '2026-08-21T16:54:00+08:00')
  await event(db, 'S-04', 'fault', '2026-08-21T16:55:00+08:00')
  await event(db, 'S-02', 'fault', '2026-08-21T16:56:00+08:00')

  const s03Recovery = await event(db, 'S-03', 'recovered', '2026-08-21T16:57:00+08:00')
  const alert = (await db.query(`select message, metadata from alerts alert
    join sensors sensor on sensor.id=alert.sensor_id
    where sensor.sensor_code='S-03' and alert.status in ('Active', 'Acknowledged')`)).rows[0]
  const intervalAfterHandoff = (await db.query(`select id, started_at, notes, detection_source
    from downtime_events where status='Open'`)).rows[0]

  assert.equal(s03Recovery.downtime_action, null)
  assert.deepEqual(s03Recovery.transition_descriptors.map((descriptor) => ({
    kind: descriptor.kind,
    action: descriptor.action,
    sensorCode: descriptor.record?.sensor?.sensorCode,
  })), [{ kind: 'alert', action: 'updated', sensorCode: 'S-03' }])
  assert.equal(alert.message, 'S-01, S-02, and S-04 remained faulted; machine downtime confirmed.')
  assert.deepEqual(alert.metadata.contributingSensors, ['S-03'])
  assert.equal(alert.metadata.currentConfirmationRule, 'S-01/S-02/S-04 all faulted')
  assert.deepEqual(alert.metadata.currentContributingSensors, ['S-01', 'S-02', 'S-04'])
  assert.deepEqual(intervalAfterHandoff, opening)
})

test('migration 032 disables the legacy manual recovery override', async (t) => {
  const db = await database(t)
  const { rows } = await db.query(`select has_function_privilege(
    'service_role',
    'public.override_sensor_recovery(uuid,uuid,text)',
    'execute'
  ) as can_execute`)

  assert.equal(rows[0].can_execute, false)
})

test('S-03 fault opens downtime immediately and owns the record', async (t) => {
  const db = await database(t)
  const result = await event(db, 'S-03')
  const rows = await intervals(db)

  assert.equal(result.downtime_action, 'created')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].sensor_code, 'S-03')
  assert.equal((await db.query('select status from machines')).rows[0].status, 'Downtime')
})

test('three qualified watchdog faults accumulate before opening one S-03 interval', async (t) => {
  const db = await database(t)
  await enableProcessWatchdogs(db)
  const sensorIds = {}
  for (const code of ['S-01', 'S-02', 'S-04']) sensorIds[code] = await primeWatchdog(db, code)

  const evaluate = (code, at) => db.query(
    'select * from evaluate_sensor_watchdog($1, $2, \'enforce\', 300)',
    [sensorIds[code], at],
  )
  await evaluate('S-01', '2026-08-21T00:02:00Z')
  await evaluate('S-04', '2026-08-21T00:03:00Z')
  assert.equal((await intervals(db)).length, 0)
  await evaluate('S-02', '2026-08-21T00:04:00Z')

  const rows = await intervals(db)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].sensor_code, 'S-03')
  assert.equal(rows[0].started_at.toISOString(), '2026-08-21T00:04:00.000Z')
})

test('sequential outstanding faults open one S-03 interval at the third fault', async (t) => {
  const db = await database(t)
  await event(db, 'S-01')
  await event(db, 'S-04', 'fault', '2026-08-21T17:00:00+08:00')
  assert.equal((await intervals(db)).length, 0)
  await event(db, 'S-02', 'fault', '2026-08-21T17:10:00+08:00')
  const rows = await intervals(db)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].sensor_code, 'S-03')
  assert.equal(rows[0].started_at.toISOString(), '2026-08-21T09:10:00.000Z')
  assert.equal(rows[0].status, 'Open')
  assert.equal((await db.query("select status from sensors where sensor_code='S-03'")).rows[0].status, 'Active')
})

test('earlier recovery prevents group downtime; acknowledgement does not', async (t) => {
  const db = await database(t)
  await event(db, 'S-01')
  await event(db, 'S-04', 'fault', '2026-08-21T17:00:00+08:00')
  await event(db, 'S-01', 'recovered', '2026-08-21T17:05:00+08:00')
  await event(db, 'S-02', 'fault', '2026-08-21T17:10:00+08:00')
  assert.equal((await intervals(db)).length, 0)
  await event(db, 'S-01', 'fault', '2026-08-21T17:15:00+08:00')
  assert.equal((await intervals(db)).length, 1)
})

test('overlapping causes preserve the interval until both branches clear', async (t) => {
  const db = await database(t)
  for (const code of ['S-01', 'S-02', 'S-04']) await event(db, code)
  const original = (await intervals(db))[0]
  await event(db, 'S-03', 'fault', '2026-08-21T17:00:00+08:00')
  const activeS03Alert = (await db.query(`select alert.severity, alert.status, alert.title
    from alerts alert join sensors sensor on sensor.id=alert.sensor_id
    where sensor.sensor_code='S-03' and alert.status in ('Active', 'Acknowledged')`)).rows[0]
  assert.deepEqual(activeS03Alert, {
    severity: 'Critical',
    status: 'Active',
    title: 'Machine Main Sensor downtime detected',
  })
  await event(db, 'S-01', 'recovered', '2026-08-21T17:05:00+08:00')
  assert.equal((await intervals(db))[0].status, 'Open')
  await event(db, 'S-03', 'recovered', '2026-08-21T17:10:00+08:00')
  const rows = await intervals(db)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, original.id)
  assert.equal(rows[0].status, 'Resolved')
  assert.equal(rows[0].duration_seconds, 17 * 60)
})

test('duplicate fault and stale recovery cannot alter the group', async (t) => {
  const db = await database(t)
  for (const code of ['S-01', 'S-04']) await event(db, code)
  const id = randomUUID()
  await event(db, 'S-02', 'fault', '2026-08-21T17:10:00+08:00', id)
  assert.equal((await event(db, 'S-02', 'fault', '2026-08-21T17:10:00+08:00', id)).duplicate, true)
  assert.equal((await event(db, 'S-02', 'recovered', '2026-08-21T17:00:00+08:00')).stale, true)
  const rows = await intervals(db)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'Open')
})
