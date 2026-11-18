const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { getEligibleSeconds } = require('../../src/shared/operationalTime')

const databaseRoot = path.resolve(__dirname, '../../database')
const releaseSchemaVersion = 59

async function createMigratedDatabase(t, migrationEnd = releaseSchemaVersion) {
  const migrations = fs.readdirSync(path.join(databaseRoot, 'migrations'))
    .filter((name) => {
      const match = /^(\d{3})_.*\.sql$/.exec(name)
      return match && Number(match[1]) >= 29 && Number(match[1]) <= migrationEnd
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
  await db.query(`
    insert into public.users (name, username, password_hash, must_change_password, role_id)
    select 'Calendar Admin', 'calendar-admin', 'hash', false, id
    from public.roles
    where name = 'Admin'
  `)
  for (const migration of migrations) {
    await db.exec(migration)
  }
  return db
}

async function getFixtureIds(db) {
  const machineId = (await db.query("select id from public.machines where machine_code = 'M-01'")).rows[0].id
  const adminId = (await db.query("select id from public.users where username = 'calendar-admin'")).rows[0].id
  const s01Id = (await db.query("select id from public.sensors where sensor_code = 'S-01'")).rows[0].id
  return { machineId, adminId, s01Id }
}

test('migration 059 seeds 27 future holidays, rotates M-01 restDays to Sunday, and is idempotent on reapply', async (t) => {
  const db = await createMigratedDatabase(t)
  const { machineId } = await getFixtureIds(db)

  const migration059 = fs.readFileSync(
    path.join(databaseRoot, 'migrations', '059_add_production_calendar.sql'),
    'utf8',
  )
  await db.exec(migration059)

  await db.exec('set role service_role;')
  const readiness = (await db.query('select public.get_backend_readiness() as version')).rows[0].version
  assert.equal(readiness, 59)

  const settings = (await db.query(
    'select version, shift_schedule from public.machine_operational_settings where machine_id = $1',
    [machineId],
  )).rows[0]
  assert.equal(Number(settings.version), 2)
  assert.deepEqual(settings.shift_schedule.restDays, ['sunday'])

  const historyRows = (await db.query(`
    select version, shift_schedule, effective_from, effective_to
    from public.machine_operational_settings_history
    where machine_id = $1
    order by version asc
  `, [machineId])).rows
  assert.equal(historyRows.length, 2)
  assert.equal(Number(historyRows[0].version), 1)
  assert.equal(historyRows[0].shift_schedule.restDays, undefined)
  assert.ok(historyRows[0].effective_to)
  assert.equal(Number(historyRows[1].version), 2)
  assert.deepEqual(historyRows[1].shift_schedule.restDays, ['sunday'])
  assert.equal(historyRows[1].effective_to, null)

  const holidays = (await db.query(`
    select calendar_date::text as calendar_date, name, day_type, is_working, source
    from public.production_calendar_days
    where machine_id = $1
    order by calendar_date asc
  `, [machineId])).rows
  assert.equal(holidays.length, 27)
  assert.equal(holidays.filter((row) => !row.is_working).length, 14)
  assert.equal(holidays.filter((row) => row.is_working).length, 13)
  assert.deepEqual(holidays[0], {
    calendar_date: '2026-11-30',
    name: 'Bonifacio Day',
    day_type: 'holiday',
    is_working: true,
    source: 'seeded',
  })
  assert.deepEqual(holidays.find((row) => row.calendar_date === '2026-12-25'), {
    calendar_date: '2026-12-25',
    name: 'Christmas Day',
    day_type: 'holiday',
    is_working: false,
    source: 'seeded',
  })
  await db.exec('reset role;')
})

test('weekly Sunday rest day yields 0 eligible seconds after migration while preserving historical Sundays', async (t) => {
  const db = await createMigratedDatabase(t)
  const { machineId, adminId } = await getFixtureIds(db)

  await db.query(`
    update public.machine_operational_settings_history
    set effective_to = '2026-11-16T02:00:00Z'::timestamptz
    where machine_id = $1 and version = 1
  `, [machineId])
  await db.query(`
    update public.machine_operational_settings_history
    set effective_from = '2026-11-16T02:00:00Z'::timestamptz
    where machine_id = $1 and version = 2
  `, [machineId])

  const pastSunday = (await db.query(
    `select public.watchdog_eligible_seconds(
      $1,
      '2026-11-15T00:00:00+08:00'::timestamptz,
      '2026-11-16T00:00:00+08:00'::timestamptz
    ) as seconds`,
    [machineId],
  )).rows[0].seconds
  assert.equal(Number(pastSunday), 420 * 60)

  const futureSunday = (await db.query(
    `select public.watchdog_eligible_seconds(
      $1,
      '2026-11-22T00:00:00+08:00'::timestamptz,
      '2026-11-23T00:00:00+08:00'::timestamptz
    ) as seconds`,
    [machineId],
  )).rows[0].seconds
  assert.equal(Number(futureSunday), 0)

  const currentSettings = (await db.query(
    'select version, sensor_thresholds, shift_schedule from public.machine_operational_settings where machine_id = $1',
    [machineId],
  )).rows[0]

  await assert.rejects(
    db.query(
      'select * from public.update_machine_operational_settings($1, $2, $3::jsonb, $4::jsonb, $5)',
      [
        machineId,
        currentSettings.version,
        JSON.stringify(currentSettings.sensor_thresholds),
        JSON.stringify({
          ...currentSettings.shift_schedule,
          restDays: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
        }),
        adminId,
      ],
    ),
    (error) => error.code === '22023',
  )

  await assert.rejects(
    db.query(
      'select * from public.update_machine_operational_settings($1, $2, $3::jsonb, $4::jsonb, $5)',
      [
        machineId,
        currentSettings.version,
        JSON.stringify(currentSettings.sensor_thresholds),
        JSON.stringify({
          ...currentSettings.shift_schedule,
          restDays: ['funday'],
        }),
        adminId,
      ],
    ),
    (error) => error.code === '22023',
  )
})

test('set_production_calendar_day toggles seeded holidays, overrides Sunday rest days, and is idempotent on retry', async (t) => {
  const db = await createMigratedDatabase(t)
  const { machineId, adminId } = await getFixtureIds(db)

  await db.query(`
    update public.machine_operational_settings_history
    set effective_to = '2026-11-16T02:00:00Z'::timestamptz
    where machine_id = $1 and version = 1
  `, [machineId])
  await db.query(`
    update public.machine_operational_settings_history
    set effective_from = '2026-11-16T02:00:00Z'::timestamptz
    where machine_id = $1 and version = 2
  `, [machineId])

  const beforeChristmas = (await db.query(
    `select public.watchdog_eligible_seconds(
      $1,
      '2026-12-25T00:00:00+08:00'::timestamptz,
      '2026-12-26T00:00:00+08:00'::timestamptz
    ) as seconds`,
    [machineId],
  )).rows[0].seconds
  assert.equal(Number(beforeChristmas), 0)

  const toggledChristmas = (await db.query(
    `select * from public.set_production_calendar_day(
      $1, '2026-12-25'::date, 'holiday', 'Christmas Day', true, null, 1, false, $2
    )`,
    [machineId, adminId],
  )).rows[0]
  assert.equal(toggledChristmas.is_working, true)
  assert.equal(toggledChristmas.source, 'seeded')
  assert.equal(Number(toggledChristmas.version), 2)

  const afterChristmas = (await db.query(
    `select public.watchdog_eligible_seconds(
      $1,
      '2026-12-25T00:00:00+08:00'::timestamptz,
      '2026-12-26T00:00:00+08:00'::timestamptz
    ) as seconds`,
    [machineId],
  )).rows[0].seconds
  assert.equal(Number(afterChristmas), 420 * 60)

  await db.query(
    `select * from public.set_production_calendar_day(
      $1, '2026-12-25'::date, 'holiday', 'Christmas Day', true, null, 2, false, $2
    )`,
    [machineId, adminId],
  )
  const audits = (await db.query(`
    select action, metadata
    from public.audit_logs
    where entity_id = $1 and action = 'PRODUCTION_CALENDAR_DAY_SET'
  `, [machineId])).rows
  assert.equal(audits.length, 1)
  assert.equal(audits[0].metadata.calendarDate, '2026-12-25')
  assert.equal(audits[0].metadata.isWorking, true)

  await db.query(
    `select * from public.set_production_calendar_day(
      $1, '2026-11-30'::date, 'holiday', 'Bonifacio Day', false, null, 1, false, $2
    )`,
    [machineId, adminId],
  )
  const bonifacioSeconds = (await db.query(
    `select public.watchdog_eligible_seconds(
      $1,
      '2026-11-30T00:00:00+08:00'::timestamptz,
      '2026-12-01T00:00:00+08:00'::timestamptz
    ) as seconds`,
    [machineId],
  )).rows[0].seconds
  assert.equal(Number(bonifacioSeconds), 0)

  await db.query(
    `select * from public.set_production_calendar_day(
      $1, '2026-11-29'::date, 'holiday', 'Sunday Overtime Run', true, null, null, false, $2
    )`,
    [machineId, adminId],
  )
  const overtimeSundaySeconds = (await db.query(
    `select public.watchdog_eligible_seconds(
      $1,
      '2026-11-29T00:00:00+08:00'::timestamptz,
      '2026-11-30T00:00:00+08:00'::timestamptz
    ) as seconds`,
    [machineId],
  )).rows[0].seconds
  assert.equal(Number(overtimeSundaySeconds), 420 * 60)
})

test('set_production_calendar_range expands 12-day Christmas shutdown, logs replaced holidays, and remove_production_calendar_range restores future seeded holidays', async (t) => {
  const db = await createMigratedDatabase(t)
  const { machineId, adminId } = await getFixtureIds(db)

  await db.query(`
    update public.machine_operational_settings_history
    set effective_to = '2026-11-16T02:00:00Z'::timestamptz
    where machine_id = $1 and version = 1
  `, [machineId])
  await db.query(`
    update public.machine_operational_settings_history
    set effective_from = '2026-11-16T02:00:00Z'::timestamptz
    where machine_id = $1 and version = 2
  `, [machineId])

  const rangeRows = (await db.query(
    `select * from public.set_production_calendar_range(
      $1,
      '2026-12-23'::date,
      '2027-01-03'::date,
      'day_off',
      'Christmas and New Year Shutdown',
      null,
      false,
      $2
    )`,
    [machineId, adminId],
  )).rows
  assert.equal(rangeRows.length, 12)
  const groupId = rangeRows[0].group_id
  assert.ok(groupId)
  assert.ok(rangeRows.every((row) => row.group_id === groupId && row.is_working === false && row.source === 'manual'))

  const shutdownEligible = (await db.query(
    `select public.watchdog_eligible_seconds(
      $1,
      '2026-12-23T00:00:00+08:00'::timestamptz,
      '2027-01-04T00:00:00+08:00'::timestamptz
    ) as seconds`,
    [machineId],
  )).rows[0].seconds
  assert.equal(Number(shutdownEligible), 0)

  await db.query(
    `select * from public.set_production_calendar_range(
      $1,
      '2026-12-23'::date,
      '2027-01-03'::date,
      'day_off',
      'Christmas and New Year Shutdown',
      null,
      false,
      $2
    )`,
    [machineId, adminId],
  )
  const rangeAudits = (await db.query(`
    select metadata
    from public.audit_logs
    where entity_id = $1 and action = 'PRODUCTION_CALENDAR_RANGE_SET'
  `, [machineId])).rows
  assert.equal(rangeAudits.length, 1)
  assert.deepEqual(rangeAudits[0].metadata.replacedDates, [
    '2026-12-24',
    '2026-12-25',
    '2026-12-30',
    '2026-12-31',
    '2027-01-01',
  ])

  const removal = (await db.query(
    `select public.remove_production_calendar_range(
      $1,
      $2,
      $3,
      '2026-12-29T10:00:00+08:00'::timestamptz
    ) as result`,
    [machineId, groupId, adminId],
  )).rows[0].result

  assert.equal(removal.removedCount, 5)
  assert.deepEqual(removal.removedDates, [
    '2026-12-30',
    '2026-12-31',
    '2027-01-01',
    '2027-01-02',
    '2027-01-03',
  ])
  assert.deepEqual(removal.lockedDates, [
    '2026-12-23',
    '2026-12-24',
    '2026-12-25',
    '2026-12-26',
    '2026-12-27',
    '2026-12-28',
    '2026-12-29',
  ])
  assert.deepEqual(removal.restoredDates, [
    '2026-12-30',
    '2026-12-31',
    '2027-01-01',
  ])

  const afterRemoval = (await db.query(`
    select calendar_date::text as calendar_date, day_type, is_working, source, group_id
    from public.production_calendar_days
    where machine_id = $1
      and calendar_date between '2026-12-23'::date and '2027-01-03'::date
    order by calendar_date asc
  `, [machineId])).rows
  assert.equal(afterRemoval.length, 10)
  assert.equal(afterRemoval.filter((row) => row.group_id === groupId).length, 7)
  assert.deepEqual(afterRemoval.slice(7), [
    { calendar_date: '2026-12-30', day_type: 'holiday', is_working: false, source: 'seeded', group_id: null },
    { calendar_date: '2026-12-31', day_type: 'holiday', is_working: false, source: 'seeded', group_id: null },
    { calendar_date: '2027-01-01', day_type: 'holiday', is_working: false, source: 'seeded', group_id: null },
  ])
})

test('evaluate_sensor_watchdog suspends detection across a 12-day shutdown and re-anchors baseline at workStart on return date', async (t) => {
  const db = await createMigratedDatabase(t)
  const { machineId, adminId, s01Id } = await getFixtureIds(db)

  await db.query(`
    update public.machine_operational_settings_history
    set effective_to = '2026-11-16T02:00:00Z'::timestamptz
    where machine_id = $1 and version = 1
  `, [machineId])
  await db.query(`
    update public.machine_operational_settings_history
    set effective_from = '2026-11-16T02:00:00Z'::timestamptz
    where machine_id = $1 and version = 2
  `, [machineId])

  const settings = (await db.query(
    'select version, sensor_thresholds, shift_schedule from public.machine_operational_settings where machine_id = $1',
    [machineId],
  )).rows[0]
  settings.sensor_thresholds['S-01'] = {
    absenceDetectionEnabled: true,
    triggerSeconds: 600,
    recoverySeconds: 30,
  }
  await db.query(
    'select * from public.update_machine_operational_settings($1, $2, $3::jsonb, $4::jsonb, $5)',
    [
      machineId,
      settings.version,
      JSON.stringify(settings.sensor_thresholds),
      JSON.stringify(settings.shift_schedule),
      adminId,
    ],
  )
  await db.query(`
    update public.machine_operational_settings_history
    set effective_to = '2026-11-16T03:00:00Z'::timestamptz
    where machine_id = $1 and version = 2
  `, [machineId])
  await db.query(`
    update public.machine_operational_settings_history
    set effective_from = '2026-11-16T03:00:00Z'::timestamptz
    where machine_id = $1 and version = 3
  `, [machineId])

  await db.query(
    `select * from public.set_production_calendar_range(
      $1,
      '2026-12-23'::date,
      '2027-01-03'::date,
      'day_off',
      'Christmas and New Year Shutdown',
      null,
      false,
      $2
    )`,
    [machineId, adminId],
  )

  const advanced = (await db.query(
    `select public.watchdog_advance_eligible_time(
      $1,
      '2026-12-22T17:05:00+08:00'::timestamptz,
      '2027-01-04T08:05:00+08:00'::timestamptz,
      1
    ) - interval '1 second' as baseline_at`,
    [machineId],
  )).rows[0].baseline_at
  assert.equal(new Date(advanced).toISOString(), '2027-01-04T00:00:00.000Z')

  await db.query(`
    update public.sensor_watchdog_state
    set connectivity_state = 'online',
        detection_state = 'healthy',
        last_heartbeat_id = gen_random_uuid(),
        last_heartbeat_payload_hash = 'shutdown-test',
        last_heartbeat_received_at = '2026-11-15T04:00:00Z'::timestamptz,
        last_activity_received_at = '2026-11-15T01:00:00Z'::timestamptz,
        absence_baseline_at = '2026-11-15T01:00:00Z'::timestamptz
    where sensor_id = $1
  `, [s01Id])

  await db.query(
    `update public.machine_operational_settings_history
     set shift_schedule = jsonb_set(shift_schedule, '{restDays}', '["sunday"]'::jsonb, true)
     where machine_id = $1 and version = 1`,
    [machineId],
  )

  const evalOnSunday = (await db.query(
    `select * from public.evaluate_sensor_watchdog(
      $1,
      '2026-11-15T04:00:10Z'::timestamptz,
      'enforce',
      30
    )`,
    [s01Id],
  )).rows[0]
  assert.equal(evalOnSunday.detection_state, 'suspended')

  await db.query(`
    update public.sensor_watchdog_state
    set last_heartbeat_received_at = '2026-11-16T00:04:55Z'::timestamptz
    where sensor_id = $1
  `, [s01Id])

  const evalOnMondayReturn = (await db.query(
    `select * from public.evaluate_sensor_watchdog(
      $1,
      '2026-11-16T00:05:00Z'::timestamptz,
      'enforce',
      30
    )`,
    [s01Id],
  )).rows[0]
  assert.equal(evalOnMondayReturn.detection_state, 'grace')

  const watchdogStateAfterReturn = (await db.query(
    'select absence_baseline_at from public.sensor_watchdog_state where sensor_id = $1',
    [s01Id],
  )).rows[0]
  assert.equal(new Date(watchdogStateAfterReturn.absence_baseline_at).toISOString(), '2026-11-16T00:00:00.000Z')

  const openDowntimes = (await db.query(
    'select count(*)::int as count from public.downtime_events where machine_id = $1',
    [machineId],
  )).rows[0].count
  assert.equal(openDowntimes, 0)
})

test('calendar RPCs enforce validation, advance-only dates, manual overwrite confirmation, and service_role privilege boundaries', async (t) => {
  const db = await createMigratedDatabase(t)
  const { machineId, adminId } = await getFixtureIds(db)

  await assert.rejects(
    db.query(
      `select * from public.set_production_calendar_day(
        $1, '2026-11-20'::date, 'machine_not_scheduled', 'Unscheduled Stop', false, '   ', null, false, $2
      )`,
      [machineId, adminId],
    ),
    (error) => error.code === '22023',
  )

  const savedUnscheduled = (await db.query(
    `select * from public.set_production_calendar_day(
      $1, '2026-11-20'::date, 'machine_not_scheduled', 'Unscheduled Stop', false, 'No orders', null, false, $2
    )`,
    [machineId, adminId],
  )).rows[0]
  assert.equal(savedUnscheduled.is_working, false)
  assert.equal(savedUnscheduled.reason, 'No orders')

  const manilaToday = (await db.query(
    "select (clock_timestamp() at time zone 'Asia/Manila')::date::text as today",
  )).rows[0].today

  await assert.rejects(
    db.query(
      `select * from public.set_production_calendar_day(
        $1, $2::date, 'day_off', 'Same Day Closure', false, null, null, false, $3
      )`,
      [machineId, manilaToday, adminId],
    ),
    (error) => error.code === '22023',
  )

  await assert.rejects(
    db.query(
      `select * from public.set_production_calendar_range(
        $1, '2027-01-01'::date, '2027-03-04'::date, 'day_off', 'Too Long Shutdown', null, false, $2
      )`,
      [machineId, adminId],
    ),
    (error) => error.code === '22023',
  )

  await assert.rejects(
    db.query(
      `select * from public.set_production_calendar_range(
        $1, '2026-11-19'::date, '2026-11-21'::date, 'day_off', 'Overlapping Range', null, false, $2
      )`,
      [machineId, adminId],
    ),
    (error) => error.code === '23505' && /2026-11-20/.test(error.detail || ''),
  )

  const untouched = (await db.query(
    `select count(*)::int as count
     from public.production_calendar_days
     where machine_id = $1 and calendar_date in ('2026-11-19'::date, '2026-11-21'::date)`,
    [machineId],
  )).rows[0].count
  assert.equal(untouched, 0)

  const overwritten = (await db.query(
    `select * from public.set_production_calendar_range(
      $1, '2026-11-19'::date, '2026-11-21'::date, 'day_off', 'Overlapping Range', null, true, $2
    )`,
    [machineId, adminId],
  )).rows
  assert.equal(overwritten.length, 3)

  await db.query(
    `select * from public.set_production_calendar_day(
      $1, '2027-05-01'::date, 'machine_not_scheduled', 'No Coil Stock', false, 'Awaiting raw material delivery', null, true, $2
    )`,
    [machineId, adminId],
  )
  const singleRemoved = (await db.query(
    "select public.remove_production_calendar_day($1, '2027-05-01'::date, $2) as result",
    [machineId, adminId],
  )).rows[0].result
  assert.equal(singleRemoved.removedCount, 1)
  assert.equal(singleRemoved.restoredHolidays.length, 1)
  assert.equal(singleRemoved.restoredHolidays[0].name, 'Labor Day')
  assert.equal(singleRemoved.restoredHolidays[0].isWorking, true)

  await assert.rejects(
    db.query(
      "select public.remove_production_calendar_day($1, '2027-05-01'::date, $2)",
      [machineId, adminId],
    ),
    (error) => error.code === '22023',
  )

  await db.exec('set role service_role;')
  await assert.rejects(
    db.query(
      `insert into public.production_calendar_days (machine_id, calendar_date, name, day_type, is_working)
       values ($1, '2027-05-10'::date, 'Direct Insert', 'day_off', false)`,
      [machineId],
    ),
    /permission denied/i,
  )
  await assert.rejects(
    db.query(
      "update public.production_calendar_days set is_working = true where machine_id = $1 and calendar_date = '2026-11-20'::date",
      [machineId],
    ),
    /permission denied/i,
  )
  await assert.rejects(
    db.query(
      "delete from public.production_calendar_days where machine_id = $1 and calendar_date = '2026-11-20'::date",
      [machineId],
    ),
    /permission denied/i,
  )
  await db.exec('reset role;')
})

test('Node.js getEligibleSeconds and PostgreSQL watchdog_eligible_seconds match across a 14-day window with workdays, Sundays, working holiday, non-working holiday, and 3-day shutdown range', async (t) => {
  const db = await createMigratedDatabase(t)
  const { machineId, adminId } = await getFixtureIds(db)

  await db.query(`
    update public.machine_operational_settings_history
    set effective_to = '2026-11-16T02:00:00Z'::timestamptz
    where machine_id = $1 and version = 1
  `, [machineId])
  await db.query(`
    update public.machine_operational_settings_history
    set effective_from = '2026-11-16T02:00:00Z'::timestamptz
    where machine_id = $1 and version = 2
  `, [machineId])

  await db.query(
    `select * from public.set_production_calendar_day(
      $1, '2026-11-25'::date, 'holiday', 'Special Plant Holiday', false, null, null, false, $2
    )`,
    [machineId, adminId],
  )
  await db.query(
    `select * from public.set_production_calendar_day(
      $1, '2026-11-29'::date, 'holiday', 'Sunday Overtime Run', true, null, null, false, $2
    )`,
    [machineId, adminId],
  )
  await db.query(
    `select * from public.set_production_calendar_range(
      $1, '2026-12-02'::date, '2026-12-04'::date, 'day_off', 'Three-Day Shutdown', null, false, $2
    )`,
    [machineId, adminId],
  )

  const settingsHistory = (await db.query(`
    select version::text as version, shift_schedule, effective_from, effective_to
    from public.machine_operational_settings_history
    where machine_id = $1
    order by effective_from asc nulls first, version asc
  `, [machineId])).rows

  const calendarDays = (await db.query(`
    select calendar_date::text as calendar_date, is_working
    from public.production_calendar_days
    where machine_id = $1
      and calendar_date between '2026-11-22'::date and '2026-12-05'::date
    order by calendar_date asc
  `, [machineId])).rows

  const dates = [
    '2026-11-22',
    '2026-11-23',
    '2026-11-24',
    '2026-11-25',
    '2026-11-26',
    '2026-11-27',
    '2026-11-28',
    '2026-11-29',
    '2026-11-30',
    '2026-12-01',
    '2026-12-02',
    '2026-12-03',
    '2026-12-04',
    '2026-12-05',
  ]
  const nextDates = [
    '2026-11-23',
    '2026-11-24',
    '2026-11-25',
    '2026-11-26',
    '2026-11-27',
    '2026-11-28',
    '2026-11-29',
    '2026-11-30',
    '2026-12-01',
    '2026-12-02',
    '2026-12-03',
    '2026-12-04',
    '2026-12-05',
    '2026-12-06',
  ]

  let expectedTotalSeconds = 0
  for (let index = 0; index < dates.length; index += 1) {
    const dayStart = `${dates[index]}T00:00:00+08:00`
    const dayEnd = `${nextDates[index]}T00:00:00+08:00`

    const sqlSeconds = Number((await db.query(
      'select public.watchdog_eligible_seconds($1, $2::timestamptz, $3::timestamptz) as seconds',
      [machineId, dayStart, dayEnd],
    )).rows[0].seconds)

    const jsSeconds = getEligibleSeconds({
      start: dayStart,
      end: dayEnd,
      settingsHistory,
      calendarDays,
    })

    assert.equal(jsSeconds, sqlSeconds, `Mismatch on ${dates[index]}`)
    expectedTotalSeconds += sqlSeconds
  }

  const fullWindowStart = '2026-11-22T00:00:00+08:00'
  const fullWindowEnd = '2026-12-06T00:00:00+08:00'
  const sqlTotalSeconds = Number((await db.query(
    'select public.watchdog_eligible_seconds($1, $2::timestamptz, $3::timestamptz) as seconds',
    [machineId, fullWindowStart, fullWindowEnd],
  )).rows[0].seconds)
  const jsTotalSeconds = getEligibleSeconds({
    start: fullWindowStart,
    end: fullWindowEnd,
    settingsHistory,
    calendarDays,
  })

  assert.equal(sqlTotalSeconds, expectedTotalSeconds)
  assert.equal(jsTotalSeconds, sqlTotalSeconds)
  assert.equal(jsTotalSeconds, 9 * 420 * 60)
})
