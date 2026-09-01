# Runbook

Use this file for common development tasks.

## Start Backend

```bash
cd Backend
npm run dev
```

## Start Frontend

```bash
cd Frontend
npm run dev
```

## Required Test Suite

Backend: verifies all API, database, security, analytics, watchdog, health, and shutdown behavior. Expected: `0 fail` (current baseline: 308 tests).

```bash
cd Backend
npm test
```

Frontend: verifies UI behavior and production compilation. Expected: all tests pass (current baseline: 250 tests) and Vite build completes.

```bash
cd Frontend
npm test
npm run build
```

Documentation: run after editing public docs. Expected: `0 fail`.

```bash
cd Backend
node --test tests/contracts/documentation.contract.test.js
```

## Focused Backend Tests

### Request deadlines

Verifies safe `504 UPSTREAM_TIMEOUT`, upstream cancellation, disconnect handling, SSE exemption, and timeout configuration. Simulated timeout warnings are expected.

```bash
cd Backend
node --test tests/request-deadline.api.test.js tests/env.test.js
```

Expected: `0 fail`.

### Health and readiness

Verifies liveness, bounded readiness, schema version 24, critical dependencies, safe `503`, and service-role-only migration access. Negative-case warnings are expected.

```bash
cd Backend
node --test tests/health.api.test.js tests/health-readiness.migration.pglite.test.js tests/env.test.js
```

Expected: `0 fail`. Apply migration `024_add_backend_readiness_check.sql` after migration `023` before hosted readiness checks.

```bash
curl -i http://localhost:3000/api/health/live
curl -i http://localhost:3000/api/health/ready
```

Expected: liveness returns HTTP `200`. Readiness returns HTTP `200` only when Supabase and migration 024 are ready; otherwise safe HTTP `503`.

### Graceful shutdown

Verifies normal drain, duplicate signals, forced deadline, cleanup failure, and listen-error handling.

```bash
cd Backend
node --test tests/server-lifecycle.test.js tests/env.test.js
```

Expected: `0 fail`.

Manual check: start Node directly, then press `Ctrl+C`.

```bash
cd Backend
node src/server.js
```

Expected logs:

```text
API server shutdown started.
API server shutdown completed.
```

### Phase 3 watchdog and heartbeat

Verifies heartbeat contracts, watchdog transitions, planned breaks, S-05 protection, and SSE shutdown.

```bash
cd Backend
node --test tests/heartbeat.api.test.js tests/heartbeat.service.test.js tests/watchdog.repository.test.js tests/watchdog.service.test.js tests/sse.test.js
```

Expected: `0 fail`.

### Phase 4 settings and live feed

Verifies settings validation, snapshot migration, live feed, and API authorization.

```bash
cd Backend
node --test tests/live-monitoring-snapshot.migration.pglite.test.js tests/database.contract.test.js tests/iot.service.test.js tests/settings.service.test.js tests/api.test.js
```

Expected: `0 fail`.

```bash
cd Frontend
npm test -- src/features/dashboard/settings/SettingsSection.test.jsx src/features/dashboard/settings/settingsUtils.test.js
npm test -- src/features/dashboard/live/LiveSection.test.jsx src/features/dashboard/live/livePresentation.test.js
npm run build
```

Expected: focused tests pass and production build completes.

## Hosted Supabase Integration

Default command skips hosted checks unless enabled.

```bash
cd Backend
npm run test:integration
```

Run against configured Supabase from a terminal:

```bash
cd Backend
RUN_SUPABASE_INTEGRATION_TESTS=true npm run test:integration
```

Expected: `0 fail`. Never target an unreviewed production database.

## Simulate ESP32 Events

```bash
cd Backend
npm run iot:simulate:once
```

The simulator randomly chooses which of the 5 sensors reports a downtime/fault event in each batch. Use deterministic mode when you need a repeatable debug sequence:

```bash
npm run iot:simulate:once -- --deterministic
```

To verify realtime alerts, keep the dashboard open and run the loop simulator:

```bash
cd Backend
npm run iot:simulate
```

