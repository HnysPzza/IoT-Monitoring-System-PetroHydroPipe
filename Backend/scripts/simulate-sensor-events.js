require('dotenv').config({ quiet: true })

const BASE_URL = process.env.IOT_SIM_BASE_URL || 'http://localhost:3000'
const INTERVAL_MS = Number.parseInt(process.env.IOT_SIM_INTERVAL_MS || '5000', 10)
const RUN_ONCE = process.argv.includes('--once')

const devices = [
  {
    sensorCode: 'S-01',
    deviceId: 'esp32-m01-s01',
    keyEnv: 'IOT_SIM_S01_KEY',
    label: 'Raw Material Detection',
    events: [
      { eventType: 'pulse', signal: 'active' },
      { eventType: 'pulse', signal: 'active' },
      { eventType: 'idle', signal: 'idle' },
    ],
  },
  {
    sensorCode: 'S-02',
    deviceId: 'esp32-m01-s02',
    keyEnv: 'IOT_SIM_S02_KEY',
    label: 'Outside Filler',
    events: [
      { eventType: 'pulse', signal: 'active' },
      { eventType: 'pulse', signal: 'active' },
      { eventType: 'recovered', signal: 'active' },
    ],
  },
  {
    sensorCode: 'S-03',
    deviceId: 'esp32-m01-s03',
    keyEnv: 'IOT_SIM_S03_KEY',
    label: 'Coil Joint',
    events: [
      { eventType: 'idle', signal: 'idle' },
      { eventType: 'pulse', signal: 'active' },
      { eventType: 'idle', signal: 'idle' },
    ],
  },
  {
    sensorCode: 'S-04',
    deviceId: 'esp32-m01-s04',
    keyEnv: 'IOT_SIM_S04_KEY',
    label: 'Inside Filler',
    events: [
      { eventType: 'pulse', signal: 'active' },
      { eventType: 'downtime', signal: 'no_pulse' },
      { eventType: 'recovered', signal: 'active' },
    ],
  },
  {
    sensorCode: 'S-05',
    deviceId: 'esp32-m01-s05',
    keyEnv: 'IOT_SIM_S05_KEY',
    label: 'Production Output Cutting',
    events: [
      { eventType: 'pulse', signal: 'active' },
      { eventType: 'pulse', signal: 'active' },
      { eventType: 'pulse', signal: 'active' },
    ],
  },
]

let batchNumber = 0

function getMissingKeys() {
  return devices
    .filter((device) => !process.env[device.keyEnv])
    .map((device) => device.keyEnv)
}

function pickEvent(device, index) {
  return device.events[index % device.events.length]
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
  const events = devices.map((device, index) => ({
    device,
    event: pickEvent(device, batchNumber + index),
  }))

  console.log(`Sending ESP32 simulator batch ${batchNumber} to ${BASE_URL}`)

  for (const { device, event } of events) {
    const savedEvent = await postEvent(device, event, batchNumber)
    console.log(`${savedEvent.recordedAt} | ${device.sensorCode} | ${savedEvent.eventType} | ${savedEvent.signal}`)
  }
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
