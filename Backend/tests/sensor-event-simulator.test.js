const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const http = require('node:http')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')

function cleanVerificationBaseline(overrides = {}) {
  const live = {
    machine: { status: 'Running' },
    sensors: ['S-01', 'S-02', 'S-03', 'S-04', 'S-05'].map((sensorCode) => ({
      sensorCode,
      status: 'Running',
      physicalStatus: 'Active',
    })),
  }
  const downtime = { records: [], summary: { open: 0 } }
  return {
    live: { ...live, ...(overrides.live || {}) },
    downtime: { ...downtime, ...(overrides.downtime || {}) },
    alerts: overrides.alerts,
  }
}

function groupedVerificationResponse(event, index, overrides = {}) {
  const outcomes = [
    { downtimeAction: null, downtimeSensorCode: null, machineStatus: 'Running', stateApplied: true, duplicate: false, stale: false },
    { downtimeAction: null, downtimeSensorCode: null, machineStatus: 'Running', stateApplied: true, duplicate: false, stale: false },
    { downtimeAction: 'created', downtimeId: 'downtime-group', downtimeSensorCode: 'S-03', machineStatus: 'Downtime', stateApplied: true, duplicate: false, stale: false },
    { downtimeAction: 'resolved', downtimeId: 'downtime-group', downtimeSensorCode: 'S-03', machineStatus: 'Running', stateApplied: true, duplicate: false, stale: false },
    { downtimeAction: null, downtimeSensorCode: null, machineStatus: 'Running', stateApplied: true, duplicate: false, stale: false },
    { downtimeAction: null, downtimeSensorCode: null, machineStatus: 'Running', stateApplied: true, duplicate: false, stale: false },
  ]
  return {
    event: {
      sensorCode: event.metadata.sensorCode,
      ...event,
      downtimeId: null,
      ...outcomes[index],
      ...(overrides[index] || {}),
    },
  }
}

function noDowntimeVerificationResponse(event, overrides = {}) {
  return {
    event: {
      sensorCode: event.metadata.sensorCode,
      ...event,
      downtimeId: null,
      downtimeSensorCode: null,
      machineStatus: 'Running',
      stateApplied: true,
      duplicate: false,
      stale: false,
      downtimeAction: null,
      ...overrides,
    },
  }
}

function directS03VerificationResponse(event, index, overrides = {}) {
  const outcomes = [
    { downtimeAction: 'created', downtimeId: 'downtime-direct', downtimeSensorCode: 'S-03', machineStatus: 'Downtime', stateApplied: true, duplicate: false, stale: false },
    { downtimeAction: null, downtimeId: null, downtimeSensorCode: null, machineStatus: 'Downtime', stateApplied: false, duplicate: true, stale: false },
    { downtimeAction: null, downtimeId: null, downtimeSensorCode: null, machineStatus: 'Downtime', stateApplied: false, duplicate: false, stale: true },
    { downtimeAction: 'resolved', downtimeId: 'downtime-direct', downtimeSensorCode: 'S-03', machineStatus: 'Running', stateApplied: true, duplicate: false, stale: false },
  ]
  return {
    event: {
      sensorCode: event.metadata.sensorCode,
      ...event,
      ...outcomes[index],
      ...(overrides[index] || {}),
    },
  }
}

function simulatorAlert(sensorCode, metadata) {
  const isDowntime = Boolean(metadata.downtimeId)
  return {
    id: `alert-${sensorCode}-${isDowntime ? 'downtime' : 'process'}`,
    severity: isDowntime ? 'Critical' : 'Warning',
    status: 'Active',
    title: `${sensorCode} ${isDowntime ? 'downtime detected' : 'process issue detected'}`,
    message: 'Simulator alert snapshot.',
    sourceType: 'sensor',
    machine: { id: 'machine-1', name: 'Spiral Mill 01' },
    sensor: { id: `sensor-${sensorCode}`, sensorCode, label: sensorCode },
    metadata,
    createdAt: '2026-01-01T00:00:00.000Z',
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    revision: '1',
  }
}

