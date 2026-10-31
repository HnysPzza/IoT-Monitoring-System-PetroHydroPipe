const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const databaseRoot = path.resolve(__dirname, '../database')
const migrationName = '051_align_production_specs_pipe_manufacturing.sql'

async function database(t) {
  const migrations = fs.readdirSync(path.join(databaseRoot, 'migrations'))
    .filter((name) => {
      const match = /^(\d{3})_.*\.sql$/.exec(name)
      return match && Number(match[1]) >= 29 && Number(match[1]) <= 51
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

test('migration 051 reports readiness 51 and is safe to reapply idempotently', async (t) => {
  const db = await database(t)

  assert.equal((await db.query('select public.get_backend_readiness() as version')).rows[0].version, 51)

  // Verify new columns exist
  const columns = await db.query(`
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema = 'public' and table_name = 'production_item_specs'
  `)
  const colMap = {}
  for (const col of columns.rows) {
    colMap[col.column_name] = col
  }

  assert.ok(colMap.customer, 'customer column must exist')
  assert.equal(colMap.customer.data_type, 'text')
  assert.ok(colMap.thickness, 'thickness column must exist')
  assert.equal(colMap.thickness.data_type, 'numeric')
  assert.ok(colMap.length, 'length column must exist')
  assert.equal(colMap.length.data_type, 'numeric')
  assert.ok(colMap.pipe_number, 'pipe_number column must exist')
  assert.equal(colMap.pipe_number.data_type, 'integer')

  // Verify legacy columns are nullable
  assert.equal(colMap.radius.is_nullable, 'YES')
  assert.equal(colMap.circumference.is_nullable, 'YES')

  // Verify idempotency by reapplying migration 051
  const migrationSql = fs.readFileSync(path.join(databaseRoot, 'migrations', migrationName), 'utf8')
  await db.exec(migrationSql)

  assert.equal((await db.query('select public.get_backend_readiness() as version')).rows[0].version, 51)
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
        [eventId, 'MCWD', 625.4, 12.7, 6000, 1, adminId],
      ),
      /permission denied/i,
    )
    await assert.rejects(
      db.query(
        `select * from public.batch_update_production_log_specs(array[$1]::uuid[], null, null, false, $2, $3, $4, $5, $6)`,
        [eventId, 'MCWD', 625.4, 12.7, 6000, adminId],
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
      `insert into public.production_item_specs (sensor_event_id, customer) values ($1, 'Direct Insert')`,
      [eventId],
    ),
    /permission denied/i,
  )
  await assert.rejects(
    db.query(
      `update public.production_item_specs set customer = 'Direct Update' where sensor_event_id = $1`,
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

test('update_production_log_spec upserts customer, diameter, thickness, length, pipe_number, trims text, rounds numeric, writes audit log', async (t) => {
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
    [eventId, '  MCWD  ', 625.404, 12.704, 6000.004, 101, adminId],
  )

  assert.equal(result.rows.length, 1)
  const row = result.rows[0]
  assert.equal(row.sensor_event_id, eventId)
  assert.equal(row.customer, 'MCWD')
  assert.equal(Number(row.diameter), 625.40)
  assert.equal(Number(row.thickness), 12.70)
  assert.equal(Number(row.length), 6000.00)
  assert.equal(row.pipe_number, 101)
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
  assert.equal(audit.metadata.customer, 'MCWD')
  assert.equal(audit.metadata.diameter, 625.40)
  assert.equal(audit.metadata.thickness, 12.70)
  assert.equal(audit.metadata.length, 6000.00)
  assert.equal(audit.metadata.pipeNumber, 101)
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
    [eventId, 'Same Customer', 625.4, 12.7, 6000, 1, adminId],
  )
  const firstUpdatedAt = first.rows[0].updated_at

  const second = await db.query(
    `select * from public.update_production_log_spec($1, $2, $3, $4, $5, $6, $7)`,
    [eventId, 'Same Customer', 625.4, 12.7, 6000, 1, adminId],
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
    [eventId, 'Initial Customer', 500.0, 10.0, 5000.0, 1, adminId],
  )
  const initialUpdatedAt = initial.rows[0].updated_at

  await assert.rejects(
    db.query(
      `select * from public.update_production_log_spec($1, $2, $3, $4, $5, $6, $7, $8)`,
      [eventId, 'Stale Update', 500.0, 10.0, 5000.0, 1, adminId, '2026-01-01T00:00:00Z'],
    ),
    (err) => err.code === '40001' && /modified by another user/i.test(err.message),
  )

  const updated = await db.query(
    `select * from public.update_production_log_spec($1, $2, $3, $4, $5, $6, $7, $8)`,
    [eventId, 'Fresh Update', 500.0, 10.0, 5000.0, 1, adminId, initialUpdatedAt],
  )
  assert.equal(updated.rows[0].customer, 'Fresh Update')
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

  // Non S-05
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'A', 1, 1, 1, 1, $2)`, [s01EventId, adminId]),
    (err) => err.code === '22023' && /only be assigned to S-05/i.test(err.message),
  )
  // Non pulse
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'A', 1, 1, 1, 1, $2)`, [s05IdleEventId, adminId]),
    (err) => err.code === '22023' && /only be assigned to S-05/i.test(err.message),
  )
  // Rejected cut
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'A', 1, 1, 1, 1, $2)`, [s05RejectedEventId, adminId]),
    (err) => err.code === '22023' && /view-only and cannot be edited/i.test(err.message),
  )
  // Missing event id
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec(null, 'A', 1, 1, 1, 1, $1)`, [adminId]),
    (err) => err.code === '22023' && /id is required/i.test(err.message),
  )
  // Non-existent event id
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'A', 1, 1, 1, 1, $2)`, [randomUUID(), adminId]),
    (err) => err.code === 'P0002' && /record not found/i.test(err.message),
  )
  // Customer > 100 chars
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, $2, 1, 1, 1, 1, $3)`, [validEventId, 'X'.repeat(101), adminId]),
    (err) => err.code === '22023' && /cannot exceed 100 characters/i.test(err.message),
  )
  // Negative diameter
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'A', -5, 1, 1, 1, $2)`, [validEventId, adminId]),
    (err) => err.code === '22023' && /greater than zero/i.test(err.message),
  )
  // Zero thickness
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'A', 1, 0, 1, 1, $2)`, [validEventId, adminId]),
    (err) => err.code === '22023' && /greater than zero/i.test(err.message),
  )
  // Negative length
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'A', 1, 1, -1, 1, $2)`, [validEventId, adminId]),
    (err) => err.code === '22023' && /greater than zero/i.test(err.message),
  )
  // Non-positive pipe number
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'A', 1, 1, 1, 0, $2)`, [validEventId, adminId]),
    (err) => err.code === '22023' && /greater than zero/i.test(err.message),
  )
  // Extreme value
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'A', 100000000, 1, 1, 1, $2)`, [validEventId, adminId]),
    (err) => err.code === '22023',
  )
  // Round to zero
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'A', 0.001, 1, 1, 1, $2)`, [validEventId, adminId]),
    (err) => err.code === '22023',
  )

  await db.exec('reset role;')
})

