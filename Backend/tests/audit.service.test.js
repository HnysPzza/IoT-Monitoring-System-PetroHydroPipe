const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')

function loadAuditService(calls) {
  const clientPath = path.join(backendRoot, 'src', 'database', 'client.js')
  const servicePath = path.join(backendRoot, 'src', 'modules', 'audit', 'audit.service.js')
  delete require.cache[require.resolve(servicePath)]
  require.cache[require.resolve(clientPath)] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: {
      getSupabaseClient: () => ({
        from() {
          const query = {
            select() { return this },
            order() { return this },
            range() { return this },
            gte(field, value) { calls.push({ operation: 'gte', field, value }); return this },
            lt(field, value) { calls.push({ operation: 'lt', field, value }); return this },
            then(resolve, reject) {
              return Promise.resolve({ data: [], count: 0, error: null }).then(resolve, reject)
            },
          }
          return query
        },
      }),
    },
  }

  return require(servicePath)
}

test('audit date filters use Manila business-day boundaries', async () => {
  const calls = []
  const service = loadAuditService(calls)

  await service.listAuditLogs({ dateFrom: '2026-07-13', dateTo: '2026-07-13' })

  assert.deepEqual(calls, [
    { operation: 'gte', field: 'created_at', value: '2026-07-12T16:00:00.000Z' },
    { operation: 'lt', field: 'created_at', value: '2026-07-13T16:00:00.000Z' },
  ])
})
