const { BrevoClient } = require('@getbrevo/brevo')
const { z } = require('zod')

const env = require('../../config/env')
const logger = require('../../utils/logger')

const emailMessageSchema = z.object({
  recipientEmail: z.string().trim().email(),
  recipientName: z.string().trim().min(1).max(120).optional(),
  subject: z.string().trim().min(1).max(200),
  htmlContent: z.string().min(1).max(200_000),
  textContent: z.string().min(1).max(200_000).optional(),
})

function createEmailServiceError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function createBrevoClient(config) {
  if (!config.BREVO_API_KEY) return null

  return new BrevoClient({
    apiKey: config.BREVO_API_KEY,
    maxRetries: 0,
    timeoutInSeconds: 10,
  })
}

function createEmailService({
  config = env,
  client = createBrevoClient(config),
  serviceLogger = logger,
} = {}) {
  return {
    async sendTransactionalEmail(message) {
      const parsed = emailMessageSchema.safeParse(message)
      if (!parsed.success) {
        throw createEmailServiceError('EMAIL_MESSAGE_INVALID', 'The transactional email is invalid.')
      }

      if (!config.BREVO_API_KEY || !config.BREVO_FROM_EMAIL || !client) {
        throw createEmailServiceError('EMAIL_PROVIDER_NOT_CONFIGURED', 'The transactional email provider is not configured.')
      }

      const payload = {
        sender: {
          name: config.BREVO_FROM_NAME,
          email: config.BREVO_FROM_EMAIL,
        },
        to: [{
          email: parsed.data.recipientEmail,
          ...(parsed.data.recipientName ? { name: parsed.data.recipientName } : {}),
        }],
        subject: parsed.data.subject,
        htmlContent: parsed.data.htmlContent,
        ...(parsed.data.textContent ? { textContent: parsed.data.textContent } : {}),
      }

      try {
        const response = await client.transactionalEmails.sendTransacEmail(payload)
        return { messageId: response?.messageId || null }
      } catch (error) {
        serviceLogger.error('Transactional email delivery failed.', {
          provider: 'brevo',
          statusCode: error?.statusCode || null,
          errorName: error?.name || null,
        })
        throw createEmailServiceError('EMAIL_DELIVERY_FAILED', 'Unable to send the transactional email.')
      }
    },
  }
}

module.exports = {
  createEmailService,
  createEmailServiceError,
  emailMessageSchema,
}