function alertSnapshotForEvents(events, outcomes) {
  const processAlerts = new Map()
  let downtimeAlert = null

  events.forEach((event, index) => {
    const outcome = outcomes[index]
    const sensorCode = event.metadata.sensorCode
    if (event.eventType !== 'fault' || outcome?.stateApplied !== true) return

    if (['S-01', 'S-02', 'S-04'].includes(sensorCode)) {
      processAlerts.set(sensorCode, simulatorAlert(sensorCode, { processFault: true, sensorCode }))
    }
    if (outcome.downtimeAction === 'created' && outcome.downtimeSensorCode === 'S-03') {
      downtimeAlert = simulatorAlert('S-03', { downtimeId: outcome.downtimeId })
    }
  })

  return { alerts: [...processAlerts.values(), ...(downtimeAlert ? [downtimeAlert] : [])], snapshotRevision: '1' }
}

async function runSimulator(
  t,
  argumentsToAdd,
  randomValue = 0.999999,
  buildResponse = (event) => ({ event }),
  baseline = cleanVerificationBaseline(),
) {
  const receivedEvents = []
  const receivedOutcomes = []
  const receivedRequests = []
  const server = http.createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      receivedRequests.push({ method: request.method, url: request.url, authorization: request.headers.authorization })
      if (request.method === 'GET') {
        const payload = request.url.startsWith('/api/iot/live')
          ? baseline.live
          : request.url.startsWith('/api/alerts')
            ? baseline.alerts || alertSnapshotForEvents(receivedEvents, receivedOutcomes)
            : baseline.downtime
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify(payload))
        return
      }

      const event = JSON.parse(body)
      receivedEvents.push(event)
      const result = buildResponse(event, receivedEvents.length - 1)
      receivedOutcomes.push(result.event)
      response.writeHead(201, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(result))
    })
  })
  t.after(() => server.close())

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const script = [
    `process.argv.push(${argumentsToAdd.map((argument) => JSON.stringify(argument)).join(', ')})`,
    `Math.random = () => ${randomValue}`,
    "require('./scripts/simulate-sensor-events.js')",
  ].join('; ')
  const child = spawn(process.execPath, ['-e', script], {
    cwd: backendRoot,
    env: {
      ...process.env,
      IOT_SIM_BASE_URL: `http://127.0.0.1:${port}`,
      IOT_SIM_S01_KEY: 'test-key',
      IOT_SIM_S02_KEY: 'test-key',
      IOT_SIM_S03_KEY: 'test-key',
      IOT_SIM_S04_KEY: 'test-key',
      IOT_SIM_S05_KEY: 'test-key',
      IOT_SIM_BEARER_TOKEN: 'test-bearer',
    },
  })
  let stderr = ''
  let stdout = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const exitCode = await new Promise((resolve) => child.on('close', resolve))

  return { exitCode, receivedEvents, receivedRequests, stderr, stdout }
}

test('one simulator batch never assigns the issue event to S-05', async (t) => {
  const { exitCode, receivedEvents, stderr } = await runSimulator(t, ['--once'])

  assert.equal(exitCode, 0, stderr)
  assert.equal(receivedEvents.length, 5)
  const outputEvent = receivedEvents.find((event) => event.metadata.sensorCode === 'S-05')
  assert.equal(outputEvent.eventType, 'pulse')
  assert.equal(outputEvent.signal, 'active')
})

test('one simulator batch labels no-pulse input as an observation instead of downtime', async (t) => {
  const { exitCode, receivedEvents, stderr, stdout } = await runSimulator(t, ['--once'], 0)

  assert.equal(exitCode, 0, stderr)
  assert.ok(receivedEvents.some((event) => event.eventType === 'downtime' && event.signal === 'no_pulse'))
  assert.match(stdout, /no pulse observation \(not confirmed downtime\)/i)
  assert.doesNotMatch(stdout, /\(downtime \/ no_pulse\)/i)
})

