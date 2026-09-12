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

test('production refuses each missing backend credential even when other settings are supplied', () => {
  const configured = {
    NODE_ENV: 'production',
    CORS_ORIGIN: 'https://frontend.example.test',
    SUPABASE_URL: 'https://database.example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-test-value',
    JWT_SECRET: 'synthetic-signing-value-for-tests-only',
  }
  for (const missing of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'JWT_SECRET']) {
    withEnvironment({ ...configured, [missing]: '' }, (loadEnv) => {
      assert.throws(loadEnv, new RegExp(missing))
    })
  }
  withEnvironment(configured, (loadEnv) => {
    assert.equal(loadEnv().NODE_ENV, 'production')
  })
})

test('loads valid Brevo development configuration', () => {
  withEnvironment({
    NODE_ENV: 'test',
    BREVO_API_KEY: 'test-brevo-key',
    BREVO_FROM_EMAIL: 'accounts@example.test',
    BREVO_FROM_NAME: 'Petro Hydro Monitoring',
  }, (loadEnv) => {
    const parsed = loadEnv()

    assert.equal(parsed.BREVO_API_KEY, 'test-brevo-key')
    assert.equal(parsed.BREVO_FROM_EMAIL, 'accounts@example.test')
    assert.equal(parsed.BREVO_FROM_NAME, 'Petro Hydro Monitoring')
  })
})

test('rejects an invalid Brevo sender email', () => {
  withEnvironment({
    NODE_ENV: 'test',
    BREVO_FROM_EMAIL: 'not-an-email',
  }, (loadEnv) => {
    assert.throws(loadEnv, /BREVO_FROM_EMAIL/)
  })
})

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

test('watchdog timing relationships fail fast at startup', () => {
  const cases = [
    [{ IOT_HEARTBEAT_EXPECTED_INTERVAL_MS: '30000', IOT_HEARTBEAT_STALE_AFTER_MS: '30000' }, /EXPECTED_INTERVAL_MS must be shorter/],
    [{ WATCHDOG_TICK_INTERVAL_MS: '30000', IOT_HEARTBEAT_STALE_AFTER_MS: '30000' }, /WATCHDOG_TICK_INTERVAL_MS must be shorter/],
    [{ WATCHDOG_EVALUATION_TIMEOUT_MS: '5000', WATCHDOG_TICK_INTERVAL_MS: '5000' }, /WATCHDOG_EVALUATION_TIMEOUT_MS must be shorter/],
    [{ WATCHDOG_MODE: 'automatic' }, /WATCHDOG_MODE/],
  ]

  for (const [overrides, pattern] of cases) {
    withEnvironment({
      NODE_ENV: 'test',
      IOT_HEARTBEAT_EXPECTED_INTERVAL_MS: '10000',
      IOT_HEARTBEAT_STALE_AFTER_MS: '30000',
      WATCHDOG_TICK_INTERVAL_MS: '5000',
      WATCHDOG_EVALUATION_TIMEOUT_MS: '4000',
      WATCHDOG_MODE: 'disabled',
      ...overrides,
    }, (loadEnv) => assert.throws(loadEnv, pattern))
  }
})

test('output loss fallback rate accepts positive decimals and rejects zero', () => {
  withEnvironment({
    NODE_ENV: 'test',
    OUTPUT_LOSS_FALLBACK_PIECES_PER_MINUTE: '0.05',
  }, (loadEnv) => {
    assert.equal(loadEnv().OUTPUT_LOSS_FALLBACK_PIECES_PER_MINUTE, 0.05)
  })

  withEnvironment({
    NODE_ENV: 'test',
    OUTPUT_LOSS_FALLBACK_PIECES_PER_MINUTE: '0',
  }, (loadEnv) => {
    assert.throws(loadEnv, /OUTPUT_LOSS_FALLBACK_PIECES_PER_MINUTE/)
  })
})

