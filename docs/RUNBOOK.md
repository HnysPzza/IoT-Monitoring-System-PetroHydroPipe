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

### Telemetry staleness migration 028

Apply `Backend/database/migrations/028_persist_telemetry_staleness.sql` after migration 027, then apply `029_account_onboarding.sql` before deploying the current backend, which requires readiness version 29. Migration 029 requires exactly one active, unarchived Admin. Do not rerun older migrations over 028: they can restore unfiltered readers or older readiness functions. Existing installations use migrations, not the complete `schema.sql`.

For a fresh installation, run `schema.sql` (baseline 028), provision the roles and exactly one active, unarchived Admin with a privately generated bcrypt password hash, then apply 029. The known password in `seed.sql` is only suitable for disposable local development. Do not replay migrations 001 through 028 over the fresh baseline.

The migration runs in one transaction with a two-second lock timeout. If it fails to acquire locks, allow the transaction to roll back and retry during a quiet ingestion window. It does not delete raw events, rewrite historical timestamps, or change sensor roles.

New events receive database-computed `stale = true` when their timestamp is at or behind their sensor's last applied timestamp; otherwise they receive `false`. Both ingestion paths share this insert trigger. Stale rows are excluded from pulse totals, the Analytics start date, and live snapshot selection.

Pre-migration rows remain `NULL` (unclassified) and retain their existing contribution to totals. There is no reliable reconstruction of the original ingestion decision from the final sensor watermark alone. Do not mark every older row stale or silently erase those counts. Historical repair needs separate evidence and review. Legitimate newly delayed pulses are also excluded under this conservative policy; offline reconciliation is not implemented.

Run local regressions from `Backend`:

```powershell
node --test --test-concurrency=1 tests/telemetry-staleness.migration.pglite.test.js tests/health.api.test.js
node --test --test-concurrency=1 tests/*.test.js tests/contracts/*.test.js
```

For the real-connection concurrency check, point `TELEMETRY_REVIEW_PG_PORT`, `TELEMETRY_REVIEW_PSQL`, and `TELEMETRY_REVIEW_PG_USER` at a disposable local PostgreSQL cluster, then run `node --test tests/integration/telemetry-staleness.concurrency.test.js`. It creates and drops its own test database and requires database-creation privileges. Without the port variable, it explicitly skips. Local PostgreSQL 18 verification passed concurrent ingestion with the older request blocked until the newer event committed.

After applying 028, verify in the project SQL editor:

```sql
select public.get_backend_readiness();
select stale, count(*) from public.sensor_events group by stale;
```

Expected readiness immediately after 028: `28`; after required migration 029: `29`. Only the latter matches the current backend and allows `/api/health/ready` to return 200. The grouped query exposes existing unclassified rows without changing them. A missing or disabled classification trigger makes readiness fail closed. A passing readiness check is a schema check, not a historical-data certification.

### Health and readiness (historical migration 024 checks)

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

## Database Secrets and Recovery Verification

For development, keep runtime secrets in the ignored backend environment file with filesystem access limited to the developer. Never copy secrets into frontend variables, build artifacts, screenshots, logs, or documentation. Git ignore rules do not encrypt files or remove previous exposure.

For deployment, inject `SUPABASE_SERVICE_ROLE_KEY` and `JWT_SECRET` through the hosting provider's protected environment configuration. Restrict dashboard/operator access and separate development credentials. Missing required production values must prevent startup. Environment injection does not protect a compromised running backend. If exposure is confirmed, rotate the affected key and verify dependent services; do not paste the value into a ticket.

### Synthetic Restore Drill

From `Backend`, with a local PostgreSQL installation:

```powershell
$env:RECOVERY_PG_BIN = 'C:\Program Files\PostgreSQL\18\bin'
node --test tests/integration/database-recovery.test.js
Remove-Item Env:\RECOVERY_PG_BIN
```

This opt-in test creates its own temporary cluster bound to loopback on a temporary port, uses synthetic records only, dumps `recovery_source`, and restores into a separate empty `recovery_target`. It never loads application environment credentials or connects to Supabase. Local trust authentication is used only for this disposable synthetic cluster. Shutdown runs through test cleanup; the diagnostic output identifies retained temporary evidence. Do not expose this cluster to a network or use it for real data.

The drill verifies 10,000 downtime records, foreign keys, audit/settings rows, RLS, denied client-role access, restricted backend writes, and refresh-token rotation after restoration. PostgreSQL roles are bootstrapped separately: a database-only dump is not a backup of cluster-global roles. A schema-based fixture demonstrates that snapshot, not every historical migration path.

September 5, 2026 result: passed on PostgreSQL 18.1; `pg_restore` took 934ms. This excludes cluster creation, application validation and operational recovery. It is not a production recovery-time guarantee.

### Actual Project Recovery Gate

Before deployment, record the selected backup mechanism, most recent successful backup, retention, encryption/access policy, and exactly what it includes (database, roles/configuration, and any external storage). Actual vendor backup coverage remains unverified. Keep backup files outside Git and the Obsidian vault.

Agree the maximum acceptable data loss (RPO) and service recovery time (RTO) with the project owner; both remain unset until that decision. Choose backup frequency and retention to meet them, rather than assuming a vendor default is sufficient.

For a real drill, confirm a disposable restore target distinct from the source, restore an actual project backup there, then verify record counts, relationships, schema/RPC versions, grants, negative client-role access, and representative application reads. Record backup timestamp, recoverable cutoff, total elapsed recovery time, and failures. Never overwrite the source database. Synthetic test success does not close this gate.

### Downtime Performance Scope

The list computes detailed metrics only for returned rows, while summaries still cover all matching records. Full-history fetching remains. See [Database Loading Improvement Evidence](./Database%20Loading%20Improvement%20Evidence.md) for measurements and the SQL parity stop condition. No new migration is required for this incremental change.
