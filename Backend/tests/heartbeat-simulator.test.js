const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const test = require('node:test')

const simulatorPath = path.resolve(__dirname, '../scripts/simulate-heartbeats.js')

test('heartbeat simulator reports configuration failure without forcing unsafe process shutdown', () => {
  const env = { ...process.env }
  for (const sensorCode of ['S01', 'S02', 'S03', 'S04', 'S05']) {
    env[`IOT_SIM_${sensorCode}_KEY`] = ''
  }

  const result = spawnSync(process.execPath, [simulatorPath, '--once'], {
    env,
    encoding: 'utf8',
    timeout: 10_000,
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /Missing simulator keys/)
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /UV_HANDLE_CLOSING|Assertion failed/)
})