test('process-isolation rejects an incorrect machine downtime result', async (t) => {
  const { exitCode, stderr } = await runSimulator(
    t,
    ['--once', '--process-isolation'],
    0.999999,
    (event, index) => noDowntimeVerificationResponse(event, {
      machineStatus: index === 1 ? 'Downtime' : 'Running',
    }),
  )

  assert.notEqual(exitCode, 0, stderr)
  assert.match(stderr, /S-01 process recovery machine status was Downtime/)
})

test('process-isolation verifies one S-01 fault and its recovery', async (t) => {
  const { exitCode, receivedEvents, receivedRequests, stderr } = await runSimulator(
    t,
    ['--once', '--process-isolation'],
    0.999999,
    noDowntimeVerificationResponse,
  )

  assert.equal(exitCode, 0, stderr)
  assert.deepEqual(
    receivedEvents.map((event) => [event.metadata.sensorCode, event.eventType]),
    [['S-01', 'fault'], ['S-01', 'recovered']],
  )
  assert.equal(receivedRequests.filter((request) => request.method === 'GET').length, 5)
  assert.equal(receivedRequests.filter((request) => request.url === '/api/alerts').length, 1)
})

test('process-isolation rejects a missing S-01 process-fault alert', async (t) => {
  const baseline = cleanVerificationBaseline({ alerts: { alerts: [], snapshotRevision: '0' } })
  const result = await runSimulator(
    t,
    ['--once', '--process-isolation'],
    0.999999,
    noDowntimeVerificationResponse,
    baseline,
  )

  assert.equal(result.exitCode, 1)
  assert.match(result.stderr, /S-01 process-fault alert is missing/)
  assert.deepEqual(
    result.receivedEvents.map((event) => [event.metadata.sensorCode, event.eventType]),
    [['S-01', 'fault']],
  )
})

test('grouped verification rejects a missing S-03 downtime alert', async (t) => {
  const baseline = cleanVerificationBaseline({
    alerts: {
      alerts: ['S-01', 'S-02', 'S-04'].map((sensorCode) => simulatorAlert(sensorCode, { processFault: true, sensorCode })),
      snapshotRevision: '0',
    },
  })
  const result = await runSimulator(t, ['--verify-group'], 0.999999, groupedVerificationResponse, baseline)

  assert.equal(result.exitCode, 1)
  assert.match(result.stderr, /S-03 downtime alert is missing/)
  assert.deepEqual(
    result.receivedEvents.map((event) => [event.metadata.sensorCode, event.eventType]),
    [['S-01', 'fault'], ['S-04', 'fault'], ['S-02', 'fault']],
  )
})

test('grouped verification rejects a missing S-04 process-fault alert', async (t) => {
  const baseline = cleanVerificationBaseline({
    alerts: {
      alerts: [simulatorAlert('S-01', { processFault: true, sensorCode: 'S-01' })],
      snapshotRevision: '0',
    },
  })
  const result = await runSimulator(t, ['--verify-group'], 0.999999, groupedVerificationResponse, baseline)

  assert.equal(result.exitCode, 1)
  assert.match(result.stderr, /S-04 process-fault alert is missing/)
  assert.deepEqual(
    result.receivedEvents.map((event) => [event.metadata.sensorCode, event.eventType]),
    [['S-01', 'fault'], ['S-04', 'fault']],
  )
})

test('direct S-03 verification rejects a missing downtime alert', async (t) => {
  const baseline = cleanVerificationBaseline({ alerts: { alerts: [], snapshotRevision: '0' } })
  const result = await runSimulator(t, ['--verify-sensor=S-03'], 0.999999, directS03VerificationResponse, baseline)

  assert.equal(result.exitCode, 1)
  assert.match(result.stderr, /S-03 downtime alert is missing/)
  assert.deepEqual(
    result.receivedEvents.map((event) => [event.metadata.sensorCode, event.eventType]),
    [['S-03', 'fault']],
  )
})

