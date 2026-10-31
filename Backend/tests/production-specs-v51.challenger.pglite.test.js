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

async function insertSensorEvent(db, {
  sensorId,
  machineId,
  eventType = 'pulse',
  outputAccepted = true,
  rejectionReason = null,
  recordedAt = '2026-06-01T08:00:00Z',
}) {
  const id = randomUUID()
  await db.query(`
    insert into sensor_events (id, sensor_id, machine_id, device_event_id, event_type, event_value, recorded_at, output_accepted, output_rejection_reason)
    values ($1, $2, $3, $4, $5, '{}'::jsonb, $6, $7, $8)
  `, [id, sensorId, machineId, randomUUID(), eventType, recordedAt, outputAccepted, rejectionReason])
  return id
}

test('ADVERSARIAL 1: customer boundary - 100 vs 101 chars, padding, whitespace trimming, and table constraints', async (t) => {
  const db = await database(t)
  const sensors = await getSensors(db)
  const adminId = await getAdminUser(db)
  const eventId = await insertSensorEvent(db, {
    sensorId: sensors['S-05'].id,
    machineId: sensors['S-05'].machine_id,
  })

  await db.exec('set role service_role;')

  // 1a. Exactly 100 chars -> should succeed
  const customer100 = 'A'.repeat(100)
  const res100 = await db.query(
    `select * from public.update_production_log_spec($1, $2, 600, 10, 6000, 1, $3)`,
    [eventId, customer100, adminId],
  )
  assert.equal(res100.rows[0].customer, customer100)
  assert.equal(res100.rows[0].customer.length, 100)

  // 1b. Exactly 101 chars -> must fail with 22023
  const customer101 = 'A'.repeat(101)
  await assert.rejects(
    db.query(
      `select * from public.update_production_log_spec($1, $2, 600, 10, 6000, 1, $3)`,
      [eventId, customer101, adminId],
    ),
    (err) => err.code === '22023' && /cannot exceed 100 characters/i.test(err.message),
  )

  // 1c. 100 chars with leading and trailing spaces (total 106 chars) -> trimmed to 100 chars -> must succeed
  const padded100 = '   ' + 'B'.repeat(100) + '   '
  const resPadded = await db.query(
    `select * from public.update_production_log_spec($1, $2, 600, 10, 6000, 1, $3)`,
    [eventId, padded100, adminId],
  )
  assert.equal(resPadded.rows[0].customer, 'B'.repeat(100))

  // 1d. 101 chars with spaces -> trimmed to 101 chars -> must fail with 22023
  const padded101 = '  ' + 'C'.repeat(101) + '  '
  await assert.rejects(
    db.query(
      `select * from public.update_production_log_spec($1, $2, 600, 10, 6000, 1, $3)`,
      [eventId, padded101, adminId],
    ),
    (err) => err.code === '22023' && /cannot exceed 100 characters/i.test(err.message),
  )

  // 1e. Whitespace only string '     ' -> trimmed to NULL
  const resWhitespace = await db.query(
    `select * from public.update_production_log_spec($1, '     ', 600, 10, 6000, 1, $2)`,
    [eventId, adminId],
  )
  assert.equal(resWhitespace.rows[0].customer, null)

  // 1f. Table constraint check directly: try to insert invalid customer into table directly (via bypassrls or superuser)
  await db.exec('reset role;')
  // Direct insert of empty string '' violates table check constraint
  const eventId2 = await insertSensorEvent(db, {
    sensorId: sensors['S-05'].id,
    machineId: sensors['S-05'].machine_id,
  })
  await assert.rejects(
    db.query(
      `insert into public.production_item_specs (sensor_event_id, customer) values ($1, '')`,
      [eventId2],
    ),
    (err) => /production_item_specs_customer_valid/.test(err.message),
  )
  // Direct insert of whitespace '   ' violates table check constraint
  await assert.rejects(
    db.query(
      `insert into public.production_item_specs (sensor_event_id, customer) values ($1, '    ')`,
      [eventId2],
    ),
    (err) => /production_item_specs_customer_valid/.test(err.message),
  )
  // Direct insert of 101 chars violates table check constraint
  await assert.rejects(
    db.query(
      `insert into public.production_item_specs (sensor_event_id, customer) values ($1, $2)`,
      [eventId2, 'Z'.repeat(101)],
    ),
    (err) => /production_item_specs_customer_valid/.test(err.message),
  )
})

