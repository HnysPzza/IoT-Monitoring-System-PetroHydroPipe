const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const databaseRoot = path.resolve(__dirname, '../../database')
const migrationName = '049_production_item_specs.sql'

async function database(t) {
  const migrations = fs.readdirSync(path.join(databaseRoot, 'migrations'))
    .filter((name) => {
      const match = /^(\d{3})_.*\.sql$/.exec(name)
      return match && Number(match[1]) >= 29 && Number(match[1]) <= 49
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
    select 'Production Admin', 'production-admin', 'hash', false, id from roles where name = 'Admin'`)
  for (const migration of migrations) await db.exec(migration)
  return db
}

async function getAdminUser(db) {
  const result = await db.query(`select id from users where username = 'production-admin'`)
  return result.rows[0].id
}

async function getSensors(db) {
  const result = await db.query(`select id, sensor_code, machine_id from sensors`)
  const map = {}
  for (const row of result.rows) {
    map[row.sensor_code] = row
  }
  return map
}

async function insertSensorEvent(db, { sensorId, machineId, eventType = 'pulse', outputAccepted = true, rejectionReason = null, recordedAt = '2026-06-01T08:00:00Z' }) {
  const id = randomUUID()
  await db.query(`
    insert into sensor_events (id, sensor_id, machine_id, device_event_id, event_type, event_value, recorded_at, output_accepted, output_rejection_reason)
    values ($1, $2, $3, $4, $5, '{}'::jsonb, $6, $7, $8)
  `, [id, sensorId, machineId, randomUUID(), eventType, recordedAt, outputAccepted, rejectionReason])
  return id
}

test('migration 049 reports readiness 49 and is safe to reapply', async (t) => {
  const db = await database(t)

  assert.equal((await db.query('select public.get_backend_readiness() as version')).rows[0].version, 49)

  const migrationSql = fs.readFileSync(path.join(databaseRoot, 'migrations', migrationName), 'utf8')
  await db.exec(migrationSql)

  assert.equal((await db.query('select public.get_backend_readiness() as version')).rows[0].version, 49)
})

test('RLS and privileges protect production_item_specs and RPCs', async (t) => {
  const db = await database(t)
  const sensors = await getSensors(db)
  const adminId = await getAdminUser(db)
  const eventId = await insertSensorEvent(db, {
    sensorId: sensors['S-05'].id,
    machineId: sensors['S-05'].machine_id,
  })

  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role};`)
    await assert.rejects(
      db.query('select * from public.production_item_specs'),
      /permission denied/i,
    )
    await assert.rejects(
      db.query(
        `select * from public.update_production_log_spec($1, $2, $3, $4, $5, $6, $7)`,
        [eventId, 'Pipe A', '12 inch', 30.5, 15.25, 95.8, adminId],
      ),
      /permission denied/i,
    )
    await assert.rejects(
      db.query(
        `select * from public.batch_update_production_log_specs(array[$1]::uuid[], null, null, false, $2, $3, $4, $5, $6, $7)`,
        [eventId, 'Pipe A', '12 inch', 30.5, 15.25, 95.8, adminId],
      ),
      /permission denied/i,
    )
    await db.exec('reset role;')
  }

  await db.exec('set role service_role;')
  const selectResult = await db.query('select count(*)::int as count from public.production_item_specs')
  assert.equal(selectResult.rows[0].count, 0)

  await assert.rejects(
    db.query(
      `insert into public.production_item_specs (sensor_event_id, label) values ($1, 'Direct Insert')`,
      [eventId],
    ),
    /permission denied/i,
  )
  await assert.rejects(
    db.query(
      `update public.production_item_specs set label = 'Direct Update' where sensor_event_id = $1`,
      [eventId],
    ),
    /permission denied/i,
  )
  await assert.rejects(
    db.query(
      `delete from public.production_item_specs where sensor_event_id = $1`,
      [eventId],
    ),
    /permission denied/i,
  )
  await db.exec('reset role;')
})

