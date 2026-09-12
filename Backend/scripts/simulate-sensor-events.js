require('dotenv').config({ quiet: true })
const { randomUUID } = require('node:crypto')

const cliArguments = process.argv.filter((argument) => argument.startsWith('--'))
const BASE_URL = process.env.IOT_SIM_BASE_URL || 'http://localhost:3000'
const INTERVAL_MS = Number.parseInt(process.env.IOT_SIM_INTERVAL_MS || '5000', 10)
const RUN_ONCE = cliArguments.includes('--once')
const PROCESS_ISOLATION_MODE = cliArguments.includes('--process-isolation') || cliArguments.includes('--deterministic')
const GROUP_VERIFICATION = cliArguments.includes('--verify-grouped-lifecycle') || cliArguments.includes('--verify-group')
const DIRECT_S03_VERIFICATION = cliArguments.includes('--verify-direct-s03-lifecycle')
const RECOVER_ACTIVE_FAULTS_MODE = cliArguments.includes('--recover-active-faults')
const verificationArgument = cliArguments.find((argument) => argument.startsWith('--verify-sensor='))
const VERIFICATION_SENSOR_CODE = verificationArgument?.slice('--verify-sensor='.length).toUpperCase()
  || (DIRECT_S03_VERIFICATION ? 'S-03' : null)

const registry = require('../src/shared/sensor-registry.json')

const devices = registry.sensors.map((sensor) => ({
  sensorCode: sensor.code,
  deviceId: sensor.deviceId,
  keyEnv: `IOT_SIM_${sensor.code.replace('-', '')}_KEY`,
  label: sensor.label,
}))
const issueDevices = devices.filter((device) => device.sensorCode !== registry.outputSensorCode)
const processSensorCodes = new Set(['S-01', 'S-02', 'S-04'])
const knownOptions = new Set([
  '--once',
  '--process-isolation',
  '--deterministic',
  '--verify-grouped-lifecycle',
  '--verify-group',
  '--verify-direct-s03-lifecycle',
  '--recover-active-faults',
])

let batchNumber = 0
let lastRecordedAtMs = 0
const unresolvedIssueEvents = new Map()

function getMissingKeys(requiredDevices = devices) {
  return requiredDevices
    .filter((device) => !process.env[device.keyEnv])
    .map((device) => device.keyEnv)
}

function validateOptions() {
  const unknownOption = cliArguments.find((argument) => (
    !knownOptions.has(argument) && !argument.startsWith('--verify-sensor=')
  ))
  if (unknownOption) throw new Error(`Unknown simulator option: ${unknownOption}.`)
  if (GROUP_VERIFICATION && VERIFICATION_SENSOR_CODE) {
    throw new Error('Choose either grouped or direct S-03 verification, not both.')
  }
  if (PROCESS_ISOLATION_MODE && (GROUP_VERIFICATION || VERIFICATION_SENSOR_CODE)) {
    throw new Error('Process-isolation cannot be combined with downtime verification.')
  }
  if (PROCESS_ISOLATION_MODE && !RUN_ONCE) {
    throw new Error('--process-isolation requires --once because retained faults can form the process group.')
  }
  if (RECOVER_ACTIVE_FAULTS_MODE && (RUN_ONCE || PROCESS_ISOLATION_MODE || GROUP_VERIFICATION || VERIFICATION_SENSOR_CODE)) {
    throw new Error('--recover-active-faults cannot be combined with simulator batches or verification.')
  }
}

function validateConfiguration() {
  validateOptions()
  const missingKeys = getMissingKeys(RECOVER_ACTIVE_FAULTS_MODE ? issueDevices : devices)
  if (missingKeys.length > 0) {
    throw new Error(`Missing simulator keys in Backend/.env: ${missingKeys.join(', ')}`)
  }
  if (!Number.isFinite(INTERVAL_MS) || INTERVAL_MS < 1000) {
    throw new Error('IOT_SIM_INTERVAL_MS must be at least 1000.')
  }
}

function nextRecordedAt() {
  lastRecordedAtMs = Math.max(Date.now(), lastRecordedAtMs + 1)
  return new Date(lastRecordedAtMs).toISOString()
}

function resolveRecordedAt(overrides) {
  if (!overrides.recordedAt) return nextRecordedAt()
  const recordedAtMs = Date.parse(overrides.recordedAt)
  if (Number.isFinite(recordedAtMs)) lastRecordedAtMs = Math.max(lastRecordedAtMs, recordedAtMs)
  return overrides.recordedAt
}

