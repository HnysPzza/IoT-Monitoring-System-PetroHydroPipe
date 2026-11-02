const assert = require('node:assert/strict')
const test = require('node:test')
const repository = require('../../../src/modules/production/production.repository')
const { listProductionLogs } = require('../../../src/modules/production/production.service')

test('loads the requested period and today concurrently when they differ', async () => {
  const original = { ...repository }
  let release
  let calls = 0
  repository.findOutputSensor = async () => ({ id: 'sensor', machine_id: 'machine' })
  repository.findProductionEvents = () => {
    calls += 1
    return calls === 1 ? new Promise((resolve) => { release = resolve }) : Promise.resolve([])
  }
  repository.findProductionSpecsByEventIds = async () => new Map()
  const request = listProductionLogs({ date: '2026-10-30' }, { asOf: new Date('2026-11-02T04:00:00Z') })
  await new Promise((resolve) => setImmediate(resolve))
  try { assert.equal(calls, 2) } finally { release([]); await request; Object.assign(repository, original) }
})
