const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const envModulePath = path.resolve(__dirname, '..', 'src', 'config', 'env.js')

function withEnvironment(overrides, assertion) {
  const previous = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  )

  try {
    Object.assign(process.env, overrides)
    delete require.cache[require.resolve(envModulePath)]
    assertion(() => require(envModulePath))
  } finally {
    delete require.cache[require.resolve(envModulePath)]
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    })
  }
}

test('SSE authorization timeout must be shorter than its revalidation interval', () => {
  withEnvironment({
    NODE_ENV: 'test',
    SSE_AUTH_REVALIDATION_INTERVAL_MS: '1000',
    SSE_AUTH_REVALIDATION_TIMEOUT_MS: '1000',
    SSE_MAX_CONNECTION_LIFETIME_MS: '2000',
  }, (loadEnv) => {
    assert.throws(loadEnv, /SSE_AUTH_REVALIDATION_TIMEOUT_MS must be shorter/)
  })
})

test('SSE revalidation interval must be shorter than maximum stream lifetime', () => {
  withEnvironment({
    NODE_ENV: 'test',
    SSE_AUTH_REVALIDATION_INTERVAL_MS: '2000',
    SSE_AUTH_REVALIDATION_TIMEOUT_MS: '1000',
    SSE_MAX_CONNECTION_LIFETIME_MS: '2000',
  }, (loadEnv) => {
    assert.throws(loadEnv, /SSE_AUTH_REVALIDATION_INTERVAL_MS must be shorter/)
  })
})

test('SSE backpressure timeout must be shorter than maximum stream lifetime', () => {
  withEnvironment({
    NODE_ENV: 'test',
    SSE_AUTH_REVALIDATION_INTERVAL_MS: '1000',
    SSE_AUTH_REVALIDATION_TIMEOUT_MS: '500',
    SSE_BACKPRESSURE_TIMEOUT_MS: '2000',
    SSE_MAX_CONNECTION_LIFETIME_MS: '2000',
  }, (loadEnv) => {
    assert.throws(loadEnv, /SSE_BACKPRESSURE_TIMEOUT_MS must be shorter/)
  })
})

test('SSE heartbeat interval stays within the client watchdog contract', () => {
  withEnvironment({
    NODE_ENV: 'test',
    SSE_HEARTBEAT_INTERVAL_MS: '120001',
  }, (loadEnv) => {
    assert.throws(loadEnv, /SSE_HEARTBEAT_INTERVAL_MS/)
  })
})
