require('dotenv').config({ quiet: true })

const BASE_URL = process.env.IOT_SIM_BASE_URL || 'http://localhost:3000'
const INTERVAL_MS = Number.parseInt(process.env.IOT_SIM_INTERVAL_MS || '5000', 10)
const RUN_ONCE = process.argv.includes('--once')
const DETERMINISTIC_MODE = process.argv.includes('--deterministic')

const devices = [
  {
    sensorCode: 'S-01',
    deviceId: 'esp32-m01-s01',
    keyEnv: 'IOT_SIM_S01_KEY',
    label: 'Raw Material Detection',
  },
  {
    sensorCode: 'S-02',
    deviceId: 'esp32-m01-s02',
    keyEnv: 'IOT_SIM_S02_KEY',
    label: 'Outside Filler',
  },
  {
    sensorCode: 'S-03',
    deviceId: 'esp32-m01-s03',
    keyEnv: 'IOT_SIM_S03_KEY',
    label: 'Coil Joint',
  },
  {
    sensorCode: 'S-04',
    deviceId: 'esp32-m01-s04',
    keyEnv: 'IOT_SIM_S04_KEY',
    label: 'Inside Filler',
  },
  {
    sensorCode: 'S-05',
    deviceId: 'esp32-m01-s05',
    keyEnv: 'IOT_SIM_S05_KEY',
    label: 'Production Output Cutting',
  },
]

let batchNumber = 0
let previousIssueSensorCode = null

function getMissingKeys() {
  return devices
    .filter((device) => !process.env[device.keyEnv])
    .map((device) => device.keyEnv)
}

function pickIssueDevice() {
  if (DETERMINISTIC_MODE) {
    return devices[(batchNumber - 1) % devices.length]
  }

  const candidates = previousIssueSensorCode
    ? devices.filter((device) => device.sensorCode !== previousIssueSensorCode)
    : devices
  const index = Math.floor(Math.random() * candidates.length)

  return candidates[index]
}

function pickIssueEvent() {
  if (DETERMINISTIC_MODE) {
    return batchNumber % 2 === 0
      ? { eventType: 'downtime', signal: 'no_pulse', expectedAlertAction: 'creates or updates alert' }
      : { eventType: 'fault', signal: 'fault', expectedAlertAction: 'creates or updates alert' }
  }

  return Math.random() < 0.7
    ? { eventType: 'downtime', signal: 'no_pulse', expectedAlertAction: 'creates or updates alert' }
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

async function postEvent(device, event, sequence) {
  const response = await fetch(`${BASE_URL}/api/iot/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-device-id': device.deviceId,
      'x-device-key': process.env[device.keyEnv],
    },
    body: JSON.stringify({
      eventType: event.eventType,
      signal: event.signal,
      recordedAt: new Date().toISOString(),
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
