const assert = require('node:assert/strict')
const test = require('node:test')
const { loadAppWithMocks, withTestServer } = require('./helpers/appTestUtils')

test('parser errors return stable JSON without reflecting submitted credentials', async () => {
  await withTestServer(loadAppWithMocks(), async (baseUrl) => {
    for (const [body, status, code, message] of [
      ['{"password":"SYNTHETIC_ONLY", nope}', 400, 'INVALID_JSON', 'Request body must contain valid JSON.'],
      [JSON.stringify({ password: 'x'.repeat(110000) }), 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.'],
    ]) {
      const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      assert.equal(response.status, status)
      assert.deepEqual(await response.json(), { error: { code, message } })
    }
  })
})

test('setup rate limits return structured JSON and retry timing', async () => {
  await withTestServer(loadAppWithMocks(), async (baseUrl) => {
    let response
    for (let attempt = 0; attempt < 11; attempt += 1) {
      response = await fetch(`${baseUrl}/api/auth/setup-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    }
    assert.equal(response.status, 429)
    assert.match(response.headers.get('content-type'), /application\/json/)
    assert.ok(Number(response.headers.get('retry-after')) > 0)
    assert.equal((await response.json()).error.code, 'RATE_LIMITED')
  })
})
