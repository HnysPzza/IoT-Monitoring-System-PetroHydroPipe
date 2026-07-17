const env = require('../src/config/env')
const { getSupabaseClient } = require('../src/database/client')

async function verifyOpenApiContract() {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      accept: 'application/openapi+json',
    },
  })

  if (!response.ok) {
    throw new Error(`Unable to inspect Supabase OpenAPI contract (${response.status}).`)
  }

  const contract = await response.json()
  const requiredRpcPaths = [
    '/rpc/ingest_iot_sensor_event',
    '/rpc/get_downtime_summary',
    '/rpc/update_downtime_record',
  ]
  const missingRpcPaths = requiredRpcPaths.filter((path) => !contract.paths?.[path])

  if (missingRpcPaths.length > 0) {
    throw new Error(`Migration 006 RPCs are missing: ${missingRpcPaths.join(', ')}.`)
  }
}

async function verifyDataContract() {
  const supabase = getSupabaseClient()
  const { error: eventError } = await supabase
    .from('sensor_events')
    .select('id, device_event_id')
    .limit(1)

  if (eventError) {
    throw new Error('sensor_events.device_event_id is missing or unreadable.')
  }

  const { data: rows, error: downtimeError } = await supabase
    .from('downtime_events')
    .select('machine_id, sensor_id, started_at, ended_at, duration_seconds, status')

  if (downtimeError) {
    throw new Error('Unable to validate downtime records.')
  }

  const openCounts = new Map()
  for (const row of rows || []) {
    const hasConsistentFields = row.status === 'Open'
      ? row.ended_at == null && row.duration_seconds == null
      : row.ended_at != null && row.duration_seconds != null
    const hasValidChronology = row.ended_at == null
      || new Date(row.ended_at).getTime() >= new Date(row.started_at).getTime()
    const hasValidDuration = row.duration_seconds == null || row.duration_seconds >= 0

    if (!hasConsistentFields || !hasValidChronology || !hasValidDuration) {
      throw new Error('Downtime data contains inconsistent state or duration fields.')
    }

    if (row.status === 'Open') {
      const key = `${row.machine_id}:${row.sensor_id}`
      openCounts.set(key, (openCounts.get(key) || 0) + 1)
    }
  }

  if ([...openCounts.values()].some((count) => count > 1)) {
    throw new Error('Downtime data contains duplicate open records.')
  }

  return { downtimeRows: (rows || []).length }
}

async function main() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase credentials are required for migration verification.')
  }

  await verifyOpenApiContract()
  const result = await verifyDataContract()
  console.log(`Downtime migration verified. Checked ${result.downtimeRows} downtime records.`)
}

main().catch((error) => {
  console.error(`Downtime migration verification failed: ${error.message}`)
  process.exitCode = 1
})