test('update_production_log_spec upserts spec, trims strings, rounds decimals, and writes audit log', async (t) => {
  const db = await database(t)
  const sensors = await getSensors(db)
  const adminId = await getAdminUser(db)
  const eventId = await insertSensorEvent(db, {
    sensorId: sensors['S-05'].id,
    machineId: sensors['S-05'].machine_id,
  })

  await db.exec('set role service_role;')
  const result = await db.query(
    `select * from public.update_production_log_spec($1, $2, $3, $4, $5, $6, $7)`,
    [eventId, '  Spiral Pipe Spec  ', '  12.5 inch  ', 31.876, 15.938, 100.141, adminId],
  )

  assert.equal(result.rows.length, 1)
  const row = result.rows[0]
  assert.equal(row.sensor_event_id, eventId)
  assert.equal(row.label, 'Spiral Pipe Spec')
  assert.equal(row.size, '12.5 inch')
  assert.equal(Number(row.diameter), 31.88)
  assert.equal(Number(row.radius), 15.94)
  assert.equal(Number(row.circumference), 100.14)
  assert.equal(row.updated_by, adminId)
  assert.ok(row.updated_at)

  const audits = await db.query(
    `select * from public.audit_logs where entity_id = $1 and action = 'PRODUCTION_SPEC_UPDATED'`,
    [eventId],
  )
  assert.equal(audits.rows.length, 1)
  const audit = audits.rows[0]
  assert.equal(audit.user_id, adminId)
  assert.equal(audit.entity_type, 'sensor_event')
  assert.equal(audit.metadata.sensorCode, 'S-05')
  assert.equal(audit.metadata.machineCode, 'M-01')
  assert.equal(audit.metadata.label, 'Spiral Pipe Spec')
  assert.equal(audit.metadata.previous, null)
  await db.exec('reset role;')
})

test('update_production_log_spec is idempotent and prevents duplicate audit logs', async (t) => {
  const db = await database(t)
  const sensors = await getSensors(db)
  const adminId = await getAdminUser(db)
  const eventId = await insertSensorEvent(db, {
    sensorId: sensors['S-05'].id,
    machineId: sensors['S-05'].machine_id,
  })

  await db.exec('set role service_role;')
  const first = await db.query(
    `select * from public.update_production_log_spec($1, $2, $3, $4, $5, $6, $7)`,
    [eventId, 'Same Label', '10 inch', 25.4, 12.7, 79.8, adminId],
  )
  const firstUpdatedAt = first.rows[0].updated_at

  const second = await db.query(
    `select * from public.update_production_log_spec($1, $2, $3, $4, $5, $6, $7)`,
    [eventId, 'Same Label', '10 inch', 25.4, 12.7, 79.8, adminId],
  )
  assert.equal(second.rows[0].updated_at.toISOString(), firstUpdatedAt.toISOString())

  const auditCount = await db.query(
    `select count(*)::int as count from public.audit_logs where entity_id = $1 and action = 'PRODUCTION_SPEC_UPDATED'`,
    [eventId],
  )
  assert.equal(auditCount.rows[0].count, 1)

  await db.exec('reset role;')
  const unspecEventId = await insertSensorEvent(db, {
    sensorId: sensors['S-05'].id,
    machineId: sensors['S-05'].machine_id,
  })
  await db.exec('set role service_role;')
  const emptyCall = await db.query(
    `select * from public.update_production_log_spec($1, null, null, null, null, null, $2)`,
    [unspecEventId, adminId],
  )
  assert.equal(emptyCall.rows.length, 1)
  assert.equal(emptyCall.rows[0].updated_at, null)
  const emptySpecCount = await db.query(
    `select count(*)::int as count from public.production_item_specs where sensor_event_id = $1`,
    [unspecEventId],
  )
  assert.equal(emptySpecCount.rows[0].count, 0)
  await db.exec('reset role;')
})

