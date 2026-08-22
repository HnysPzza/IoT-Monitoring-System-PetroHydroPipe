const assert = require('node:assert/strict')
const test = require('node:test')

const { createWatchdogMetrics } = require('../src/modules/watchdog/watchdog.metrics')
const { createWatchdogRunner } = require('../src/modules/watchdog/watchdog.runner')
const { createWatchdogService, validateCycleResult } = require('../src/modules/watchdog/watchdog.service')

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function evaluation(sensorNumber, overrides = {}) {
  const code = `S-${String(sensorNumber).padStart(2, '0')}`
  return {
    evaluated_sensor_id: `30000000-0000-4000-8000-${String(sensorNumber).padStart(12, '0')}`,
    sensor_code: code,
    machine_code: 'M-01',
    succeeded: true,
    connectivity_state: 'online',
    detection_state: 'healthy',
    transition_descriptors: [],
    error_code: null,
    ...overrides,
  }
}

function failedEvaluation(sensorNumber) {
  return evaluation(sensorNumber, {
    succeeded: false,
    connectivity_state: null,
    detection_state: null,
    transition_descriptors: [],
    error_code: 'WATCHDOG_EVALUATION_FAILED',
  })
}

function cycleResult(evaluations, states) {
  return { evaluations, states }
}

function runnerLogger(logs = []) {
  return {
    info: (message, metadata) => logs.push({ level: 'info', message, metadata }),
    warn: (message, metadata) => logs.push({ level: 'warn', message, metadata }),
    error: (message, metadata) => logs.push({ level: 'error', message, metadata }),
  }
}

test('watchdog service uses one batch call, publishes successes, and reports a partial outcome', async () => {
  const calls = []
  const published = []
  const logs = []
  const metrics = createWatchdogMetrics()
  const result = cycleResult([
    evaluation(1, { transition_descriptors: [{ kind: 'downtime', action: 'created', id: 'one' }] }),
    failedEvaluation(2),
    evaluation(3, { transition_descriptors: [{ kind: 'alert', action: 'created', record: { id: 'three' } }] }),
  ], { online: 3, healthy: 2, suspended: 1 })
  const service = createWatchdogService({
    watchdogRepository: {
      async evaluateCycle(args) {
        calls.push(args)
        return result
      },
    },
    publisher: (descriptors) => {
      published.push(...descriptors)
      return descriptors.length
    },
    serviceLogger: { error: (message, metadata) => logs.push({ message, metadata }), warn: () => {} },
  })
  const signal = new AbortController().signal

  const outcome = await service.runCycle({
    evaluatedAt: '2026-08-22T04:00:00.000Z',
    mode: 'observe',
    staleAfterSeconds: 30,
    signal,
    metrics,
  })

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], {
    evaluatedAt: '2026-08-22T04:00:00.000Z', mode: 'observe', staleAfterSeconds: 30, signal,
  })
  assert.deepEqual(outcome, {
    outcome: 'partial', sensorCount: 3, successfulSensors: 2, failedSensors: 1,
  })
  assert.equal(published.length, 2)
  assert.deepEqual(logs[0].metadata, {
    sensorCode: 'S-02', machineCode: 'M-01', errorCode: 'WATCHDOG_EVALUATION_FAILED',
  })
  const snapshot = metrics.snapshot()
  assert.equal(snapshot.sensorEvaluations, 3)
  assert.equal(snapshot.sensorFailures, 1)
  assert.equal(snapshot.transitions, 2)
  assert.equal(snapshot.states.online, 3)
})