test('ADVERSARIAL 2: dimension boundaries - zero, negative, fractional rounding, NaN', async (t) => {
  const db = await database(t)
  const sensors = await getSensors(db)
  const adminId = await getAdminUser(db)
  const eventId = await insertSensorEvent(db, {
    sensorId: sensors['S-05'].id,
    machineId: sensors['S-05'].machine_id,
  })

  await db.exec('set role service_role;')

  // 2a. Thickness zero -> 22023
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'MCWD', 500, 0, 6000, 1, $2)`, [eventId, adminId]),
    (err) => err.code === '22023' && /Thickness must be greater than zero/i.test(err.message),
  )

  // 2b. Thickness negative -> 22023
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'MCWD', 500, -0.01, 6000, 1, $2)`, [eventId, adminId]),
    (err) => err.code === '22023' && /Thickness must be greater than zero/i.test(err.message),
  )

  // 2c. Thickness sub-centimeter rounding to zero (0.004) -> round(0.004, 2) = 0.00 -> 22023
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'MCWD', 500, 0.004, 6000, 1, $2)`, [eventId, adminId]),
    (err) => err.code === '22023' && /Thickness must be greater than zero/i.test(err.message),
  )

  // 2d. Thickness 0.005 rounds to 0.01 -> succeeds
  const resSmallThickness = await db.query(
    `select * from public.update_production_log_spec($1, 'MCWD', 500, 0.005, 6000, 1, $2)`,
    [eventId, adminId],
  )
  assert.equal(Number(resSmallThickness.rows[0].thickness), 0.01)

  // 2e. Length zero -> 22023
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'MCWD', 500, 10, 0, 1, $2)`, [eventId, adminId]),
    (err) => err.code === '22023' && /Length must be greater than zero/i.test(err.message),
  )

  // 2f. Length negative -> 22023
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'MCWD', 500, 10, -500, 1, $2)`, [eventId, adminId]),
    (err) => err.code === '22023' && /Length must be greater than zero/i.test(err.message),
  )

  // 2g. Diameter zero -> 22023
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'MCWD', 0, 10, 6000, 1, $2)`, [eventId, adminId]),
    (err) => err.code === '22023' && /Diameter must be greater than zero/i.test(err.message),
  )

  // 2h. Diameter negative -> 22023
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'MCWD', -100, 10, 6000, 1, $2)`, [eventId, adminId]),
    (err) => err.code === '22023' && /Diameter must be greater than zero/i.test(err.message),
  )

  // 2i. Pipe number zero -> 22023
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'MCWD', 500, 10, 6000, 0, $2)`, [eventId, adminId]),
    (err) => err.code === '22023' && /Pipe number must be greater than zero/i.test(err.message),
  )

  // 2j. Pipe number negative -> 22023
  await assert.rejects(
    db.query(`select * from public.update_production_log_spec($1, 'MCWD', 500, 10, 6000, -10, $2)`, [eventId, adminId]),
    (err) => err.code === '22023' && /Pipe number must be greater than zero/i.test(err.message),
  )

  // 2k. Max 32-bit positive integer pipe_number (2147483647) -> succeeds
  const resMaxInt = await db.query(
    `select * from public.update_production_log_spec($1, 'MCWD', 500, 10, 6000, 2147483647, $2)`,
    [eventId, adminId],
  )
  assert.equal(resMaxInt.rows[0].pipe_number, 2147483647)

  // 2l. Table constraints directly for thickness, length, pipe_number
  await db.exec('reset role;')
  const eventIdDirect = await insertSensorEvent(db, {
    sensorId: sensors['S-05'].id,
    machineId: sensors['S-05'].machine_id,
  })
  await assert.rejects(
    db.query(`insert into public.production_item_specs (sensor_event_id, thickness) values ($1, 0)`, [eventIdDirect]),
    (err) => /production_item_specs_thickness_positive/.test(err.message),
  )
  await assert.rejects(
    db.query(`insert into public.production_item_specs (sensor_event_id, length) values ($1, 0)`, [eventIdDirect]),
    (err) => /production_item_specs_length_positive/.test(err.message),
  )
  await assert.rejects(
    db.query(`insert into public.production_item_specs (sensor_event_id, pipe_number) values ($1, 0)`, [eventIdDirect]),
    (err) => /production_item_specs_pipe_number_positive/.test(err.message),
  )
})

