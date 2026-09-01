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

## Run Tests

Backend:

```bash
cd Backend
npm test
```

Frontend:

```bash
cd Frontend
npm test
npm run build
```

## Test Backend Request Deadlines

Run the deterministic regression tests. They use a local fake slow upstream and do not require or modify hosted Supabase data.

```powershell
cd Backend
node --test tests/request-deadline.api.test.js tests/env.test.js
```

Expected result: **10 tests pass**.

Expected behavior:

- An ordinary `/api` request whose Supabase HTTP work exceeds the configured deadline is cancelled and returns HTTP `504` with `error.code: "UPSTREAM_TIMEOUT"`.
- The response message is safe for users and does not expose database, credential, or internal error details.
- If the client disconnects first, the backend cancels the outstanding upstream HTTP request.
- A response that already committed headers, such as an SSE stream, remains open past the ordinary request deadline and follows its own stream controls.
- `API_REQUEST_TIMEOUT_MS` defaults to `12000` and accepts only `500` through `14000`, keeping the backend deadline below the frontend's 15-second timeout.

Previous behavior: most Supabase work had no request-scoped server deadline, so it could continue consuming backend resources after the frontend stopped waiting.

Current behavior: ordinary API work has one bounded request lifecycle shared with Supabase HTTP calls. This verifies HTTP cancellation locally; staging verification is still required to determine how quickly hosted Supabase stops a PostgreSQL statement that was already executing.

## Check Supabase Structure

Read-only integration checks skip unless enabled:

```bash
cd Backend
npm run test:integration
```

To run them against the configured Supabase project:

```bash
$env:RUN_SUPABASE_INTEGRATION_TESTS='true'
npm run test:integration
```

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

Apply database migrations `011`, `012`, `013`, and `014` in numeric order before running the completed Phase 3 backend. Migration `013` repairs Supabase heartbeat hashing. Migration `014` replaces sequential watchdog requests with one service-role-only batched evaluation. Take a backup and use a disposable staging copy first. Do not apply destructive rollback SQL; disable the feature and repair forward.

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

The simulator uses the existing `IOT_SIM_S01_KEY` through `IOT_SIM_S05_KEY` secrets. Optional `IOT_SIM_S##_ACTIVE=false` values simulate no activity while keeping device connectivity alive. `IOT_SIM_BOOT_COUNTER` must be a positive decimal string and must increase when simulating a new device boot generation.

As an Admin, inspect bounded aggregate diagnostics:

```text
GET /api/operations/watchdog
```

The response uses a nested `watchdog.counters` object, returns aggregate states only, and sends `Cache-Control: no-store`. In disabled mode, verify `running: false`, `lastOutcome: "idle"`, `counters.cycles: 0`, and `states: {}` while heartbeat ingestion continues normally.

Do not switch directly from disabled to enforce. Verify heartbeat ordering and connectivity first, then run observe mode against the manual log. Enforcement requires separate physical calibration and parallel-run approval. S-05 must never have absence detection enabled.

If the watchdog behaves unsafely:

1. Set `WATCHDOG_MODE=disabled` and restart the backend.
2. Preserve settings history, watchdog runtime/transition evidence, downtime, alerts, and audits.
3. Reconcile any committed watchdog-owned downtime through the authorized workflow.
4. Diagnose with safe aggregate diagnostics and server logs.
5. Correct forward with reviewed code or a new migration.

## Phase 4 Settings and Live Feed Checks

Apply migration `015` after migration `014` before deploying the Phase 4 backend. Review it first and use a backup or disposable staging database. It adds a read-only service-role snapshot and has no destructive rollback.

Start the backend with `WATCHDOG_MODE=disabled`, log in as Admin, then verify:

1. Settings loads Spiral Mill 01 and shows Watchdog disabled.
2. S-05 trigger and recovery inputs are locked.
3. A reviewed harmless settings change saves once and increments the version once.
4. A stale browser version receives a conflict, retains the draft, and requires Reload latest.
5. `GET /api/iot/live` returns `Cache-Control: no-store`, one machine, and five sensors.
6. Live Feed refreshes every 15 seconds, never overlaps requests, and pauses in a hidden tab.
7. Disconnecting the network keeps the last snapshot visible with a stale-data warning.
8. Production Supervisor can read Live Feed but cannot access the Admin Settings route.

Focused local checks:

```powershell
cd Backend
node --test tests/live-monitoring-snapshot.migration.pglite.test.js tests/database.contract.test.js tests/iot.service.test.js tests/settings.service.test.js tests/api.test.js

cd ../Frontend
npm.cmd test -- src/features/dashboard/settings/SettingsSection.test.jsx src/features/dashboard/settings/settingsUtils.test.js
npm.cmd test -- src/features/dashboard/live/LiveSection.test.jsx src/features/dashboard/live/livePresentation.test.js
npm.cmd run build
```

The Settings page does not change `WATCHDOG_MODE`. Do not use enforce mode as a UI test. Enforcement still requires the Phase 3 physical calibration, concurrency, soak, and parallel-run approvals.

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
