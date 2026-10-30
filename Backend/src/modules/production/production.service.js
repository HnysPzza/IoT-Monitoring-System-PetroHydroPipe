const productionRepository = require('./production.repository')
const {
  addBusinessDays,
  formatBusinessDate,
  getBusinessDayRange,
  parseBusinessDate,
  startOfBusinessDay,
} = require('../../shared/businessTime')
const {
  OUTPUT_SENSOR_CODE,
  getSensorLabel,
} = require('../../shared/sensorIdentity')

// ponytail: Default window is fixed to 30 days; upgrade to cursor pagination or date partitions when event volume exceeds 50k per month.
const DEFAULT_LIST_WINDOW_DAYS = 30

function resolveDateWindow(filters, asOf) {
  if (filters.date) {
    return getBusinessDayRange(filters.date)
  }

  if (filters.dateFrom && filters.dateTo) {
    const start = parseBusinessDate(filters.dateFrom)
    const end = addBusinessDays(parseBusinessDate(filters.dateTo), 1)
    return { start, end }
  }

  if (filters.dateFrom) {
    const start = parseBusinessDate(filters.dateFrom)
    const end = new Date(
      Math.max(
        addBusinessDays(startOfBusinessDay(asOf), 1).getTime(),
        addBusinessDays(start, DEFAULT_LIST_WINDOW_DAYS).getTime(),
      ),
    )
    return { start, end }
  }

  if (filters.dateTo) {
    const end = addBusinessDays(parseBusinessDate(filters.dateTo), 1)
    const start = addBusinessDays(end, -DEFAULT_LIST_WINDOW_DAYS)
    return { start, end }
  }

  const end = addBusinessDays(startOfBusinessDay(asOf), 1)
  const start = addBusinessDays(end, -DEFAULT_LIST_WINDOW_DAYS)
  return { start, end }
}

function checkIsSpecified(spec) {
  if (!spec) return false
  return (
    (spec.label != null && String(spec.label).trim() !== '') ||
    (spec.size != null && String(spec.size).trim() !== '') ||
    spec.diameter != null ||
    spec.radius != null ||
    spec.circumference != null
  )
}

function toProductionRecord(event, spec, machine, sensorLabel) {
  const isSpecified = Boolean(event.output_accepted && checkIsSpecified(spec))
  return {
    id: event.id,
    sensorEventId: event.id,
    deviceEventId: event.device_event_id || null,
    sensorCode: OUTPUT_SENSOR_CODE,
    sensorLabel,
    machineCode: machine.code,
    machineName: machine.name,
    recordedAt: event.recorded_at,
    outputAccepted: Boolean(event.output_accepted),
    rejectionReason: event.output_rejection_reason || null,
    status: event.output_accepted ? 'accepted' : 'rejected',
    isEditable: Boolean(event.output_accepted),
    isSpecified,
    specStatus: !event.output_accepted ? 'rejected' : (isSpecified ? 'specified' : 'unspecified'),
    label: spec?.label ?? null,
    size: spec?.size ?? null,
    diameter: spec?.diameter != null ? Number(spec.diameter) : null,
    radius: spec?.radius != null ? Number(spec.radius) : null,
    circumference: spec?.circumference != null ? Number(spec.circumference) : null,
    updatedAt: spec?.updated_at ?? null,
    updatedBy: spec?.updated_by ?? null,
  }
}

function countAcceptedInRange(events, range) {
  const startTime = range.start.getTime()
  const endTime = range.end.getTime()
  return events.filter((event) => {
    if (event.output_accepted !== true) return false
    const eventTime = new Date(event.recorded_at).getTime()
    return eventTime >= startTime && eventTime < endTime
  }).length
}

function matchesSearch(record, query) {
  if (!query) return true
  const lower = query.toLowerCase()
  if (record.label && record.label.toLowerCase().includes(lower)) return true
  if (record.size && record.size.toLowerCase().includes(lower)) return true
  if (record.deviceEventId && String(record.deviceEventId).toLowerCase().includes(lower)) return true
  if (record.id && String(record.id).toLowerCase().includes(lower)) return true
  return false
}