function pickIssueDevice() {
  const availableDevices = issueDevices.filter((device) => !unresolvedIssueEvents.has(device.sensorCode))
  const candidates = availableDevices.length > 0 ? availableDevices : issueDevices
  return candidates[Math.floor(Math.random() * candidates.length)]
}

function pickIssueEvent() {
  return Math.random() < 0.7
    ? { eventType: 'downtime', signal: 'no_pulse', expectedAlertAction: 'records observation without alert' }
    : { eventType: 'fault', signal: 'fault', expectedAlertAction: 'creates or updates alert' }
}

function formatEventForConsole(eventType, signal) {
  if (eventType === 'downtime' && signal === 'no_pulse') {
    return 'no pulse observation (not confirmed downtime)'
  }
  return `${eventType} / ${signal}`
}

function pickNormalEvent(device) {
  const unresolvedIssue = unresolvedIssueEvents.get(device.sensorCode)
  if (unresolvedIssue) return { ...unresolvedIssue, expectedAlertAction: 'keeps outstanding issue', priority: 2 }
  if (Math.random() < 0.15) return { eventType: 'idle', signal: 'idle', expectedAlertAction: 'no alert expected', priority: 2 }
  return { eventType: 'pulse', signal: 'active', expectedAlertAction: 'resolves any old alert', priority: 2 }
}

