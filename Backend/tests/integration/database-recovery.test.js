const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const fs = require('node:fs/promises')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const { performance } = require('node:perf_hooks')
const test = require('node:test')

const execute = promisify(execFile)
const bin = process.env.RECOVERY_PG_BIN

test('synthetic PostgreSQL backup restores records, constraints, grants and session RPCs', {
  skip: !bin,
  timeout: 120000,
}, async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'petro-recovery-'))
  const dataDirectory = path.join(directory, 'cluster')
  const socket = net.createServer()
  await new Promise((resolve, reject) => {
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', resolve)
  })
  const port = socket.address().port
  await new Promise((resolve) => socket.close(resolve))
  const run = (name, args) => execute(path.join(bin, `${name}${process.platform === 'win32' ? '.exe' : ''}`), args, {
    windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024,
  })
  const connection = ['-h', '127.0.0.1', '-p', String(port), '-U', 'recovery_review']
  const query = async (database, sql) => (await run('psql', [
    ...connection, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', database, '-c', sql,
  ])).stdout.trim()
  await run('initdb', ['-D', dataDirectory, '-U', 'recovery_review', '--auth=trust', '--encoding=UTF8', '--no-locale'])
  context.after(async () => {
    await run('pg_ctl', ['-D', dataDirectory, '-m', 'fast', '-w', 'stop'])
  })
  await run('pg_ctl', ['-D', dataDirectory, '-l', path.join(directory, 'postgres.log'),
    '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'])
  await query('postgres', 'create role anon; create role authenticated; create role service_role bypassrls;')
  await query('postgres', 'create database recovery_source')
  await query('postgres', 'create database recovery_target')
  await run('psql', [...connection, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', 'recovery_source',
    '-f', path.resolve(__dirname, '../../database/schema.sql')])
  await query('recovery_source', `
    insert into roles(id,name) values ('11111111-1111-4111-8111-111111111111','Admin');
    insert into users(id,role_id,name,username,password_hash,status) values
      ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','Synthetic','synthetic','not-a-login-hash','Active');
    insert into machines(id,machine_code,name) values ('33333333-3333-4333-8333-333333333333','M-01','Synthetic');
    insert into sensors(id,machine_id,sensor_code,esp32_device_id,label) values
      ('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','S-03','synthetic-device','Synthetic');
    insert into machine_operational_settings(machine_id) values ('33333333-3333-4333-8333-333333333333');
    insert into machine_operational_settings_history(machine_id,version,sensor_thresholds,shift_schedule)
      select machine_id,version,sensor_thresholds,shift_schedule from machine_operational_settings;
    insert into downtime_events(machine_id,sensor_id,started_at,ended_at,duration_seconds,status,cause)
      select '33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444',
        '2025-01-01'::timestamptz + sequence * interval '10 minutes',
        '2025-01-01'::timestamptz + sequence * interval '10 minutes' + interval '5 minutes',300,'Resolved','Other'
      from generate_series(0,9999) sequence;
    insert into audit_logs(action,entity_type) values ('RECOVERY_FIXTURE','test');
    select issue_refresh_token('22222222-2222-4222-8222-222222222222',repeat('a',64),now()+interval '1 hour');
    analyze downtime_events;
  `)
  const backup = path.join(directory, 'synthetic.dump')
  await run('pg_dump', [...connection, '-d', 'recovery_source', '-Fc', '-f', backup])
  const started = performance.now()
  await run('pg_restore', [...connection, '-d', 'recovery_target', '--exit-on-error', backup])
  const restoreMs = performance.now() - started
  const fingerprint = `select md5(string_agg(row_to_json(record)::text, '' order by record.id)) from downtime_events record`
  assert.equal(await query('recovery_target', fingerprint), await query('recovery_source', fingerprint))
  assert.equal(await query('recovery_target', 'select count(*) from downtime_events'), '10000')
  assert.equal(await query('recovery_target', 'select count(*) from downtime_events downtime join sensors sensor on sensor.id=downtime.sensor_id join machines machine on machine.id=sensor.machine_id'), '10000')
  assert.equal(await query('recovery_target', "select count(*) from audit_logs where action='RECOVERY_FIXTURE'"), '1')
  assert.equal(await query('recovery_target', 'select count(*) from machine_operational_settings_history'), '1')
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(query('recovery_target', `set role ${role}; select * from downtime_events`), /permission denied/)
    await assert.rejects(query('recovery_target', `set role ${role}; select issue_refresh_token('22222222-2222-4222-8222-222222222222',repeat('b',64),now()+interval '1 hour')`), /permission denied/)
  }
  assert.equal(await query('recovery_target', "select bool_and(relrowsecurity) from pg_class where oid in ('users'::regclass,'downtime_events'::regclass,'sensor_events'::regclass)"), 't')
  assert.equal(await query('recovery_target', 'set role service_role; select count(*) from downtime_events'), '10000')
  await assert.rejects(query('recovery_target', 'set role service_role; delete from downtime_events'), /permission denied/)
  await assert.rejects(query('recovery_target', "insert into sensors(machine_id,sensor_code,esp32_device_id,label) values ('55555555-5555-4555-8555-555555555555','S-02','missing-parent','Synthetic')"), /foreign key/)
  assert.equal(await query('recovery_target', "set role service_role; select outcome from rotate_refresh_token(repeat('a',64),repeat('b',64))"), 'rotated')
  const plans = {}
  for (const [label, suffix] of [['first500', 'limit 500'], ['late500', 'offset 9500 limit 500'], ['page25', 'limit 25']]) {
    plans[label] = JSON.parse(await query('recovery_source', `explain (analyze,buffers,format json)
      select * from downtime_events order by started_at asc,id asc ${suffix}`))
  }
  await fs.writeFile(path.join(directory, 'query-plans.json'), JSON.stringify(plans, null, 2))
  context.diagnostic(JSON.stringify({ restoreMs: Math.round(restoreMs), directory, rows: 10000,
    plans: Object.fromEntries(Object.entries(plans).map(([label, plan]) => [label, { executionMs: plan[0]['Execution Time'], node: plan[0].Plan['Node Type'] }])),
    scope: 'Synthetic local PostgreSQL only; no Supabase or HTTP timing; cluster roles bootstrapped separately' }))
})