test('verification refuses an incomplete sensor snapshot before sending any events', async (t) => {
  const baseline = cleanVerificationBaseline()
  baseline.live.sensors = []
  const result = await runSimulator(t, ['--process-isolation', '--once'], 0.99, noDowntimeVerificationResponse, baseline)
  assert.notEqual(result.exitCode, 0)
  assert.match(result.stderr, /baseline.*invalid/i)
  assert.equal(result.receivedEvents.length, 0)
})

test('recovery mode closes only currently faulted S-01 through S-04 sensors', async (t) => {
  const baseline = cleanVerificationBaseline()
  baseline.live.machine.status = 'Downtime'
  for (const sensorCode of ['S-01', 'S-03', 'S-04', 'S-05']) {
    const sensor = baseline.live.sensors.find((candidate) => candidate.sensorCode === sensorCode)
    sensor.status = 'Fault'
    sensor.physicalStatus = 'Fault'
  }

  const { exitCode, receivedEvents, receivedRequests, stderr } = await runSimulator(
    t,
    ['--recover-active-faults'],
    0.999999,
    (event) => {
      const sensor = baseline.live.sensors.find((candidate) => candidate.sensorCode === event.metadata.sensorCode)
      sensor.status = 'Running'
      sensor.physicalStatus = 'Active'
      if (baseline.live.sensors.filter((candidate) => candidate.sensorCode !== 'S-05').every((candidate) => candidate.status !== 'Fault')) {
        baseline.live.machine.status = 'Running'
      }
      return noDowntimeVerificationResponse(event)
    },
    baseline,
  )

  assert.equal(exitCode, 0, stderr)
  assert.deepEqual(
    receivedEvents.map((event) => [event.metadata.sensorCode, event.eventType, event.signal]),
    [
      ['S-01', 'recovered', 'active'],
      ['S-03', 'recovered', 'active'],
      ['S-04', 'recovered', 'active'],
    ],
  )
  assert.equal(receivedRequests.filter((request) => request.method === 'GET').length, 5)
  assert.ok(receivedRequests.filter((request) => request.method === 'GET').every((request) => request.authorization === 'Bearer test-bearer'))
})

test('recovery mode is a no-op when no S-01 through S-04 sensor is faulted', async (t) => {
  const { exitCode, receivedEvents, receivedRequests, stderr } = await runSimulator(t, ['--recover-active-faults'])

  assert.equal(exitCode, 0, stderr)
  assert.equal(receivedEvents.length, 0)
  assert.equal(receivedRequests.filter((request) => request.method === 'GET').length, 2)
})

test('F06 group recovery never sends physical recovery to healthy S-03', async (t) => {
  const baseline = cleanVerificationBaseline()
  baseline.live.machine.status = 'Downtime'
  baseline.live.sensors[2].status = 'Downtime'
  for (const sensor of baseline.live.sensors.filter((s) => ['S-01', 'S-02', 'S-04'].includes(s.sensorCode))) {
    sensor.status = 'Fault'
    sensor.physicalStatus = 'Fault'
  }
  const result = await runSimulator(t, ['--recover-active-faults'], 0.99, (event) => {
    const sensor = baseline.live.sensors.find((s) => s.sensorCode === event.metadata.sensorCode)
    sensor.status = 'Running'
    sensor.physicalStatus = 'Active'
    baseline.live.sensors[2].status = 'Running'
    baseline.live.machine.status = 'Running'
    return noDowntimeVerificationResponse(event)
  }, baseline)
  assert.equal(result.exitCode, 0, result.stderr)
  assert.deepEqual(result.receivedEvents.map((e) => e.metadata.sensorCode), ['S-01', 'S-02', 'S-04'])
})

