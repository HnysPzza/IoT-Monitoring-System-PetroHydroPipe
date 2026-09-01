#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createInterface } = require('node:readline/promises')

const root = path.resolve(__dirname, '..')
const backend = path.join(root, 'Backend')
const frontend = path.join(root, 'Frontend')

const npm = (...args) => ({ command: 'npm', args, cwd: backend })
const nodeTest = (...files) => ({ command: process.execPath, args: ['--test', ...files], cwd: backend })

const suites = Object.freeze({
  all: {
    name: 'All required tests',
    description: 'Runs backend, frontend, and production build checks.',
    expected: 'All tests pass, backend reports 0 fail, and Vite build completes.',
    includes: ['backend', 'frontend'],
  },
  backend: {
    name: 'Backend full suite',
    description: 'Checks API, database, security, analytics, watchdog, health, and shutdown behavior.',
    expected: 'Backend reports 0 fail.',
    commands: [npm('test')],
  },
  frontend: {
    name: 'Frontend tests and build',
    description: 'Checks UI behavior and production compilation.',
    expected: 'All frontend tests pass and Vite build completes.',
    commands: [
      { ...npm('test'), cwd: frontend },
      { ...npm('run', 'build'), cwd: frontend },
    ],
  },
  docs: {
    name: 'Documentation contract',
    description: 'Checks public documentation contracts and safety wording.',
    expected: 'Documentation contract reports 0 fail.',
    commands: [nodeTest('tests/contracts/documentation.contract.test.js')],
  },
  deadlines: {
    name: 'Request deadline tests',
    description: 'Checks safe timeouts, cancellation, disconnects, SSE exemption, and configuration.',
    expected: 'Tests report 0 fail; simulated timeout warnings are expected.',
    commands: [nodeTest('tests/request-deadline.api.test.js', 'tests/env.test.js')],
  },
  health: {
    name: 'Health and readiness tests',
    description: 'Checks liveness, bounded readiness, schema version, dependencies, and safe failures.',
    expected: 'Tests report 0 fail; negative-case readiness warnings are expected.',
    commands: [nodeTest('tests/health.api.test.js', 'tests/health-readiness.migration.pglite.test.js', 'tests/env.test.js')],
  },
  shutdown: {
    name: 'Graceful shutdown tests',
    description: 'Checks normal drain, duplicate signals, deadline enforcement, cleanup failures, and listen errors.',
    expected: 'Tests report 0 fail.',
    commands: [nodeTest('tests/server-lifecycle.test.js', 'tests/env.test.js')],
  },
  phase3: {
    name: 'Watchdog and heartbeat tests',
    description: 'Checks heartbeat contracts, watchdog transitions, planned breaks, S-05 protection, and SSE shutdown.',
    expected: 'Tests report 0 fail.',
    commands: [nodeTest(
      'tests/heartbeat.api.test.js',
      'tests/heartbeat.service.test.js',
      'tests/watchdog.repository.test.js',
      'tests/watchdog.service.test.js',
      'tests/sse.test.js',
    )],
  },
  phase4: {
    name: 'Settings and Live Feed tests',
    description: 'Checks settings, snapshots, Live Feed, authorization, focused UI behavior, and production build.',
    expected: 'Backend and frontend tests pass and Vite build completes.',
    commands: [
      nodeTest(
        'tests/live-monitoring-snapshot.migration.pglite.test.js',
        'tests/database.contract.test.js',
        'tests/iot.service.test.js',
        'tests/settings.service.test.js',
        'tests/api.test.js',
      ),
      { ...npm(
        'test', '--',
        'src/features/dashboard/settings/SettingsSection.test.jsx',
        'src/features/dashboard/settings/settingsUtils.test.js',
      ), cwd: frontend },
      { ...npm(
        'test', '--',
        'src/features/dashboard/live/LiveSection.test.jsx',
        'src/features/dashboard/live/livePresentation.test.js',
      ), cwd: frontend },
      { ...npm('run', 'build'), cwd: frontend },
    ],
  },
  integration: {
    name: 'Local integration tests',
    description: 'Runs integration tests with hosted checks disabled by default.',
    expected: 'Tests report 0 fail; hosted checks may be skipped.',
    commands: [npm('run', 'test:integration')],
  },
  hosted: {
    name: 'Hosted Supabase integration tests',
    description: 'Runs enabled integration tests against configured Supabase.',
    expected: 'Tests report 0 fail against a reviewed non-production target.',
    hosted: true,
    commands: [{ ...npm('run', 'test:integration'), env: { RUN_SUPABASE_INTEGRATION_TESTS: 'true' } }],
  },
  manual: {
    name: 'Manual operational checks',
    description: 'Shows live health and graceful-shutdown checks without changing system state.',
    expected: 'Liveness is 200; readiness is 200 or safe 503; shutdown logs start and completion.',
    manual: true,
  },
  'simulate-once': {
    name: 'Simulate one ESP32 event batch',
    description: 'Sends one simulated sensor-event batch to configured backend.',
    expected: 'Simulator completes one batch; configured backend may create event, downtime, and alert records.',
    simulation: true,
    commands: [npm('run', 'iot:simulate:once')],
  },
  'simulate-deterministic': {
    name: 'Simulate one deterministic ESP32 event batch',
    description: 'Sends one repeatable sensor-event sequence to configured backend.',
    expected: 'Simulator completes repeatable batch; configured backend may create event, downtime, and alert records.',
    simulation: true,
    commands: [npm('run', 'iot:simulate:once', '--', '--deterministic')],
  },
  'simulate-verify': {
    name: 'Verify ESP32 event simulation',
    description: 'Runs configured S-04 downtime lifecycle verification against backend.',
    expected: 'Verification completes successfully and may create lifecycle records in configured backend.',
    simulation: true,
    commands: [npm('run', 'iot:simulate:verify')],
  },
  simulate: {
    name: 'Run continuous ESP32 event simulation',
    description: 'Continuously sends simulated sensor events until Ctrl+C.',
    expected: 'Simulator continues until cancelled; configured backend may create event, downtime, and alert records.',
    simulation: true,
    commands: [npm('run', 'iot:simulate')],
  },
  'heartbeat-once': {
    name: 'Simulate one heartbeat batch',
    description: 'Sends one authenticated heartbeat batch to configured backend.',
    expected: 'Simulator completes one heartbeat batch and updates configured device runtime state.',
    simulation: true,
    commands: [npm('run', 'iot:heartbeat:once')],
  },
  heartbeat: {
    name: 'Run continuous heartbeat simulation',
    description: 'Continuously sends authenticated heartbeats until Ctrl+C.',
    expected: 'Simulator continues until cancelled and updates configured device runtime state.',
    simulation: true,
    commands: [npm('run', 'iot:heartbeat')],
  },
})