test('ADVERSARIAL 3: optimistic concurrency - 40001 triggers on stale, missing, and modified rows', async (t) => {
  const db = await database(t)
  const sensors = await getSensors(db)
  const adminId = await getAdminUser(db)
  const eventId = await insertSensorEvent(db, {
    sensorId: sensors['S-05'].id,
    machineId: sensors['S-05'].machine_id,
  })

  await db.exec('set role service_role;')

  // 3a. Initial create: caller expects non-existent row to match a fake timestamp -> must fail with 40001
  await assert.rejects(
    db.query(
      `select * from public.update_production_log_spec($1, 'Client', 500, 10, 6000, 1, $2, '2026-01-01T00:00:00Z')`,
      [eventId, adminId],
    ),
    (err) => err.code === '40001' && /modified by another user/i.test(err.message),
  )

  // 3b. Create row with null expected_updated_at -> succeeds
  const created = await db.query(
    `select * from public.update_production_log_spec($1, 'Client A', 500, 10, 6000, 1, $2, null)`,
    [eventId, adminId],
  )
  const t1 = created.rows[0].updated_at

  // 3c. User B updates the row -> new timestamp t2
  const updatedByB = await db.query(
    `select * from public.update_production_log_spec($1, 'Client B', 500, 10, 6000, 1, $2, $3)`,
    [eventId, adminId, t1],
  )
  const t2 = updatedByB.rows[0].updated_at
  assert.notEqual(t1.toISOString(), t2.toISOString())

  // 3d. User A attempts to update using stale timestamp t1 -> must fail with 40001
  await assert.rejects(
    db.query(
      `select * from public.update_production_log_spec($1, 'Client A Overwrite', 500, 10, 6000, 1, $2, $3)`,
      [eventId, adminId, t1],
    ),
    (err) => err.code === '40001' && /modified by another user/i.test(err.message),
  )

  // 3e. User A refreshes to t2 and updates -> succeeds
  const updatedByA = await db.query(
    `select * from public.update_production_log_spec($1, 'Client A Resolved', 500, 10, 6000, 1, $2, $3)`,
    [eventId, adminId, t2],
  )
  assert.equal(updatedByA.rows[0].customer, 'Client A Resolved')
})