test('API request deadline defaults to twelve seconds and rejects unsafe values', () => {
  withEnvironment({
    NODE_ENV: 'test',
    API_REQUEST_TIMEOUT_MS: '',
  }, (loadEnv) => {
    assert.equal(loadEnv().API_REQUEST_TIMEOUT_MS, 12_000)
  })

  for (const value of ['0', '-1', '499', '14001', '15000', '120001', 'not-a-number']) {
    withEnvironment({
      NODE_ENV: 'test',
      API_REQUEST_TIMEOUT_MS: value,
    }, (loadEnv) => {
      assert.throws(loadEnv, /API_REQUEST_TIMEOUT_MS/)
    })
  }

  withEnvironment({
    NODE_ENV: 'test',
    API_REQUEST_TIMEOUT_MS: '8000',
  }, (loadEnv) => {
    assert.equal(loadEnv().API_REQUEST_TIMEOUT_MS, 8000)
  })
})

test('health readiness timeout is short and below the API request deadline', () => {
  withEnvironment({
    NODE_ENV: 'test',
    API_REQUEST_TIMEOUT_MS: '12000',
    HEALTH_READINESS_TIMEOUT_MS: '',
  }, (loadEnv) => {
    assert.equal(loadEnv().HEALTH_READINESS_TIMEOUT_MS, 2_000)
  })

  for (const value of ['0', '99', '5001', '12000', 'not-a-number']) {
    withEnvironment({
      NODE_ENV: 'test',
      API_REQUEST_TIMEOUT_MS: '12000',
      HEALTH_READINESS_TIMEOUT_MS: value,
    }, (loadEnv) => assert.throws(loadEnv, /HEALTH_READINESS_TIMEOUT_MS/))
  }

  withEnvironment({
    NODE_ENV: 'test',
    API_REQUEST_TIMEOUT_MS: '500',
    HEALTH_READINESS_TIMEOUT_MS: '500',
  }, (loadEnv) => {
    assert.throws(loadEnv, /HEALTH_READINESS_TIMEOUT_MS must be shorter/)
  })
})

test('server shutdown deadline is bounded', () => {
  withEnvironment({
    NODE_ENV: 'test',
    SERVER_SHUTDOWN_TIMEOUT_MS: '',
  }, (loadEnv) => {
    assert.equal(loadEnv().SERVER_SHUTDOWN_TIMEOUT_MS, 10_000)
  })

  for (const value of ['0', '999', '60001', 'not-a-number']) {
    withEnvironment({
      NODE_ENV: 'test',
      SERVER_SHUTDOWN_TIMEOUT_MS: value,
    }, (loadEnv) => assert.throws(loadEnv, /SERVER_SHUTDOWN_TIMEOUT_MS/))
  }
})

test('access token lifetime is bounded to the documented 15-60 minute window', () => {
  withEnvironment({
    NODE_ENV: 'test',
    ACCESS_TOKEN_EXPIRES_MINUTES: '',
  }, (loadEnv) => {
    assert.equal(loadEnv().ACCESS_TOKEN_EXPIRES_MINUTES, 30)
  })

  for (const value of ['14', '61', 'not-a-number']) {
    withEnvironment({
      NODE_ENV: 'test',
      ACCESS_TOKEN_EXPIRES_MINUTES: value,
    }, (loadEnv) => assert.throws(loadEnv, /ACCESS_TOKEN_EXPIRES_MINUTES/))
  }
})

test('refresh token lifetime is bounded between 1 hour and 24 hours', () => {
  withEnvironment({
    NODE_ENV: 'test',
    REFRESH_TOKEN_TTL_MINUTES: '',
  }, (loadEnv) => {
    assert.equal(loadEnv().REFRESH_TOKEN_TTL_MINUTES, 480)
  })

  for (const value of ['59', '1441', 'not-a-number']) {
    withEnvironment({
      NODE_ENV: 'test',
      REFRESH_TOKEN_TTL_MINUTES: value,
    }, (loadEnv) => assert.throws(loadEnv, /REFRESH_TOKEN_TTL_MINUTES/))
  }
})