test('watchdog service rejects empty and completely failed cycles', async () => {
  for (const [result, code] of [
    [cycleResult([], {}), 'WATCHDOG_NO_SENSORS_CONFIGURED'],
    [cycleResult([failedEvaluation(1), failedEvaluation(2)], { offline: 2, disabled: 2 }), 'WATCHDOG_ALL_SENSOR_EVALUATIONS_FAILED'],
  ]) {
    const metrics = createWatchdogMetrics()
    const service = createWatchdogService({
      watchdogRepository: { evaluateCycle: async () => result },
      serviceLogger: { error: () => {}, warn: () => {} },
    })
    await assert.rejects(
      service.runCycle({
        evaluatedAt: '2026-08-22T04:00:00.000Z',
        mode: 'observe',
        staleAfterSeconds: 30,
        signal: new AbortController().signal,
        metrics,
      }),
      { code },
    )
  }
})

test('watchdog batch result validation fails closed on malformed data', () => {
  const valid = cycleResult([evaluation(1)], { online: 1, healthy: 1 })
  const malformed = [
    null,
    { evaluations: {}, states: {} },
    cycleResult([{ ...evaluation(1), evaluated_sensor_id: 'not-a-uuid' }], { online: 1, healthy: 1 }),
    cycleResult([{ ...evaluation(1), sensor_code: 'S-99' }], { online: 1, healthy: 1 }),
    cycleResult([{ ...evaluation(1), transition_descriptors: {} }], { online: 1, healthy: 1 }),
    cycleResult([{ ...failedEvaluation(1), error_code: 'private database error' }], { offline: 1, disabled: 1 }),
    cycleResult([evaluation(1), evaluation(1)], { online: 2, healthy: 2 }),
    cycleResult([evaluation(1)], { online: 1, healthy: 1, injected: 1 }),
    cycleResult([evaluation(1)], { online: 2, healthy: 1 }),
  ]
  assert.equal(validateCycleResult(valid), valid)
  for (const result of malformed) {
    assert.throws(() => validateCycleResult(result), { code: 'WATCHDOG_CYCLE_RESULT_INVALID' })
  }
})

test('watchdog runner starts immediately, prevents overlap, and records successful cycles', async () => {
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
      return { outcome: 'success' }
    },
  }
  const runner = createWatchdogRunner({
    service, metrics, mode: 'observe', intervalMs: 5, timeoutMs: 100, staleAfterSeconds: 30,
    runnerLogger: runnerLogger(),
  })

  assert.equal(runner.start(), true)
  assert.equal(runner.start(), false)
  await delay(45)
  await runner.stop()
  assert.ok(calls >= 2)
  assert.equal(maximumConcurrent, 1)
  assert.equal(runner.status().running, false)
  assert.ok(metrics.snapshot().cycleSuccesses >= 1)
  assert.equal(await runner.stop(), false)
})

test('disabled watchdog does not start or schedule evaluation cycles', async () => {
  let calls = 0
  const logs = []
  const metrics = createWatchdogMetrics()
  const runner = createWatchdogRunner({
    service: { async runCycle() { calls += 1 } },
    metrics, mode: 'disabled', intervalMs: 5, timeoutMs: 100, staleAfterSeconds: 30,
    runnerLogger: runnerLogger(logs),
  })

  assert.equal(runner.start(), false)
  await delay(20)
  assert.equal(calls, 0)
  assert.deepEqual(runner.status(), { mode: 'disabled', running: false, inFlight: false })
  assert.equal(metrics.snapshot().cycles, 0)
  assert.equal(metrics.snapshot().lastOutcome, 'idle')
  assert.equal(logs[0].message, 'Sensor watchdog is disabled.')
})

test('watchdog runner records partial cycles without claiming full success', async () => {
  const metrics = createWatchdogMetrics()
  const logs = []
  const runner = createWatchdogRunner({
    service: { async runCycle() { return { outcome: 'partial', successfulSensors: 4, failedSensors: 1 } } },
    metrics, mode: 'observe', intervalMs: 1000, timeoutMs: 100, staleAfterSeconds: 30,
    runnerLogger: runnerLogger(logs),
  })

  runner.start()
  await delay(20)
  await runner.stop()
  const snapshot = metrics.snapshot()
  assert.equal(snapshot.cyclePartialFailures, 1)
  assert.equal(snapshot.cycleSuccesses, 0)
  assert.equal(snapshot.lastSuccessAt, null)
  assert.equal(snapshot.lastOutcome, 'partial')
  assert.equal(snapshot.lastErrorCode, 'WATCHDOG_CYCLE_PARTIAL_FAILURE')
  assert.equal(logs.find((entry) => entry.level === 'warn').metadata.failedSensors, 1)
})