test('F06 review skips a target that recovered before its turn', async (t) => {
  const baseline = cleanVerificationBaseline()
  for (const sensor of baseline.live.sensors.filter((s) => ['S-01', 'S-04'].includes(s.sensorCode))) sensor.status = 'Fault'
  const result = await runSimulator(t, ['--recover-active-faults'], 0.99, (event) => {
    for (const sensor of baseline.live.sensors) sensor.status = 'Running'
    return noDowntimeVerificationResponse(event)
  }, baseline)
  assert.equal(result.exitCode, 0, result.stderr)
  assert.deepEqual(result.receivedEvents.map((e) => e.metadata.sensorCode), ['S-01'])
})

for (const fault of ['empty', 'missing', 'duplicate', 'machine-down', 'open-interval']) {
  test(`F07 recovery rejects ${fault} state instead of reporting success`, async (t) => {
    const baseline = cleanVerificationBaseline()
    if (fault === 'empty') baseline.live.sensors = []
    if (fault === 'missing') baseline.live.sensors.pop()
    if (fault === 'duplicate') baseline.live.sensors[4] = baseline.live.sensors[0]
    if (fault === 'machine-down') baseline.live.machine.status = 'Downtime'
    if (fault === 'open-interval') baseline.downtime = { records: [{ status: 'Open' }], summary: { open: 1 } }
    const result = await runSimulator(t, ['--recover-active-faults'], 0.99, noDowntimeVerificationResponse, baseline)
    assert.equal(result.exitCode, 1)
    assert.equal(result.receivedEvents.length, 0)
  })
}

test('F07 review verifies final downtime after accepted sensor recovery', async (t) => {
  const baseline = cleanVerificationBaseline()
  baseline.live.sensors[0].status = 'Fault'
  const result = await runSimulator(t, ['--recover-active-faults'], 0.99, (event) => {
    baseline.live.sensors[0].status = 'Running'
    baseline.downtime = { records: [{ status: 'Open' }], summary: { open: 1 } }
    return noDowntimeVerificationResponse(event)
  }, baseline)
  assert.equal(result.exitCode, 1)
  assert.match(result.stderr, /downtime remains active/)
})

test('F07 review permits an inactive but recovered machine', async (t) => {
  const baseline = cleanVerificationBaseline()
  baseline.live.machine.status = 'Idle'
  const result = await runSimulator(t, ['--recover-active-faults'], 0.99, noDowntimeVerificationResponse, baseline)
  assert.equal(result.exitCode, 0, result.stderr)
  assert.equal(result.receivedEvents.length, 0)
})

test('recovery mode fails when a fault remains after its accepted recovery event', async (t) => {
  const baseline = cleanVerificationBaseline()
  const sensor = baseline.live.sensors.find((candidate) => candidate.sensorCode === 'S-01')
  sensor.status = 'Fault'
  sensor.physicalStatus = 'Fault'

  const { exitCode, receivedEvents, receivedRequests, stderr } = await runSimulator(
    t,
    ['--recover-active-faults'],
    0.999999,
    noDowntimeVerificationResponse,
    baseline,
  )

  assert.equal(exitCode, 1)
  assert.match(stderr, /Recovery verification failed: S-01 remains faulted/)
  assert.deepEqual(receivedEvents.map((event) => event.metadata.sensorCode), ['S-01'])
  assert.equal(receivedRequests.filter((request) => request.method === 'GET').length, 2)
})

test('downtime lifecycle verification rejects S-05 before sending an event', async (t) => {
  const { exitCode, receivedEvents, stderr } = await runSimulator(t, ['--verify-sensor=S-05'])

  assert.equal(exitCode, 1)
  assert.match(stderr, /S-05 does not support downtime verification/)
  assert.equal(receivedEvents.length, 0)
})

test('verification aborts before writes when the baseline has active downtime', async (t) => {
  const baseline = cleanVerificationBaseline()
  baseline.live.machine.status = 'Downtime'
  baseline.live.sensors[2].status = 'Downtime'
  baseline.downtime.records = [{ id: 'open-s03', sensor: 'S-03', status: 'Open' }]
  baseline.downtime.summary.open = 1

  const { exitCode, receivedEvents, receivedRequests, stderr } = await runSimulator(
    t,
    ['--verify-group'],
    0.999999,
    groupedVerificationResponse,
    baseline,
  )

  assert.equal(exitCode, 1)
  assert.match(stderr, /Verification preflight failed: active downtime is already present/)
  assert.equal(receivedEvents.length, 0)
  assert.deepEqual(receivedRequests.map((request) => request.method), ['GET', 'GET'])
  assert.ok(receivedRequests.every((request) => request.authorization === 'Bearer test-bearer'))
})

