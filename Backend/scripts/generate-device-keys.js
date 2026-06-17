const crypto = require('crypto')
const bcrypt = require('bcryptjs')

const SALT_ROUNDS = 10

const devices = [
  { sensorCode: 'S-01', deviceId: 'esp32-m01-s01', envKey: 'IOT_SIM_S01_KEY', label: 'Raw Material Detection' },
  { sensorCode: 'S-02', deviceId: 'esp32-m01-s02', envKey: 'IOT_SIM_S02_KEY', label: 'Outside Filler' },
  { sensorCode: 'S-03', deviceId: 'esp32-m01-s03', envKey: 'IOT_SIM_S03_KEY', label: 'Coil Joint' },
  { sensorCode: 'S-04', deviceId: 'esp32-m01-s04', envKey: 'IOT_SIM_S04_KEY', label: 'Inside Filler' },
  { sensorCode: 'S-05', deviceId: 'esp32-m01-s05', envKey: 'IOT_SIM_S05_KEY', label: 'Production Output Cutting' },
]

function createDeviceSecret(sensorCode) {
  return `php-${sensorCode.toLowerCase()}-${crypto.randomBytes(18).toString('hex')}`
}

async function main() {
  const generatedDevices = await Promise.all(
    devices.map(async (device) => {
      const secret = createDeviceSecret(device.sensorCode)
      const hash = await bcrypt.hash(secret, SALT_ROUNDS)

      return {
        ...device,
        secret,
        hash,
      }
    }),
  )

  console.log('ESP32 simulator device keys')
  console.log('Store plaintext secrets only in local Backend/.env. Do not commit them.')
  console.log('')

  console.log('Backend/.env values:')
  generatedDevices.forEach((device) => {
    console.log(`${device.envKey}=${device.secret}`)
  })

  console.log('')
  console.log('Supabase SQL for sensors.device_key_hash:')
  console.log('update sensors')
  console.log('set device_key_hash = case sensor_code')
  generatedDevices.forEach((device) => {
    console.log(`  when '${device.sensorCode}' then '${device.hash}'`)
  })
  console.log('  else device_key_hash')
  console.log('end')
  console.log("where sensor_code in ('S-01', 'S-02', 'S-03', 'S-04', 'S-05');")

  console.log('')
  console.log('Device reference:')
  generatedDevices.forEach((device) => {
    console.log(`${device.sensorCode} | ${device.deviceId} | ${device.label}`)
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
