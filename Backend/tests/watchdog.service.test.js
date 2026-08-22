const assert = require('node:assert/strict')
const test = require('node:test')

const { createWatchdogMetrics } = require('../src/modules/watchdog/watchdog.metrics')
const { createWatchdogRunner } = require('../src/modules/watchdog/watchdog.runner')
const { createWatchdogService, validateEvaluationResult } = require('../src/modules/watchdog/watchdog.service')

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function result(sensorId, descriptors = []) {
  return {
    evaluated_sensor_id: sensorId,
    connectivity_state: 'online',
    detection_state: 'healthy',
    transition_descriptors: descriptors,
  }
}

test('watchdog service evaluates sensors in order, publishes committed descriptors, and isolates one failure', async () => {
  const calls = []
  const published = []
  const logs = []
  const metrics = createWatchdogMetrics()
  const repository = {
    async listSensors() {
      return [
        { sensorId: 'sensor-1', sensorCode: 'S-01', machineCode: 'M-01' },
        { sensorId: 'sensor-2', sensorCode: 'S-02', machineCode: 'M-01' },
        { sensorId: 'sensor-3', sensorCode: 'S-03', machineCode: 'M-01' },
      ]
    },
    async evaluateSensor({ sensorId }) {
      calls.push(sensorId)
      if (sensorId === 'sensor-2') {
        const error = new Error('private failure')
        error.code = 'WATCHDOG_EVALUATION_FAILED'
        throw error
      }
      return result(sensorId, [{ kind: 'downtime', action: 'created', id: sensorId }])
    },
    async getStateCounts() {
      return { online: 3, healthy: 2, suspended: 1 }
    },
  }
  const service = createWatchdogService({
    watchdogRepository: repository,
    publisher: (descriptors) => {
      published.push(...descriptors)
      return descriptors.length
    },
    serviceLogger: { error: (message, metadata) => logs.push({ message, metadata }), warn: () => {} },
  })

  await service.runCycle({
    evaluatedAt: '2026-08-22T04:00:00.000Z',
    mode: 'observe',
    staleAfterSeconds: 30,
    signal: new AbortController().signal,
    metrics,
  })

  assert.deepEqual(calls, ['sensor-1', 'sensor-2', 'sensor-3'])
  assert.equal(published.length, 2)
  assert.equal(logs.length, 1)
  assert.deepEqual(logs[0].metadata, {
    sensorCode: 'S-02',
    machineCode: 'M-01',
    errorCode: 'WATCHDOG_EVALUATION_FAILED',
  })
  const snapshot = metrics.snapshot()
  assert.equal(snapshot.sensorEvaluations, 3)
  assert.equal(snapshot.sensorFailures, 1)
  assert.equal(snapshot.transitions, 2)
  assert.equal(snapshot.states.online, 3)
})

test('watchdog result validation rejects malformed and mismatched database data', () => {
  assert.throws(() => validateEvaluationResult(null, 'sensor-1'), { code: 'WATCHDOG_EVALUATION_RESULT_INVALID' })
  assert.throws(
    () => validateEvaluationResult(result('another-sensor'), 'sensor-1'),
    { code: 'WATCHDOG_EVALUATION_RESULT_INVALID' },
  )
  assert.throws(
    () => validateEvaluationResult({ ...result('sensor-1'), transition_descriptors: {} }, 'sensor-1'),
    { code: 'WATCHDOG_EVALUATION_RESULT_INVALID' },
  )
})

test('watchdog runner starts immediately, prevents overlap, and has idempotent lifecycle', async () => {
  let calls = 0
  let concurrent = 0
  let maximumConcurrent = 0
  const metrics = createWatchdogMetrics()
  const service = {
    async runCycle() {
      calls += 1
      concurrent += 1
      maximumConcurrent = Math.max(maximumConcurrent, concurrent)
      await delay(15)
      concurrent -= 1
    },
  }
  const runner = createWatchdogRunner({
    service,
    metrics,
    mode: 'observe',
    intervalMs: 5,
    timeoutMs: 100,
    staleAfterSeconds: 30,
    runnerLogger: { info: () => {}, error: () => {} },
  })

  assert.equal(runner.start(), true)
  assert.equal(runner.start(), false)
  await delay(45)
  await runner.stop()
  assert.ok(calls >= 2)
  assert.equal(maximumConcurrent, 1)
  assert.equal(runner.status().running, false)
  assert.equal(await runner.stop(), false)
})

