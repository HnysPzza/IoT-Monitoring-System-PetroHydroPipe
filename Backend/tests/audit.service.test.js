const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')

function loadAuditService(calls, tableResponses = {}) {
  const clientPath = path.join(backendRoot, 'src', 'database', 'client.js')
  const servicePath = path.join(backendRoot, 'src', 'modules', 'audit', 'audit.service.js')
  delete require.cache[require.resolve(servicePath)]
  require.cache[require.resolve(clientPath)] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: {
      getSupabaseClient: () => ({
        from(table) {
          const query = {
            select() { return this },
            order() { return this },
            range() { return this },
            in(field, values) { calls.push({ operation: 'in', field, values }); return this },
            gte(field, value) { calls.push({ operation: 'gte', field, value }); return this },
            lt(field, value) { calls.push({ operation: 'lt', field, value }); return this },
            then(resolve, reject) {
              return Promise.resolve(tableResponses[table] || { data: [], count: 0, error: null }).then(resolve, reject)
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

test('audit user records include the affected username', async () => {
  const calls = []
  const service = loadAuditService(calls, {
    audit_logs: {
      data: [{
        id: 'audit-1',
        user_id: 'actor-1',
        action: 'USER_INVITED',
        entity_type: 'user',
        entity_id: 'target-1',
        metadata: {},
        created_at: '2026-07-13T00:00:00.000Z',
        users: { id: 'actor-1', username: 'admin', name: 'Admin', roles: { name: 'Admin' } },
      }],
      count: 1,
      error: null,
    },
    users: { data: [{ id: 'target-1', username: 'operator01' }], error: null },
  })

  const result = await service.listAuditLogs()

  assert.deepEqual(result.logs[0].targetUser, { username: 'operator01' })
  assert.deepEqual(calls, [{ operation: 'in', field: 'id', values: ['target-1'] }])
})
