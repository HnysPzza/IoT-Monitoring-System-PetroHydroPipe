const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')
const normalizeSql = (sql) => sql.replace(/\r\n/g, '\n')
const currentSchemaSql = normalizeSql(
  fs.readFileSync(path.join(backendRoot, 'database', 'schema.sql'), 'utf8'),
)
const downtimeMigrationSql = normalizeSql(fs.readFileSync(
  path.join(backendRoot, 'database', 'migrations', '006_downtime_open_record_unique_index.sql'),
  'utf8',
))
const alertIntegrityMigrationSql = fs.readFileSync(
  path.join(backendRoot, 'database', 'migrations', '007_alert_sync_integrity.sql'),
  'utf8',
)

function buildPreAlertIntegritySchema() {
  const legacyIngestStart = downtimeMigrationSql.indexOf('create or replace function public.ingest_iot_sensor_event(')
  const legacyIngestEnd = downtimeMigrationSql.indexOf(
    'create or replace function public.get_downtime_summary(',
    legacyIngestStart,
  )
  const currentIntegrityStart = currentSchemaSql.indexOf(
    '-- Atomic alert-sync integrity keeps state, alerts, revisions, and audits consistent.',
  )
  const currentIntegrityEnd = currentSchemaSql.indexOf(
    'create or replace function public.update_machine_operational_settings(',
    currentIntegrityStart,
  )

  assert.ok(legacyIngestStart >= 0 && legacyIngestEnd > legacyIngestStart)
  assert.ok(currentIntegrityStart >= 0 && currentIntegrityEnd > currentIntegrityStart)

  const legacyIngest = downtimeMigrationSql.slice(legacyIngestStart, legacyIngestEnd)
  const alertRevisionPrivilegeBlock = `revoke all on table public.alert_revision_state from public, anon, authenticated;
grant select, update on table public.alert_revision_state to service_role;

`
  const alertFunctionPrivilegeBlock = `revoke execute on function public.assign_alert_revision() from public, anon, authenticated;
revoke execute on function public.alert_to_api_json(public.alerts) from public, anon, authenticated;
revoke execute on function public.acknowledge_alert(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.get_alerts_snapshot() from public, anon, authenticated;
grant execute on function public.alert_to_api_json(public.alerts) to service_role;
grant execute on function public.acknowledge_alert(uuid, uuid) to service_role;
grant execute on function public.get_alerts_snapshot() to service_role;

`

  return (
    currentSchemaSql.slice(0, currentIntegrityStart)
    + '-- Atomic IoT ingestion before alert-sync integrity migration.\n'
    + legacyIngest
    + currentSchemaSql.slice(currentIntegrityEnd)
  )
    .replace('  last_applied_recorded_at timestamptz,\n', '')
    .replace('  revision bigint not null,\n', '')
    .replace(
      /-- Transactional singleton serializes alert revisions in commit order\.\s+create table if not exists alert_revision_state \([\s\S]*?on conflict \(singleton\) do nothing;\s+/,
      '',
    )
    .replace(
      /alter table alert_revision_state enable row level security;\s+create policy alert_revision_service_role[\s\S]*?with check \(true\);\s+/,
      '',
    )
    .replace('create unique index if not exists idx_alerts_revision on alerts(revision);\n', '')
    .replace(alertRevisionPrivilegeBlock, '')
    .replace(alertFunctionPrivilegeBlock, '')
}

async function createDatabase(sql) {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
  ])
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec('create role anon; create role authenticated; create role service_role;')
  await db.exec(sql)
  return db
}

async function seedIdentity(db) {
  await db.exec(`
    insert into public.roles (id, name)
    values ('10000000-0000-4000-8000-000000000001', 'Admin');

    insert into public.users (id, role_id, name, username, password_hash)
    values (
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'Alert Operator',
      'alert.operator',
      'not-used-by-this-test'
    );

    insert into public.machines (id, machine_code, name, status)
    values (
      '30000000-0000-4000-8000-000000000001',
      'M-01',
      'Spiral Mill 01',
      'Running'
    );

    insert into public.sensors (
      id, machine_id, sensor_code, esp32_device_id, label, status
    ) values (
      '40000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'S-04',
      'esp32-s04',
      'Flux Level Sensor',
      'Active'
    );
  `)
}

