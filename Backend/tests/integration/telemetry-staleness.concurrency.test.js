const assert = require('node:assert/strict')
const { execFile, spawn } = require('node:child_process')
const { promisify } = require('node:util')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const test = require('node:test')

const enabled = Boolean(process.env.TELEMETRY_REVIEW_PG_PORT)
const psql = process.env.TELEMETRY_REVIEW_PSQL || 'psql'
const user = process.env.TELEMETRY_REVIEW_PG_USER || 'telemetryreview'
const databaseName = `telemetry_staleness_review_${randomUUID().replaceAll('-', '')}`
const connectionArgs = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', process.env.TELEMETRY_REVIEW_PG_PORT || '55440', '-U', user]
const args = [...connectionArgs, '-d', databaseName]
const execute = promisify(execFile)
const query = async (sql) => (await execute(psql, [...args, '-c', sql])).stdout.trim()

async function holdTransaction(sql) {
  const child = spawn(psql, args, { windowsHide: true })
  let output = ''
  const closed = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.stderr.on('data', (data) => { output += data })
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(output)))
  })
  const ready = new Promise((resolve) => {
    child.stdout.on('data', (data) => {
      output += data
      if (output.includes('telemetry-newer-held')) resolve()
    })
  })
  child.stdin.write(`begin; ${sql}; select 'telemetry-newer-held';\n`)
  await Promise.race([ready, closed.then(() => { throw new Error('Holder exited before acquiring the sensor lock') })])
  return async () => { child.stdin.end('commit;\n'); await closed }
}

async function waitForLock(application, finished) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await query(`select count(*) from pg_stat_activity where application_name='${application}' and wait_event_type='Lock'`) !== '0') return true
    if (finished()) return false
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return false
}

test.before(async () => {
  if (!enabled) return
  await execute(psql, [...connectionArgs, '-d', 'postgres', '-c', `create database ${databaseName}`])
  await query("do $$ begin create role anon; exception when duplicate_object then null; end $$; do $$ begin create role authenticated; exception when duplicate_object then null; end $$; do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;")
  for (const filename of ['schema.sql', 'seed.sql', 'migrations/028_persist_telemetry_staleness.sql']) {
    await execute(psql, [...args, '-f', path.resolve(__dirname, '../../database', filename)])
  }
})

test.after(async () => {
  if (enabled) await execute(psql, [...connectionArgs, '-d', 'postgres', '-c', `drop database if exists ${databaseName} with (force)`])
})

test('real connections classify the blocked older event as stale and exclude it from aggregation', {
  skip: enabled ? false : 'Set TELEMETRY_REVIEW_PG_PORT to a disposable loopback PostgreSQL cluster port to run this integration test.',
  timeout: 30000,
}, async () => {
  const sensor = (await query("set role service_role; select id::text || '|' || machine_id::text from sensors where sensor_code='S-05'")).split('|')
  const [sensorId, machineId] = sensor
  const newerEventId = randomUUID()
  const olderEventId = randomUUID()
  const release = await holdTransaction(`set role service_role; select stale from public.ingest_iot_sensor_event('${newerEventId}','${sensorId}','${machineId}','pulse','{"signal":"active"}'::jsonb,'2026-08-20T10:05:00Z')`)
  let finished = false
  const older = query(`set application_name='telemetry-staleness-older'; set role service_role; select stale::text || ':' || state_applied::text from public.ingest_iot_sensor_event('${olderEventId}','${sensorId}','${machineId}','pulse','{"signal":"active"}'::jsonb,'2026-08-20T10:03:00Z')`).finally(() => { finished = true })
  let blocked
  try { blocked = await waitForLock('telemetry-staleness-older', () => finished) } finally { await release() }
  assert.equal(blocked, true)
  assert.equal(await older, 'true:false')
  assert.equal(await query(`set role service_role; select count(*) from sensor_events where sensor_id='${sensorId}'`), '2')
  assert.equal(await query(`set role service_role; select coalesce(sum(event_count),0) from public.aggregate_analytics_sensor_events('${machineId}','2026-08-01','2026-09-01',3600)`), '1')
  assert.equal(await query(`set role service_role; select stale from sensor_events where device_event_id='${olderEventId}'`), 't')
})
