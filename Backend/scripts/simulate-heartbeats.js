require('dotenv').config({ quiet: true })
const { randomUUID } = require('node:crypto')

const registry = require('../src/shared/sensor-registry.json')

const BASE_URL = process.env.IOT_SIM_BASE_URL || 'http://localhost:3000'
const INTERVAL_MS = Number.parseInt(process.env.IOT_HEARTBEAT_EXPECTED_INTERVAL_MS || '10000', 10)
const BOOT_COUNTER = process.env.IOT_SIM_BOOT_COUNTER || String(Math.floor(Date.now() / 1000))
const RUN_ONCE = process.argv.includes('--once')
const BOOT_ID = randomUUID()

const devices = registry.sensors.map((sensor) => ({
  sensorCode: sensor.code,
  deviceId: sensor.deviceId,
  keyEnv: `IOT_SIM_${sensor.code.replace('-', '')}_KEY`,
  sequence: 0n,
}))

function validateConfiguration() {
  const missingKeys = devices.filter((device) => !process.env[device.keyEnv]).map((device) => device.keyEnv)
  if (missingKeys.length > 0) throw new Error(`Missing simulator keys: ${missingKeys.join(', ')}`)
  if (!/^[1-9]\d*$/.test(BOOT_COUNTER)) throw new Error('IOT_SIM_BOOT_COUNTER must be a positive decimal string.')
  if (!Number.isInteger(INTERVAL_MS) || INTERVAL_MS < 1000) {
    throw new Error('IOT_HEARTBEAT_EXPECTED_INTERVAL_MS must be at least 1000.')
  }
}

async function postHeartbeat(device) {
  device.sequence += 1n
  const response = await fetch(`${BASE_URL}/api/iot/heartbeats`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-device-id': device.deviceId,
      'x-device-key': process.env[device.keyEnv],
    },
    body: JSON.stringify({
      heartbeatId: randomUUID(),
      bootId: BOOT_ID,
      bootCounter: BOOT_COUNTER,
      sequence: device.sequence.toString(),
      recordedAt: new Date().toISOString(),
      activityObserved: process.env[`IOT_SIM_${device.sensorCode.replace('-', '')}_ACTIVE`] !== 'false',
    }),
  })
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(`${device.sensorCode} heartbeat failed: ${payload?.error?.message || `HTTP ${response.status}`}`)
  }

  return payload.heartbeat
}

async function runBatch() {
  for (const device of devices) {
    const heartbeat = await postHeartbeat(device)
    console.log(`${heartbeat.receivedAt} | ${device.sensorCode} | ${heartbeat.connectivityState} | sequence ${device.sequence}`)
  }
}

async function main() {
  validateConfiguration()
  await runBatch()
  if (RUN_ONCE) return

  console.log(`Sending heartbeats every ${INTERVAL_MS}ms. Press Ctrl+C to stop.`)
  setInterval(() => {
    runBatch().catch((error) => console.error(error.message))
  }, INTERVAL_MS)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