async function ingest(db, { eventId, eventType, signal, recordedAt }) {
  const result = await db.query(`
    select * from public.ingest_iot_sensor_event(
      $1::uuid,
      '40000000-0000-4000-8000-000000000001'::uuid,
      '30000000-0000-4000-8000-000000000001'::uuid,
      $2::text,
      $3::jsonb,
      $4::timestamptz
    )
  `, [eventId, eventType, JSON.stringify({ signal, metadata: {} }), recordedAt])
  return result.rows[0]
}

async function getRevision(db) {
  const result = await db.query(`
    select current_revision::text as revision
    from public.alert_revision_state
    where singleton = true
  `)
  return result.rows[0].revision
}

test('migration 007 upgrades existing data and preserves the complete alert lifecycle', async () => {
  const db = await createDatabase(buildPreAlertIntegritySchema())

  try {
    await seedIdentity(db)
    const baseTime = Date.now() - (10 * 60 * 1000)
    const initialAt = new Date(baseTime).toISOString()
    const historicalUpdatedAt = new Date(baseTime - 60_000).toISOString()

    await db.query(`
      insert into public.sensor_events (
        id, sensor_id, machine_id, device_event_id, event_type, event_value, recorded_at
      ) values (
        '50000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001',
        '60000000-0000-4000-8000-000000000001',
        'pulse',
        '{"signal":"active"}',
        $1::timestamptz
      );
    `, [initialAt])

    await db.query(`
      insert into public.alerts (
        id, source_type, source_id, machine_id, sensor_id, severity, status,
        title, message, metadata, created_at, updated_at
      ) values (
        '70000000-0000-4000-8000-000000000001',
        'sensor',
        '40000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001',
        'Critical',
        'Active',
        'Historical alert',
        'Historical message',
        '{}',
        $1::timestamptz,
        $1::timestamptz
      );
    `, [historicalUpdatedAt])

    await db.exec(alertIntegrityMigrationSql)

    const backfill = await db.query(`
      select
        sensor.last_applied_recorded_at,
        alert.revision::text as revision,
        alert.updated_at
      from public.sensors sensor
      cross join public.alerts alert
      where sensor.id = '40000000-0000-4000-8000-000000000001'
        and alert.id = '70000000-0000-4000-8000-000000000001'
    `)
    assert.equal(new Date(backfill.rows[0].last_applied_recorded_at).toISOString(), initialAt)
    assert.equal(backfill.rows[0].revision, '1')
    assert.equal(new Date(backfill.rows[0].updated_at).toISOString(), historicalUpdatedAt)

    const initialSnapshot = await db.query('select * from public.get_alerts_snapshot()')
    assert.equal(initialSnapshot.rows[0].snapshot_revision, '1')
    assert.equal(initialSnapshot.rows[0].alerts[0].revision, '1')
    assert.equal(initialSnapshot.rows[0].alerts[0].sensor.label, 'Flux Level Sensor')

    const faultAt = new Date(baseTime + 60_000).toISOString()
    const fault = await ingest(db, {
      eventId: '80000000-0000-4000-8000-000000000001',
      eventType: 'fault',
      signal: 'fault',
      recordedAt: faultAt,
    })
    assert.equal(fault.state_applied, true)
    assert.equal(fault.alert_action, 'updated')
    assert.equal(fault.alert_record.status, 'Active')
    assert.equal(fault.alert_record.revision, '2')
    assert.equal(fault.alert_record.title, 'Flux Level Sensor downtime detected')

    const auditCountAfterFault = await db.query('select count(*)::integer as count from public.audit_logs')
    const duplicate = await ingest(db, {
      eventId: '80000000-0000-4000-8000-000000000001',
      eventType: 'fault',
      signal: 'fault',
      recordedAt: faultAt,
    })
    assert.equal(duplicate.duplicate, true)
    assert.equal(duplicate.alert_action, null)
    assert.equal(await getRevision(db), '2')

    const stale = await ingest(db, {
      eventId: '80000000-0000-4000-8000-000000000002',
      eventType: 'recovered',
      signal: 'active',
      recordedAt: initialAt,
    })
    assert.equal(stale.stale, true)
    assert.equal(stale.state_applied, false)
    assert.equal(await getRevision(db), '2')
    const auditCountAfterStale = await db.query('select count(*)::integer as count from public.audit_logs')
    assert.equal(auditCountAfterStale.rows[0].count, auditCountAfterFault.rows[0].count)

    const recoveryAt = new Date(baseTime + 120_000).toISOString()
    const recovery = await ingest(db, {
      eventId: '80000000-0000-4000-8000-000000000003',
      eventType: 'recovered',
      signal: 'active',
      recordedAt: recoveryAt,
    })
    assert.equal(recovery.alert_action, 'updated')
    assert.equal(recovery.alert_record.status, 'Active')
    assert.equal(recovery.alert_record.metadata.recoveryPending, true)
    assert.equal(recovery.alert_record.revision, '3')

    const acknowledgement = await db.query(`
      select * from public.acknowledge_alert(
        '70000000-0000-4000-8000-000000000001'::uuid,
        '20000000-0000-4000-8000-000000000001'::uuid
      )
    `)
    assert.equal(acknowledgement.rows[0].outcome, 'resolved_after_recovery')
    assert.equal(acknowledgement.rows[0].alert_action, 'resolved')
    assert.equal(acknowledgement.rows[0].alert_record.revision, '4')
    assert.equal(acknowledgement.rows[0].alert_record.acknowledgedBy.role, 'Admin')

    const resolvedRetry = await db.query(`
      select * from public.acknowledge_alert(
        '70000000-0000-4000-8000-000000000001'::uuid,
        '20000000-0000-4000-8000-000000000001'::uuid
      )
    `)
    assert.equal(resolvedRetry.rows[0].outcome, 'already_resolved')
    assert.equal(await getRevision(db), '4')

    const alertAudits = await db.query(`
      select action from public.audit_logs
      where action like 'ALERT_%'
      order by created_at, action
    `)
    assert.deepEqual(
      alertAudits.rows.map((row) => row.action),
      ['ALERT_ACKNOWLEDGED', 'ALERT_RESOLVED'],
    )

    const finalSnapshot = await db.query('select * from public.get_alerts_snapshot()')
    assert.deepEqual(finalSnapshot.rows[0].alerts, [])
    assert.equal(finalSnapshot.rows[0].snapshot_revision, '4')

    const revisionInvariant = await db.query(`
      select
        revision_state.current_revision::text as current_revision,
        max(alert.revision)::text as max_alert_revision
      from public.alert_revision_state revision_state
      cross join public.alerts alert
      where revision_state.singleton = true
      group by revision_state.current_revision
    `)
    assert.equal(revisionInvariant.rows[0].current_revision, '4')
    assert.equal(revisionInvariant.rows[0].max_alert_revision, '4')

    const privileges = await db.query(`
      select
        has_function_privilege('anon', 'public.get_alerts_snapshot()', 'EXECUTE') as anon_snapshot,
        has_function_privilege(
          'authenticated',
          'public.get_alerts_snapshot()',
          'EXECUTE'
        ) as authenticated_snapshot,
        has_function_privilege('service_role', 'public.get_alerts_snapshot()', 'EXECUTE') as service_snapshot,
        has_function_privilege('anon', 'public.acknowledge_alert(uuid,uuid)', 'EXECUTE') as anon_ack,
        has_function_privilege(
          'authenticated',
          'public.acknowledge_alert(uuid,uuid)',
          'EXECUTE'
        ) as authenticated_ack,
        has_function_privilege('service_role', 'public.acknowledge_alert(uuid,uuid)', 'EXECUTE') as service_ack,
        has_function_privilege(
          'anon',
          'public.ingest_iot_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)',
          'EXECUTE'
        ) as anon_ingest,
        has_function_privilege(
          'authenticated',
          'public.ingest_iot_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)',
          'EXECUTE'
        ) as authenticated_ingest,
        has_function_privilege(
          'service_role',
          'public.ingest_iot_sensor_event(uuid,uuid,uuid,text,jsonb,timestamptz)',
          'EXECUTE'
        ) as service_ingest,
        has_function_privilege('anon', 'public.alert_to_api_json(public.alerts)', 'EXECUTE') as anon_helper,
        has_function_privilege(
          'authenticated',
          'public.alert_to_api_json(public.alerts)',
          'EXECUTE'
        ) as authenticated_helper,
        has_function_privilege(
          'service_role',
          'public.alert_to_api_json(public.alerts)',
          'EXECUTE'
        ) as service_helper,
        has_table_privilege('anon', 'public.alert_revision_state', 'SELECT') as anon_counter,
        has_table_privilege(
          'authenticated',
          'public.alert_revision_state',
          'SELECT'
        ) as authenticated_counter,
        has_table_privilege('service_role', 'public.alert_revision_state', 'SELECT') as service_counter,
        has_table_privilege('service_role', 'public.alert_revision_state', 'UPDATE') as service_counter_update,
        has_table_privilege('service_role', 'public.alert_revision_state', 'INSERT') as service_counter_insert,
        has_table_privilege('service_role', 'public.alert_revision_state', 'DELETE') as service_counter_delete
    `)
    assert.equal(privileges.rows[0].anon_snapshot, false)
    assert.equal(privileges.rows[0].authenticated_snapshot, false)
    assert.equal(privileges.rows[0].service_snapshot, true)
    assert.equal(privileges.rows[0].anon_ack, false)
    assert.equal(privileges.rows[0].authenticated_ack, false)
    assert.equal(privileges.rows[0].service_ack, true)
    assert.equal(privileges.rows[0].anon_ingest, false)
    assert.equal(privileges.rows[0].authenticated_ingest, false)
    assert.equal(privileges.rows[0].service_ingest, true)
    assert.equal(privileges.rows[0].anon_helper, false)
    assert.equal(privileges.rows[0].authenticated_helper, false)
    assert.equal(privileges.rows[0].service_helper, true)
    assert.equal(privileges.rows[0].anon_counter, false)
    assert.equal(privileges.rows[0].authenticated_counter, false)
    assert.equal(privileges.rows[0].service_counter, true)
    assert.equal(privileges.rows[0].service_counter_update, true)
    assert.equal(privileges.rows[0].service_counter_insert, false)
    assert.equal(privileges.rows[0].service_counter_delete, false)
  } finally {
    await db.close()
  }
})

