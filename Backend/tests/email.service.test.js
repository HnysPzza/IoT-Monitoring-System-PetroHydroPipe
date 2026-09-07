const assert = require('node:assert/strict')
const test = require('node:test')

const { createEmailService } = require('../src/modules/email/email.service')

function configured() {
  return {
    BREVO_API_KEY: 'test-brevo-key',
    BREVO_FROM_EMAIL: 'accounts@example.test',
    BREVO_FROM_NAME: 'Petro Hydro Monitoring',
  }
}

function fakeClient(response = { messageId: 'brevo-message-1' }) {
  const calls = []
  return {
    calls,
    client: {
      transactionalEmails: {
        async sendTransacEmail(payload) {
          calls.push(payload)
          return response
        },
      },
    },
  }
}

test('email service maps a valid transactional message to the Brevo SDK', async () => {
  const fake = fakeClient()
  const service = createEmailService({ config: configured(), client: fake.client })

  const result = await service.sendTransactionalEmail({
    recipientEmail: 'operator@example.test',
    recipientName: 'Operator One',
    subject: 'Set up your account',
    htmlContent: '<p>Choose your password.</p>',
    textContent: 'Choose your password.',
  })

  assert.deepEqual(result, { messageId: 'brevo-message-1' })
  assert.deepEqual(fake.calls, [{
    sender: { name: 'Petro Hydro Monitoring', email: 'accounts@example.test' },
    to: [{ email: 'operator@example.test', name: 'Operator One' }],
    subject: 'Set up your account',
    htmlContent: '<p>Choose your password.</p>',
    textContent: 'Choose your password.',
  }])
})

test('email service rejects invalid messages before calling Brevo', async () => {
  const fake = fakeClient()
  const service = createEmailService({ config: configured(), client: fake.client })

  await assert.rejects(
    service.sendTransactionalEmail({
      recipientEmail: 'not-an-email',
      subject: '',
      htmlContent: '<p>Invalid</p>',
    }),
    { code: 'EMAIL_MESSAGE_INVALID' },
  )
  assert.equal(fake.calls.length, 0)
})

test('email service fails closed when Brevo configuration is missing', async () => {
  const fake = fakeClient()
  const service = createEmailService({
    config: { ...configured(), BREVO_API_KEY: '', BREVO_FROM_EMAIL: undefined },
    client: fake.client,
  })

  await assert.rejects(
    service.sendTransactionalEmail({
      recipientEmail: 'operator@example.test',
      subject: 'Set up your account',
      htmlContent: '<p>Choose your password.</p>',
    }),
    { code: 'EMAIL_PROVIDER_NOT_CONFIGURED' },
  )
  assert.equal(fake.calls.length, 0)
})

test('email service sanitizes provider failures and does not log message content', async () => {
  const logs = []
  const providerError = new Error('provider response contains setup-token-secret')
  providerError.statusCode = 401
  const service = createEmailService({
    config: configured(),
    client: {
      transactionalEmails: {
        async sendTransacEmail() {
          throw providerError
        },
      },
    },
    serviceLogger: {
      error(message, metadata) {
        logs.push({ message, metadata })
      },
    },
  })

  await assert.rejects(
    service.sendTransactionalEmail({
      recipientEmail: 'operator@example.test',
      subject: 'Set up your account',
      htmlContent: '<p>https://localhost/setup?token=setup-token-secret</p>',
    }),
    { code: 'EMAIL_DELIVERY_FAILED', message: 'Unable to send the transactional email.' },
  )
  assert.deepEqual(logs, [{
    message: 'Transactional email delivery failed.',
    metadata: { provider: 'brevo', statusCode: 401, errorName: 'Error' },
  }])
  assert.equal(JSON.stringify(logs).includes('setup-token-secret'), false)
})