async function listProductionLogs(filters = {}, options = {}) {
  const asOf = options.asOf || new Date()
  const window = resolveDateWindow(filters, asOf)

  const sensorConfig = await productionRepository.findOutputSensor(options.client)
  if (!sensorConfig?.id) {
    const error = new Error('Production output sensor is not configured.')
    error.status = 500
    error.code = 'PRODUCTION_SENSOR_MISSING'
    throw error
  }

  const machineRecord = Array.isArray(sensorConfig.machines)
    ? sensorConfig.machines[0]
    : sensorConfig.machines

  const machine = {
    id: sensorConfig.machine_id || machineRecord?.id || null,
    code: machineRecord?.machine_code || 'M-01',
    name: machineRecord?.name || 'Spiral Mill 01',
  }
  const sensorLabel = getSensorLabel(OUTPUT_SENSOR_CODE, sensorConfig.label)
  const sensor = {
    id: sensorConfig.id,
    code: sensorConfig.sensor_code || OUTPUT_SENSOR_CODE,
    label: sensorLabel,
  }

  const page = Number(filters.page) || 1
  const pageSize = Number(filters.pageSize || filters.limit) || 25

  if (asOf <= window.start) {
    return {
      sensor,
      machine,
      periodState: 'future',
      range: {
        start: window.start.toISOString(),
        end: window.end.toISOString(),
      },
      summary: {
        totalAcceptedToday: null,
        totalAccepted: null,
        specifiedCount: null,
        unspecifiedCount: null,
        rejectedCount: null,
      },
      records: [],
      pagination: {
        page,
        pageSize,
        limit: pageSize,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: page > 1,
      },
    }
  }

  const periodState = asOf < window.end ? 'partial' : 'complete'
  const todayRange = getBusinessDayRange(formatBusinessDate(asOf))
  const queryEndIso = periodState === 'partial' ? asOf.toISOString() : window.end.toISOString()

  const rawWindowEvents = await productionRepository.findProductionEvents(
    {
      sensorId: sensor.id,
      startIso: window.start.toISOString(),
      endIso: queryEndIso,
    },
    options.client,
  )

  const windowEvents = rawWindowEvents.filter(
    (event) => event.output_accepted === true || event.output_accepted === false,
  )

  let totalAcceptedToday = 0
  const isWindowCoveringToday = window.start <= todayRange.start && window.end >= todayRange.end

  if (isWindowCoveringToday) {
    totalAcceptedToday = countAcceptedInRange(windowEvents, todayRange)
  } else if (asOf > todayRange.start) {
    const rawTodayEvents = await productionRepository.findProductionEvents(
      {
        sensorId: sensor.id,
        startIso: todayRange.start.toISOString(),
        endIso: todayRange.end.toISOString(),
      },
      options.client,
    )
    const todayEvents = rawTodayEvents.filter(
      (event) => event.output_accepted === true || event.output_accepted === false,
    )
    totalAcceptedToday = countAcceptedInRange(todayEvents, todayRange)
  }

  const acceptedEventIds = windowEvents
    .filter((event) => event.output_accepted === true)
    .map((event) => event.id)

  const specsMap = await productionRepository.findProductionSpecsByEventIds(
    acceptedEventIds,
    options.client,
  )

  let totalAccepted = 0
  let specifiedCount = 0
  let unspecifiedCount = 0
  let rejectedCount = 0

  const allRecords = windowEvents.map((event) => {
    const spec = specsMap.get(event.id) || null
    const record = toProductionRecord(event, spec, machine, sensorLabel)

    if (record.outputAccepted) {
      totalAccepted += 1
      if (record.isSpecified) {
        specifiedCount += 1
      } else {
        unspecifiedCount += 1
      }
    } else {
      rejectedCount += 1
    }

    return record
  })

  const summary = {
    totalAcceptedToday,
    totalAccepted,
    specifiedCount,
    unspecifiedCount,
    rejectedCount,
  }

  const statusFilter = filters.status || 'accepted'
  const specStatusFilter = filters.specStatus || 'all'
  const searchQuery = (filters.search || '').trim()

  const filteredRecords = allRecords.filter((record) => {
    if (statusFilter === 'accepted' && !record.outputAccepted) return false
    if (statusFilter === 'rejected' && record.outputAccepted) return false

    if (specStatusFilter === 'specified' && (!record.outputAccepted || !record.isSpecified)) return false
    if (specStatusFilter === 'unspecified' && (!record.outputAccepted || record.isSpecified)) return false

    if (searchQuery && !matchesSearch(record, searchQuery)) return false

    return true
  })

  filteredRecords.sort((a, b) => {
    const timeDiff = new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime()
    if (timeDiff !== 0) return timeDiff
    return String(b.id).localeCompare(String(a.id))
  })

  const total = filteredRecords.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const offset = (page - 1) * pageSize
  const records = filteredRecords.slice(offset, offset + pageSize)

  const pagination = {
    page,
    pageSize,
    limit: pageSize,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  }

  return {
    sensor,
    machine,
    periodState,
    range: {
      start: window.start.toISOString(),
      end: window.end.toISOString(),
    },
    summary,
    records,
    pagination,
  }
}

module.exports = {
  listProductionLogs,
  resolveDateWindow,
}