test('optimistic concurrency rejects stale expected_updated_at with 40001', async (t) => {
  const db = await database(t)
  const sensors = await getSensors(db)
  const adminId = await getAdminUser(db)
  const eventId = await insertSensorEvent(db, {
    sensorId: sensors['S-05'].id,
    machineId: sensors['S-05'].machine_id,
  })

  await db.exec('set role service_role;')
  const initial = await db.query(
    `select * from public.update_production_log_spec($1, $2, $3, $4, $5, $6, $7)`,
    [eventId, 'Initial', '8 inch', 20.0, 10.0, 62.83, adminId],
  )
  const initialUpdatedAt = initial.rows[0].updated_at

  await assert.rejects(
    db.query(
      `select * from public.update_production_log_spec($1, $2, $3, $4, $5, $6, $7, $8)`,
      [eventId, 'Stale Update', '8 inch', 20.0, 10.0, 62.83, adminId, '2026-01-01T00:00:00Z'],
    ),
    (err) => err.code === '40001' && /modified by another user/i.test(err.message),
  )

  const updated = await db.query(
    `select * from public.update_production_log_spec($1, $2, $3, $4, $5, $6, $7, $8)`,
    [eventId, 'Fresh Update', '8 inch', 20.0, 10.0, 62.83, adminId, initialUpdatedAt],
  )
  assert.equal(updated.rows[0].label, 'Fresh Update')
  await db.exec('reset role;')
})

