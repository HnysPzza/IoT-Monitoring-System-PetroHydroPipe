const { getSupabaseClient } = require('../../database/client')
const { getBusinessDayRange } = require('../../shared/businessTime')
const logger = require('../../utils/logger')

const DEFAULT_AUDIT_LIMIT = 25
const MAX_AUDIT_LIMIT = 100

const SENSITIVE_METADATA_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'refreshToken',
  'accessToken',
  'secret',
  'apiKey',
  'credential',
])

function createAuditError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function getRoleName(userRecord) {
  if (!userRecord) return null

  if (Array.isArray(userRecord.roles)) {
    return userRecord.roles[0]?.name || null
  }

  return userRecord.roles?.name || null
}

function parseNumericField(value) {
  if (value == null || typeof value === 'boolean') return null
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    const num = Number(trimmed)
    return Number.isFinite(num) ? num : null
  }
  return null
}

function sanitizeText(value) {
  if (value == null || typeof value === 'boolean') return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  return null
}

function sanitizeProductionSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null

  const sanitized = {}
  if (spec.label !== undefined) sanitized.label = sanitizeText(spec.label)
  if (spec.size !== undefined) sanitized.size = sanitizeText(spec.size)
  if (spec.diameter !== undefined) sanitized.diameter = parseNumericField(spec.diameter)
  if (spec.radius !== undefined) sanitized.radius = parseNumericField(spec.radius)
  if (spec.circumference !== undefined) sanitized.circumference = parseNumericField(spec.circumference)
  return sanitized
}

function sanitizeAuditMetadata(action, rawMetadata) {
  if (!rawMetadata || typeof rawMetadata !== 'object' || Array.isArray(rawMetadata)) {
    return {}
  }

  if (action === 'PRODUCTION_SPEC_UPDATED') {
    return {
      sensorCode: sanitizeText(rawMetadata.sensorCode),
      machineCode: sanitizeText(rawMetadata.machineCode),
      recordedAt: sanitizeText(rawMetadata.recordedAt),
      label: sanitizeText(rawMetadata.label),
      size: sanitizeText(rawMetadata.size),
      diameter: parseNumericField(rawMetadata.diameter),
      radius: parseNumericField(rawMetadata.radius),
      circumference: parseNumericField(rawMetadata.circumference),
      previous: sanitizeProductionSpec(rawMetadata.previous),
    }
  }

  if (action === 'PRODUCTION_SPEC_BATCH_UPDATED') {
    const batchMeta = {
      sensorCode: sanitizeText(rawMetadata.sensorCode) || 'S-05',
      matchedCount: parseNumericField(rawMetadata.matchedCount) ?? 0,
      updatedCount: parseNumericField(rawMetadata.updatedCount) ?? 0,
      onlyUnlabeled: Boolean(rawMetadata.onlyUnlabeled),
      sensorEventIds: Array.isArray(rawMetadata.sensorEventIds)
        ? rawMetadata.sensorEventIds.map(sanitizeText).filter(Boolean)
        : [],
      appliedSpec: sanitizeProductionSpec(rawMetadata.appliedSpec) || {},
    }
    if (rawMetadata.machineCode !== undefined) {
      batchMeta.machineCode = sanitizeText(rawMetadata.machineCode)
    }
    return batchMeta
  }

  const cleaned = {}
  for (const [key, value] of Object.entries(rawMetadata)) {
    if (!SENSITIVE_METADATA_KEYS.has(key)) {
      cleaned[key] = value
    }
  }
  return cleaned
}

function isPulseEvent(action, metadata) {
  if (action === 'SENSOR_PULSE') return true
  if (action === 'IOT_EVENT_RECEIVED') {
    const eventType = String(metadata?.eventType || metadata?.event_type || metadata?.signal || '').trim().toLowerCase()
    return eventType === 'pulse'
  }
  return false
}

function toAuditLogResponse(logRecord) {
  return {
    id: logRecord.id,
    action: logRecord.action,
    entityType: logRecord.entity_type,
    entityId: logRecord.entity_id,
    actor: logRecord.users
      ? {
        id: logRecord.users.id,
        name: logRecord.users.name,
        username: logRecord.users.username,
        role: getRoleName(logRecord.users),
      }
      : null,
    metadata: sanitizeAuditMetadata(logRecord.action, logRecord.metadata),
    createdAt: logRecord.created_at,
  }
}

async function listAuditLogs(filters = {}) {
  const supabase = getSupabaseClient()
  const limit = Math.min(filters.limit || DEFAULT_AUDIT_LIMIT, MAX_AUDIT_LIMIT)
  const page = filters.page || 1
  const from = (page - 1) * limit
  const to = from + limit - 1

  let query = supabase
    .from('audit_logs')
    .select(`
      id,
      user_id,
      action,
      entity_type,
      entity_id,
      metadata,
      created_at,
      users (
        id,
        name,
        username,
        roles (
          name
        )
      )
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (filters.action && filters.action !== 'All') {
    query = query.eq('action', filters.action)
  }

  if (filters.entityType && filters.entityType !== 'All') {
    query = query.eq('entity_type', filters.entityType)
  }

  if (filters.userId) {
    query = query.eq('user_id', filters.userId)
  }

  if (filters.dateFrom) {
    const { start } = getBusinessDayRange(filters.dateFrom)
    query = query.gte('created_at', start.toISOString())
  }

  if (filters.dateTo) {
    const { end } = getBusinessDayRange(filters.dateTo)
    query = query.lt('created_at', end.toISOString())
  }

  const { data, error, count } = await query

  if (error) {
    throw createAuditError(500, 'AUDIT_QUERY_FAILED', 'Unable to load audit logs.')
  }

  const filteredData = (data || []).filter((record) => !isPulseEvent(record.action, record.metadata))

  const total = count || 0
  const totalPages = Math.max(Math.ceil(total / limit), 1)
  const affectedUserIds = [...new Set(filteredData
    .filter((record) => record.entity_type === 'user' && record.entity_id)
    .map((record) => record.entity_id))]
  let affectedUsersById = new Map()

  if (affectedUserIds.length > 0) {
    const { data: affectedUsers, error: affectedUsersError } = await supabase
      .from('users')
      .select('id, username')
      .in('id', affectedUserIds)

    if (affectedUsersError) {
      throw createAuditError(500, 'AUDIT_QUERY_FAILED', 'Unable to load audit logs.')
    }

    affectedUsersById = new Map((affectedUsers || []).map((user) => [user.id, user]))
  }

  return {
    logs: filteredData.map((record) => ({
      ...toAuditLogResponse(record),
      targetUser: record.entity_type === 'user' && affectedUsersById.has(record.entity_id)
        ? { username: affectedUsersById.get(record.entity_id).username }
        : null,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  }
}

async function recordAuditLog({ userId = null, action, entityType, entityId = null, metadata = {} }) {
  if (isPulseEvent(action, metadata)) {
    return null
  }

  const sanitizedMetadata = sanitizeAuditMetadata(action, metadata)
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('audit_logs')
    .insert({
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata: sanitizedMetadata,
    })

  if (error) {
    logger.error('AUDIT_WRITE_FAILED', { action, entityType, error: error.message })
    throw createAuditError(500, 'AUDIT_WRITE_FAILED', 'Unable to record audit log.')
  }
}

module.exports = {
  isPulseEvent,
  listAuditLogs,
  recordAuditLog,
  sanitizeAuditMetadata,
  toAuditLogResponse,
}
