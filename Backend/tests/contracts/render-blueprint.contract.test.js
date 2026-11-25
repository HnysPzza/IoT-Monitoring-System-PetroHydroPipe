const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '../../..')

test('render.yaml configures production proxy trust, readiness health check, single-instance starter plan, same-origin /api rewrite, and static security headers', () => {
  const renderYaml = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8')
  const indexHtml = fs.readFileSync(path.join(root, 'Frontend/index.html'), 'utf8')
  const inlineScriptMatch = indexHtml.match(/<script>([\s\S]*?)<\/script>/)
  assert.ok(inlineScriptMatch, 'Frontend/index.html inline theme script must exist')

  // Browsers hash exact script text (normalizing CRLF to LF per HTML spec).
  const inlineScriptLf = inlineScriptMatch[1].replace(/\r\n/g, '\n')
  const expectedScriptSha256 = `sha256-${crypto.createHash('sha256').update(inlineScriptLf, 'utf8').digest('base64')}`

  assert.match(renderYaml, /healthCheckPath:\s*\/api\/health\/ready\b/)
  assert.doesNotMatch(renderYaml, /healthCheckPath:\s*\/api\/health\/live\b/)
  assert.match(renderYaml, /plan:\s*starter\b/)
  assert.match(renderYaml, /numInstances:\s*1\b/)
  assert.match(renderYaml, /- key:\s*TRUST_PROXY\s+value:\s*["']?1["']?/)

  const apiRewriteIdx = renderYaml.indexOf('source: /api/*')
  const spaRewriteIdx = renderYaml.indexOf('source: /*')
  assert.ok(apiRewriteIdx > 0, 'render.yaml must define /api/* proxy rewrite')
  assert.ok(spaRewriteIdx > apiRewriteIdx, '/api/* rewrite must precede /* SPA fallback')
  assert.match(renderYaml, /destination:\s*https:\/\/petrohydropipe-backend\.onrender\.com\/api\/:splat/)

  assert.match(renderYaml, /name:\s*X-Frame-Options\s+value:\s*DENY/)
  assert.match(renderYaml, /name:\s*X-Content-Type-Options\s+value:\s*nosniff/)
  assert.match(renderYaml, /name:\s*Referrer-Policy\s+value:\s*strict-origin-when-cross-origin/)
  assert.ok(
    renderYaml.includes(`'${expectedScriptSha256}'`),
    `render.yaml CSP must include inline theme script hash '${expectedScriptSha256}'`,
  )
})