test('watchdog runner records total service failure as a failed cycle', async () => {
  const metrics = createWatchdogMetrics()
  const error = new Error('All failed.')
  error.code = 'WATCHDOG_ALL_SENSOR_EVALUATIONS_FAILED'
  const runner = createWatchdogRunner({
    service: { async runCycle() { throw error } },
    metrics, mode: 'observe', intervalMs: 1000, timeoutMs: 100, staleAfterSeconds: 30,
    runnerLogger: runnerLogger(),
  })

  runner.start()
  await delay(20)
  await runner.stop()
  const snapshot = metrics.snapshot()
  assert.equal(snapshot.cycleFailures, 1)
  assert.equal(snapshot.lastOutcome, 'failed')
  assert.equal(snapshot.lastErrorCode, 'WATCHDOG_ALL_SENSOR_EVALUATIONS_FAILED')
})

test('watchdog runner aborts a timed-out cycle and records a safe error code', async () => {
  let aborted = false
  const metrics = createWatchdogMetrics()
  const logs = []
  const service = {
    runCycle({ signal }) {
      return new Promise((resolve) => signal.addEventListener('abort', () => {
        aborted = true
        resolve({ outcome: 'success' })
      }, { once: true }))
    },
  }
  const runner = createWatchdogRunner({
    service, metrics, mode: 'observe', intervalMs: 100, timeoutMs: 10, staleAfterSeconds: 30,
    runnerLogger: runnerLogger(logs),
  })

  runner.start()
  await delay(25)
  await runner.stop()
  assert.equal(aborted, true)
  assert.equal(metrics.snapshot().lastOutcome, 'failed')
  assert.equal(metrics.snapshot().lastErrorCode, 'WATCHDOG_CYCLE_TIMEOUT')
  assert.equal(logs.find((entry) => entry.level === 'error').metadata.errorCode, 'WATCHDOG_CYCLE_TIMEOUT')
})

test('graceful shutdown cancellation is not counted as a failure', async () => {
  const metrics = createWatchdogMetrics()
  const logs = []
  const service = {
    runCycle({ signal }) {
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ outcome: 'success' }), { once: true }))
    },
  }
  const runner = createWatchdogRunner({
    service, metrics, mode: 'observe', intervalMs: 1000, timeoutMs: 100, staleAfterSeconds: 30,
    runnerLogger: runnerLogger(logs),
  })

  runner.start()
  await delay(5)
  await runner.stop()
  const snapshot = metrics.snapshot()
  assert.equal(snapshot.cycleCancellations, 1)
  assert.equal(snapshot.cycleFailures, 0)
  assert.equal(snapshot.lastOutcome, 'cancelled')
  assert.equal(snapshot.lastErrorCode, null)
  assert.equal(logs.some((entry) => entry.level === 'error'), false)
})

test('uncooperative timed-out work cannot overlap a later watchdog cycle', async () => {
  let calls = 0
  const runner = createWatchdogRunner({
    service: { runCycle() { calls += 1; return new Promise(() => {}) } },
    metrics: createWatchdogMetrics(), mode: 'observe', intervalMs: 5, timeoutMs: 10, staleAfterSeconds: 30,
    runnerLogger: runnerLogger(),
  })

  runner.start()
  await delay(35)
  assert.equal(calls, 1)
  await runner.stop()
  assert.equal(calls, 1)
  assert.equal(runner.status().running, false)
  assert.equal(runner.status().inFlight, true)
})