const menu = Object.freeze([
  'all', 'backend', 'frontend', 'docs', 'deadlines', 'health',
  'shutdown', 'phase3', 'phase4', 'integration', 'hosted', 'manual',
  'simulate-once', 'simulate-deterministic', 'simulate-verify', 'simulate',
  'heartbeat-once', 'heartbeat',
])

const categories = Object.freeze({
  tests: {
    name: 'Test suites',
    suites: ['all', 'backend', 'frontend', 'docs', 'deadlines', 'shutdown', 'phase3', 'phase4', 'integration', 'hosted'],
  },
  health: {
    name: 'Health checks',
    suites: ['health', 'manual'],
  },
  simulations: {
    name: 'Simulations',
    suites: ['simulate-once', 'simulate-deterministic', 'simulate-verify', 'simulate', 'heartbeat-once', 'heartbeat'],
  },
})

const hasSuite = (suiteId) => Object.hasOwn(suites, suiteId)

function usage() {
  return `Usage: node scripts/run-tests.js [options]

Options:
  --suite <id>       Run one suite without menu
  --list             List suite IDs
  --dry-run          Print commands without running them
  --allow-hosted     Confirm reviewed hosted Supabase target in non-interactive use
  --allow-simulation Confirm simulator data writes in non-interactive use
  --self-test        Test runner behavior without running project tests
  -h, --help         Show help`
}

function parseArgs(args) {
  const options = {
    suite: null,
    list: false,
    dryRun: false,
    allowHosted: false,
    allowSimulation: false,
    selfTest: false,
    help: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '-h' || argument === '--help') options.help = true
    else if (argument === '--list') options.list = true
    else if (argument === '--dry-run') options.dryRun = true
    else if (argument === '--allow-hosted') options.allowHosted = true
    else if (argument === '--allow-simulation') options.allowSimulation = true
    else if (argument === '--self-test') options.selfTest = true
    else if (argument === '--suite') {
      if (options.suite !== null) throw new Error('--suite may only be provided once')
      index += 1
      if (!args[index]) throw new Error('--suite requires an ID')
      options.suite = args[index]
    } else if (argument.startsWith('--suite=')) {
      if (options.suite !== null) throw new Error('--suite may only be provided once')
      options.suite = argument.slice('--suite='.length)
      if (!options.suite) throw new Error('--suite requires an ID')
    } else throw new Error(`Unknown option: ${argument}`)
  }

  const actions = [options.help, options.list, options.selfTest, Boolean(options.suite)].filter(Boolean).length
  if (actions > 1) throw new Error('Choose only one of --help, --list, --self-test, or --suite')
  return options
}

