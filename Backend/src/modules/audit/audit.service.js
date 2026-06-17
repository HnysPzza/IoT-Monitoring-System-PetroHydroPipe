const { getSupabaseClient } = require('../../database/client')

const DEFAULT_AUDIT_LIMIT = 25
const MAX_AUDIT_LIMIT = 100

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
    metadata: logRecord.metadata || {},
    createdAt: logRecord.created_at,
  }
}

function getEndOfDayIso(dateValue) {
  return `${dateValue}T23:59:59.999Z`
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
    query = query.gte('created_at', `${filters.dateFrom}T00:00:00.000Z`)
  }

  if (filters.dateTo) {
    query = query.lte('created_at', getEndOfDayIso(filters.dateTo))
  }

  const { data, error, count } = await query

  if (error) {
    throw createAuditError(500, 'AUDIT_QUERY_FAILED', 'Unable to load audit logs.')
  }

  const total = count || 0
  const totalPages = Math.max(Math.ceil(total / limit), 1)

  return {
    logs: data.map(toAuditLogResponse),
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
  try {
    const supabase = getSupabaseClient()
    const { error } = await supabase
      .from('audit_logs')
      .insert({
        user_id: userId,
        action,
        entity_type: entityType,
        entity_id: entityId,
        metadata,
      })

    if (error) {
      console.warn('Unable to record audit log.', { action, entityType, error: error.message })
    }
  } catch (error) {
    console.warn('Unable to record audit log.', { action, entityType, error: error.message })
  }
}

module.exports = {
  listAuditLogs,
  recordAuditLog,
}
