const assert = require('node:assert/strict')
const test = require('node:test')

const { createLiveStatusPublisher } = require('../../../src/modules/iot/liveStatusPublisher')

function buildLive({ machineStatus = 'Running', s01 = 'Running', s03 = 'Running', evaluatedAt = '2026-10-31T00:00:00.000Z' } = {}) {
  const sensor = (sensorCode, status) => ({
    sensorCode,
    status,
    physicalStatus: status === 'Running' ? 'Active' : 'Inactive',
    signal: status === 'Running' ? 'active' : 'idle',
    lastEventAt: '2026-10-31T00:00:00.000Z',
    monitoring: { connectivityState: 'online', detectionState: 'healthy', lastEvaluatedAt: evaluatedAt },
  })
  return {
    monitoring: { mode: 'enforce', capturedAt: evaluatedAt },
    machine: { machineCode: 'M-01', status: machineStatus },
    sensors: [sensor('S-01', s01), sensor('S-03', s03)],
  }
}

function setup(snapshots) {
  const published = []
  const logs = []
  const scheduled = []
  let loads = 0
  const publisher = createLiveStatusPublisher({
    loadLiveFeed: async () => {
      const next = snapshots[Math.min(loads, snapshots.length - 1)]
      loads += 1
      if (next instanceof Error) throw next
      return next
    },
    publish: (live) => published.push(live),
    logger: { error: (message, context) => logs.push({ message, context }) },
    schedule: (callback) => {
      scheduled.push(callback)
      return scheduled.length
    },
  })

  async function flushScheduled() {
    const callbacks = scheduled.splice(0)
    for (const callback of callbacks) await callback()
  }

  return { publisher, published, logs, flushScheduled, getLoads: () => loads }
}

test('publishes the first snapshot it reads', async () => {
  const live = buildLive()
  const { publisher, published, flushScheduled } = setup([live])

  publisher.requestPublish()
  await flushScheduled()

  assert.deepEqual(published, [live])
})

test('does not republish when only evaluation timestamps changed', async () => {
  const { publisher, published, flushScheduled } = setup([
    buildLive(),
    buildLive({ evaluatedAt: '2026-10-31T00:00:05.000Z' }),
  ])

  publisher.requestPublish()
  await flushScheduled()
  publisher.requestPublish()
  await flushScheduled()

  assert.equal(published.length, 1)
})

test('publishes a status change that has no alert', async () => {
  const { publisher, published, flushScheduled } = setup([
    buildLive({ s01: 'Idle' }),
    buildLive({ s01: 'Running' }),
  ])

  publisher.requestPublish()
  await flushScheduled()
  publisher.requestPublish()
  await flushScheduled()

  assert.deepEqual(published.map((live) => live.sensors[0].status), ['Idle', 'Running'])
})

test('publishes when only the machine status changes', async () => {
  const { publisher, published, flushScheduled } = setup([
    buildLive({ machineStatus: 'Running' }),
    buildLive({ machineStatus: 'Downtime', s03: 'Downtime' }),
  ])

  publisher.requestPublish()
  await flushScheduled()
  publisher.requestPublish()
  await flushScheduled()

  assert.equal(published.length, 2)
  assert.equal(published[1].machine.status, 'Downtime')
})

test('coalesces a burst of requests into one snapshot read', async () => {
  const { publisher, published, flushScheduled, getLoads } = setup([buildLive()])

  for (let index = 0; index < 5; index += 1) publisher.requestPublish()
  await flushScheduled()

  assert.equal(getLoads(), 1)
  assert.equal(published.length, 1)
})

test('logs a failed snapshot read without throwing and recovers on the next request', async () => {
  const failure = Object.assign(new Error('db down'), { code: 'LIVE_SNAPSHOT_QUERY_FAILED' })
  const { publisher, published, logs, flushScheduled } = setup([failure, buildLive()])

  publisher.requestPublish()
  await flushScheduled()
  publisher.requestPublish()
  await flushScheduled()

  assert.deepEqual(logs, [{ message: 'LIVE_STATUS_PUBLISH_FAILED', context: { code: 'LIVE_SNAPSHOT_QUERY_FAILED' } }])
  assert.equal(published.length, 1)
})

test('logs a failed publish and retries the same snapshot on the next request', async () => {
  const live = buildLive()
  const published = []
  const logs = []
  const scheduled = []
  let shouldFail = true
  const publisher = createLiveStatusPublisher({
    loadLiveFeed: async () => live,
    publish: (snapshot) => {
      if (shouldFail) throw new Error('listener failed')
      published.push(snapshot)
    },
    logger: { error: (message) => logs.push(message) },
    schedule: (callback) => scheduled.push(callback),
  })

  publisher.requestPublish()
  await scheduled.shift()()
  shouldFail = false
  publisher.requestPublish()
  await scheduled.shift()()

  assert.deepEqual(logs, ['LIVE_STATUS_PUBLISH_FAILED'])
  assert.deepEqual(published, [live])
})