test('disabled watchdog does not start or schedule evaluation cycles', async () => {
  let calls = 0
  const logs = []
  const metrics = createWatchdogMetrics()
  const runner = createWatchdogRunner({
    service: {
      async runCycle() {
        calls += 1
      },
    },
    metrics,
    mode: 'disabled',
    intervalMs: 5,
    timeoutMs: 100,
    staleAfterSeconds: 30,
    runnerLogger: { info: (message, metadata) => logs.push({ message, metadata }), error: () => {} },
  })

  assert.equal(runner.start(), false)
  await delay(20)
  assert.equal(calls, 0)
  assert.deepEqual(runner.status(), { mode: 'disabled', running: false, inFlight: false })
  assert.equal(metrics.snapshot().cycles, 0)
  assert.equal(logs[0].message, 'Sensor watchdog is disabled.')
})

test('aborted watchdog evaluation stops the cycle without cascading sensor failures', async () => {
  const controller = new AbortController()
  const timeoutError = new Error('Watchdog cycle timed out.')
  timeoutError.code = 'WATCHDOG_CYCLE_TIMEOUT'
  const calls = []
  const logs = []
  const metrics = createWatchdogMetrics()
  const repository = {
    async listSensors() {
      return [
        { sensorId: 'sensor-1', sensorCode: 'S-01', machineCode: 'M-01' },
        { sensorId: 'sensor-2', sensorCode: 'S-02', machineCode: 'M-01' },
      ]
    },
    async evaluateSensor({ sensorId }) {
      calls.push(sensorId)
      controller.abort(timeoutError)
      const error = new Error('Aborted database request.')
      error.code = 'WATCHDOG_EVALUATION_FAILED'
      throw error
    },
    async getStateCounts() {
      throw new Error('State counts must not run after an abort.')
    },
  }
  const service = createWatchdogService({
    watchdogRepository: repository,
    serviceLogger: { error: (message, metadata) => logs.push({ message, metadata }), warn: () => {} },
  })

  await assert.rejects(
    service.runCycle({
      evaluatedAt: '2026-08-22T04:00:00.000Z',
      mode: 'observe',
      staleAfterSeconds: 30,
      signal: controller.signal,
      metrics,
    }),
    { code: 'WATCHDOG_CYCLE_TIMEOUT' },
  )
  assert.deepEqual(calls, ['sensor-1'])
  assert.equal(logs.length, 0)
  assert.equal(metrics.snapshot().sensorFailures, 0)
})

test('watchdog runner aborts a timed-out cycle and records a safe error code', async () => {
  let aborted = false
  const metrics = createWatchdogMetrics()
  const logs = []
  const service = {
    runCycle({ signal }) {
      return new Promise((resolve) => {
        signal.addEventListener('abort', () => {
          aborted = true
          resolve()
        }, { once: true })
      })
    },
  }
  const runner = createWatchdogRunner({
    service,
    metrics,
    mode: 'observe',
    intervalMs: 100,
    timeoutMs: 10,
    staleAfterSeconds: 30,
    runnerLogger: { info: () => {}, error: (message, metadata) => logs.push({ message, metadata }) },
  })

  runner.start()
  await delay(25)
  await runner.stop()
  assert.equal(aborted, true)
  assert.equal(metrics.snapshot().lastErrorCode, 'WATCHDOG_CYCLE_TIMEOUT')
  assert.equal(logs[0].metadata.errorCode, 'WATCHDOG_CYCLE_TIMEOUT')
})

test('uncooperative timed-out work cannot overlap a later watchdog cycle', async () => {
  let calls = 0
  const runner = createWatchdogRunner({
    service: {
      runCycle() {
        calls += 1
        return new Promise(() => {})
      },
    },
    metrics: createWatchdogMetrics(),
    mode: 'observe',
    intervalMs: 5,
    timeoutMs: 10,
    staleAfterSeconds: 30,
    runnerLogger: { info: () => {}, error: () => {} },
  })

  runner.start()
  await delay(35)
  assert.equal(calls, 1)
  await runner.stop()
  assert.equal(calls, 1)
  assert.equal(runner.status().running, false)
  assert.equal(runner.status().inFlight, true)
})
