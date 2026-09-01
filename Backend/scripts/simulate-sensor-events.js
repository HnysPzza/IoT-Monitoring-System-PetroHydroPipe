require('dotenv').config({ quiet: true })
const { randomUUID } = require('node:crypto')

const BASE_URL = process.env.IOT_SIM_BASE_URL || 'http://localhost:3000'
const INTERVAL_MS = Number.parseInt(process.env.IOT_SIM_INTERVAL_MS || '5000', 10)
const RUN_ONCE = process.argv.includes('--once')
const DETERMINISTIC_MODE = process.argv.includes('--deterministic')
const verificationArgument = process.argv.find((argument) => argument.startsWith('--verify-sensor='))
const VERIFICATION_SENSOR_CODE = verificationArgument?.slice('--verify-sensor='.length).toUpperCase() || null

const registry = require('../src/shared/sensor-registry.json')

const devices = registry.sensors.map((sensor) => ({
  sensorCode: sensor.code,
  deviceId: sensor.deviceId,
  keyEnv: `IOT_SIM_${sensor.code.replace('-', '')}_KEY`,
  label: sensor.label,
}))
const issueDevices = devices.filter((device) => device.sensorCode !== registry.outputSensorCode)

let batchNumber = 0
let previousIssueSensorCode = null

function getMissingKeys() {
  return devices
    .filter((device) => !process.env[device.keyEnv])
    .map((device) => device.keyEnv)
}

function pickIssueDevice() {
  if (DETERMINISTIC_MODE) {
    return issueDevices[(batchNumber - 1) % issueDevices.length]
  }

  const candidates = previousIssueSensorCode
    ? issueDevices.filter((device) => device.sensorCode !== previousIssueSensorCode)
    : issueDevices
  const index = Math.floor(Math.random() * candidates.length)

  return candidates[index]
}

function pickIssueEvent() {
  if (DETERMINISTIC_MODE) {
    return batchNumber % 2 === 0
      ? { eventType: 'downtime', signal: 'no_pulse', expectedAlertAction: 'records observation without alert' }
      : { eventType: 'fault', signal: 'fault', expectedAlertAction: 'creates or updates alert' }
  }

  return Math.random() < 0.7
    ? { eventType: 'downtime', signal: 'no_pulse', expectedAlertAction: 'records observation without alert' }
    : { eventType: 'fault', signal: 'fault', expectedAlertAction: 'creates or updates alert' }
}

function pickNormalEvent(device) {
  if (device.sensorCode === previousIssueSensorCode) {
    return { eventType: 'recovered', signal: 'active', expectedAlertAction: 'resolves previous alert', priority: 3 }
  }

  if (DETERMINISTIC_MODE) {
    return { eventType: 'pulse', signal: 'active', expectedAlertAction: 'keeps or restores normal state', priority: 2 }
  }

  if (Math.random() < 0.15) {
    return { eventType: 'idle', signal: 'idle', expectedAlertAction: 'no alert expected', priority: 2 }
  }

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
      recordedAt: overrides.recordedAt || new Date().toISOString(),
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
    const message = payload?.error?.message || `HTTP ${response.status}`
    throw new Error(`${device.sensorCode} ${device.deviceId} failed: ${message}`)
  }

  return payload.event
}

async function runBatch() {
  batchNumber += 1
  const issueDevice = pickIssueDevice()
  const issueEvent = {
    ...pickIssueEvent(),
    priority: 1,
  }
  const events = devices.map((device) => ({
    device,
    event: device.sensorCode === issueDevice.sensorCode ? issueEvent : pickNormalEvent(device),
  })).sort((left, right) => left.event.priority - right.event.priority)

  console.log(`Sending ESP32 simulator batch ${batchNumber} to ${BASE_URL}`)
  console.log(`Issue sensor: ${issueDevice.sensorCode} ${issueDevice.label} (${issueEvent.eventType} / ${issueEvent.signal})`)

  // Send the new issue first, then recover old issues, so the notification bell does not briefly drop to zero.
  for (const { device, event } of events) {
    const savedEvent = await postEvent(device, event, batchNumber)
    console.log(`${savedEvent.recordedAt} | ${device.sensorCode} ${device.label} | ${savedEvent.eventType} | ${savedEvent.signal} | ${event.expectedAlertAction}`)
  }

  previousIssueSensorCode = issueDevice.sensorCode
}

async function runVerificationLifecycle() {
  const device = devices.find((candidate) => candidate.sensorCode === VERIFICATION_SENSOR_CODE)
  if (!device) {
    throw new Error(`Unknown verification sensor ${VERIFICATION_SENSOR_CODE}.`)
  }
  if (device.sensorCode === registry.outputSensorCode) {
    throw new Error(`${device.sensorCode} does not support downtime verification.`)
  }

  const issueAt = new Date()
  const issueEventId = randomUUID()
  const issue = { eventType: 'fault', signal: 'fault' }
  const recovered = { eventType: 'recovered', signal: 'active' }

  console.log(`Verifying idempotent downtime lifecycle for ${device.sensorCode} against ${BASE_URL}`)
  const createdEvent = await postEvent(device, issue, 1, {
    eventId: issueEventId,
    recordedAt: issueAt.toISOString(),
  })
  const duplicateEvent = await postEvent(device, issue, 1, {
    eventId: issueEventId,
    recordedAt: issueAt.toISOString(),
  })
  const staleEvent = await postEvent(device, recovered, 2, {
    recordedAt: new Date(issueAt.getTime() - 1000).toISOString(),
  })

  await new Promise((resolve) => setTimeout(resolve, 25))
  const recoveredEvent = await postEvent(device, recovered, 3)

  const checks = [
    [createdEvent.stateApplied && !createdEvent.duplicate && !createdEvent.stale, 'issue event was not applied'],
    [duplicateEvent.duplicate && !duplicateEvent.stateApplied, 'duplicate retry was not idempotent'],
    [staleEvent.stale && !staleEvent.stateApplied, 'stale recovery changed current state'],
    [recoveredEvent.stateApplied && !recoveredEvent.stale, 'final recovery was not applied'],
  ]
  const failedCheck = checks.find(([passed]) => !passed)
  if (failedCheck) {
    throw new Error(`Verification failed: ${failedCheck[1]}.`)
  }

  console.log(`Verified ${device.sensorCode}: issue applied, duplicate ignored, stale recovery ignored, final recovery applied.`)
}

async function main() {
  const missingKeys = getMissingKeys()

  if (missingKeys.length > 0) {
    console.error(`Missing simulator keys in Backend/.env: ${missingKeys.join(', ')}`)
    console.error('Run npm run iot:keys, store the printed env values locally, and update Supabase with the printed SQL.')
    process.exit(1)
  }

  if (!Number.isFinite(INTERVAL_MS) || INTERVAL_MS < 1000) {
    console.error('IOT_SIM_INTERVAL_MS must be at least 1000.')
    process.exit(1)
  }

  if (VERIFICATION_SENSOR_CODE) {
    await runVerificationLifecycle()
    return
  }

  await runBatch()

  if (RUN_ONCE) {
    return
  }

  console.log(`Continuing every ${INTERVAL_MS}ms. Press Ctrl+C to stop.`)
  windowlessInterval(runBatch, INTERVAL_MS)
}

function windowlessInterval(callback, intervalMs) {
  setInterval(() => {
    callback().catch((error) => {
      console.error(error.message)
    })
  }, intervalMs)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
