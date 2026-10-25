const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const databaseRoot = path.resolve(__dirname, '../database')
const migrationName = '047_reject_reserved_sensor_metadata.sql'

async function database(t) {
  const migrations = fs.readdirSync(path.join(databaseRoot, 'migrations'))
    .filter((name) => {
      const match = /^(\d{3})_.*\.sql$/.exec(name)
      return match && Number(match[1]) >= 29 && Number(match[1]) <= 47
    })
    .sort()
    .map((name) => fs.readFileSync(path.join(databaseRoot, 'migrations', name), 'utf8'))
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'), import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  t.after(() => db.close())
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  await db.exec(fs.readFileSync(path.join(databaseRoot, 'schema.sql'), 'utf8'))
  await db.exec(fs.readFileSync(path.join(databaseRoot, 'seed.sql'), 'utf8'))
  await db.query(`insert into users(name, username, password_hash, must_change_password, role_id)
    select 'Reserved Metadata Admin', 'reserved-metadata-admin', 'hash', false, id from roles where name = 'Admin'`)
  for (const migration of migrations) await db.exec(migration)
  return db
}

function ingest(db, sensorCode, eventType, signal, metadata, rpc = 'ingest_iot_sensor_event') {
  return db.query(`
    select result.*
    from sensors sensor
    cross join lateral ${rpc}(
      $1, sensor.id, sensor.machine_id, $2, $3::jsonb, $4
    ) result
    where sensor.sensor_code = $5
  `, [randomUUID(), eventType, JSON.stringify({ signal, metadata }), '2026-08-21T16:54:00+08:00', sensorCode])
}

async function snapshot(db) {
  return (await db.query(`select
    (select count(*)::int from sensor_events) as events,
    (select count(*)::int from alerts) as alerts,
    (select count(*)::int from downtime_events) as downtime,
    (select json_agg(status order by sensor_code) from sensors) as sensor_statuses,
    (select status from machines where machine_code = 'M-01') as machine_status`)).rows[0]
}

function isReservedMetadataError(error) {
  return error.code === '22023' && /server-reserved/i.test(error.message)
}

test('reserved output keys are rejected on every ingestion route without writing state', async (t) => {
  const db = await database(t)
  const before = await snapshot(db)
  const cases = [
    ['S-01', 'pulse', 'active', { outputAccepted: true }, 'ingest_iot_sensor_event'],
    ['S-03', 'fault', 'fault', { outputRejectionReason: 'machine_downtime' }, 'ingest_iot_sensor_event'],
    ['S-05', 'pulse', 'active', { outputAccepted: false, outputRejectionReason: 'stale_event' }, 'ingest_iot_sensor_event'],
    ['S-05', 'fault', 'fault', { outputAccepted: true }, 'ingest_iot_sensor_event'],
    ['S-01', 'pulse', 'active', { outputAccepted: true }, 'ingest_iot_grouped_sensor_event'],
    ['S-04', 'fault', 'fault', { outputRejectionReason: 'stale_event' }, 'ingest_iot_grouped_sensor_event'],
  ]

  for (const [sensorCode, eventType, signal, metadata, rpc] of cases) {
    await assert.rejects(
      ingest(db, sensorCode, eventType, signal, metadata, rpc),
      isReservedMetadataError,
      `${rpc} ${sensorCode} ${eventType}`,
    )
  }

  assert.deepEqual(await snapshot(db), before)
})

test('ordinary device metadata is still accepted', async (t) => {
  const db = await database(t)

  const { rows } = await ingest(db, 'S-01', 'pulse', 'active', { firmware: '1.0.0' })

  assert.equal(rows[0].state_applied, true)
  assert.deepEqual(rows[0].event_value.metadata, { firmware: '1.0.0' })
})

test('migration 047 reports readiness 47 and is safe to reapply', async (t) => {
  const db = await database(t)

  await db.exec(fs.readFileSync(path.join(databaseRoot, 'migrations', migrationName), 'utf8'))

  assert.equal((await db.query('select public.get_backend_readiness() as version')).rows[0].version, 47)
  await assert.rejects(ingest(db, 'S-02', 'pulse', 'active', { outputAccepted: true }), isReservedMetadataError)
})