test('fresh alert transitions use contiguous revisions and preserve lifecycle ordering', async () => {
  const db = await createDatabase(currentSchemaSql)

  try {
    await seedIdentity(db)
    const baseTime = Date.now() - (10 * 60 * 1000)
    const at = (offset) => new Date(baseTime + offset).toISOString()

    const created = await ingest(db, {
      eventId: 'a0000000-0000-4000-8000-000000000001',
      eventType: 'fault',
      signal: 'fault',
      recordedAt: at(0),
    })
    assert.equal(created.alert_action, 'created')
    assert.equal(created.alert_record.revision, '1')

    await assert.rejects(
      () => ingest(db, {
        eventId: 'a0000000-0000-4000-8000-000000000001',
        eventType: 'fault',
        signal: 'fault',
        recordedAt: at(1),
      }),
      /Device event ID was reused with different event data/,
    )

    const refreshed = await ingest(db, {
      eventId: 'a0000000-0000-4000-8000-000000000002',
      eventType: 'fault',
      signal: 'fault',
      recordedAt: at(60_000),
    })
    assert.equal(refreshed.alert_action, 'updated')
    assert.equal(refreshed.alert_record.revision, '2')
    assert.equal(await getRevision(db), '2')

    const recoveryPending = await ingest(db, {
      eventId: 'a0000000-0000-4000-8000-000000000003',
      eventType: 'recovered',
      signal: 'active',
      recordedAt: at(120_000),
    })
    assert.equal(recoveryPending.alert_record.status, 'Active')
    assert.equal(recoveryPending.alert_record.metadata.recoveryPending, true)
    assert.equal(recoveryPending.alert_record.revision, '3')

    const recurrence = await ingest(db, {
      eventId: 'a0000000-0000-4000-8000-000000000004',
      eventType: 'fault',
      signal: 'fault',
      recordedAt: at(180_000),
    })
    assert.equal(recurrence.alert_record.status, 'Active')
    assert.equal(recurrence.alert_record.revision, '4')
    assert.equal('recoveryPending' in recurrence.alert_record.metadata, false)
    assert.equal('recoveredAt' in recurrence.alert_record.metadata, false)
    assert.equal('recoveryEventId' in recurrence.alert_record.metadata, false)

    const acknowledged = await db.query(`
      select * from public.acknowledge_alert(
        $1::uuid,
        '20000000-0000-4000-8000-000000000001'::uuid
      )
    `, [recurrence.alert_record.id])
    assert.equal(acknowledged.rows[0].outcome, 'acknowledged')
    assert.equal(acknowledged.rows[0].alert_record.status, 'Acknowledged')
    assert.equal(acknowledged.rows[0].alert_record.revision, '5')

    const acknowledgedFault = await ingest(db, {
      eventId: 'a0000000-0000-4000-8000-000000000005',
      eventType: 'fault',
      signal: 'fault',
      recordedAt: at(240_000),
    })
    assert.equal(acknowledgedFault.alert_record.status, 'Acknowledged')
    assert.equal(acknowledgedFault.alert_record.revision, '6')

    const resolved = await ingest(db, {
      eventId: 'a0000000-0000-4000-8000-000000000006',
      eventType: 'recovered',
      signal: 'active',
      recordedAt: at(300_000),
    })
    assert.equal(resolved.alert_action, 'resolved')
    assert.equal(resolved.alert_record.status, 'Resolved')
    assert.equal(resolved.alert_record.revision, '7')
    assert.equal(await getRevision(db), '7')

    const auditActions = await db.query(`
      select action, count(*)::integer as count
      from public.audit_logs
      where action like 'ALERT_%'
      group by action
      order by action
    `)
    assert.deepEqual(auditActions.rows, [
      { action: 'ALERT_ACKNOWLEDGED', count: 1 },
      { action: 'ALERT_CREATED', count: 1 },
      { action: 'ALERT_RESOLVED', count: 1 },
    ])

    const unresolved = await db.query(`
      select count(*)::integer as count
      from public.alerts
      where status in ('Active', 'Acknowledged')
    `)
    assert.equal(unresolved.rows[0].count, 0)
  } finally {
    await db.close()
  }
})

