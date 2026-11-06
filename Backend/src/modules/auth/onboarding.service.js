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
  if (error.code === 'P0001') throw fail(429, 'RESEND_COOLDOWN', 'Wait one minute before requesting another setup or reset link.')
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

async function sendPasswordLinkEmail(email, token, origin, purpose = 'setup') {
  const isReset = purpose === 'reset'
  const link = `${origin}/${isReset ? 'reset-password' : 'setup-password'}#token=${token}`
  const logoUrl = /^https:\/\/(?!localhost|127\.0\.0\.1)/i.test(origin) ? `${origin}/assets/logo.png` : 'https://raw.githubusercontent.com/HnysPzza/IoT-Monitoring-System-PetroHydroPipe/main/Frontend/public/assets/logo.png'
  const subject = isReset ? 'Reset your PetroHydroPipe password' : 'Set up your PetroHydroPipe account'
  const eyebrow = isReset ? 'Password reset' : 'Account invitation'
  const heading = isReset ? 'Reset your password.' : 'Welcome to your workspace.'
  const message = isReset
    ? 'Your administrator requested a password reset. Choose a new secure password to continue using the monitoring system.'
    : 'Your administrator has created your account. Choose a secure password to get started with the monitoring system.'
  const buttonText = isReset ? 'Reset password' : 'Set up password'
  const expirationDescription = isReset
    ? 'This link expires one hour after it is issued. Saving your new password signs out your active sessions.'
    : 'This link expires one hour after it is issued and cannot be used again after your password is saved.'
  const helpText = isReset
    ? 'Expired or already used? Ask your administrator for a new reset link.'
    : 'Expired or already used? Sign in if you have set your password, or ask your administrator for a new invitation.'
  const endNote = isReset
    ? 'If you did not request this reset, ignore this email and contact your administrator.'
    : 'If you did not expect this invitation, you can safely ignore this email or contact your administrator.'
  try {
    await createEmailService().sendTransactionalEmail({
      recipientEmail: email,
      subject,
      htmlContent: `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${subject}</title></head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #334155;">
  <div style="display: none; max-height: 0; overflow: hidden;">${isReset ? 'Choose a new password using your one-time link within one hour.' : 'Your account is ready to set up. Create your password within one hour.'}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc;"><tr><td align="center" style="background-color: #f8fafc; padding: 40px 16px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #334155; text-align: left;">
      <tr><td style="background-color: #ffffff; border-bottom: 1px solid #f1f5f9; padding: 32px 40px 24px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr>
            <td align="left" valign="middle" style="vertical-align: middle;">
              <img src="${logoUrl}" height="28px" alt="PetroHydroPipe Logo" style="height: 28px; width: auto; display: inline-block; vertical-align: middle; border: 0;" />
              <span style="font-size: 16px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em; margin-left: 10px; vertical-align: middle;">PetroHydroPipe</span>
            </td>
            <td align="right" valign="middle" style="vertical-align: middle; text-align: right;">
              <span style="display: inline-block; font-size: 11px; font-weight: 500; color: #64748b; background-color: #f1f5f9; padding: 4px 8px; border-radius: 6px;">IoT Monitoring System</span>
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding: 32px 40px;">
        <p style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #2563eb; margin: 0 0 8px 0; margin-bottom: 8px;">${eyebrow}</p>
        <h1 style="font-size: 24px; font-weight: 600; color: #0f172a; letter-spacing: -0.03em; margin: 0 0 16px 0;">${heading}</h1>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px 0;">${message}</p>
        <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;"><tr><td bgcolor="#2563eb" style="border-radius: 8px; background-color: #2563eb;">
          <a href="${link}" style="display: inline-block; background-color: #2563eb; color: #ffffff; font-size: 14px; font-weight: 500; text-decoration: none; padding: 12px 24px; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">${buttonText}</a>
        </td></tr></table>
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; margin-bottom: 24px; font-variant-numeric: tabular-nums;">
          <span style="font-size: 12px; font-weight: 600; color: #0f172a; margin-bottom: 4px; display: block; font-variant-numeric: tabular-nums;">Valid for one hour &middot; Single-use link</span>
          <p style="font-size: 12px; line-height: 1.5; color: #64748b; margin: 0; font-variant-numeric: tabular-nums;">${expirationDescription}</p>
        </div>
        <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin: 0;">${helpText}</p>
      </td></tr>
      <tr><td style="background-color: #f8fafc; border-top: 1px solid #f1f5f9; padding: 24px 40px; text-align: center;">
        <p style="font-size: 12px; color: #94a3b8; line-height: 1.5; margin: 0 0 8px 0;">Keep this email private. Your administrator will never receive your chosen password.</p>
        <p style="font-size: 12px; color: #94a3b8; line-height: 1.5; margin: 0 0 16px 0;">${endNote}</p>
        <p style="font-size: 11px; color: #cbd5e1; margin: 0;">PetroHydroPipe IoT Monitoring System &middot; Secure Account Access</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`,
      textContent: `${isReset ? 'Your administrator requested a password reset.' : 'Welcome to PetroHydroPipe. Your administrator has created your account.'} ${isReset ? 'Reset your password' : 'Set your password'} using this single-use link within one hour of issue: ${link}\n\n${isReset ? 'Saving your new password signs out your active sessions. If it has expired, ask your administrator for a new reset link.' : 'This link cannot be used again after your password is saved. If it has expired, ask your administrator for a new invitation.'} Keep this email private. ${endNote}`,
    })
    return 'accepted'
  } catch (error) {
    logger.error('Account password email was not confirmed.', { code: error.code })
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
  return { user, delivery: await sendPasswordLinkEmail(values.email, token, origin) }
}

async function resendSetup({ userId, actorUserId }) {
  const origin = setupOrigin()
  const { data, error } = await getSupabaseClient().from('users').select('email').eq('id', userId).maybeSingle()
  if (error) throw fail(500, 'USER_QUERY_FAILED', 'Unable to load account.')
  if (!data) throw fail(404, 'USER_NOT_FOUND', 'Account not found.')
  const token = randomBytes(32).toString('hex')
  await callOnboarding('resend_user_invitation', { p_actor: actorUserId, p_user_id: userId, p_token_hash: hashToken(token) })
  return { delivery: await sendPasswordLinkEmail(data.email, token, origin) }
}

async function requestPasswordReset({ userId, actorUserId }) {
  const origin = setupOrigin()
  const { data, error } = await getSupabaseClient().from('users').select('email').eq('id', userId).maybeSingle()
  if (error) throw fail(500, 'USER_QUERY_FAILED', 'Unable to load account.')
  if (!data) throw fail(404, 'USER_NOT_FOUND', 'Account not found.')
  const token = randomBytes(32).toString('hex')
  await callOnboarding('request_user_password_reset', {
    p_actor: actorUserId,
    p_user_id: userId,
    p_token_hash: hashToken(token),
  })
  return { delivery: await sendPasswordLinkEmail(data.email, token, origin, 'reset') }
}

async function setupPassword({ token, password }) {
  await callOnboarding('complete_password_setup', { p_token_hash: hashToken(token), p_password_hash: await bcrypt.hash(password, 10) })
}

async function validateSetupToken({ token }) {
  const { data, error } = await getSupabaseClient().from('password_setup_tokens')
    .select('purpose, expires_at, used_at, users!inner(status, deleted_at, onboarding_state)')
    .eq('token_hash', hashToken(token)).maybeSingle()
  if (error) throw fail(500, 'SETUP_LINK_QUERY_FAILED', 'Unable to check setup link.')
  const validForMs = Date.parse(data?.expires_at) - Date.now()
  if (!data || data.purpose !== 'setup' || data.used_at || !(validForMs > 0) || data.users?.status !== 'Active' ||
      data.users.deleted_at || data.users.onboarding_state !== 'Invited') {
    throw fail(400, 'SETUP_LINK_INVALID', 'This setup link is invalid, expired, or already used.')
  }
  return { validForMs }
}

async function validatePasswordResetToken({ token }) {
  const { data, error } = await getSupabaseClient().from('password_setup_tokens')
    .select('purpose, expires_at, used_at, users!inner(status, deleted_at, onboarding_state)')
    .eq('token_hash', hashToken(token)).maybeSingle()
  if (error) throw fail(500, 'PASSWORD_RESET_LINK_QUERY_FAILED', 'Unable to check password reset link.')
  const validForMs = Date.parse(data?.expires_at) - Date.now()
  if (!data || data.purpose !== 'reset' || data.used_at || !(validForMs > 0) || data.users?.status !== 'Active' ||
      data.users.deleted_at || data.users.onboarding_state !== 'Ready') {
    throw fail(400, 'PASSWORD_RESET_LINK_INVALID', 'This password reset link is invalid, expired, or already used.')
  }
  return { validForMs }
}

async function changePassword(userId, { currentPassword, password }) {
  const { data, error } = await getSupabaseClient().from('users').select('password_hash, must_change_password').eq('id', userId).maybeSingle()
  if (error) throw fail(500, 'USER_QUERY_FAILED', 'Unable to load account.')
  if (!data?.must_change_password) throw fail(403, 'ACCOUNT_OPERATION_INVALID', 'Password change is only permitted when required by your account.')
  if (!data?.password_hash || !await bcrypt.compare(currentPassword, data.password_hash)) throw fail(400, 'PASSWORD_INCORRECT', 'Current password is incorrect.')
  if (await bcrypt.compare(password, data.password_hash)) throw fail(400, 'PASSWORD_UNCHANGED', 'Choose a different password.')
  await callOnboarding('change_account_password', { p_user_id: userId, p_old_hash: data.password_hash, p_new_hash: await bcrypt.hash(password, 10) })
}

module.exports = {
  addUser,
  resendSetup,
  requestPasswordReset,
  setupPassword,
  validateSetupToken,
  validatePasswordResetToken,
  changePassword,
  callOnboarding,
  hashToken,
}
