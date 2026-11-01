const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const databaseRoot = path.resolve(__dirname, '../../database')

async function setupDatabase(t) {
  const migrations = fs.readdirSync(path.join(databaseRoot, 'migrations'))
    .filter((name) => {
      const match = /^(\d{3})_.*\.sql$/.exec(name)
      return match && Number(match[1]) >= 29 && Number(match[1]) <= 51
    })
    .sort()
    .map((name) => fs.readFileSync(path.join(databaseRoot, 'migrations', name), 'utf8'))

  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
  ])

  const db = await PGlite.create({ extensions: { pgcrypto } })
  t.after(() => db.close())

  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
  await db.exec(fs.readFileSync(path.join(databaseRoot, 'schema.sql'), 'utf8'))
  await db.exec(fs.readFileSync(path.join(databaseRoot, 'seed.sql'), 'utf8'))
  await db.query(`insert into users(name, username, password_hash, must_change_password, role_id)
    select 'Challenger Admin', 'challenger-admin', 'hash', false, id from roles where name = 'Admin'`)

  for (const migration of migrations) {
    await db.exec(migration)
  }

  return db
}

async function getAdminUser(db) {
  const result = await db.query(`select id from users where username = 'challenger-admin'`)
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

test('CHALLENGE 1: 500-record hard cap behavior (ID array and Time Window boundaries)', async (t) => {
  const db = await setupDatabase(t)
  const sensors = await getSensors(db)
  const adminId = await getAdminUser(db)

  await db.exec('set role service_role;')

  // 1a: ID array of 501 items -> MUST throw 22023
  const over500Ids = Array.from({ length: 501 }, () => randomUUID())
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        $1::uuid[], null, null, false, 'Client Cap', 500.0, 10.0, 6000.0, $2
      )`,
      [over500Ids, adminId],
    ),
    (err) => err.code === '22023' && /cannot exceed 500 records/i.test(err.message),
    'Should reject ID array > 500'
  )

  // 1b: 501 items with duplicates where distinct count = 500 -> MUST NOT throw cap error
  // Insert 500 real events
  const s05Id = sensors['S-05'].id
  const machineId = sensors['S-05'].machine_id

  // Bulk insert 500 events using generate_series for speed (must be run as superuser)
  await db.exec('reset role;')
  await db.query(`
    insert into sensor_events (id, sensor_id, machine_id, device_event_id, event_type, event_value, recorded_at, output_accepted)
    select
      gen_random_uuid(),
      $1,
      $2,
      gen_random_uuid(),
      'pulse',
      '{}'::jsonb,
      ($3::timestamptz + (s || ' seconds')::interval),
      true
    from generate_series(1, 500) as s
  `, [s05Id, machineId, '2026-06-05T00:00:00Z'])

  const eventsResult = await db.query(`
    select id from sensor_events
    where sensor_id = $1 and recorded_at >= '2026-06-05T00:00:00Z' and recorded_at < '2026-06-05T01:00:00Z'
    order by recorded_at asc
  `, [s05Id])

  assert.equal(eventsResult.rows.length, 500, 'Should have created 500 events')
  const exactly500Ids = eventsResult.rows.map((r) => r.id)

  // Duplicate the first ID to make length 501, but distinct 500
  const arrayWithDupe501 = [exactly500Ids[0], ...exactly500Ids]
  assert.equal(arrayWithDupe501.length, 501)

  await db.exec('set role service_role;')
  const dupeBatchResult = await db.query(
    `select * from public.batch_update_production_log_specs(
      $1::uuid[], null, null, false, 'Dupe Test Customer', 600.0, 10.0, 6000.0, $2
    )`,
    [arrayWithDupe501, adminId],
  )
  assert.equal(dupeBatchResult.rows[0].matched_count, 500, 'Distinct count is 500, should succeed')
  assert.equal(dupeBatchResult.rows[0].updated_count, 500, 'Should update 500 events')

  // 1c: Time window with exactly 500 events -> MUST succeed
  // Reset spec to null on those 500
  await db.exec('reset role;')
  await db.query(`delete from public.production_item_specs where sensor_event_id = any($1::uuid[])`, [exactly500Ids])

  await db.exec('set role service_role;')
  const timeWindowExactResult = await db.query(
    `select * from public.batch_update_production_log_specs(
      null, '2026-06-05T00:00:00Z', '2026-06-05T00:10:00Z', false, 'Window 500 Customer', 800.0, 12.0, 9000.0, $1
    )`,
    [adminId],
  )
  assert.equal(timeWindowExactResult.rows[0].matched_count, 500, 'Exactly 500 in window should match')
  assert.equal(timeWindowExactResult.rows[0].updated_count, 500, 'Exactly 500 in window should update')

  // 1d: Time window with 501 events -> MUST throw 22023 cap error
  // Add 1 more event inside the window
  await db.exec('reset role;')
  await insertSensorEvent(db, {
    sensorId: s05Id,
    machineId,
    recordedAt: '2026-06-05T00:05:00Z',
  })

  await db.exec('set role service_role;')

  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        null, '2026-06-05T00:00:00Z', '2026-06-05T00:10:00Z', false, 'Over Limit Customer', 800.0, 12.0, 9000.0, $1
      )`,
      [adminId],
    ),
    (err) => err.code === '22023' && /cannot exceed 500 records/i.test(err.message),
    'Time window with 501 events must trigger 500-record cap exception'
  )

  await db.exec('reset role;')
})