test('concurrent fault requests keep one unresolved alert', async () => {
  const db = await createDatabase(currentSchemaSql)

  try {
    await seedIdentity(db)
    const recordedAt = new Date(Date.now() - 60_000).toISOString()
    const results = await Promise.all([
      ingest(db, {
        eventId: 'b0000000-0000-4000-8000-000000000001',
        eventType: 'fault',
        signal: 'fault',
        recordedAt,
      }),
      ingest(db, {
        eventId: 'b0000000-0000-4000-8000-000000000002',
        eventType: 'fault',
        signal: 'fault',
        recordedAt,
      }),
    ])

    assert.equal(results.filter((result) => result.state_applied).length, 1)
    assert.equal(results.filter((result) => result.stale).length, 1)
    const unresolved = await db.query(`
      select count(*)::integer as count
      from public.alerts
      where status in ('Active', 'Acknowledged')
    `)
    assert.equal(unresolved.rows[0].count, 1)
    assert.equal(await getRevision(db), '1')
  } finally {
    await db.close()
  }
})

test('an alert write failure rolls back IoT state, downtime, audits, and revision', async () => {
  const db = await createDatabase(currentSchemaSql)

  try {
    await seedIdentity(db)
    await db.exec(`
      create function public.reject_alert_write()
      returns trigger
      language plpgsql
      set search_path = pg_catalog, public
      as $$
      begin
        raise exception using errcode = 'P0001', message = 'forced alert write failure';
      end;
      $$;

      create trigger reject_alert_write
      before insert or update on public.alerts
      for each row execute function public.reject_alert_write();
    `)

    await assert.rejects(
      () => ingest(db, {
        eventId: 'c0000000-0000-4000-8000-000000000001',
        eventType: 'fault',
        signal: 'fault',
        recordedAt: new Date(Date.now() - 60_000).toISOString(),
      }),
      /forced alert write failure/,
    )

    const counts = await db.query(`
      select
        (select count(*)::integer from public.sensor_events) as sensor_events,
        (select count(*)::integer from public.downtime_events) as downtime_events,
        (select count(*)::integer from public.alerts) as alerts,
        (select count(*)::integer from public.audit_logs) as audits,
        (select current_revision::integer from public.alert_revision_state where singleton = true) as revision
    `)
    assert.deepEqual(counts.rows[0], {
      sensor_events: 0,
      downtime_events: 0,
      alerts: 0,
      audits: 0,
      revision: 0,
    })

    const state = await db.query(`
      select sensor.status, sensor.last_applied_recorded_at, machine.status as machine_status
      from public.sensors sensor
      join public.machines machine on machine.id = sensor.machine_id
      where sensor.id = '40000000-0000-4000-8000-000000000001'
    `)
    assert.equal(state.rows[0].status, 'Active')
    assert.equal(state.rows[0].last_applied_recorded_at, null)
    assert.equal(state.rows[0].machine_status, 'Running')
  } finally {
    await db.close()
  }
})