test('ADVERSARIAL 4: rejected S-05 cut pulse immutability - single and batch updates strictly rejected', async (t) => {
  const db = await database(t)
  const sensors = await getSensors(db)
  const adminId = await getAdminUser(db)

  // S-05 pulse rejected (e.g., minimum duration violation / noise)
  const rejectedCutId = await insertSensorEvent(db, {
    sensorId: sensors['S-05'].id,
    machineId: sensors['S-05'].machine_id,
    eventType: 'pulse',
    outputAccepted: false,
    rejectionReason: 'server_debounce',
    recordedAt: '2026-06-03T10:00:00Z',
  })
  const acceptedCutId = await insertSensorEvent(db, {
    sensorId: sensors['S-05'].id,
    machineId: sensors['S-05'].machine_id,
    eventType: 'pulse',
    outputAccepted: true,
    recordedAt: '2026-06-03T10:05:00Z',
  })

  await db.exec('set role service_role;')

  // 4a. Single update on rejected cut -> must throw 22023
  await assert.rejects(
    db.query(
      `select * from public.update_production_log_spec($1, 'Attempted Spec', 600, 10, 6000, 1, $2)`,
      [rejectedCutId, adminId],
    ),
    (err) => err.code === '22023' && /view-only and cannot be edited/i.test(err.message),
  )

  // 4b. Batch update by ID array containing the rejected cut -> must fail entire batch with 22023
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        array[$1, $2]::uuid[], null, null, false, 'Batch Client', 800, 12, 6000, $3
      )`,
      [acceptedCutId, rejectedCutId, adminId],
    ),
    (err) => err.code === '22023' && /view-only and cannot be edited/i.test(err.message),
  )

  // 4c. Batch update by time window covering the rejected cut -> rejected cut must be omitted
  const timeWindowRes = await db.query(
    `select * from public.batch_update_production_log_specs(
      null, '2026-06-03T09:00:00Z', '2026-06-03T11:00:00Z', false, 'Window Client', 1000, 12, 9000, $1
    )`,
    [adminId],
  )
  assert.equal(timeWindowRes.rows[0].matched_count, 1)
  assert.equal(timeWindowRes.rows[0].updated_count, 1)
  assert.deepEqual(timeWindowRes.rows[0].sensor_event_ids, [acceptedCutId])

  // Verify rejected cut has NO row in production_item_specs
  const rejectedRow = await db.query(
    `select * from public.production_item_specs where sensor_event_id = $1`,
    [rejectedCutId],
  )
  assert.equal(rejectedRow.rows.length, 0)
})

test('ADVERSARIAL 5: batch update stress - duplicate IDs in array, array containing nulls, partial updates', async (t) => {
  const db = await database(t)
  const sensors = await getSensors(db)
  const adminId = await getAdminUser(db)

  const id1 = await insertSensorEvent(db, { sensorId: sensors['S-05'].id, machineId: sensors['S-05'].machine_id })
  const id2 = await insertSensorEvent(db, { sensorId: sensors['S-05'].id, machineId: sensors['S-05'].machine_id })

  await db.exec('set role service_role;')

  // 5a. Array with duplicate IDs: [id1, id1, id2] -> should deduplicate cleanly and update both
  const dedupRes = await db.query(
    `select * from public.batch_update_production_log_specs(
      array[$1, $1, $2]::uuid[], null, null, false, 'Dedup Client', 625.4, 10, 6000, $3
    )`,
    [id1, id2, adminId],
  )
  assert.equal(dedupRes.rows[0].matched_count, 2)
  assert.equal(dedupRes.rows[0].updated_count, 2)

  // 5b. Array containing null value: [id1, null] -> must throw 22023
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        array[$1, null]::uuid[], null, null, false, 'Client', 600, 10, 6000, $2
      )`,
      [id1, adminId],
    ),
    (err) => err.code === '22023' && /cannot contain null values/i.test(err.message),
  )

  // 5c. Partial batch update: update ONLY thickness without changing customer, diameter, length
  const partialRes = await db.query(
    `select * from public.batch_update_production_log_specs(
      array[$1]::uuid[], null, null, false, null, null, 14.5, null, $2
    )`,
    [id1, adminId],
  )
  assert.equal(partialRes.rows[0].updated_count, 1)

  const checkRow1 = (await db.query(`select * from public.production_item_specs where sensor_event_id = $1`, [id1])).rows[0]
  assert.equal(checkRow1.customer, 'Dedup Client') // Preserved!
  assert.equal(Number(checkRow1.diameter), 625.40) // Preserved!
  assert.equal(Number(checkRow1.thickness), 14.50) // Updated!
  assert.equal(Number(checkRow1.length), 6000.00) // Preserved!
})