The selected issue sensor should appear in the dashboard notification bell. The simulator sends the new issue before recovery events so the bell can show the newest issue quickly. Later active/recovered events mark previous simulator alerts as recovered; if a recovered alert was not acknowledged yet, it stays visible until a user acknowledges it.

## Phase 3 Heartbeat and Watchdog Checks

Apply migrations `011`–`014` in order using a backup and staging first. Keep watchdog disabled until heartbeat and manual-log checks pass. Repair forward; do not use destructive rollback SQL.

Keep the first deployment disabled:

```env
IOT_HEARTBEAT_EXPECTED_INTERVAL_MS=10000
IOT_HEARTBEAT_STALE_AFTER_MS=30000
WATCHDOG_MODE=disabled
WATCHDOG_TICK_INTERVAL_MS=5000
WATCHDOG_EVALUATION_TIMEOUT_MS=4000
```

Send one authenticated heartbeat batch:

```bash
cd Backend
npm run iot:heartbeat:once
```

Run continuous heartbeat simulation:

```bash
npm run iot:heartbeat
```

The simulator uses `IOT_SIM_S01_KEY` through `IOT_SIM_S05_KEY`. Set `IOT_SIM_S##_ACTIVE=false` to simulate inactivity while keeping connectivity. Increase positive `IOT_SIM_BOOT_COUNTER` for each simulated reboot.

As an Admin, inspect bounded aggregate diagnostics:

```text
GET /api/operations/watchdog
```

Expected in disabled mode: `running: false`, `lastOutcome: "idle"`, `counters.cycles: 0`, and `states: {}` while heartbeats continue. Response must use `Cache-Control: no-store`.

Move from disabled to observe only after heartbeat checks. Enforce requires physical calibration and parallel-run approval. Never enable absence detection for S-05.

If the watchdog behaves unsafely:

1. Set `WATCHDOG_MODE=disabled` and restart the backend.
2. Preserve settings history, watchdog runtime/transition evidence, downtime, alerts, and audits.
3. Reconcile any committed watchdog-owned downtime through the authorized workflow.
4. Diagnose with safe aggregate diagnostics and server logs.
5. Correct forward with reviewed code or a new migration.

## Phase 4 Settings and Live Feed Checks

Apply migration `015` after `014` in staging first. It adds the service-role live snapshot.

Start the backend with `WATCHDOG_MODE=disabled`, log in as Admin, then verify:

1. Settings loads Spiral Mill 01 and shows Watchdog disabled.
2. S-05 trigger and recovery inputs are locked.
3. A reviewed harmless settings change saves once and increments the version once.
4. A stale browser version receives a conflict, retains the draft, and requires Reload latest.
5. `GET /api/iot/live` returns `Cache-Control: no-store`, one machine, and five sensors.
6. Live Feed refreshes every 15 seconds, never overlaps requests, and pauses in a hidden tab.
7. Disconnecting the network keeps the last snapshot visible with a stale-data warning.
8. Production Supervisor can read Live Feed but cannot access the Admin Settings route.

Settings does not change `WATCHDOG_MODE`. Do not use enforce mode as a UI test; physical calibration, concurrency, soak, and parallel-run approval remain required.

## Deployment Planning

Current production direction:

```text
React Dashboard -> Express Backend -> PostgreSQL Database
ESP32 Devices -> Express Backend -> PostgreSQL Database
```

For a public deployment, use separate frontend and API domains:

```text
https://petrohydropipe-monitoring.com
https://api.petrohydropipe-monitoring.com
```

Keep Supabase as database-only unless the architecture is revisited. Keep auth in Express.

See [DEPLOYMENT_AUTH_PLANNING.md](./DEPLOYMENT_AUTH_PLANNING.md).

## Common Issues

### 401 on Dashboard APIs

Usually means the frontend still has an old token. Log out and log back in.

### 401 on ESP32 Simulation

Usually means the simulator keys in `Backend/.env` do not match `sensors.device_key_hash` in Supabase.

### Frontend Cannot Reach Backend

Check `Frontend/.env`:

```env
VITE_API_BASE_URL=http://localhost:3000
```

Check backend CORS:

```env
CORS_ORIGIN=http://localhost:5173
```
