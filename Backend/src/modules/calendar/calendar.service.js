const { getSupabaseClient } = require('../../database/client')
const { formatBusinessDate } = require('../../shared/businessTime')
const { invalidateDeviceThresholdsCache } = require('../iot/iot.service')
const { storedCalendarDayRecordSchema } = require('./calendar.model')

function createCalendarError(status, code, message, details) {
  const error = new Error(message)
  error.status = status
  error.code = code
  if (details !== undefined) {
    error.details = details
  }
  return error
}

function parseCalendarEntry(record, errorCode, expectedMachineId) {
  const parsed = storedCalendarDayRecordSchema.safeParse(record)

  if (!parsed.success || parsed.data.machine_id !== expectedMachineId) {
    throw createCalendarError(500, errorCode, 'Production calendar entry is invalid.')
  }

  return {
    calendarDate: parsed.data.calendar_date,
    name: parsed.data.name,
    dayType: parsed.data.day_type,
    isWorking: parsed.data.is_working,
    reason: parsed.data.reason,
    source: parsed.data.source,
    groupId: parsed.data.group_id,
    version: parsed.data.version,
    updatedBy: parsed.data.updated_by,
    updatedAt: parsed.data.updated_at,
  }
}

function parseConflictingDates(rawDetail) {
  if (Array.isArray(rawDetail)) {
    return rawDetail.filter((item) => typeof item === 'string')
  }
  if (typeof rawDetail === 'string' && rawDetail.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawDetail)
      if (Array.isArray(parsed)) {
        return parsed.filter((item) => typeof item === 'string')
      }
    } catch {
      return []
    }
  }
  return []
}

function assertFutureManilaDate(calendarDate, asOf = new Date()) {
  const manilaToday = formatBusinessDate(asOf)
  if (calendarDate <= manilaToday) {
    throw createCalendarError(
      400,
      'VALIDATION_ERROR',
      'Production calendar dates can only be modified in advance.',
    )
  }
}

function mapCalendarRpcError(error, fallbackCode, fallbackMessage) {
  if (error?.code === '23505') {
    const conflictingDates = parseConflictingDates(error.details ?? error.detail)
    return createCalendarError(
      409,
      'CALENDAR_OVERWRITE_CONFIRM_REQUIRED',
      'Manual production calendar entries already exist for the selected dates.',
      { conflictingDates },
    )
  }

  if (error?.code === '40001') {
    return createCalendarError(
      409,
      'CALENDAR_VERSION_CONFLICT',
      'Production calendar entry was updated by another request.',
    )
  }

  if (error?.code === '22023') {
    return createCalendarError(
      400,
      'VALIDATION_ERROR',
      error.message || 'Invalid production calendar request.',
    )
  }

  if (error?.code === 'P0002') {
    if (/machine not found/i.test(error.message || '')) {
      return createCalendarError(404, 'MACHINE_NOT_FOUND', 'Machine not found.')
    }
    return createCalendarError(404, 'CALENDAR_ENTRY_NOT_FOUND', 'Production calendar entry not found.')
  }

  return createCalendarError(500, fallbackCode, fallbackMessage)
}

async function loadMachine(supabase, machineId) {
  const { data, error } = await supabase
    .from('machines')
    .select('id')
    .eq('id', machineId)
    .maybeSingle()

  if (error) {
    throw createCalendarError(500, 'CALENDAR_QUERY_FAILED', 'Unable to load production calendar.')
  }

  if (!data) {
    throw createCalendarError(404, 'MACHINE_NOT_FOUND', 'Machine not found.')
  }
}

async function executeRpc(supabase, functionName, args) {
  const call = supabase.rpc(functionName, args)
  if (call && typeof call.then === 'function') {
    return call
  }
  if (call && typeof call.maybeSingle === 'function') {
    return call.maybeSingle()
  }
  return call
}

async function getProductionCalendar({ machineId, from, to }, suppliedClient) {
  const supabase = suppliedClient || getSupabaseClient()
  const machinePromise = loadMachine(supabase, machineId)

  let query = supabase
    .from('production_calendar_days')
    .select('machine_id, calendar_date, name, day_type, is_working, reason, source, group_id, version, updated_by, updated_at')
    .eq('machine_id', machineId)

  if (from) {
    query = query.gte('calendar_date', from)
  }
  if (to) {
    query = query.lte('calendar_date', to)
  }

  const calendarPromise = Promise.resolve(query.order('calendar_date', { ascending: true })).then(
    (value) => ({ value }),
    (error) => ({ error }),
  )

  await machinePromise
  const result = await calendarPromise
  if ('error' in result) throw result.error
  const { data, error } = result.value

  if (error) {
    throw createCalendarError(500, 'CALENDAR_QUERY_FAILED', 'Unable to load production calendar.')
  }

  if (!Array.isArray(data)) {
    throw createCalendarError(500, 'CALENDAR_QUERY_FAILED', 'Unable to load production calendar.')
  }

  return data.map((row) => parseCalendarEntry(row, 'CALENDAR_QUERY_FAILED', machineId))
}