function suiteIdFromSelection(selection, available = menu) {
  const value = selection.trim()
  if (value === '0') return null
  if (/^\d+$/.test(value)) return available[Number(value) - 1]
  return available.includes(value) && hasSuite(value) ? value : undefined
}

function expandedCommands(suiteId, trail = new Set()) {
  if (!hasSuite(suiteId)) throw new Error(`Unknown suite: ${suiteId}`)
  const suite = suites[suiteId]
  if (trail.has(suiteId)) throw new Error(`Circular suite include: ${suiteId}`)
  if (!suite.includes) return suite.commands || []

  const nextTrail = new Set(trail).add(suiteId)
  return suite.includes.flatMap((included) => expandedCommands(included, nextTrail))
}

function displayCommand(command) {
  const environment = command.env
    ? `${Object.entries(command.env).map(([key, value]) => `${key}=${value}`).join(' ')} `
    : ''
  const executable = command.command === process.execPath ? 'node' : command.command
  return `${environment}${[executable, ...command.args].join(' ')}`
}

function runCommand(command, dryRun) {
  console.log(`\n[${path.relative(root, command.cwd) || '.'}] ${displayCommand(command)}`)
  if (dryRun) return 0

  const env = { ...process.env, ...command.env }
  const executable = process.platform === 'win32' && command.command === 'npm'
    ? process.env.ComSpec || 'cmd.exe'
    : command.command
  const args = process.platform === 'win32' && command.command === 'npm'
    ? ['/d', '/s', '/c', 'npm', ...command.args]
    : command.args
  const result = spawnSync(executable, args, { cwd: command.cwd, env, stdio: 'inherit' })

  if (result.error) {
    console.error(`Failed to start command: ${result.error.message}`)
    return 1
  }
  if (result.signal === 'SIGINT') return 130
  return result.status ?? 1
}

function printManualChecks() {
  console.log(`
Start backend:
  cd Backend
  node src/server.js

In another terminal:
  curl -i http://localhost:3000/api/health/live
  curl -i http://localhost:3000/api/health/ready

Expected: live returns HTTP 200. Ready returns HTTP 200 only when Supabase and migration 024 are ready; otherwise safe HTTP 503.

Graceful shutdown: press Ctrl+C in backend terminal.
Expected logs:
  API server shutdown started.
  API server shutdown completed.`)
}

async function confirmHosted(options, input = process.stdin, output = process.stdout) {
  if (options.allowHosted) return true
  if (!input.isTTY) return false

  const prompt = createInterface({ input, output })
  const answer = await prompt.question('Type RUN to confirm configured Supabase is a reviewed non-production target: ')
  prompt.close()
  return answer.trim() === 'RUN'
}

async function confirmSimulation(options, input = process.stdin, output = process.stdout) {
  if (options.allowSimulation) return true
  if (!input.isTTY) return false

  const prompt = createInterface({ input, output })
  const answer = await prompt.question('Type RUN to confirm simulator may write records to configured backend: ')
  prompt.close()
  return answer.trim() === 'RUN'
}

async function runSuite(suiteId, options) {
  if (!hasSuite(suiteId)) throw new Error(`Unknown suite: ${suiteId}`)
  const suite = suites[suiteId]

  console.log(`\n${suite.name}\n${suite.description}\nExpected: ${suite.expected}`)
  if (suite.manual) {
    printManualChecks()
    return 0
  }
  if (suite.hosted && !options.dryRun && !(await confirmHosted(options))) {
    console.error('Hosted tests cancelled. Use --allow-hosted only after reviewing target configuration.')
    return 2
  }
  if (suite.simulation && !options.dryRun && !(await confirmSimulation(options))) {
    console.error('Simulation cancelled. Use --allow-simulation only after reviewing backend configuration.')
    return 2
  }

  const started = Date.now()
  for (const command of expandedCommands(suiteId)) {
    const status = runCommand(command, options.dryRun)
    if (status !== 0) {
      console.error(`\nFAILED: ${suite.name} (${Math.ceil((Date.now() - started) / 1000)}s)`)
      return status
    }
  }

  console.log(`\n${options.dryRun ? 'DRY RUN' : 'PASSED'}: ${suite.name} (${Math.ceil((Date.now() - started) / 1000)}s)`)
  return 0
}

