const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const http = require('node:http')
const path = require('node:path')
const test = require('node:test')

const backendRoot = path.resolve(__dirname, '..')

async function runSimulator(t, argumentsToAdd, randomValue = 0.999999) {
  const receivedEvents = []
  const server = http.createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const event = JSON.parse(body)
      receivedEvents.push(event)
      response.writeHead(201, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ event }))
    })
  })
  t.after(() => server.close())

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const script = [
    `process.argv.push(${argumentsToAdd.map((argument) => JSON.stringify(argument)).join(', ')})`,
    `Math.random = () => ${randomValue}`,
    "require('./scripts/simulate-sensor-events.js')",
  ].join('; ')
  const child = spawn(process.execPath, ['-e', script], {
    cwd: backendRoot,
    env: {
      ...process.env,
      IOT_SIM_BASE_URL: `http://127.0.0.1:${port}`,
      IOT_SIM_S01_KEY: 'test-key',
      IOT_SIM_S02_KEY: 'test-key',
      IOT_SIM_S03_KEY: 'test-key',
      IOT_SIM_S04_KEY: 'test-key',
      IOT_SIM_S05_KEY: 'test-key',
    },
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const exitCode = await new Promise((resolve) => child.on('close', resolve))

  return { exitCode, receivedEvents, stderr }
}

test('one simulator batch never assigns the issue event to S-05', async (t) => {
  const { exitCode, receivedEvents, stderr } = await runSimulator(t, ['--once'])

  assert.equal(exitCode, 0, stderr)
  assert.equal(receivedEvents.length, 5)
  const outputEvent = receivedEvents.find((event) => event.metadata.sensorCode === 'S-05')
  assert.equal(outputEvent.eventType, 'pulse')
  assert.equal(outputEvent.signal, 'active')
})

test('downtime lifecycle verification rejects S-05 before sending an event', async (t) => {
  const { exitCode, receivedEvents, stderr } = await runSimulator(t, ['--verify-sensor=S-05'])

  assert.equal(exitCode, 1)
  assert.match(stderr, /S-05 does not support downtime verification/)
  assert.equal(receivedEvents.length, 0)
})
