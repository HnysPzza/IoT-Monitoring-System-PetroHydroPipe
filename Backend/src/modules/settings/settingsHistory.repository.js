const { z } = require('zod')
const { getSupabaseClient } = require('../../database/client')
const { formatBusinessDate } = require('../../shared/businessTime')
const { shiftScheduleSchema } = require('./settings.model')

const PAGE_SIZE = 500
const historyRecordSchema = z.strictObject({
  machine_id: z.string().uuid(),
  version: z.union([z.string().regex(/^[1-9]\d*$/), z.number().int().positive()]),
  shift_schedule: shiftScheduleSchema,
  effective_from: z.string().datetime({ offset: true }).nullable(),
  effective_to: z.string().datetime({ offset: true }).nullable(),
})
const calendarDateStringSchema = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  z.instanceof(Date).transform((value) => formatBusinessDate(value)),
])
const calendarRecordSchema = z.union([
  z.object({
    calendar_date: calendarDateStringSchema,
    is_working: z.boolean(),
  }).passthrough(),
  z.object({
    calendarDate: calendarDateStringSchema,
    isWorking: z.boolean(),
  }).passthrough(),
])

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

  const startDate = formatBusinessDate(window.start)
  const endDate = formatBusinessDate(window.end)
  const calendarRecords = []

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('production_calendar_days')
      .select('calendar_date, is_working')
      .eq('machine_id', machineId)
    if (typeof query.gte === 'function') query = query.gte('calendar_date', startDate)
    if (typeof query.lte === 'function') query = query.lte('calendar_date', endDate)
    const { data, error } = await query
      .order('calendar_date', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      throw createHistoryError('SETTINGS_HISTORY_QUERY_FAILED', 'Unable to load operational settings history.')
    }

    const page = data || []
    calendarRecords.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  const parsedCalendar = z.array(calendarRecordSchema).safeParse(calendarRecords)
  if (!parsedCalendar.success) {
    throw createHistoryError('SETTINGS_HISTORY_INVALID', 'Operational settings history is invalid.')
  }

  Object.defineProperty(parsed.data, 'calendarDays', {
    value: parsedCalendar.data,
    enumerable: false,
    configurable: true,
    writable: true,
  })

  return parsed.data
}

module.exports = { getSettingsHistory }