test('CHALLENGE 2: Mutual exclusivity between ID array and time window', async (t) => {
  const db = await setupDatabase(t)
  const sensors = await getSensors(db)
  const adminId = await getAdminUser(db)
  const sampleId = await insertSensorEvent(db, {
    sensorId: sensors['S-05'].id,
    machineId: sensors['S-05'].machine_id,
  })

  await db.exec('set role service_role;')

  // 2a: Both IDs and full time window provided
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        $1::uuid[], '2026-06-01T00:00:00Z', '2026-06-01T01:00:00Z', false, 'Client', 500.0, 10.0, 6000.0, $2
      )`,
      [[sampleId], adminId],
    ),
    (err) => err.code === '22023' && /either a non-empty array.*or a time range, but not both/i.test(err.message),
    'Must reject both IDs and full time window'
  )

  // 2b: IDs and ONLY started_at provided
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        $1::uuid[], '2026-06-01T00:00:00Z', null, false, 'Client', 500.0, 10.0, 6000.0, $2
      )`,
      [[sampleId], adminId],
    ),
    (err) => err.code === '22023' && /either a non-empty array.*or a time range, but not both/i.test(err.message),
    'Must reject IDs and started_at'
  )

  // 2c: IDs and ONLY ended_at provided
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        $1::uuid[], null, '2026-06-01T01:00:00Z', false, 'Client', 500.0, 10.0, 6000.0, $2
      )`,
      [[sampleId], adminId],
    ),
    (err) => err.code === '22023' && /either a non-empty array.*or a time range, but not both/i.test(err.message),
    'Must reject IDs and ended_at'
  )

  // 2d: Neither IDs nor time window provided (both null)
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        null, null, null, false, 'Client', 500.0, 10.0, 6000.0, $1
      )`,
      [adminId],
    ),
    (err) => err.code === '22023' && /either a non-empty array.*or a time range, but not both/i.test(err.message),
    'Must reject both null'
  )

  // 2e: Empty array of IDs and no window
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        '{}'::uuid[], null, null, false, 'Client', 500.0, 10.0, 6000.0, $1
      )`,
      [adminId],
    ),
    (err) => err.code === '22023',
    'Must reject empty ID array with no window'
  )

  // 2j: Empty array of IDs AND a valid time window
  // When an empty array '{}' is passed, array_length evaluates to NULL; the RPC falls through into the time window logic.
  // We empirically assert that this does not error out on mutual exclusivity because array_length is null.
  const emptyArrayWithWindowRes = await db.query(
    `select * from public.batch_update_production_log_specs(
      '{}'::uuid[], '2026-06-01T00:00:00Z', '2026-06-01T01:00:00Z', false, 'Client', 500.0, 10.0, 6000.0, $1
    )`,
    [adminId],
  )
  assert.equal(emptyArrayWithWindowRes.rows.length, 1)




  // 2f: Null ID array and incomplete window (started_at only)
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        null, '2026-06-01T00:00:00Z', null, false, 'Client', 500.0, 10.0, 6000.0, $1
      )`,
      [adminId],
    ),
    (err) => err.code === '22023' && /started_at earlier than ended_at/i.test(err.message),
    'Must reject window with started_at only'
  )

  // 2g: Null ID array and incomplete window (ended_at only)
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        null, null, '2026-06-01T01:00:00Z', false, 'Client', 500.0, 10.0, 6000.0, $1
      )`,
      [adminId],
    ),
    (err) => err.code === '22023' && /started_at earlier than ended_at/i.test(err.message),
    'Must reject window with ended_at only'
  )

  // 2h: Started_at >= ended_at
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        null, '2026-06-01T02:00:00Z', '2026-06-01T01:00:00Z', false, 'Client', 500.0, 10.0, 6000.0, $1
      )`,
      [adminId],
    ),
    (err) => err.code === '22023' && /started_at earlier than ended_at/i.test(err.message),
    'Must reject inverted window'
  )

  // 2i: ID array containing a null element
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        $1::uuid[], null, null, false, 'Client', 500.0, 10.0, 6000.0, $2
      )`,
      [[sampleId, null], adminId],
    ),
    (err) => err.code === '22023' && /cannot contain null values/i.test(err.message),
    'Must reject ID array containing null'
  )

  await db.exec('reset role;')
})

test('CHALLENGE 3: Preservation of existing pipe_number during batch spec updates', async (t) => {
  const db = await setupDatabase(t)
  const sensors = await getSensors(db)
  const adminId = await getAdminUser(db)

  const s05Id = sensors['S-05'].id
  const machineId = sensors['S-05'].machine_id

  // Create 3 cuts:
  // Cut A: has pipe_number = 101, custom specs
  // Cut B: has pipe_number = 102, no dimensions
  // Cut C: has NO spec row at all
  const idA = await insertSensorEvent(db, { sensorId: s05Id, machineId, recordedAt: '2026-06-03T08:01:00Z' })
  const idB = await insertSensorEvent(db, { sensorId: s05Id, machineId, recordedAt: '2026-06-03T08:02:00Z' })
  const idC = await insertSensorEvent(db, { sensorId: s05Id, machineId, recordedAt: '2026-06-03T08:03:00Z' })

  await db.exec('set role service_role;')

  // Seed Cut A
  await db.query(
    `select * from public.update_production_log_spec($1, 'Initial Client A', 500.0, 10.0, 6000.0, 101, $2)`,
    [idA, adminId],
  )

  // Seed Cut B with pipe_number = 102 but all other fields null
  await db.query(
    `select * from public.update_production_log_spec($1, null, null, null, null, 102, $2)`,
    [idB, adminId],
  )

  // Verify initial state
  const specA_before = (await db.query('select * from public.production_item_specs where sensor_event_id = $1', [idA])).rows[0]
  assert.equal(specA_before.pipe_number, 101)
  assert.equal(specA_before.customer, 'Initial Client A')

  const specB_before = (await db.query('select * from public.production_item_specs where sensor_event_id = $1', [idB])).rows[0]
  assert.equal(specB_before.pipe_number, 102)
  assert.equal(specB_before.customer, null)

  const specC_before = (await db.query('select * from public.production_item_specs where sensor_event_id = $1', [idC])).rows
  assert.equal(specC_before.length, 0)

  // Execute batch update applying new customer and dimensions to all 3 cuts
  const batchRes = await db.query(
    `select * from public.batch_update_production_log_specs(
      $1::uuid[], null, null, false, 'Consolidated Steel Corp', 1120.0, 14.0, 12000.0, $2
    )`,
    [[idA, idB, idC], adminId],
  )

  assert.equal(batchRes.rows[0].matched_count, 3)
  assert.equal(batchRes.rows[0].updated_count, 3)

  // Verify Cut A: pipe_number MUST STILL BE 101!
  const specA_after = (await db.query('select * from public.production_item_specs where sensor_event_id = $1', [idA])).rows[0]
  assert.equal(specA_after.pipe_number, 101, 'Cut A pipe_number must remain 101')
  assert.equal(specA_after.customer, 'Consolidated Steel Corp')
  assert.equal(Number(specA_after.diameter), 1120.0)
  assert.equal(Number(specA_after.thickness), 14.0)
  assert.equal(Number(specA_after.length), 12000.0)

  // Verify Cut B: pipe_number MUST STILL BE 102!
  const specB_after = (await db.query('select * from public.production_item_specs where sensor_event_id = $1', [idB])).rows[0]
  assert.equal(specB_after.pipe_number, 102, 'Cut B pipe_number must remain 102')
  assert.equal(specB_after.customer, 'Consolidated Steel Corp')
  assert.equal(Number(specB_after.diameter), 1120.0)
  assert.equal(Number(specB_after.thickness), 14.0)
  assert.equal(Number(specB_after.length), 12000.0)

  // Verify Cut C: pipe_number was not set, so should remain null
  const specC_after = (await db.query('select * from public.production_item_specs where sensor_event_id = $1', [idC])).rows[0]
  assert.equal(specC_after.pipe_number, null, 'Cut C pipe_number must remain null')
  assert.equal(specC_after.customer, 'Consolidated Steel Corp')
  assert.equal(Number(specC_after.diameter), 1120.0)
  assert.equal(Number(specC_after.thickness), 14.0)
  assert.equal(Number(specC_after.length), 12000.0)

  // Verify Audit Log: does NOT corrupt or inject pipe_number
  const auditRes = await db.query(
    `select * from public.audit_logs where action = 'PRODUCTION_SPEC_BATCH_UPDATED' order by created_at desc limit 1`
  )
  assert.equal(auditRes.rows.length, 1)
  const audit = auditRes.rows[0]
  assert.equal(audit.metadata.appliedSpec.customer, 'Consolidated Steel Corp')
  assert.equal(audit.metadata.appliedSpec.diameter, 1120.0)
  assert.equal(audit.metadata.appliedSpec.pipeNumber, undefined, 'Audit log appliedSpec must not contain pipeNumber')

  await db.exec('reset role;')
})

test('CHALLENGE 4: only_unlabeled filter correctness across all fields and both selection modes', async (t) => {
  const db = await setupDatabase(t)
  const sensors = await getSensors(db)
  const adminId = await getAdminUser(db)

  const s05Id = sensors['S-05'].id
  const machineId = sensors['S-05'].machine_id

  // We test 9 scenarios:
  // 1. Cut has no spec row -> UNLABELED (should match)
  // 2. Cut has spec row with all fields NULL -> UNLABELED (should match)
  // 3. Cut has ONLY pipe_number -> LABELED (should NOT match)
  // 4. Cut has ONLY legacy label -> LABELED (should NOT match)
  // 5. Cut has ONLY legacy size -> LABELED (should NOT match)
  // 6. Cut has ONLY customer -> LABELED (should NOT match)
  // 7. Cut has ONLY diameter -> LABELED (should NOT match)
  // 8. Cut has ONLY thickness -> LABELED (should NOT match)
  // 9. Cut has ONLY length -> LABELED (should NOT match)

  const startTime = '2026-06-04T00:00:00Z'
  const makeTime = (min) => `2026-06-04T00:${String(min).padStart(2, '0')}:00Z`

  const idNoSpec = await insertSensorEvent(db, { sensorId: s05Id, machineId, recordedAt: makeTime(1) })
  const idAllNull = await insertSensorEvent(db, { sensorId: s05Id, machineId, recordedAt: makeTime(2) })
  const idOnlyPipeNum = await insertSensorEvent(db, { sensorId: s05Id, machineId, recordedAt: makeTime(3) })
  const idOnlyLabel = await insertSensorEvent(db, { sensorId: s05Id, machineId, recordedAt: makeTime(4) })
  const idOnlySize = await insertSensorEvent(db, { sensorId: s05Id, machineId, recordedAt: makeTime(5) })
  const idOnlyCust = await insertSensorEvent(db, { sensorId: s05Id, machineId, recordedAt: makeTime(6) })
  const idOnlyDiam = await insertSensorEvent(db, { sensorId: s05Id, machineId, recordedAt: makeTime(7) })
  const idOnlyThick = await insertSensorEvent(db, { sensorId: s05Id, machineId, recordedAt: makeTime(8) })
  const idOnlyLen = await insertSensorEvent(db, { sensorId: s05Id, machineId, recordedAt: makeTime(9) })

  await db.exec('set role service_role;')

  // Seed specs directly or via RPC (run under superuser role)
  await db.exec('reset role;')
  // 2. All null spec row
  await db.query(`insert into public.production_item_specs (sensor_event_id, updated_at) values ($1, now())`, [idAllNull])
  // 3. Only pipe_number
  await db.query(`insert into public.production_item_specs (sensor_event_id, pipe_number, updated_at) values ($1, 77, now())`, [idOnlyPipeNum])
  // 4. Only legacy label
  await db.query(`insert into public.production_item_specs (sensor_event_id, label, updated_at) values ($1, 'LEGACY-HEAT-1', now())`, [idOnlyLabel])
  // 5. Only legacy size
  await db.query(`insert into public.production_item_specs (sensor_event_id, size, updated_at) values ($1, '600mm', now())`, [idOnlySize])
  // 6. Only customer
  await db.query(`insert into public.production_item_specs (sensor_event_id, customer, updated_at) values ($1, 'Acme Corp', now())`, [idOnlyCust])
  // 7. Only diameter
  await db.query(`insert into public.production_item_specs (sensor_event_id, diameter, updated_at) values ($1, 800.0, now())`, [idOnlyDiam])
  // 8. Only thickness
  await db.query(`insert into public.production_item_specs (sensor_event_id, thickness, updated_at) values ($1, 12.0, now())`, [idOnlyThick])
  // 9. Only length
  await db.query(`insert into public.production_item_specs (sensor_event_id, length, updated_at) values ($1, 6000.0, now())`, [idOnlyLen])

  // --- Test 4A: ID array mode with only_unlabeled = true ---
  const allIds = [idNoSpec, idAllNull, idOnlyPipeNum, idOnlyLabel, idOnlySize, idOnlyCust, idOnlyDiam, idOnlyThick, idOnlyLen]

  await db.exec('set role service_role;')
  const arrayResult = await db.query(
    `select * from public.batch_update_production_log_specs(
      $1::uuid[], null, null, true, 'Unlabeled Array Client', 625.4, 10.0, 6000.0, $2
    )`,
    [allIds, adminId],
  )

  assert.equal(arrayResult.rows[0].matched_count, 2, 'In ID array mode, exactly 2 events should match (noSpec and allNull)')
  assert.equal(arrayResult.rows[0].updated_count, 2, 'In ID array mode, exactly 2 events should update')
  const matchedSetArray = new Set(arrayResult.rows[0].sensor_event_ids)
  assert.ok(matchedSetArray.has(idNoSpec), 'idNoSpec must be updated')
  assert.ok(matchedSetArray.has(idAllNull), 'idAllNull must be updated')
  assert.ok(!matchedSetArray.has(idOnlyPipeNum), 'idOnlyPipeNum must NOT be updated')
  assert.ok(!matchedSetArray.has(idOnlyLabel), 'idOnlyLabel must NOT be updated')
  assert.ok(!matchedSetArray.has(idOnlySize), 'idOnlySize must NOT be updated')
  assert.ok(!matchedSetArray.has(idOnlyCust), 'idOnlyCust must NOT be updated')
  assert.ok(!matchedSetArray.has(idOnlyDiam), 'idOnlyDiam must NOT be updated')
  assert.ok(!matchedSetArray.has(idOnlyThick), 'idOnlyThick must NOT be updated')
  assert.ok(!matchedSetArray.has(idOnlyLen), 'idOnlyLen must NOT be updated')

  // --- Test 4B: Time window mode with only_unlabeled = true ---
  // Create a second batch of 9 cuts for a fresh time window
  await db.exec('reset role;')
  const makeTime2 = (min) => `2026-06-04T01:${String(min).padStart(2, '0')}:00Z`
  const idNoSpec2 = await insertSensorEvent(db, { sensorId: s05Id, machineId, recordedAt: makeTime2(1) })
  const idAllNull2 = await insertSensorEvent(db, { sensorId: s05Id, machineId, recordedAt: makeTime2(2) })
  const idOnlyPipeNum2 = await insertSensorEvent(db, { sensorId: s05Id, machineId, recordedAt: makeTime2(3) })
  const idOnlyLabel2 = await insertSensorEvent(db, { sensorId: s05Id, machineId, recordedAt: makeTime2(4) })
  const idOnlySize2 = await insertSensorEvent(db, { sensorId: s05Id, machineId, recordedAt: makeTime2(5) })
  const idOnlyCust2 = await insertSensorEvent(db, { sensorId: s05Id, machineId, recordedAt: makeTime2(6) })
  const idOnlyDiam2 = await insertSensorEvent(db, { sensorId: s05Id, machineId, recordedAt: makeTime2(7) })
  const idOnlyThick2 = await insertSensorEvent(db, { sensorId: s05Id, machineId, recordedAt: makeTime2(8) })
  const idOnlyLen2 = await insertSensorEvent(db, { sensorId: s05Id, machineId, recordedAt: makeTime2(9) })

  await db.query(`insert into public.production_item_specs (sensor_event_id, updated_at) values ($1, now())`, [idAllNull2])
  await db.query(`insert into public.production_item_specs (sensor_event_id, pipe_number, updated_at) values ($1, 78, now())`, [idOnlyPipeNum2])
  await db.query(`insert into public.production_item_specs (sensor_event_id, label, updated_at) values ($1, 'LEGACY-HEAT-2', now())`, [idOnlyLabel2])
  await db.query(`insert into public.production_item_specs (sensor_event_id, size, updated_at) values ($1, '800mm', now())`, [idOnlySize2])
  await db.query(`insert into public.production_item_specs (sensor_event_id, customer, updated_at) values ($1, 'Beta Inc', now())`, [idOnlyCust2])
  await db.query(`insert into public.production_item_specs (sensor_event_id, diameter, updated_at) values ($1, 900.0, now())`, [idOnlyDiam2])
  await db.query(`insert into public.production_item_specs (sensor_event_id, thickness, updated_at) values ($1, 14.0, now())`, [idOnlyThick2])
  await db.query(`insert into public.production_item_specs (sensor_event_id, length, updated_at) values ($1, 9000.0, now())`, [idOnlyLen2])

  await db.exec('set role service_role;')
  const windowResult = await db.query(
    `select * from public.batch_update_production_log_specs(
      null, '2026-06-04T01:00:00Z', '2026-06-04T01:30:00Z', true, 'Unlabeled Window Client', 1020.0, 12.7, 12000.0, $1
    )`,
    [adminId],
  )

  assert.equal(windowResult.rows[0].matched_count, 2, 'In time window mode, exactly 2 events should match (noSpec2 and allNull2)')
  assert.equal(windowResult.rows[0].updated_count, 2, 'In time window mode, exactly 2 events should update')
  const matchedSetWindow = new Set(windowResult.rows[0].sensor_event_ids)
  assert.ok(matchedSetWindow.has(idNoSpec2), 'idNoSpec2 must be updated')
  assert.ok(matchedSetWindow.has(idAllNull2), 'idAllNull2 must be updated')
  assert.ok(!matchedSetWindow.has(idOnlyPipeNum2), 'idOnlyPipeNum2 must NOT be updated')
  assert.ok(!matchedSetWindow.has(idOnlyLabel2), 'idOnlyLabel2 must NOT be updated')
  assert.ok(!matchedSetWindow.has(idOnlySize2), 'idOnlySize2 must NOT be updated')
  assert.ok(!matchedSetWindow.has(idOnlyCust2), 'idOnlyCust2 must NOT be updated')
  assert.ok(!matchedSetWindow.has(idOnlyDiam2), 'idOnlyDiam2 must NOT be updated')
  assert.ok(!matchedSetWindow.has(idOnlyThick2), 'idOnlyThick2 must NOT be updated')
  assert.ok(!matchedSetWindow.has(idOnlyLen2), 'idOnlyLen2 must NOT be updated')

  await db.exec('reset role;')
})

test('CHALLENGE 5: Adversarial edge cases on rejected cuts, non S-05 events, and dimension boundaries in batch', async (t) => {
  const db = await setupDatabase(t)
  const sensors = await getSensors(db)
  const adminId = await getAdminUser(db)

  const s05Id = sensors['S-05'].id
  const s01Id = sensors['S-01'].id
  const machineId = sensors['S-05'].machine_id

  const validAcceptedCut = await insertSensorEvent(db, { sensorId: s05Id, machineId, outputAccepted: true })
  const rejectedCut = await insertSensorEvent(db, { sensorId: s05Id, machineId, outputAccepted: false, rejectionReason: 'stale_event' })
  const s01Event = await insertSensorEvent(db, { sensorId: s01Id, machineId, outputAccepted: true })

  await db.exec('set role service_role;')

  // 5a: Batch update containing a rejected cut in ID array -> MUST throw 22023
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        $1::uuid[], null, null, false, 'Client', 500.0, 10.0, 6000.0, $2
      )`,
      [[validAcceptedCut, rejectedCut], adminId],
    ),
    (err) => err.code === '22023' && /view-only and cannot be edited/i.test(err.message),
    'Must reject batch containing rejected cut'
  )

  // 5b: Batch update containing non S-05 event in ID array -> MUST throw 22023
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        $1::uuid[], null, null, false, 'Client', 500.0, 10.0, 6000.0, $2
      )`,
      [[validAcceptedCut, s01Event], adminId],
    ),
    (err) => err.code === '22023' && /only be assigned to S-05/i.test(err.message),
    'Must reject batch containing non-S05 event'
  )

  // 5c: Batch update with blank customer string ('   ') -> should be coerced to null
  // But if all other fields are null, must reject with 'Provide at least one specification field'
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        $1::uuid[], null, null, false, '   ', null, null, null, $2
      )`,
      [[validAcceptedCut], adminId],
    ),
    (err) => err.code === '22023' && /Provide at least one specification field/i.test(err.message),
    'Whitespace customer without dimensions must be rejected as no fields'
  )

  // 5d: Batch update with customer > 100 characters -> MUST throw 22023
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        $1::uuid[], null, null, false, $2, 500.0, 10.0, 6000.0, $3
      )`,
      [[validAcceptedCut], 'A'.repeat(101), adminId],
    ),
    (err) => err.code === '22023' && /cannot exceed 100 characters/i.test(err.message),
    'Customer > 100 characters must be rejected'
  )

  // 5e: Negative diameter in batch -> MUST throw 22023
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        $1::uuid[], null, null, false, 'Client', -10.0, 10.0, 6000.0, $2
      )`,
      [[validAcceptedCut], adminId],
    ),
    (err) => err.code === '22023' && /greater than zero/i.test(err.message),
    'Negative diameter must be rejected'
  )

  // 5f: Zero thickness in batch -> MUST throw 22023
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        $1::uuid[], null, null, false, 'Client', 500.0, 0, 6000.0, $2
      )`,
      [[validAcceptedCut], adminId],
    ),
    (err) => err.code === '22023' && /greater than zero/i.test(err.message),
    'Zero thickness must be rejected'
  )

  // 5g: Negative length in batch -> MUST throw 22023
  await assert.rejects(
    db.query(
      `select * from public.batch_update_production_log_specs(
        $1::uuid[], null, null, false, 'Client', 500.0, 10.0, -100.0, $2
      )`,
      [[validAcceptedCut], adminId],
    ),
    (err) => err.code === '22023' && /greater than zero/i.test(err.message),
    'Negative length must be rejected'
  )

  await db.exec('reset role;')
})