test('batch_update_production_log_specs updates by ID array and preserves existing unmentioned fields', async (t) => {
  const db = await database(t)
  const sensors = await getSensors(db)
  const adminId = await getAdminUser(db)

  const id1 = await insertSensorEvent(db, { sensorId: sensors['S-05'].id, machineId: sensors['S-05'].machine_id })
  const id2 = await insertSensorEvent(db, { sensorId: sensors['S-05'].id, machineId: sensors['S-05'].machine_id })

  await db.exec('set role service_role;')
  // Pre-seed cut 1 with pipe number 42
  await db.query(
    `select * from public.update_production_log_spec($1, 'Original Client', 500.0, 10.0, 6000.0, 42, $2)`,
    [id1, adminId],
  )

  // Batch update setting customer, diameter, thickness, length on both cuts
  const batchResult = await db.query(
    `select * from public.batch_update_production_log_specs(
      $1::uuid[], null, null, false, 'Regan Industrial', 1020.0, 12.0, 9000.0, $2
    )`,
    [[id1, id2], adminId],
  )

  assert.equal(batchResult.rows[0].matched_count, 2)
  assert.equal(batchResult.rows[0].updated_count, 2)

  // Cut 1 should have updated customer/dimensions but preserved pipe_number = 42
  const row1 = (await db.query('select * from public.production_item_specs where sensor_event_id = $1', [id1])).rows[0]
  assert.equal(row1.customer, 'Regan Industrial')
  assert.equal(Number(row1.diameter), 1020.0)
  assert.equal(Number(row1.thickness), 12.0)
  assert.equal(Number(row1.length), 9000.0)
  assert.equal(row1.pipe_number, 42)

  // Cut 2 should have updated customer/dimensions and pipe_number is null
  const row2 = (await db.query('select * from public.production_item_specs where sensor_event_id = $1', [id2])).rows[0]
  assert.equal(row2.customer, 'Regan Industrial')
  assert.equal(Number(row2.diameter), 1020.0)
  assert.equal(Number(row2.thickness), 12.0)
  assert.equal(Number(row2.length), 9000.0)
  assert.equal(row2.pipe_number, null)

  const batchAudits = await db.query(`select * from public.audit_logs where action = 'PRODUCTION_SPEC_BATCH_UPDATED'`)
  assert.equal(batchAudits.rows.length, 1)
  assert.equal(batchAudits.rows[0].metadata.matchedCount, 2)
  assert.equal(batchAudits.rows[0].metadata.updatedCount, 2)

  // Idempotent retry
  const retryResult = await db.query(
    `select * from public.batch_update_production_log_specs(
      $1::uuid[], null, null, false, 'Regan Industrial', 1020.0, 12.0, 9000.0, $2
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
    `select * from public.update_production_log_spec($1, 'Existing Cut', 600.0, 10.0, 6000.0, 1, $2)`,
    [id1, adminId],
  )

  const result = await db.query(
    `select * from public.batch_update_production_log_specs(
      null, $1, $2, true, 'Window Client', 800.0, 12.0, 6000.0, $3
    )`,
    [windowStart, windowEnd, adminId],
  )

  assert.equal(result.rows[0].matched_count, 1)
  assert.equal(result.rows[0].updated_count, 1)
  assert.deepEqual(result.rows[0].sensor_event_ids, [id2])

  const row1 = (await db.query('select * from public.production_item_specs where sensor_event_id = $1', [id1])).rows[0]
  assert.equal(row1.customer, 'Existing Cut')

  const row2 = (await db.query('select * from public.production_item_specs where sensor_event_id = $1', [id2])).rows[0]
  assert.equal(row2.customer, 'Window Client')

  const outsideRow = (await db.query('select * from public.production_item_specs where sensor_event_id = $1', [outsideId])).rows
  assert.equal(outsideRow.length, 0)
  await db.exec('reset role;')
})

test('batch_update_production_log_specs enforces 500-record cap and validation rules', async (t) => {
  const db = await database(t)
  const sensors = await getSensors(db)
  const adminId = await getAdminUser(db)

  await db.exec('set role service_role;')

  // Rejects neither IDs nor window
  await assert.rejects(
    db.query(`select * from public.batch_update_production_log_specs(null, null, null, false, 'Tag', 500.0, null, null, $1)`, [adminId]),
    (err) => err.code === '22023' && /either a non-empty array.*or a time range/i.test(err.message),
  )

  // Rejects both IDs and window
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        array[$1]::uuid[], '2026-06-01T00:00:00Z', '2026-06-01T01:00:00Z', false, 'Tag', 500.0, null, null, $2
      )`,
      [randomUUID(), adminId],
    ),
    (err) => err.code === '22023' && /either a non-empty array.*or a time range/i.test(err.message),
  )

  // Rejects no spec fields
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        array[$1]::uuid[], null, null, false, null, null, null, null, $2
      )`,
      [randomUUID(), adminId],
    ),
    (err) => err.code === '22023' && /at least one specification field/i.test(err.message),
  )

  // Rejects array > 500
  const over500Ids = Array.from({ length: 501 }, () => randomUUID())
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        $1::uuid[], null, null, false, 'Tag', 500.0, null, null, $2
      )`,
      [over500Ids, adminId],
    ),
    (err) => err.code === '22023' && /cannot exceed 500 records/i.test(err.message),
  )

  // Inverted range
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        null, '2026-06-01T10:00:00Z', '2026-06-01T09:00:00Z', false, 'Tag', 500.0, null, null, $1
      )`,
      [adminId],
    ),
    (err) => err.code === '22023' && /started_at earlier than ended_at/i.test(err.message),
  )

  // Identical start and end
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        null, '2026-06-01T10:00:00Z', '2026-06-01T10:00:00Z', false, 'Tag', 500.0, null, null, $1
      )`,
      [adminId],
    ),
    (err) => err.code === '22023' && /started_at earlier than ended_at/i.test(err.message),
  )

  await db.exec('reset role;')
})