test('validation rejects invalid sensors, rejected cuts, negative values, and non-existent IDs', async (t) => {
  const db = await database(t)
  const sensors = await getSensors(db)
  const adminId = await getAdminUser(db)

  const s01EventId = await insertSensorEvent(db, {
    sensorId: sensors['S-01'].id,
    machineId: sensors['S-01'].machine_id,
    eventType: 'pulse',
  })
  const s05IdleEventId = await insertSensorEvent(db, {
    sensorId: sensors['S-05'].id,
    machineId: sensors['S-05'].machine_id,
    eventType: 'idle',
  })
  const s05RejectedEventId = await insertSensorEvent(db, {
    sensorId: sensors['S-05'].id,
    machineId: sensors['S-05'].machine_id,
    eventType: 'pulse',
    outputAccepted: false,
    rejectionReason: 'stale_event',
  })
  const validEventId = await insertSensorEvent(db, {
    sensorId: sensors['S-05'].id,
    machineId: sensors['S-05'].machine_id,
    eventType: 'pulse',
    outputAccepted: true,
  })

  await db.exec('set role service_role;')

  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'A', 'B', 1, 1, 1, $2)`, [s01EventId, adminId]),
    (err) => err.code === '22023' && /only be assigned to S-05/i.test(err.message),
  )
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'A', 'B', 1, 1, 1, $2)`, [s05IdleEventId, adminId]),
    (err) => err.code === '22023' && /only be assigned to S-05/i.test(err.message),
  )
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'A', 'B', 1, 1, 1, $2)`, [s05RejectedEventId, adminId]),
    (err) => err.code === '22023' && /view-only and cannot be edited/i.test(err.message),
  )
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec(null, 'A', 'B', 1, 1, 1, $1)`, [adminId]),
    (err) => err.code === '22023' && /id is required/i.test(err.message),
  )
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'A', 'B', 1, 1, 1, $2)`, [randomUUID(), adminId]),
    (err) => err.code === 'P0002' && /record not found/i.test(err.message),
  )
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'A', 'B', -5, 1, 1, $2)`, [validEventId, adminId]),
    (err) => err.code === '22023' && /greater than zero/i.test(err.message),
  )
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'A', 'B', 1, 0, 1, $2)`, [validEventId, adminId]),
    (err) => err.code === '22023' && /greater than zero/i.test(err.message),
  )
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'A', 'B', 1, 1, -1, $2)`, [validEventId, adminId]),
    (err) => err.code === '22023' && /greater than zero/i.test(err.message),
  )
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'A', 'B', 100000000, 1, 1, $2)`, [validEventId, adminId]),
    (err) => err.code === '22023',
  )
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'A', 'B', 0.001, 1, 1, $2)`, [validEventId, adminId]),
    (err) => err.code === '22023',
  )
  await assert.rejects(
    db.query(`select * from public.batch_update_production_log_specs(array[$1]::uuid[], null, null, false, 'A', 'B', 100000000, null, null, $2)`, [validEventId, adminId]),
    (err) => err.code === '22023',
  )
  await assert.rejects(
    db.query(`select * from public.batch_update_production_log_specs(array[$1]::uuid[], null, null, false, 'A', 'B', 0.001, null, null, $2)`, [validEventId, adminId]),
    (err) => err.code === '22023',
  )

  const invalidUserId = randomUUID()
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'Rollback Test', '10', 10, 5, 31.4, $2)`, [validEventId, invalidUserId]),
    (err) => err.code === '23503',
  )
  const specCount = await db.query('select count(*)::int as count from public.production_item_specs where sensor_event_id = $1', [validEventId])
  assert.equal(specCount.rows[0].count, 0)
  await db.exec('reset role;')
})

test('batch_update_production_log_specs updates by ID array and preserves existing unmentioned fields', async (t) => {
  const db = await database(t)
  const sensors = await getSensors(db)
  const adminId = await getAdminUser(db)

  const id1 = await insertSensorEvent(db, { sensorId: sensors['S-05'].id, machineId: sensors['S-05'].machine_id })
  const id2 = await insertSensorEvent(db, { sensorId: sensors['S-05'].id, machineId: sensors['S-05'].machine_id })

  await db.exec('set role service_role;')
  await db.query(
    `select * from public.update_production_log_spec($1, 'Original Label 1', 'Small', 10.0, 5.0, 31.42, $2)`,
    [id1, adminId],
  )

  const batchResult = await db.query(
    `select * from public.batch_update_production_log_specs(
      $1::uuid[], null, null, false, null, 'Large', 20.0, null, null, $2
    )`,
    [[id1, id2], adminId],
  )

  assert.equal(batchResult.rows[0].matched_count, 2)
  assert.equal(batchResult.rows[0].updated_count, 2)

  const row1 = (await db.query('select * from public.production_item_specs where sensor_event_id = $1', [id1])).rows[0]
  assert.equal(row1.label, 'Original Label 1')
  assert.equal(row1.size, 'Large')
  assert.equal(Number(row1.diameter), 20.0)
  assert.equal(Number(row1.radius), 5.0)

  const row2 = (await db.query('select * from public.production_item_specs where sensor_event_id = $1', [id2])).rows[0]
  assert.equal(row2.label, null)
  assert.equal(row2.size, 'Large')
  assert.equal(Number(row2.diameter), 20.0)

  const batchAudits = await db.query(`select * from public.audit_logs where action = 'PRODUCTION_SPEC_BATCH_UPDATED'`)
  assert.equal(batchAudits.rows.length, 1)
  assert.equal(batchAudits.rows[0].metadata.matchedCount, 2)
  assert.equal(batchAudits.rows[0].metadata.updatedCount, 2)

  const retryResult = await db.query(
    `select * from public.batch_update_production_log_specs(
      $1::uuid[], null, null, false, null, 'Large', 20.0, null, null, $2
    )`,
    [[id1, id2], adminId],
  )
  assert.equal(retryResult.rows[0].matched_count, 2)
  assert.equal(retryResult.rows[0].updated_count, 0)
  const batchAuditsAfterRetry = await db.query(`select count(*)::int as count from public.audit_logs where action = 'PRODUCTION_SPEC_BATCH_UPDATED'`)
  assert.equal(batchAuditsAfterRetry.rows[0].count, 1)

  await db.exec('reset role;')
})

test('batch_update_production_log_specs honors only_unlabeled and time window', async (t) => {
  const db = await database(t)
  const sensors = await getSensors(db)
  const adminId = await getAdminUser(db)

  const windowStart = '2026-06-02T10:00:00Z'
  const windowEnd = '2026-06-02T11:00:00Z'

  const id1 = await insertSensorEvent(db, {
    sensorId: sensors['S-05'].id, machineId: sensors['S-05'].machine_id, recordedAt: '2026-06-02T10:15:00Z',
  })
  const id2 = await insertSensorEvent(db, {
    sensorId: sensors['S-05'].id, machineId: sensors['S-05'].machine_id, recordedAt: '2026-06-02T10:30:00Z',
  })
  const outsideId = await insertSensorEvent(db, {
    sensorId: sensors['S-05'].id, machineId: sensors['S-05'].machine_id, recordedAt: '2026-06-02T12:00:00Z',
  })

  await db.exec('set role service_role;')
  await db.query(
    `select * from public.update_production_log_spec($1, 'Existing Cut', 'Medium', 15.0, 7.5, 47.12, $2)`,
    [id1, adminId],
  )

  const result = await db.query(
    `select * from public.batch_update_production_log_specs(
      null, $1, $2, true, 'Window Tag', 'Window Size', null, null, null, $3
    )`,
    [windowStart, windowEnd, adminId],
  )

  assert.equal(result.rows[0].matched_count, 1)
  assert.equal(result.rows[0].updated_count, 1)
  assert.deepEqual(result.rows[0].sensor_event_ids, [id2])

  const row1 = (await db.query('select * from public.production_item_specs where sensor_event_id = $1', [id1])).rows[0]
  assert.equal(row1.label, 'Existing Cut')

  const row2 = (await db.query('select * from public.production_item_specs where sensor_event_id = $1', [id2])).rows[0]
  assert.equal(row2.label, 'Window Tag')

  const outsideRow = (await db.query('select * from public.production_item_specs where sensor_event_id = $1', [outsideId])).rows
  assert.equal(outsideRow.length, 0)
  await db.exec('reset role;')
})

test('batch_update_production_log_specs enforces 500-record cap and validation rules', async (t) => {
  const db = await database(t)
  const sensors = await getSensors(db)
  const adminId = await getAdminUser(db)

  await db.exec('set role service_role;')

  await assert.rejects(
    db.query(`select * from public.batch_update_production_log_specs(null, null, null, false, 'Tag', null, null, null, null, $1)`, [adminId]),
    (err) => err.code === '22023' && /either a non-empty array.*or a time range/i.test(err.message),
  )

  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        array[$1]::uuid[], '2026-06-01T00:00:00Z', '2026-06-01T01:00:00Z', false, 'Tag', null, null, null, null, $2
      )`,
      [randomUUID(), adminId],
    ),
    (err) => err.code === '22023' && /either a non-empty array.*or a time range/i.test(err.message),
  )

  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        array[$1]::uuid[], null, null, false, null, null, null, null, null, $2
      )`,
      [randomUUID(), adminId],
    ),
    (err) => err.code === '22023' && /at least one specification field/i.test(err.message),
  )

  const over500Ids = Array.from({ length: 501 }, () => randomUUID())
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        $1::uuid[], null, null, false, 'Tag', null, null, null, null, $2
      )`,
      [over500Ids, adminId],
    ),
    (err) => err.code === '22023' && /cannot exceed 500 records/i.test(err.message),
  )

  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        null, '2026-06-01T10:00:00Z', '2026-06-01T09:00:00Z', false, 'Tag', null, null, null, null, $1
      )`,
      [adminId],
    ),
    (err) => err.code === '22023' && /started_at earlier than ended_at/i.test(err.message),
  )

  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        null, '2026-06-01T10:00:00Z', '2026-06-01T10:00:00Z', false, 'Tag', null, null, null, null, $1
      )`,
      [adminId],
    ),
    (err) => err.code === '22023' && /started_at earlier than ended_at/i.test(err.message),
  )

  await db.exec('reset role;')
  await db.query(`
    insert into sensor_events (id, sensor_id, machine_id, device_event_id, event_type, event_value, recorded_at, output_accepted)
    select gen_random_uuid(), $1, $2, gen_random_uuid(), 'pulse', '{}'::jsonb,
           '2026-07-01T00:00:00Z'::timestamptz + (n || ' seconds')::interval, true
    from generate_series(1, 501) as n
  `, [sensors['S-05'].id, sensors['S-05'].machine_id])
  await db.exec('set role service_role;')

  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        null, '2026-07-01T00:00:00Z', '2026-07-01T00:10:00Z', false, 'Tag', null, null, null, null, $1
      )`,
      [adminId],
    ),
    (err) => err.code === '22023' && /cannot exceed 500 records/i.test(err.message),
  )
  await db.exec('reset role;')
})