function printSuites() {
  for (const category of Object.values(categories)) {
    console.log(`\n${category.name}`)
    for (const id of category.suites) console.log(`  ${id.padEnd(22)} ${suites[id].name}`)
  }
}

async function chooseSuite() {
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  const categoryIds = Object.keys(categories)
  console.log('\nCentral runner')
  categoryIds.forEach((id, index) => console.log(`${index + 1}. ${categories[id].name}`))
  console.log(' 0. Exit')
  const categoryAnswer = await prompt.question('\nChoose category: ')
  const categoryId = /^\d+$/.test(categoryAnswer.trim())
    ? categoryIds[Number(categoryAnswer.trim()) - 1]
    : categoryAnswer.trim()
  if (categoryAnswer.trim() === '0') {
    prompt.close()
    return null
  }
  if (!Object.hasOwn(categories, categoryId)) {
    prompt.close()
    return undefined
  }

  const available = categories[categoryId].suites
  console.log(`\n${categories[categoryId].name}`)
  available.forEach((id, index) => console.log(`${String(index + 1).padStart(2)}. ${suites[id].name}`))
  console.log(' 0. Exit')
  const answer = await prompt.question('\nChoose option: ')
  prompt.close()
  return suiteIdFromSelection(answer, available)
}

function selfTest() {
  assert.deepEqual(parseArgs(['--suite=health', '--dry-run']), {
    suite: 'health', list: false, dryRun: true, allowHosted: false, allowSimulation: false, selfTest: false, help: false,
  })
  assert.throws(() => parseArgs(['--suite']), /requires an ID/)
  assert.throws(() => parseArgs(['--suite', 'health', '--list']), /Choose only one/)
  assert.throws(() => parseArgs(['--suite', 'health', '--suite=docs']), /only be provided once/)
  assert.equal(suiteIdFromSelection('6'), 'health')
  assert.equal(suiteIdFromSelection('health'), 'health')
  assert.equal(suiteIdFromSelection('1', categories.simulations.suites), 'simulate-once')
  assert.equal(suiteIdFromSelection('health', categories.simulations.suites), undefined)
  assert.equal(suiteIdFromSelection('__proto__'), undefined)
  assert.equal(suiteIdFromSelection('health & whoami'), undefined)
  assert.equal(suiteIdFromSelection('999'), undefined)
  assert.equal(suiteIdFromSelection('0'), null)
  assert.equal(expandedCommands('all').length, 3)
  assert.equal(expandedCommands('all').some((command) => command.env?.RUN_SUPABASE_INTEGRATION_TESTS), false)
  assert.equal(expandedCommands('hosted')[0].env.RUN_SUPABASE_INTEGRATION_TESTS, 'true')
  assert.deepEqual(expandedCommands('simulate')[0].args, ['run', 'iot:simulate'])
  assert.deepEqual(expandedCommands('simulate-deterministic')[0].args, ['run', 'iot:simulate:once', '--', '--deterministic'])
  assert.deepEqual(expandedCommands('simulate-verify')[0].args, ['run', 'iot:simulate:verify'])
  assert.deepEqual(expandedCommands('heartbeat')[0].args, ['run', 'iot:heartbeat'])
  for (const id of menu) {
    assert.ok(hasSuite(id), `Missing suite: ${id}`)
    for (const command of expandedCommands(id)) {
      assert.ok(fs.existsSync(command.cwd), `Missing working directory: ${command.cwd}`)
      if (command.command === process.execPath) {
        for (const file of command.args.slice(1)) {
          assert.ok(fs.existsSync(path.join(command.cwd, file)), `Missing test file: ${file}`)
        }
      }
    }
  }
  console.log('Runner self-test passed.')
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`${error.message}\n\n${usage()}`)
    return 2
  }

  if (options.help) {
    console.log(usage())
    return 0
  }
  if (options.list) {
    printSuites()
    return 0
  }
  if (options.selfTest) {
    selfTest()
    return 0
  }

  let suiteId = options.suite
  if (!suiteId) {
    if (!process.stdin.isTTY) {
      console.error('Interactive menu requires a terminal. Use --suite <id>.')
      return 2
    }
    suiteId = await chooseSuite()
  }
  if (suiteId === null) return 0
  if (!hasSuite(suiteId)) {
    console.error(`Unknown suite: ${suiteId ?? '(empty)'}. Use --list to see valid IDs.`)
    return 2
  }
  return runSuite(suiteId, options)
}

main()
  .then((status) => { process.exitCode = status })
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
