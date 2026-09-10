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
const BACK_SELECTION = Symbol('back')

const npm = (...args) => ({ command: 'npm', args, cwd: backend })
const nodeTest = (...files) => ({ command: process.execPath, args: ['--test', ...files], cwd: backend })
const nodeTestNamed = (namePattern, ...files) => ({
  command: process.execPath,
  args: ['--test', '--test-name-pattern', namePattern, ...files],
  cwd: backend,
  testFiles: files,
})

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
  'simulate-short-material-pause': {
    name: 'Test short material pause (local)',
    description: 'Uses an isolated clock to confirm a process sensor returns from Idle to Active before its threshold. Does not contact configured backend.',
    expected: 'Process sensor returns from Idle to Active before threshold.',
    commands: [nodeTestNamed(
      'confirmed healthy activity returns a process sensor from grace Idle to Active',
      'tests/process-absence.migration.pglite.test.js',
    )],
  },
  'simulate-material-fault': {
    name: 'Test material fault (local)',
    description: 'Uses an isolated clock to confirm S-01, S-02, and S-04 stay Idle before threshold, then become process Faults at threshold. Does not contact configured backend.',
    expected: 'Process Fault alert only; no machine downtime.',
    commands: [nodeTestNamed(
      'is Idle before threshold and one process Fault at threshold',
      'tests/process-absence.migration.pglite.test.js',
    )],
  },
  'simulate-short-machine-stop': {
    name: 'Test short machine stop (local)',
    description: 'Uses an isolated clock to confirm S-03 is Idle during a short stop and opens one interval only at its threshold. Does not contact configured backend.',
    expected: 'Short stop is Idle; threshold creates one S-03 downtime record.',
    commands: [nodeTestNamed(
      'S-03 short absence is Idle and confirmed absence opens one interval at the crossing',
      'tests/machine-authority.migration.pglite.test.js',
    )],
  },
  'simulate-planned-break': {
    name: 'Test planned break (local)',
    description: 'Uses an isolated clock to confirm break start, end, and post-break grace reset absence timing. Does not contact configured backend.',
    expected: 'Break timing suspends absence; post-break grace restarts it.',
    commands: [nodeTestNamed(
      'break start, break end and grace end preserve exact absence boundaries',
      'tests/machine-authority.migration.pglite.test.js',
    )],
  },
  'simulate-offline-reconnect': {
    name: 'Test offline and reconnect (local)',
    description: 'Uses an isolated clock to confirm reconnect starts a new absence baseline without inventing activity. Does not contact configured backend.',
    expected: 'Reconnect starts an absence baseline without inventing activity.',
    commands: [nodeTestNamed(
      'reconnect starts absence measurement at confirmed receipt without inventing activity',
      'tests/sensor-observation-contract.migration.pglite.test.js',
    )],
  },
  'simulate-demo-once': {
    name: 'Send random sensor events once (live)',
    description: 'Sends one random set of sensor events to the configured backend.',
    expected: 'One batch is sent; it may create faults or downtime.',
    simulation: true,
    commands: [npm('run', 'iot:simulate:demo-once')],
  },
  'simulate-recover-active-faults': {
    name: 'Recover active sensor faults (live)',
    description: 'Finds faulted S-01 to S-04 sensors and sends recovery events for them.',
    expected: 'Current process-sensor faults recover; no events are sent when none are faulted.',
    simulation: true,
    commands: [npm('run', 'iot:simulate:recover-active-faults')],
  },
  'simulate-process-isolation': {
    name: 'Test one process fault (live)',
    description: 'Faults S-01, then sends its recovery event.',
    expected: 'S-01 becomes a process fault and creates no downtime.',
    simulation: true,
    commands: [npm('run', 'iot:simulate:process-isolation')],
  },
  'simulate-grouped-lifecycle': {
    name: 'Test three process faults (live)',
    description: 'Faults S-01, S-04, and S-02 one at a time, then recovers them.',
    expected: 'The third fault opens S-03 downtime; recoveries close it.',
    simulation: true,
    commands: [npm('run', 'iot:simulate:verify-grouped-lifecycle')],
  },
  'simulate-direct-s03-lifecycle': {
    name: 'Test direct S-03 downtime (live)',
    description: 'Faults S-03, tests duplicate and stale events, then recovers it.',
    expected: 'S-03 opens downtime directly; recovery closes it.',
    simulation: true,
    commands: [npm('run', 'iot:simulate:verify-direct-s03-lifecycle')],
  },
  'simulate-demo-continuous': {
    name: 'Send random sensor events continuously (live)',
    description: 'Keeps sending random sensor events until Ctrl+C.',
    expected: 'Events continue until cancelled and may create faults or downtime.',
    simulation: true,
    commands: [npm('run', 'iot:simulate:demo-continuous')],
  },
  'heartbeat-once': {
    name: 'Send one heartbeat batch (live)',
    description: 'Sends one authenticated heartbeat batch to the configured backend.',
    expected: 'One heartbeat batch updates device runtime state.',
    simulation: true,
    commands: [npm('run', 'iot:heartbeat:once')],
  },
  heartbeat: {
    name: 'Send heartbeats continuously (live)',
    description: 'Keeps sending authenticated heartbeats until Ctrl+C.',
    expected: 'Heartbeats continue until cancelled.',
    simulation: true,
    commands: [npm('run', 'iot:heartbeat')],
  },
})

