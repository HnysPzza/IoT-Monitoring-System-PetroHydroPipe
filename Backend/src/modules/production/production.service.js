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

function calculatePipeTonnage(diameter, thickness, length) {
  if (diameter == null || thickness == null || length == null) return null
  if (typeof diameter !== 'number' && typeof diameter !== 'string') return null
  if (typeof thickness !== 'number' && typeof thickness !== 'string') return null
  if (typeof length !== 'number' && typeof length !== 'string') return null

  if (typeof diameter === 'string' && diameter.trim() === '') return null
  if (typeof thickness === 'string' && thickness.trim() === '') return null
  if (typeof length === 'string' && length.trim() === '') return null

  const d = Number(diameter)
  const t = Number(thickness)
  const l = Number(length)

  if (!Number.isFinite(d) || !Number.isFinite(t) || !Number.isFinite(l)) return null
  if (d <= 0 || t <= 0 || l <= 0 || d <= t) return null

  const weightKgPerMeter = (d - t) * t * 0.02466
  const totalWeightTons = (weightKgPerMeter * l) / 1000000
  return Math.round(totalWeightTons * 10000) / 10000
}

function checkIsSpecified(spec) {
  if (!spec) return false
  return Boolean(
    (spec.customer != null && String(spec.customer).trim() !== '') ||
    spec.diameter != null ||
    spec.thickness != null ||
    spec.length != null ||
    spec.pipe_number != null ||
    spec.pipeNumber != null ||
    (spec.label != null && String(spec.label).trim() !== '') ||
    (spec.size != null && String(spec.size).trim() !== '') ||
    spec.radius != null ||
    spec.circumference != null
  )
}

