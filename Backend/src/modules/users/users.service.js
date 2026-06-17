const bcrypt = require('bcryptjs')
const { getSupabaseClient } = require('../../database/client')
const { recordAuditLog } = require('../audit/audit.service')

const PASSWORD_SALT_ROUNDS = 10

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

async function listUsers() {
  // Admin directory reads users joined with their role names.
  const supabase = getSupabaseClient()

  const { data, error } = await supabase
    .from('users')
    .select(getUserSelect())
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    throw createUserError(500, 'USERS_QUERY_FAILED', 'Unable to load user accounts.')
  }

  return data.map(toUserResponse)
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

async function findRoleByName(roleName) {
  const supabase = getSupabaseClient()

  const { data, error } = await supabase
    .from('roles')
    .select('id, name')
    .eq('name', roleName)
    .maybeSingle()

  if (error) {
    throw createUserError(500, 'ROLE_QUERY_FAILED', 'Unable to validate role.')
  }

  return data
}

async function assertUniqueUsernameAndEmail(username, email) {
  // Duplicate checks run before insert so the UI can show clear conflict messages.
  const supabase = getSupabaseClient()
  const normalizedUsername = username.trim().toLowerCase()
  const normalizedEmail = email.trim().toLowerCase()

  const { data, error } = await supabase
    .from('users')
    .select('id, username, email')
    .or(`username.eq.${normalizedUsername},email.eq.${normalizedEmail}`)

  if (error) {
    throw createUserError(500, 'USER_LOOKUP_FAILED', 'Unable to validate account uniqueness.')
  }

  const usernameExists = data.some((user) => user.username.toLowerCase() === normalizedUsername)
  const emailExists = data.some((user) => user.email?.toLowerCase() === normalizedEmail)

  if (usernameExists) {
    throw createUserError(409, 'USERNAME_EXISTS', 'Username already exists.')
  }

  if (emailExists) {
    throw createUserError(409, 'EMAIL_EXISTS', 'Email already exists.')
  }
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
  // New accounts start active and must change the temporary password later.
  const normalizedUsername = values.username.trim().toLowerCase()
  const normalizedEmail = values.email.trim().toLowerCase()
  const role = await findRoleByName(values.role.trim())

  if (!role) {
    throw createUserError(400, 'INVALID_ROLE', 'Selected role does not exist.')
  }

  await assertUniqueUsernameAndEmail(normalizedUsername, normalizedEmail)

  const passwordHash = await bcrypt.hash(values.password, PASSWORD_SALT_ROUNDS)
  const supabase = getSupabaseClient()

  const { data, error } = await supabase
    .from('users')
    .insert({
      role_id: role.id,
      name: values.name.trim(),
      username: normalizedUsername,
      email: normalizedEmail,
      password_hash: passwordHash,
      status: 'Active',
      must_change_password: true,
    })
    .select(getUserSelect())
    .single()

  if (error) {
    throw createUserError(500, 'USER_CREATE_FAILED', 'Unable to create user account.')
  }

  const user = toUserResponse(data)
  await recordAuditLog({
    userId: values.actorUserId,
    action: 'USER_CREATED',
    entityType: 'user',
    entityId: user.id,
    metadata: {
      targetUsername: user.username,
      targetRole: user.role,
      targetStatus: user.status,
    },
  })

  return user
}

async function updateUserStatus({ userId, status, actorUserId }) {
  if (userId === actorUserId && status === 'Inactive') {
    throw createUserError(400, 'SELF_DEACTIVATION_BLOCKED', 'You cannot deactivate your own account.')
  }

  await fetchUserById(userId)

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
