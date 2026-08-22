const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')

function loadRepository({ data = { evaluations: [], states: {} }, error = null } = {}) {
  const calls = []
  const query = {
    abortSignal(signal) {
      calls.push({ signal })
      return this
    },
    async single() {
      return { data, error }
    },
  }
  const clientPath = path.join(backendRoot, 'src', 'database', 'client.js')
  const repositoryPath = path.join(backendRoot, 'src', 'modules', 'watchdog', 'watchdog.repository.js')
  delete require.cache[require.resolve(repositoryPath)]
  require.cache[require.resolve(clientPath)] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: {
      getSupabaseClient: () => ({
        rpc(functionName, args) {
          calls.push({ functionName, args })
          return query
        },
      }),
    },
  }
  return { calls, repository: require(repositoryPath) }
}

test('watchdog repository performs exactly one abortable batch RPC per cycle', async () => {
  const data = { evaluations: [], states: {} }
  const { calls, repository } = loadRepository({ data })
  const signal = new AbortController().signal
  const result = await repository.evaluateCycle({
    evaluatedAt: '2026-08-22T04:00:00.000Z', mode: 'observe', staleAfterSeconds: 30, signal,
  })

  assert.equal(result, data)
  assert.deepEqual(calls[0], {
    functionName: 'evaluate_watchdog_cycle',
    args: {
      p_evaluated_at: '2026-08-22T04:00:00.000Z',
      p_mode: 'observe',
      p_stale_after_seconds: 30,
    },
  })
  assert.equal(calls[1].signal, signal)
  assert.equal(calls.filter((call) => call.functionName).length, 1)
})

test('watchdog repository masks batch RPC failures', async () => {
  const { repository } = loadRepository({ error: { code: 'XX000', message: 'private database failure' } })
  await assert.rejects(
    repository.evaluateCycle({
      evaluatedAt: '2026-08-22T04:00:00.000Z',
      mode: 'observe',
      staleAfterSeconds: 30,
      signal: new AbortController().signal,
    }),
    (error) => error.code === 'WATCHDOG_CYCLE_QUERY_FAILED'
      && error.message === 'Unable to evaluate the sensor watchdog cycle.'
      && !error.message.includes('private'),
  )
})