async function setProductionCalendarDay(
  {
    machineId,
    calendarDate,
    dayType,
    name,
    isWorking,
    reason,
    expectedVersion,
    confirmOverwrite,
    actorUserId,
    asOf,
  },
  suppliedClient,
) {
  assertFutureManilaDate(calendarDate, asOf)
  const supabase = suppliedClient || getSupabaseClient()

  const { data, error } = await executeRpc(supabase, 'set_production_calendar_day', {
    p_machine_id: machineId,
    p_calendar_date: calendarDate,
    p_day_type: dayType,
    p_name: name ?? '',
    p_is_working: dayType === 'holiday' ? Boolean(isWorking) : false,
    p_reason: reason ?? null,
    p_expected_version: expectedVersion ?? null,
    p_confirm_overwrite: Boolean(confirmOverwrite),
    p_actor_id: actorUserId,
  })

  if (error) {
    throw mapCalendarRpcError(error, 'CALENDAR_UPDATE_FAILED', 'Unable to update production calendar entry.')
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) {
    throw createCalendarError(500, 'CALENDAR_UPDATE_FAILED', 'Unable to update production calendar entry.')
  }

  invalidateDeviceThresholdsCache?.(machineId)
  return parseCalendarEntry(row, 'CALENDAR_UPDATE_FAILED', machineId)
}

async function setProductionCalendarRange(
  {
    machineId,
    startDate,
    endDate,
    dayType,
    name,
    reason,
    confirmOverwrite,
    groupId,
    actorUserId,
    asOf,
  },
  suppliedClient,
) {
  assertFutureManilaDate(startDate, asOf)
  const supabase = suppliedClient || getSupabaseClient()

  const { data, error } = await executeRpc(supabase, 'set_production_calendar_range', {
    p_machine_id: machineId,
    p_start_date: startDate,
    p_end_date: endDate,
    p_day_type: dayType,
    p_name: name,
    p_reason: reason ?? null,
    p_confirm_overwrite: Boolean(confirmOverwrite),
    p_actor_id: actorUserId,
    p_group_id: groupId ?? null,
  })

  if (error) {
    throw mapCalendarRpcError(error, 'CALENDAR_RANGE_UPDATE_FAILED', 'Unable to save production calendar range.')
  }

  if (!Array.isArray(data) || data.length === 0) {
    throw createCalendarError(500, 'CALENDAR_RANGE_UPDATE_FAILED', 'Unable to save production calendar range.')
  }

  const entries = data.map((row) => parseCalendarEntry(row, 'CALENDAR_RANGE_UPDATE_FAILED', machineId))
  invalidateDeviceThresholdsCache?.(machineId)
  return {
    groupId: entries[0].groupId,
    entries,
  }
}

function validateRemovalResult(result, errorCode) {
  if (
    !result
    || typeof result !== 'object'
    || !Number.isInteger(result.removedCount)
    || !Array.isArray(result.removedDates)
    || !Array.isArray(result.lockedDates)
    || !Array.isArray(result.restoredDates)
    || !Array.isArray(result.restoredHolidays)
  ) {
    throw createCalendarError(500, errorCode, 'Unable to remove production calendar entry.')
  }
  return result
}

async function removeProductionCalendarDay(
  { machineId, calendarDate, actorUserId, asOf },
  suppliedClient,
) {
  assertFutureManilaDate(calendarDate, asOf)
  const supabase = suppliedClient || getSupabaseClient()

  const { data, error } = await executeRpc(supabase, 'remove_production_calendar_day', {
    p_machine_id: machineId,
    p_calendar_date: calendarDate,
    p_actor_id: actorUserId,
  })

  if (error) {
    throw mapCalendarRpcError(error, 'CALENDAR_REMOVE_FAILED', 'Unable to remove production calendar entry.')
  }

  const rawResult = Array.isArray(data) ? data[0] : data
  const validated = validateRemovalResult(rawResult, 'CALENDAR_REMOVE_FAILED')
  invalidateDeviceThresholdsCache?.(machineId)
  return validated
}

async function removeProductionCalendarRange(
  { machineId, groupId, actorUserId, asOf },
  suppliedClient,
) {
  const supabase = suppliedClient || getSupabaseClient()

  const { data, error } = await executeRpc(supabase, 'remove_production_calendar_range', {
    p_machine_id: machineId,
    p_group_id: groupId,
    p_actor_id: actorUserId,
    p_as_of: asOf ? new Date(asOf).toISOString() : null,
  })

  if (error) {
    throw mapCalendarRpcError(error, 'CALENDAR_RANGE_REMOVE_FAILED', 'Unable to remove production calendar range.')
  }

  const rawResult = Array.isArray(data) ? data[0] : data
  const validated = validateRemovalResult(rawResult, 'CALENDAR_RANGE_REMOVE_FAILED')
  invalidateDeviceThresholdsCache?.(machineId)
  return validated
}

module.exports = {
  getProductionCalendar,
  removeProductionCalendarDay,
  removeProductionCalendarRange,
  setProductionCalendarDay,
  setProductionCalendarRange,
}
