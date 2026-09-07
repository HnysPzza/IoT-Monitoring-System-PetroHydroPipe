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
      htmlContent: `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Set up your PetroHydroPipe account</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;color:#1e293b;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;">Your account is ready to set up. Create your password within one hour.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
      <tr><td style="padding:28px 32px;background:#142d4e;border-bottom:4px solid #38bdf8;">
        <p style="margin:0;color:#ffffff;font-size:22px;font-weight:bold;">PetroHydroPipe</p>
        <p style="margin:8px 0 0;color:#cbd5e1;font-size:12px;letter-spacing:1px;">IoT Machine Monitoring System</p>
      </td></tr>
      <tr><td style="padding:32px;">
        <p style="margin:0 0 12px;color:#0369a1;font-size:12px;font-weight:bold;letter-spacing:1px;">ACCOUNT INVITATION</p>
        <h1 style="margin:0 0 16px;color:#0f172a;font-size:28px;line-height:1.2;">Welcome to your workspace.</h1>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;">Your administrator has created your account. Choose a private password to get started with the monitoring system.</p>
        <table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="border-radius:8px;background:#0369a1;">
          <a href="${link}" style="display:inline-block;padding:16px 28px;background:#0369a1;border:1px solid #0369a1;border-radius:8px;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;">Set up password</a>
        </td></tr></table>
        <p style="margin:24px 0 0;padding:16px;background:#f0f9ff;border-left:3px solid #0284c7;font-size:14px;line-height:1.6;"><strong>Valid for one hour. Works once.</strong><br>This link expires one hour after it is issued and cannot be used again after your password is saved.</p>
        <p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#475569;">Expired or already used? Sign in if you have set your password, or ask your administrator for a new invitation.</p>
      </td></tr>
      <tr><td style="padding:24px 32px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;line-height:1.6;">Keep this email private. Your administrator will never receive your chosen password.<br>If you did not expect this invitation, contact your administrator.</td></tr>
    </table>
    <p style="margin:20px 0 0;color:#64748b;font-size:12px;">PetroHydroPipe &middot; Secure account access</p>
  </td></tr></table>
</body></html>`,
      textContent: `Welcome to PetroHydroPipe. Your administrator has created your account. Set your password using this single-use link within one hour of issue: ${link}\n\nThis link cannot be used again after your password is saved. If it has expired, ask your administrator for a new invitation. Keep this email private. If you did not expect it, contact your administrator.`,
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

async function validateSetupToken({ token }) {
  const { data, error } = await getSupabaseClient().from('password_setup_tokens')
    .select('expires_at, used_at, users!inner(status, deleted_at, onboarding_state)')
    .eq('token_hash', hashToken(token)).maybeSingle()
  if (error) throw fail(500, 'SETUP_LINK_QUERY_FAILED', 'Unable to check setup link.')
  const validForMs = Date.parse(data?.expires_at) - Date.now()
  if (!data || data.used_at || !(validForMs > 0) || data.users?.status !== 'Active' ||
      data.users.deleted_at || data.users.onboarding_state !== 'Invited') {
    throw fail(400, 'SETUP_LINK_INVALID', 'This setup link is invalid, expired, or already used.')
  }
  return { validForMs }
}

async function changePassword(userId, { currentPassword, password }) {
  const { data, error } = await getSupabaseClient().from('users').select('password_hash').eq('id', userId).maybeSingle()
  if (error) throw fail(500, 'USER_QUERY_FAILED', 'Unable to load account.')
  if (!data?.password_hash || !await bcrypt.compare(currentPassword, data.password_hash)) throw fail(400, 'PASSWORD_INCORRECT', 'Current password is incorrect.')
  if (await bcrypt.compare(password, data.password_hash)) throw fail(400, 'PASSWORD_UNCHANGED', 'Choose a different password.')
  await callOnboarding('change_account_password', { p_user_id: userId, p_old_hash: data.password_hash, p_new_hash: await bcrypt.hash(password, 10) })
}

module.exports = { addUser, resendSetup, setupPassword, validateSetupToken, changePassword, callOnboarding, hashToken }
