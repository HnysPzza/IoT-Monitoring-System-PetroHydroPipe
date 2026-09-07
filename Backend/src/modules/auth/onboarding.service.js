const { randomBytes, createHash } = require('node:crypto')
const bcrypt = require('bcryptjs')
const env = require('../../config/env')
const { getSupabaseClient } = require('../../database/client')
const { createEmailService } = require('../email/email.service')
const logger = require('../../utils/logger')

function fail(status, code, message) {
  return Object.assign(new Error(message), { status, code })
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

async function callOnboarding(functionName, values) {
  const { data, error } = await getSupabaseClient().rpc(functionName, values)
  if (!error) return data
  if (error.code === '23505') throw fail(409, 'ACCOUNT_EXISTS', 'Username or email already exists. Check the directory before retrying.')
  if (error.code === '42501') throw fail(403, 'ACCOUNT_PROTECTED', 'This account operation is not permitted.')
  if (error.code === '22023') throw fail(400, 'ACCOUNT_OPERATION_INVALID', 'Account or setup link is not eligible. Refresh the directory or request a new link.')
  if (error.code === 'P0001') throw fail(429, 'RESEND_COOLDOWN', 'Wait one minute before resending.')
  logger.error('Account operation failed.', { operation: functionName, code: error.code })
  throw fail(500, 'ACCOUNT_OPERATION_FAILED', 'Unable to complete account operation.')
}

function setupOrigin() {
  const origin = new URL(env.ACCOUNT_SETUP_ORIGIN)
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
      !['http:', 'https:'].includes(origin.protocol) || (env.NODE_ENV === 'production' && origin.protocol !== 'https:')) {
    throw fail(503, 'SETUP_ORIGIN_INVALID', 'Account setup origin is not configured safely.')
  }
  if (!env.BREVO_API_KEY || !env.BREVO_FROM_EMAIL) throw fail(503, 'EMAIL_NOT_CONFIGURED', 'Configure the email sender before adding users.')
  return origin.origin
}

async function sendSetupEmail(email, token, origin) {
  const link = `${origin}/setup-password#token=${token}`
  try {
    await createEmailService().sendTransactionalEmail({
      recipientEmail: email,
      subject: 'Set up your PetroHydroPipe account',
      htmlContent: `<p>Your account has been added. Choose your own password using this single-use link within one hour.</p><p><a href="${link}">Set up password</a></p><p>If you did not expect this email, contact your administrator.</p>`,
      textContent: `Your account has been added. Set your password within one hour: ${link}`,
    })
    return 'accepted'
  } catch (error) {
    logger.error('Account setup email was not confirmed.', { code: error.code })
    return 'unconfirmed'
  }
}

async function addUser(values) {
  const origin = setupOrigin()
  const token = randomBytes(32).toString('hex')
  const user = await callOnboarding('add_invited_user', {
    p_actor: values.actorUserId, p_name: values.name, p_username: values.username,
    p_email: values.email, p_role: values.role, p_token_hash: hashToken(token),
  })
  return { user, delivery: await sendSetupEmail(values.email, token, origin) }
}

async function resendSetup({ userId, actorUserId }) {
  const origin = setupOrigin()
  const { data, error } = await getSupabaseClient().from('users').select('email').eq('id', userId).maybeSingle()
  if (error) throw fail(500, 'USER_QUERY_FAILED', 'Unable to load account.')
  if (!data) throw fail(404, 'USER_NOT_FOUND', 'Account not found.')
  const token = randomBytes(32).toString('hex')
  await callOnboarding('resend_user_invitation', { p_actor: actorUserId, p_user_id: userId, p_token_hash: hashToken(token) })
  return { delivery: await sendSetupEmail(data.email, token, origin) }
}

async function setupPassword({ token, password }) {
  await callOnboarding('complete_password_setup', { p_token_hash: hashToken(token), p_password_hash: await bcrypt.hash(password, 10) })
}

async function changePassword(userId, { currentPassword, password }) {
  const { data, error } = await getSupabaseClient().from('users').select('password_hash').eq('id', userId).maybeSingle()
  if (error) throw fail(500, 'USER_QUERY_FAILED', 'Unable to load account.')
  if (!data?.password_hash || !await bcrypt.compare(currentPassword, data.password_hash)) throw fail(400, 'PASSWORD_INCORRECT', 'Current password is incorrect.')
  if (await bcrypt.compare(password, data.password_hash)) throw fail(400, 'PASSWORD_UNCHANGED', 'Choose a different password.')
  await callOnboarding('change_account_password', { p_user_id: userId, p_old_hash: data.password_hash, p_new_hash: await bcrypt.hash(password, 10) })
}

module.exports = { addUser, resendSetup, setupPassword, changePassword, callOnboarding, hashToken }