test('grouped verification rejects an unapplied third process fault', async (t) => {
  const { exitCode, stderr } = await runSimulator(
    t,
    ['--verify-group'],
    0.999999,
    (event, index) => groupedVerificationResponse(event, index, {
      2: { stateApplied: false },
    }),
  )

  assert.equal(exitCode, 1)
  assert.match(stderr, /third process fault was not applied/)
})

test('grouped verification checks every recovery event', async (t) => {
  const { exitCode, stderr } = await runSimulator(
    t,
    ['--verify-group'],
    0.999999,
    (event, index) => groupedVerificationResponse(event, index, {
      4: { stateApplied: false },
    }),
  )

  assert.equal(exitCode, 1)
  assert.match(stderr, /S-04 recovery was not applied/)
})

test('simulator rejects unknown command options before sending events', async (t) => {
  const { exitCode, receivedEvents, receivedRequests, stderr } = await runSimulator(
    t,
    ['--once', '--unknown-option'],
  )

  assert.equal(exitCode, 1)
  assert.match(stderr, /Unknown simulator option: --unknown-option/)
  assert.equal(receivedEvents.length, 0)
  assert.equal(receivedRequests.length, 0)
})

test('direct S-03 verification proves downtime and recovery ownership', async (t) => {
  const { exitCode, receivedEvents, receivedRequests, stderr } = await runSimulator(
    t,
    ['--verify-sensor=S-03'],
    0.999999,
    directS03VerificationResponse,
  )

  assert.equal(exitCode, 0, stderr)
  assert.deepEqual(
    receivedEvents.map((event) => [event.metadata.sensorCode, event.eventType]),
    [['S-03', 'fault'], ['S-03', 'fault'], ['S-03', 'recovered'], ['S-03', 'recovered']],
  )
  assert.deepEqual(receivedEvents[1], receivedEvents[0])
  assert.equal(receivedRequests.filter((request) => request.method === 'GET').length, 5)
  assert.equal(receivedRequests.filter((request) => request.url === '/api/alerts').length, 1)
  assert.ok(receivedRequests.filter((request) => request.method === 'GET').every((request) => request.authorization === 'Bearer test-bearer'))
})

test('grouped verification uses a monotonic current-time event sequence', async (t) => {
  const runStartedAt = Date.now()
  const { exitCode, receivedEvents, receivedRequests, stderr } = await runSimulator(
    t,
    ['--verify-group'],
    0.999999,
    groupedVerificationResponse,
  )

  assert.equal(exitCode, 0, stderr)
  assert.deepEqual(
    receivedEvents.map((event) => [event.metadata.sensorCode, event.eventType]),
    [['S-01', 'fault'], ['S-04', 'fault'], ['S-02', 'fault'], ['S-01', 'recovered'], ['S-04', 'recovered'], ['S-02', 'recovered']],
  )

  const recordedAt = receivedEvents.map((event) => new Date(event.recordedAt).getTime())
  assert.ok(recordedAt.every((value) => value >= runStartedAt))
  assert.ok(recordedAt.every((value, index) => index === 0 || value > recordedAt[index - 1]))
  assert.ok(recordedAt.every((value) => value <= Date.now()))
  assert.equal(receivedRequests.filter((request) => request.method === 'GET').length, 8)
  assert.equal(receivedRequests.filter((request) => request.url === '/api/alerts').length, 4)
  assert.ok(receivedRequests.filter((request) => request.method === 'GET').every((request) => request.authorization === 'Bearer test-bearer'))
})