function toProductionRecord(event, spec, machine, sensorLabel, autoPipeNumber = null) {
  const isSpecified = Boolean(event.output_accepted && checkIsSpecified(spec))
  const diameter = spec?.diameter != null ? Number(spec.diameter) : null
  const thickness = spec?.thickness != null ? Number(spec.thickness) : null
  const length = spec?.length != null ? Number(spec.length) : null
  const rawPipeNumber = spec?.pipe_number != null
    ? Number(spec.pipe_number)
    : (spec?.pipeNumber != null ? Number(spec.pipeNumber) : null)
  const pipeNumber = rawPipeNumber !== null
    ? rawPipeNumber
    : (event.output_accepted ? autoPipeNumber : null)
  const tonnage = calculatePipeTonnage(diameter, thickness, length)

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
    customer: spec?.customer ?? null,
    diameter,
    thickness,
    length,
    pipeNumber,
    tonnage,
    label: spec?.label ?? null,
    size: spec?.size ?? null,
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
  if (record.customer && record.customer.toLowerCase().includes(lower)) return true
  if (record.pipeNumber != null && String(record.pipeNumber).toLowerCase().includes(lower)) return true
  if (record.deviceEventId && String(record.deviceEventId).toLowerCase().includes(lower)) return true
  if (record.id && String(record.id).toLowerCase().includes(lower)) return true
  if (record.label && record.label.toLowerCase().includes(lower)) return true
  if (record.size && record.size.toLowerCase().includes(lower)) return true
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
        totalTonnage: null,
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

  const acceptedByDay = new Map()
  for (const event of windowEvents) {
    if (event.output_accepted !== true) continue
    const dayKey = formatBusinessDate(event.recorded_at)
    if (!acceptedByDay.has(dayKey)) {
      acceptedByDay.set(dayKey, [])
    }
    acceptedByDay.get(dayKey).push(event)
  }

  const dailyPipeSequenceByEventId = new Map()
  for (const [, dayEvents] of acceptedByDay.entries()) {
    dayEvents.sort((a, b) => {
      const timeDiff = new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
      if (timeDiff !== 0) return timeDiff
      return String(a.id || '').localeCompare(String(b.id || ''))
    })
    dayEvents.forEach((event, idx) => {
      dailyPipeSequenceByEventId.set(event.id, idx + 1)
    })
  }

  let totalAccepted = 0
  let specifiedCount = 0
  let unspecifiedCount = 0
  let rejectedCount = 0
  let sumTonnage = 0

  const allRecords = windowEvents.map((event) => {
    const spec = specsMap.get(event.id) || null
    const autoPipeNumber = dailyPipeSequenceByEventId.get(event.id) ?? null
    const record = toProductionRecord(event, spec, machine, sensorLabel, autoPipeNumber)

    if (record.outputAccepted) {
      totalAccepted += 1
      if (record.isSpecified) {
        specifiedCount += 1
      } else {
        unspecifiedCount += 1
      }
      if (record.tonnage != null) {
        sumTonnage += record.tonnage
      }
    } else {
      rejectedCount += 1
    }

    return record
  })

  const totalTonnage = Math.round(sumTonnage * 10000) / 10000

  const summary = {
    totalAcceptedToday,
    totalAccepted,
    specifiedCount,
    unspecifiedCount,
    rejectedCount,
    totalTonnage,
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

function toSpecPayload(specRow) {
  const isSpecified = checkIsSpecified(specRow)
  const diameter = specRow.diameter != null ? Number(specRow.diameter) : null
  const thickness = specRow.thickness != null ? Number(specRow.thickness) : null
  const length = specRow.length != null ? Number(specRow.length) : null
  const pipeNumber = specRow.pipe_number != null
    ? Number(specRow.pipe_number)
    : (specRow.pipeNumber != null ? Number(specRow.pipeNumber) : null)
  const tonnage = calculatePipeTonnage(diameter, thickness, length)

  return {
    sensorEventId: specRow.sensor_event_id,
    customer: specRow.customer ?? null,
    diameter,
    thickness,
    length,
    pipeNumber,
    tonnage,
    label: specRow.label ?? null,
    size: specRow.size ?? null,
    radius: specRow.radius != null ? Number(specRow.radius) : null,
    circumference: specRow.circumference != null ? Number(specRow.circumference) : null,
    isSpecified,
    specStatus: isSpecified ? 'specified' : 'unspecified',
    updatedAt: specRow.updated_at ?? null,
    updatedBy: specRow.updated_by ?? null,
  }
}

async function updateProductionLogSpec({ eventId, payload, actorUserId }, options = {}) {
  const row = await productionRepository.updateProductionSpec(
    {
      eventId,
      customer: payload.customer ?? null,
      diameter: payload.diameter ?? null,
      thickness: payload.thickness ?? null,
      length: payload.length ?? null,
      pipeNumber: payload.pipeNumber ?? null,
      actorUserId,
      expectedUpdatedAt: payload.expectedUpdatedAt ?? null,
    },
    options.client,
  )

  return { spec: toSpecPayload(row) }
}

async function batchUpdateProductionLogSpecs({ payload, actorUserId }, options = {}) {
  let startedAt = null
  let endedAt = null

  if (payload.startedAt && payload.endedAt) {
    startedAt = payload.startedAt
    endedAt = payload.endedAt
  } else if (payload.dateFrom && payload.dateTo) {
    startedAt = parseBusinessDate(payload.dateFrom).toISOString()
    endedAt = addBusinessDays(parseBusinessDate(payload.dateTo), 1).toISOString()
  }

  const row = await productionRepository.batchUpdateProductionSpecs(
    {
      sensorEventIds: payload.sensorEventIds ?? null,
      startedAt,
      endedAt,
      onlyUnlabeled: Boolean(payload.onlyUnlabeled),
      customer: payload.customer ?? null,
      diameter: payload.diameter ?? null,
      thickness: payload.thickness ?? null,
      length: payload.length ?? null,
      actorUserId,
    },
    options.client,
  )

  return {
    matchedCount: Number(row.matched_count ?? 0),
    updatedCount: Number(row.updated_count ?? 0),
    sensorEventIds: row.sensor_event_ids || [],
  }
}

module.exports = {
  calculatePipeTonnage,
  checkIsSpecified,
  listProductionLogs,
  resolveDateWindow,
  toProductionRecord,
  toSpecPayload,
  updateProductionLogSpec,
  batchUpdateProductionLogSpecs,
}
