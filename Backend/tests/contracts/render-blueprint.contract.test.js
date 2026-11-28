const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { loadAppWithMocks, withTestServer } = require('../helpers/appTestUtils')

const root = path.resolve(__dirname, '../../..')

test('render.yaml deploys a single Node web service with no Static Site /api rewrite', () => {
  const renderYaml = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8')
  const serviceMatches = renderYaml.match(/^\s*-\s+type:/gm) || []

  assert.equal(serviceMatches.length, 1, 'render.yaml must define exactly one Render service')
  assert.match(renderYaml, /runtime:\s*node\b/)
  assert.doesNotMatch(renderYaml, /runtime:\s*static\b/)
  assert.doesNotMatch(renderYaml, /name:\s*petrohydropipe-frontend\b/)
  assert.doesNotMatch(renderYaml, /source:\s*\/api\/\*/)
  assert.doesNotMatch(renderYaml, /rootDir:\s*Backend\b/)

  assert.match(renderYaml, /healthCheckPath:\s*\/api\/health\/ready\b/)
  assert.doesNotMatch(renderYaml, /healthCheckPath:\s*\/api\/health\/live\b/)
  assert.match(renderYaml, /plan:\s*starter\b/)
  assert.match(renderYaml, /numInstances:\s*1\b/)
  assert.match(renderYaml, /buildCommand:.*npm --prefix Backend ci --omit=dev/)
  assert.match(renderYaml, /buildCommand:.*npm --prefix Frontend ci --include=dev/)
  assert.match(renderYaml, /buildCommand:.*npm --prefix Frontend run build/)
  assert.match(renderYaml, /startCommand:\s*npm --prefix Backend start\b/)

  assert.match(renderYaml, /- key:\s*NODE_VERSION\s+value:\s*["']?22\.x["']?/)
  assert.match(renderYaml, /- key:\s*TRUST_PROXY\s+value:\s*["']?1["']?/)
  assert.match(renderYaml, /- key:\s*CORS_ORIGIN\s+sync:\s*false\b/)
  assert.match(renderYaml, /- key:\s*ACCOUNT_SETUP_ORIGIN\s+sync:\s*false\b/)
  assert.match(renderYaml, /- key:\s*WATCHDOG_MODE\s+value:\s*enforce\b/)
})

test('Express serves Frontend SPA same-origin with CSP headers, cache rules, and API 404 isolation', async () => {
  const indexHtml = fs.readFileSync(path.join(root, 'Frontend/index.html'), 'utf8')
  const nginxConf = fs.readFileSync(path.join(root, 'Frontend/nginx.conf'), 'utf8')
  assert.match(indexHtml, /<script src="\/theme-init\.js"><\/script>/)
  assert.doesNotMatch(indexHtml, /<script>[\s\S]*?<\/script>/)
  assert.equal(fs.existsSync(path.join(root, 'Frontend/public/theme-init.js')), true)
  assert.match(nginxConf, /add_header Content-Security-Policy "[^"]*script-src 'self'[^"]*frame-ancestors 'none'/)

  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'php-frontend-dist-'))

  try {
    fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true })
    fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><html><body>spa-shell</body></html>')
    fs.writeFileSync(path.join(distDir, 'assets', 'app-Ab12Cd34.js'), 'console.log("ok")\n')
    fs.writeFileSync(path.join(distDir, 'assets', 'logo.png'), 'png-bytes')

    const appModule = loadAppWithMocks()
    assert.equal(typeof appModule.createApp, 'function', 'app must export createApp factory')
    const app = appModule.createApp({ frontendDistDir: distDir })

    await withTestServer(app, async (baseUrl) => {
      const rootRes = await fetch(`${baseUrl}/`)
      const rootBody = await rootRes.text()
      assert.equal(rootRes.status, 200)
      assert.match(rootRes.headers.get('content-type') || '', /text\/html/)
      assert.equal(rootRes.headers.get('cache-control'), 'no-cache')
      assert.equal(rootRes.headers.get('x-frame-options'), 'DENY')
      assert.equal(rootRes.headers.get('x-content-type-options'), 'nosniff')
      assert.equal(rootRes.headers.get('referrer-policy'), 'strict-origin-when-cross-origin')
      const csp = rootRes.headers.get('content-security-policy') || ''
      assert.match(csp, /script-src 'self'(?:;|$)/)
      assert.doesNotMatch(csp, /sha256-/)
      assert.match(csp, /connect-src 'self'/)
      assert.match(csp, /frame-ancestors 'none'/)
      assert.match(csp, /object-src 'none'/)
      assert.doesNotMatch(csp, /upgrade-insecure-requests/)
      assert.match(rootBody, /spa-shell/)

      const corsPreflight = await fetch(`${baseUrl}/api/reports/export`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
        },
      })
      assert.match(corsPreflight.headers.get('access-control-expose-headers') || '', /Content-Disposition/i)

      for (const spaPath of ['/login', '/dashboard/machines', '/setup-password?token=abc']) {
        const res = await fetch(`${baseUrl}${spaPath}`)
        assert.equal(res.status, 200, spaPath)
        assert.equal(res.headers.get('cache-control'), 'no-cache', spaPath)
        assert.match(await res.text(), /spa-shell/, spaPath)
      }

      const headRes = await fetch(`${baseUrl}/login`, { method: 'HEAD' })
      assert.equal(headRes.status, 200)
      assert.equal(headRes.headers.get('cache-control'), 'no-cache')

      const hashedAsset = await fetch(`${baseUrl}/assets/app-Ab12Cd34.js`)
      assert.equal(hashedAsset.status, 200)
      assert.equal(hashedAsset.headers.get('cache-control'), 'public, max-age=31536000, immutable')

      const unhashedAsset = await fetch(`${baseUrl}/assets/logo.png`)
      assert.equal(unhashedAsset.status, 200)
      assert.equal(unhashedAsset.headers.get('cache-control'), 'public, max-age=3600')

      const missingAsset = await fetch(`${baseUrl}/assets/missing-chunk.js`)
      assert.equal(missingAsset.status, 404)
      assert.equal((await missingAsset.json()).error.code, 'NOT_FOUND')

      const postSpa = await fetch(`${baseUrl}/login`, { method: 'POST' })
      assert.equal(postSpa.status, 404)
      assert.equal((await postSpa.json()).error.code, 'NOT_FOUND')

      for (const [method, apiPath] of [['GET', '/api'], ['GET', '/api/does-not-exist'], ['POST', '/api/does-not-exist']]) {
        const res = await fetch(`${baseUrl}${apiPath}`, { method })
        assert.equal(res.status, 404, `${method} ${apiPath}`)
        assert.equal((await res.json()).error.code, 'NOT_FOUND', `${method} ${apiPath}`)
      }

      const healthRes = await fetch(`${baseUrl}/api/health`)
      assert.equal(healthRes.status, 200)
      assert.equal((await healthRes.json()).status, 'ok')
    })
  } finally {
    fs.rmSync(distDir, { recursive: true, force: true })
  }
})

test('Express stays API-only when Frontend dist build is absent', async () => {
  const missingDir = path.join(os.tmpdir(), `php-missing-dist-${Date.now()}`)
  const appModule = loadAppWithMocks()
  const app = appModule.createApp({ frontendDistDir: missingDir })

  await withTestServer(app, async (baseUrl) => {
    const rootRes = await fetch(`${baseUrl}/`)
    assert.equal(rootRes.status, 404)
    assert.equal((await rootRes.json()).error.code, 'NOT_FOUND')

    const healthRes = await fetch(`${baseUrl}/api/health`)
    assert.equal(healthRes.status, 200)
  })
})
