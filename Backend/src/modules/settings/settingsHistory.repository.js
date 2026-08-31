const { z } = require('zod')
const { getSupabaseClient } = require('../../database/client')
const { shiftScheduleSchema } = require('./settings.model')

const PAGE_SIZE = 500
const historyRecordSchema = z.strictObject({
  machine_id: z.string().uuid(),
  version: z.union([z.string().regex(/^[1-9]\d*$/), z.number().int().positive()]),
  shift_schedule: shiftScheduleSchema,
  effective_from: z.string().datetime({ offset: true }).nullable(),
  effective_to: z.string().datetime({ offset: true }).nullable(),
})

function createHistoryError(code, message) {
  const error = new Error(message)
  error.status = 500
  error.code = code
  return error
}

async function getSettingsHistory(machineId, window, suppliedClient) {
  const supabase = suppliedClient || getSupabaseClient()
  const records = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('machine_operational_settings_history')
      .select('machine_id, version, shift_schedule, effective_from, effective_to')
      .eq('machine_id', machineId)
      .or(`effective_from.is.null,effective_from.lt.${window.end.toISOString()}`)
      .or(`effective_to.is.null,effective_to.gt.${window.start.toISOString()}`)
      .order('effective_from', { ascending: true, nullsFirst: true })
      .order('version', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      throw createHistoryError('SETTINGS_HISTORY_QUERY_FAILED', 'Unable to load operational settings history.')
    }

    const page = data || []
    records.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  const parsed = z.array(historyRecordSchema).safeParse(records)
  if (!parsed.success) {
    throw createHistoryError('SETTINGS_HISTORY_INVALID', 'Operational settings history is invalid.')
  }

  return parsed.data
}

module.exports = { getSettingsHistory }