async function postEvent(device, event, sequence, overrides = {}) {
  const response = await fetch(`${BASE_URL}/api/iot/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-device-id': device.deviceId,
      'x-device-key': process.env[device.keyEnv],
    },
    body: JSON.stringify({
      eventId: overrides.eventId || randomUUID(),
      eventType: event.eventType,
      signal: event.signal,
      recordedAt: resolveRecordedAt(overrides),
      metadata: {
        simulator: true,
        sensorCode: device.sensorCode,
        label: device.label,
        sequence,
        rssi: -58 - ((sequence + device.sensorCode.charCodeAt(2)) % 14),
      },
    }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`${device.sensorCode} ${device.deviceId} failed: ${payload?.error?.message || `HTTP ${response.status}`}`)
  }
  if (!payload?.event || typeof payload.event !== 'object') {
    throw new Error(`${device.sensorCode} did not return an event result.`)
  }
  return payload.event
}

function assertVerificationEvent(label, device, event, expected) {
  const checks = [
    [event.sensorCode === device.sensorCode, `${label} returned the wrong sensor`],
    [event.eventType === expected.eventType, `${label} returned the wrong event type`],
    [event.stateApplied === expected.stateApplied, expected.stateApplied ? `${label} was not applied` : `${label} was unexpectedly applied`],
    [event.duplicate === expected.duplicate, `${label} duplicate state was incorrect`],
    [event.stale === expected.stale, `${label} stale state was incorrect`],
    [event.machineStatus === expected.machineStatus, `${label} machine status was ${event.machineStatus || 'missing'}`],
    [event.downtimeAction === expected.downtimeAction, `${label} downtime action was ${event.downtimeAction || 'missing'}`],
  ]

  if (expected.downtimeAction) {
    checks.push(
      [typeof event.downtimeId === 'string' && event.downtimeId.length > 0, `${label} did not return a downtime ID`],
      [event.downtimeSensorCode === 'S-03', `${label} downtime owner was not S-03`],
    )
    if (expected.downtimeId) checks.push([event.downtimeId === expected.downtimeId, `${label} changed the downtime ID`])
  } else {
    checks.push(
      [event.downtimeId === null, `${label} returned an unexpected downtime ID`],
      [event.downtimeSensorCode === null, `${label} returned an unexpected downtime owner`],
    )
  }

  const failedCheck = checks.find(([passed]) => !passed)
  if (failedCheck) throw new Error(`Verification failed: ${failedCheck[1]}.`)
}

function liveReadToken() {
  const token = process.env.IOT_SIM_BEARER_TOKEN
  if (!token) throw new Error('IOT_SIM_BEARER_TOKEN is required to read live simulator state.')
  return token
}

async function readStateEndpoint(path, token) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`Verification preflight read ${path} failed: ${payload?.error?.message || `HTTP ${response.status}`}`)
  }
  return payload
}

async function readAlertSnapshot(token) {
  const snapshot = await readStateEndpoint('/api/alerts', token)
  if (!Array.isArray(snapshot?.alerts) || typeof snapshot.snapshotRevision !== 'string') {
    throw new Error('Verification alert state is invalid.')
  }
  return snapshot.alerts
}

async function assertProcessFaultAlert(device, token) {
  const alerts = await readAlertSnapshot(token)
  const alert = alerts.find((candidate) => (
    candidate?.sensor?.sensorCode === device.sensorCode
      && candidate?.metadata?.processFault === true
  ))
  if (!alert) throw new Error(`Verification failed: ${device.sensorCode} process-fault alert is missing.`)
}

async function assertDowntimeAlert(downtimeId, token) {
  const alerts = await readAlertSnapshot(token)
  const alert = alerts.find((candidate) => (
    candidate?.sensor?.sensorCode === 'S-03'
      && candidate?.metadata?.downtimeId === downtimeId
      && candidate?.metadata?.processFault !== true
  ))
  if (!alert) throw new Error('Verification failed: S-03 downtime alert is missing.')
}

function getBaselineIssue(live, downtime) {
  if (!live?.machine || !Array.isArray(live.sensors) || !Array.isArray(downtime?.records)) {
    return 'the live baseline response is invalid'
  }
  try {
    getActiveFaultRecoveryDevices(live)
  } catch {
    return 'the live baseline response is invalid'
  }
  if (!Number.isInteger(downtime.summary?.open) || downtime.summary.open < 0) {
    return 'the downtime baseline response is invalid'
  }
  if (downtime.records.some((record) => record.status === 'Open') || Number(downtime.summary?.open) > 0) {
    return 'active downtime is already present'
  }
  if (live.machine.status !== 'Running') return `machine status is already ${live.machine.status || 'unknown'}`

  const dirtySensor = live.sensors.find((sensor) => (
    (processSensorCodes.has(sensor.sensorCode) || sensor.sensorCode === 'S-03')
      && (sensor.status === 'Fault' || sensor.status === 'Downtime' || sensor.physicalStatus === 'Fault')
  ))
  return dirtySensor ? `${dirtySensor.sensorCode} is already faulted` : null
}

async function assertCleanVerificationBaseline(phase) {
  const token = liveReadToken()
  const [live, downtime] = await Promise.all([
    readStateEndpoint('/api/iot/live', token),
    readStateEndpoint('/api/downtime?status=Open&limit=100', token),
  ])
  const issue = getBaselineIssue(live, downtime)
  if (issue) throw new Error(`Verification ${phase} failed: ${issue}.`)
}

function isFaultedSensor(sensor) {
  return sensor?.status === 'Fault'
    || sensor?.physicalStatus === 'Fault'
}

function getActiveFaultRecoveryDevices(live) {
  if (!Array.isArray(live?.sensors) || live.sensors.length !== devices.length
    || !['Running', 'Idle', 'Downtime'].includes(live.machine?.status)) {
    throw new Error('Recovery preflight failed: live sensor state is invalid.')
  }
  if (live.sensors.some((sensor) => !sensor
    || !devices.some((device) => device.sensorCode === sensor.sensorCode)
    || !['Running', 'Idle', 'Downtime', 'Fault'].includes(sensor.status)
    || !['Active', 'Inactive', 'Fault'].includes(sensor.physicalStatus))) {
    throw new Error('Recovery preflight failed: live sensor state is invalid.')
  }
  const sensorsByCode = new Map(live.sensors.map((sensor) => [sensor.sensorCode, sensor]))
  if (sensorsByCode.size !== devices.length) throw new Error('Recovery preflight failed: sensor identities are incomplete.')
  return issueDevices.filter((device) => isFaultedSensor(sensorsByCode.get(device.sensorCode)))
}

async function assertNoRemainingDowntime(live, token) {
  const downtime = await readStateEndpoint('/api/downtime?status=Open&limit=100', token)
  if (!Array.isArray(downtime?.records) || !Number.isInteger(downtime.summary?.open)
    || downtime.summary.open < 0) throw new Error('Recovery verification failed: downtime state is invalid.')
  if (live.machine.status === 'Downtime' || live.sensors.some((sensor) => sensor.status === 'Downtime')
    || downtime.records.length > 0 || downtime.summary.open > 0) {
    throw new Error('Recovery verification failed: machine downtime remains active.')
  }
}

function assertAcceptedRecovery(device, event) {
  const checks = [
    [event.sensorCode === device.sensorCode, 'returned the wrong sensor'],
    [event.eventType === 'recovered', 'returned the wrong event type'],
    [event.stateApplied === true, 'was not applied'],
    [event.duplicate === false, 'was unexpectedly duplicate'],
    [event.stale === false, 'was unexpectedly stale'],
  ]
  const failedCheck = checks.find(([passed]) => !passed)
  if (failedCheck) throw new Error(`Recovery ${device.sensorCode} ${failedCheck[1]}.`)
}

async function runActiveFaultRecovery() {
  const token = liveReadToken()
  const initialLive = await readStateEndpoint('/api/iot/live', token)
  const recoveryDevices = getActiveFaultRecoveryDevices(initialLive)

  if (recoveryDevices.length === 0) {
    await assertNoRemainingDowntime(initialLive, token)
    console.log('No active S-01 through S-04 faults to recover.')
    return
  }

  console.log(`Recovering active S-01 through S-04 faults against ${BASE_URL}`)
  console.log('Simulation only: this sends synthetic activity, not proof of a physical repair.')
  let currentLive = initialLive
  const recoveredCodes = []
  for (const [index, device] of recoveryDevices.entries()) {
    if (!getActiveFaultRecoveryDevices(currentLive).some((candidate) => candidate.sensorCode === device.sensorCode)) continue
    const savedEvent = await postEvent(device, { eventType: 'recovered', signal: 'active' }, index + 1)
    assertAcceptedRecovery(device, savedEvent)
    recoveredCodes.push(device.sensorCode)
    currentLive = await readStateEndpoint('/api/iot/live', token)
    console.log(`${savedEvent.recordedAt} | ${device.sensorCode} ${device.label} | recovered | active`)
  }

  const remainingDevices = getActiveFaultRecoveryDevices(currentLive)
  if (remainingDevices.length > 0) {
    throw new Error(`Recovery verification failed: ${remainingDevices.map((device) => device.sensorCode).join(', ')} remains faulted.`)
  }
  await assertNoRemainingDowntime(currentLive, token)

  console.log(`Recovered active faults: ${recoveredCodes.join(', ')}.`)
}

async function runBatch() {
  batchNumber += 1
  const issueDevice = pickIssueDevice()
  const issueEvent = { ...pickIssueEvent(), priority: 1 }
  const events = devices.map((device) => ({
    device,
    event: device.sensorCode === issueDevice.sensorCode ? issueEvent : pickNormalEvent(device),
  })).sort((left, right) => left.event.priority - right.event.priority)

  console.log(`Sending ESP32 simulator batch ${batchNumber} to ${BASE_URL}`)
  console.log(`Issue sensor: ${issueDevice.sensorCode} ${issueDevice.label} (${formatEventForConsole(issueEvent.eventType, issueEvent.signal)})`)

  for (const { device, event } of events) {
    const savedEvent = await postEvent(device, event, batchNumber)
    console.log(`${savedEvent.recordedAt} | ${device.sensorCode} ${device.label} | ${formatEventForConsole(savedEvent.eventType, savedEvent.signal)} | ${event.expectedAlertAction}`)
  }

  unresolvedIssueEvents.set(issueDevice.sensorCode, {
    eventType: issueEvent.eventType,
    signal: issueEvent.signal,
  })
}

async function runProcessIsolationVerification() {
  const device = devices.find((candidate) => candidate.sensorCode === 'S-01')
  const fault = { eventType: 'fault', signal: 'fault' }
  const recovered = { eventType: 'recovered', signal: 'active' }
  const token = liveReadToken()

  await assertCleanVerificationBaseline('preflight')
  console.log(`Verifying single-process isolation against ${BASE_URL}`)
  const faultEvent = await postEvent(device, fault, 1)
  assertVerificationEvent('S-01 process fault', device, faultEvent, {
    eventType: 'fault', stateApplied: true, duplicate: false, stale: false,
    machineStatus: 'Running', downtimeAction: null,
  })
  await assertProcessFaultAlert(device, token)

  const recoveredEvent = await postEvent(device, recovered, 2)
  assertVerificationEvent('S-01 process recovery', device, recoveredEvent, {
    eventType: 'recovered', stateApplied: true, duplicate: false, stale: false,
    machineStatus: 'Running', downtimeAction: null,
  })
  await assertCleanVerificationBaseline('final state')
  console.log('Verified single-process isolation: S-01 fault stayed process-level and recovered cleanly.')
}

async function runDirectS03Verification() {
  const device = devices.find((candidate) => candidate.sensorCode === VERIFICATION_SENSOR_CODE)
  if (!device) throw new Error(`Unknown verification sensor ${VERIFICATION_SENSOR_CODE}.`)
  if (device.sensorCode === registry.outputSensorCode) throw new Error(`${device.sensorCode} does not support downtime verification.`)
  if (device.sensorCode !== 'S-03') {
    throw new Error(`${device.sensorCode} does not create downtime alone; use --verify-grouped-lifecycle.`)
  }

  await assertCleanVerificationBaseline('preflight')
  const issue = { eventType: 'fault', signal: 'fault' }
  const recovered = { eventType: 'recovered', signal: 'active' }
  const token = liveReadToken()
  const issueAt = nextRecordedAt()
  const issueEventId = randomUUID()

  console.log(`Verifying direct S-03 downtime lifecycle against ${BASE_URL}`)
  const createdEvent = await postEvent(device, issue, 1, { eventId: issueEventId, recordedAt: issueAt })
  assertVerificationEvent('S-03 fault', device, createdEvent, {
    eventType: 'fault', stateApplied: true, duplicate: false, stale: false,
    machineStatus: 'Downtime', downtimeAction: 'created',
  })
  await assertDowntimeAlert(createdEvent.downtimeId, token)

  const duplicateEvent = await postEvent(device, issue, 1, { eventId: issueEventId, recordedAt: issueAt })
  assertVerificationEvent('duplicate retry', device, duplicateEvent, {
    eventType: 'fault', stateApplied: false, duplicate: true, stale: false,
    machineStatus: 'Downtime', downtimeAction: null,
  })

  const staleEvent = await postEvent(device, recovered, 3, {
    recordedAt: new Date(Date.parse(issueAt) - 1).toISOString(),
  })
  assertVerificationEvent('stale recovery', device, staleEvent, {
    eventType: 'recovered', stateApplied: false, duplicate: false, stale: true,
    machineStatus: 'Downtime', downtimeAction: null,
  })

  console.log('Verified direct S-03 downtime: created, duplicate ignored, stale recovery ignored; leave it open and run recover-active-faults when ready.')
}

async function runGroupedVerificationLifecycle() {
  const sequence = [
    { sensorCode: 'S-01', event: { eventType: 'fault', signal: 'fault' }, label: 'first process fault', machineStatus: 'Running', downtimeAction: null },
    { sensorCode: 'S-04', event: { eventType: 'fault', signal: 'fault' }, label: 'second process fault', machineStatus: 'Running', downtimeAction: null },
    { sensorCode: 'S-02', event: { eventType: 'fault', signal: 'fault' }, label: 'third process fault', machineStatus: 'Downtime', downtimeAction: 'created' },
  ]

  const token = liveReadToken()
  await assertCleanVerificationBaseline('preflight')
  console.log(`Verifying grouped downtime lifecycle against ${BASE_URL}`)
  let downtimeId = null
  for (const [index, step] of sequence.entries()) {
    const device = devices.find((candidate) => candidate.sensorCode === step.sensorCode)
    const savedEvent = await postEvent(device, step.event, index + 1)
    assertVerificationEvent(step.label, device, savedEvent, {
      eventType: step.event.eventType,
      stateApplied: true,
      duplicate: false,
      stale: false,
      machineStatus: step.machineStatus,
      downtimeAction: step.downtimeAction,
    })
    await assertProcessFaultAlert(device, token)
    if (step.downtimeAction === 'created') {
      downtimeId = savedEvent.downtimeId
      await assertDowntimeAlert(downtimeId, token)
    }
  }

  console.log('Verified grouped downtime: two process faults stayed process-level, the third opened S-03; leave faults active and run recover-active-faults when ready.')
}

function windowlessInterval(callback, intervalMs) {
  const scheduleNext = () => {
    setTimeout(async () => {
      try {
        await callback()
      } catch (error) {
        console.error(error.message)
      }
      scheduleNext()
    }, intervalMs)
  }
  scheduleNext()
}

async function main() {
  validateConfiguration()

  if (GROUP_VERIFICATION) {
    await runGroupedVerificationLifecycle()
    return
  }
  if (VERIFICATION_SENSOR_CODE) {
    await runDirectS03Verification()
    return
  }
  if (PROCESS_ISOLATION_MODE) {
    await runProcessIsolationVerification()
    return
  }
  if (RECOVER_ACTIVE_FAULTS_MODE) {
    await runActiveFaultRecovery()
    return
  }

  await runBatch()
  if (RUN_ONCE) return

  console.log(`Continuing random demonstration every ${INTERVAL_MS}ms. Press Ctrl+C to stop.`)
  windowlessInterval(runBatch, INTERVAL_MS)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
