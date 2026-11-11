const { addUser, callOnboarding } = require('../auth/onboarding.service')
const { getSupabaseClient } = require('../../database/client')

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

  return userRecord.roles?.name || userRecord.role || null
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
    mustChangePassword: Boolean(userRecord.must_change_password ?? userRecord.mustChangePassword),
    createdAt: userRecord.created_at ?? userRecord.createdAt,
    lastLoginAt: userRecord.last_login_at ?? userRecord.lastLoginAt ?? null,
    deletedAt: userRecord.deleted_at ?? userRecord.deletedAt ?? null,
  }
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

async function createUser(values) {
  return addUser(values)
}

function mapUserMutationRpcError(error, { selfCode, selfMessage, fallbackCode, fallbackMessage }) {
  const message = String(error?.message || '')
  if (error?.code === 'P0002' || /not found/i.test(message)) {
    return createUserError(404, 'USER_NOT_FOUND', 'User account not found.')
  }
  if (error?.code === '42501' && /cannot be (deactivated|archived)|Protected administrator/i.test(message)) {
    return createUserError(403, 'ACCOUNT_PROTECTED', 'The Admin account is protected.')
  }
  if (error?.code === '42501') {
    return createUserError(403, 'FORBIDDEN', 'Admin access required.')
  }
  if (error?.code === '22023' && /own account/i.test(message)) {
    return createUserError(400, selfCode, selfMessage)
  }
  return createUserError(500, fallbackCode, fallbackMessage)
}

async function updateUserStatus({ userId, status, actorUserId }) {
  if (userId === actorUserId && status === 'Inactive') {
    throw createUserError(400, 'SELF_DEACTIVATION_BLOCKED', 'You cannot deactivate your own account.')
  }

  const supabase = getSupabaseClient()
  const { data, error } = await supabase.rpc('update_user_account_status', {
    p_actor: actorUserId,
    p_user_id: userId,
    p_status: status,
  })

  if (error) {
    throw mapUserMutationRpcError(error, {
      selfCode: 'SELF_DEACTIVATION_BLOCKED',
      selfMessage: 'You cannot deactivate your own account.',
      fallbackCode: 'USER_STATUS_UPDATE_FAILED',
      fallbackMessage: 'Unable to update user status.',
    })
  }

  if (!data) {
    throw createUserError(404, 'USER_NOT_FOUND', 'User account not found.')
  }

  return toUserResponse(data)
}

async function archiveUser({ userId, actorUserId }) {
  if (userId === actorUserId) {
    throw createUserError(400, 'SELF_ARCHIVE_BLOCKED', 'You cannot archive your own account.')
  }

  const supabase = getSupabaseClient()
  const { data, error } = await supabase.rpc('archive_user_account', {
    p_actor: actorUserId,
    p_user_id: userId,
  })

  if (error) {
    throw mapUserMutationRpcError(error, {
      selfCode: 'SELF_ARCHIVE_BLOCKED',
      selfMessage: 'You cannot archive your own account.',
      fallbackCode: 'USER_ARCHIVE_FAILED',
      fallbackMessage: 'Unable to archive user account.',
    })
  }

  if (!data) {
    throw createUserError(404, 'USER_NOT_FOUND', 'User account not found.')
  }

  return toUserResponse(data)
}

module.exports = {
  archiveUser,
  createUser,
  listRoles,
  listUsers,
  toUserResponse,
  updateUserStatus,
}