test('migration 007 rolls back every operational mutation when an atomic audit write fails', async () => {
  const db = await createDatabase(buildPreAlertIntegritySchema())

  try {
    await seedIdentity(db)
    await db.exec(alertIntegrityMigrationSql)
    await db.exec(`
      alter table public.audit_logs
      add constraint reject_iot_receipt check (action <> 'IOT_EVENT_RECEIVED');
    `)

    const faultAt = new Date(Date.now() - 60_000).toISOString()
    await assert.rejects(
      () => ingest(db, {
        eventId: '90000000-0000-4000-8000-000000000001',
        eventType: 'fault',
        signal: 'fault',
        recordedAt: faultAt,
      }),
      /reject_iot_receipt/,
    )

    const counts = await db.query(`
      select
        (select count(*)::integer from public.sensor_events) as sensor_events,
        (select count(*)::integer from public.downtime_events) as downtime_events,
        (select count(*)::integer from public.alerts) as alerts,
        (select count(*)::integer from public.audit_logs) as audits,
        (select current_revision::integer from public.alert_revision_state where singleton = true) as revision
    `)
    assert.deepEqual(counts.rows[0], {
      sensor_events: 0,
      downtime_events: 0,
      alerts: 0,
      audits: 0,
      revision: 0,
    })

    const state = await db.query(`
      select sensor.status, sensor.last_applied_recorded_at, machine.status as machine_status
      from public.sensors sensor
      join public.machines machine on machine.id = sensor.machine_id
      where sensor.id = '40000000-0000-4000-8000-000000000001'
    `)
    assert.equal(state.rows[0].status, 'Active')
    assert.equal(state.rows[0].last_applied_recorded_at, null)
    assert.equal(state.rows[0].machine_status, 'Running')
  } finally {
    await db.close()
  }
})

