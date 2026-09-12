const { addUser, callOnboarding } = require('../auth/onboarding.service')
const { getSupabaseClient } = require('../../database/client')
const { recordAuditLog } = require('../audit/audit.service')

function createUserError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function getRoleName(userRecord) {
  if (Array.isArray(userRecord.roles)) {
    return userRecord.roles[0]?.name || null
  }

  return userRecord.roles?.name || null
}

function toUserResponse(userRecord) {
  // Public user shape for the frontend table; password_hash is intentionally excluded.
  return {
    id: userRecord.id,
    name: userRecord.name,
    username: userRecord.username,
    email: userRecord.email,
    role: getRoleName(userRecord),
    status: userRecord.status,
    mustChangePassword: Boolean(userRecord.must_change_password),
    createdAt: userRecord.created_at,
    lastLoginAt: userRecord.last_login_at,
    deletedAt: userRecord.deleted_at,
  }
}

function getUserSelect() {
  return `
    id,
    name,
    username,
    email,
    status,
    must_change_password,
    created_at,
    last_login_at,
    deleted_at,
    roles (
      name
    )
  `
}

async function listUsers(query) {
  return callOnboarding('list_user_accounts', Object.fromEntries(
    Object.entries(query).map(([key, value]) => [`p_${key}`, value]),
  ))
}

async function listRoles() {
  // Frontend role dropdown is loaded from the database, not hardcoded.
  const supabase = getSupabaseClient()

  const { data, error } = await supabase
    .from('roles')
    .select('id, name')
    .order('name', { ascending: true })

  if (error) {
    throw createUserError(500, 'ROLES_QUERY_FAILED', 'Unable to load roles.')
  }

  return data
}

async function fetchUserById(userId) {
  const supabase = getSupabaseClient()

  const { data, error } = await supabase
    .from('users')
    .select(getUserSelect())
    .eq('id', userId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    throw createUserError(500, 'USER_QUERY_FAILED', 'Unable to load user account.')
  }

  if (!data) {
    throw createUserError(404, 'USER_NOT_FOUND', 'User account not found.')
  }

  return data
}

async function createUser(values) {
  return addUser(values)
}

async function updateUserStatus({ userId, status, actorUserId }) {
  if (userId === actorUserId && status === 'Inactive') {
    throw createUserError(400, 'SELF_DEACTIVATION_BLOCKED', 'You cannot deactivate your own account.')
  }

  const target = await fetchUserById(userId)
  if (getRoleName(target) === 'Admin') throw createUserError(403, 'ACCOUNT_PROTECTED', 'The Admin account is protected.')

  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('users')
    .update({ status })
    .eq('id', userId)
    .select(getUserSelect())
    .single()

  if (error) {
    throw createUserError(500, 'USER_STATUS_UPDATE_FAILED', 'Unable to update user status.')
  }

  const user = toUserResponse(data)
  await recordAuditLog({
    userId: actorUserId,
    action: 'USER_STATUS_UPDATED',
    entityType: 'user',
    entityId: user.id,
    metadata: {
      targetUsername: user.username,
      targetRole: user.role,
      newStatus: user.status,
    },
  })

  return user
}

async function archiveUser({ userId, actorUserId }) {
  if (userId === actorUserId) {
    throw createUserError(400, 'SELF_ARCHIVE_BLOCKED', 'You cannot archive your own account.')
  }

  const existingUser = toUserResponse(await fetchUserById(userId))
  if (existingUser.role === 'Admin') throw createUserError(403, 'ACCOUNT_PROTECTED', 'The Admin account is protected.')
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('users')
    .update({
      status: 'Inactive',
      deleted_at: new Date().toISOString(),
      deleted_by: actorUserId,
    })
    .eq('id', userId)
    .is('deleted_at', null)
    .select(getUserSelect())
    .single()

  if (error) {
    throw createUserError(500, 'USER_ARCHIVE_FAILED', 'Unable to archive user account.')
  }

  const archivedUser = toUserResponse(data)
  await recordAuditLog({
    userId: actorUserId,
    action: 'USER_ARCHIVED',
    entityType: 'user',
    entityId: archivedUser.id,
    metadata: {
      targetUsername: existingUser.username,
      targetRole: existingUser.role,
      previousStatus: existingUser.status,
      newStatus: archivedUser.status,
      archivedAt: archivedUser.deletedAt,
    },
  })

  return archivedUser
}

module.exports = {
  archiveUser,
  createUser,
  listRoles,
  listUsers,
  toUserResponse,
  updateUserStatus,
}