const menu = Object.freeze([
  'all', 'backend', 'frontend', 'docs', 'deadlines', 'health',
  'shutdown', 'phase3', 'phase4', 'integration', 'hosted', 'manual',
  'simulate-short-material-pause', 'simulate-material-fault', 'simulate-short-machine-stop', 'simulate-planned-break', 'simulate-offline-reconnect',
  'simulate-demo-once', 'simulate-recover-active-faults', 'simulate-process-isolation', 'simulate-direct-s03-lifecycle', 'simulate-grouped-lifecycle', 'simulate-demo-continuous',
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
    suites: [
      'simulate-short-material-pause', 'simulate-material-fault', 'simulate-short-machine-stop', 'simulate-planned-break', 'simulate-offline-reconnect',
      'simulate-demo-once', 'simulate-recover-active-faults', 'simulate-process-isolation', 'simulate-direct-s03-lifecycle', 'simulate-grouped-lifecycle', 'simulate-demo-continuous',
      'heartbeat-once', 'heartbeat',
    ],
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

function submenuSelection(selection, available) {
  const value = selection.trim().toLowerCase()
  if (value === '9' || value === 'back') return BACK_SELECTION
  if (/^\d+$/.test(value) && Number(value) > 9) return available[Number(value) - 2]
  return suiteIdFromSelection(value, available)
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
  available.forEach((id, index) => console.log(`${String(index < 8 ? index + 1 : index + 2).padStart(2)}. ${suites[id].name}`))
  console.log(' 9. Back')
  console.log(' 0. Exit')
  const answer = await prompt.question('\nChoose option: ')
  prompt.close()
  return submenuSelection(answer, available)
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
  assert.equal(suiteIdFromSelection('1', categories.simulations.suites), 'simulate-short-material-pause')
  assert.equal(suiteIdFromSelection('health', categories.simulations.suites), undefined)
  assert.equal(suiteIdFromSelection('__proto__'), undefined)
  assert.equal(suiteIdFromSelection('health & whoami'), undefined)
  assert.equal(suiteIdFromSelection('999'), undefined)
  assert.equal(suiteIdFromSelection('0'), null)
  assert.equal(submenuSelection('9', categories.simulations.suites), BACK_SELECTION)
  assert.equal(submenuSelection('back', categories.tests.suites), BACK_SELECTION)
  assert.equal(submenuSelection('8', categories.simulations.suites), 'simulate-process-isolation')
  assert.equal(submenuSelection('10', categories.simulations.suites), 'simulate-direct-s03-lifecycle')
  assert.equal(submenuSelection('14', categories.simulations.suites), 'heartbeat')
  assert.equal(submenuSelection('10', categories.tests.suites), categories.tests.suites[8])
  assert.equal(submenuSelection('11', categories.tests.suites), categories.tests.suites[9])
  assert.equal(expandedCommands('all').length, 3)
  assert.equal(expandedCommands('all').some((command) => command.env?.RUN_SUPABASE_INTEGRATION_TESTS), false)
  assert.equal(expandedCommands('hosted')[0].env.RUN_SUPABASE_INTEGRATION_TESTS, 'true')
  assert.deepEqual(expandedCommands('simulate-demo-continuous')[0].args, ['run', 'iot:simulate:demo-continuous'])
  assert.deepEqual(expandedCommands('simulate-recover-active-faults')[0].args, ['run', 'iot:simulate:recover-active-faults'])
  assert.deepEqual(expandedCommands('simulate-process-isolation')[0].args, ['run', 'iot:simulate:process-isolation'])
  assert.deepEqual(expandedCommands('simulate-grouped-lifecycle')[0].args, ['run', 'iot:simulate:verify-grouped-lifecycle'])
  assert.deepEqual(expandedCommands('simulate-direct-s03-lifecycle')[0].args, ['run', 'iot:simulate:verify-direct-s03-lifecycle'])
  assert.deepEqual(expandedCommands('simulate-short-material-pause')[0].args, [
    '--test', '--test-name-pattern', 'confirmed healthy activity returns a process sensor from grace Idle to Active',
    'tests/process-absence.migration.pglite.test.js',
  ])
  assert.deepEqual(expandedCommands('simulate-material-fault')[0].args, [
    '--test', '--test-name-pattern', 'is Idle before threshold and one process Fault at threshold',
    'tests/process-absence.migration.pglite.test.js',
  ])
  assert.deepEqual(expandedCommands('simulate-short-machine-stop')[0].args, [
    '--test', '--test-name-pattern', 'S-03 short absence is Idle and confirmed absence opens one interval at the crossing',
    'tests/machine-authority.migration.pglite.test.js',
  ])
  assert.deepEqual(expandedCommands('simulate-planned-break')[0].args, [
    '--test', '--test-name-pattern', 'break start, break end and grace end preserve exact absence boundaries',
    'tests/machine-authority.migration.pglite.test.js',
  ])
  assert.deepEqual(expandedCommands('simulate-offline-reconnect')[0].args, [
    '--test', '--test-name-pattern', 'reconnect starts absence measurement at confirmed receipt without inventing activity',
    'tests/sensor-observation-contract.migration.pglite.test.js',
  ])
  for (const id of ['simulate-short-material-pause', 'simulate-material-fault', 'simulate-short-machine-stop', 'simulate-planned-break', 'simulate-offline-reconnect']) {
    assert.equal(suites[id].simulation, undefined)
  }
  assert.deepEqual(expandedCommands('heartbeat')[0].args, ['run', 'iot:heartbeat'])
  for (const id of menu) {
    assert.ok(hasSuite(id), `Missing suite: ${id}`)
    for (const command of expandedCommands(id)) {
      assert.ok(fs.existsSync(command.cwd), `Missing working directory: ${command.cwd}`)
      if (command.command === process.execPath) {
        for (const file of command.testFiles || command.args.slice(1)) {
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

  if (options.suite) {
    if (!hasSuite(options.suite)) {
      console.error(`Unknown suite: ${options.suite}. Use --list to see valid IDs.`)
      return 2
    }
    return runSuite(options.suite, options)
  }

  if (!process.stdin.isTTY) {
    console.error('Interactive menu requires a terminal. Use --suite <id>.')
    return 2
  }

  while (true) {
    const suiteId = await chooseSuite()
    if (suiteId === null) return 0
    if (suiteId === BACK_SELECTION) continue
    if (!suiteId || !hasSuite(suiteId)) {
      console.error(`\nUnknown choice. Use numbers shown in the menu or 0 to exit.`)
      continue
    }
    await runSuite(suiteId, options)
  }
}

main()
  .then((status) => { process.exitCode = status })
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