test('acknowledgement treats malformed legacy recovery metadata as not pending', async () => {
  const db = await createDatabase(currentSchemaSql)

  try {
    await seedIdentity(db)
    const inserted = await db.query(`
      insert into public.alerts (
        source_type, source_id, machine_id, sensor_id, severity, status, title, message, metadata
      ) values (
        'sensor',
        '40000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001',
        'Critical',
        'Active',
        'Malformed legacy alert',
        'Legacy metadata must not break acknowledgement.',
        '{"recoveryPending":"not-a-boolean"}'
      )
      returning id
    `)

    const acknowledgement = await db.query(`
      select * from public.acknowledge_alert(
        $1::uuid,
        '20000000-0000-4000-8000-000000000001'::uuid
      )
    `, [inserted.rows[0].id])
    assert.equal(acknowledgement.rows[0].outcome, 'acknowledged')
    assert.equal(acknowledgement.rows[0].alert_record.status, 'Acknowledged')

    const repeated = await db.query(`
      select * from public.acknowledge_alert(
        $1::uuid,
        '20000000-0000-4000-8000-000000000001'::uuid
      )
    `, [inserted.rows[0].id])
    assert.equal(repeated.rows[0].outcome, 'already_acknowledged')
    assert.equal(repeated.rows[0].alert_action, null)
    assert.equal(repeated.rows[0].alert_record.revision, acknowledgement.rows[0].alert_record.revision)
  } finally {
    await db.close()
  }
})
