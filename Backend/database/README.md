# Database Setup

This folder contains the Supabase/PostgreSQL database foundation for the PetroHydroPipe IoT monitoring system through Phase 4.

## Files

- `schema.sql` creates the first required tables, constraints, indexes, and timestamp triggers.
- `seed.sql` inserts the base roles, one admin account, one machine, and five sensors.
- `device_key_setup.sql` updates the five sensors with bcrypt hashes for ESP32 device authentication.
- `migrations/001_add_sensor_device_keys.sql` adds `sensors.device_key_hash` to an existing Phase 2 database.
- `migrations/002_update_sensor_identity_labels.sql` aligns existing sensor labels with the Phase 9 identity map.
- `migrations/003_add_user_archiving.sql` adds archive fields so user accounts are hidden without deleting history.
- `migrations/004_supabase_security_cleanup.sql` fixes Supabase advisor warnings for function permissions/search path and adds a downtime sensor index.
- `migrations/005_create_alerts.sql` adds persistent alert acknowledgement records for realtime dashboard notifications.
- `migrations/006_downtime_open_record_unique_index.sql` adds idempotent event IDs, atomic IoT/downtime RPCs, and downtime state constraints.
- `migrations/007_alert_sync_integrity.sql` makes IoT state, downtime, alert, and transition audits atomic; adds recorded-time ordering, transactional alert revisions, acknowledgement, and one-statement alert snapshots.
- `migrations/008_harmonize_plant_sensor_labels.sql` applies the canonical plant sensor labels.
- `migrations/009_align_sensor_downtime_causes.sql` assigns future filler-wire faults to `Consumable Shortage`.
- `migrations/010_create_machine_operational_settings.sql` adds versioned per-machine thresholds and shift schedules plus an atomic settings/audit RPC.
- `migrations/011_add_settings_history_and_watchdog_runtime.sql` adds effective-dated settings history, bounded heartbeat/watchdog state, transition evidence, and atomic heartbeat ingestion.
- `migrations/012_add_atomic_watchdog_transitions.sql` adds downtime ownership and atomic disabled/observe/enforce watchdog evaluation.
- `migrations/013_fix_heartbeat_digest_schema.sql` repairs heartbeat hashing for Supabase's `extensions.pgcrypto` layout.
- `migrations/014_add_batched_watchdog_evaluation.sql` adds one service-role-only watchdog cycle RPC with isolated sensor failures and aggregate state counts.
- `migrations/015_add_live_monitoring_snapshot.sql` adds one service-role-only read snapshot for M-01, its five latest sensor events, and watchdog state.
- `migrations/016_protect_base_tables.sql` denies browser roles direct access to backend-owned base tables.
- `migrations/017_secure_downtime_update_rpc.sql` restores controlled downtime updates through a service-role-only RPC.
- `migrations/018_add_manual_sensor_recovery_override.sql` adds atomic, audited manual recovery without imitating an IoT event.
- `migrations/019_add_analytics_event_aggregation.sql` adds secured event aggregation for backend Analytics.
- `migrations/020_add_analytics_all_time_range.sql` adds the first contributing-record lookup for all-time Analytics.
- `migrations/021_add_managing_director_role.sql` adds the PRD-required Managing Director role for read-only operational access.
- `migrations/022_require_reviewed_cause_before_resolve.sql` prevents unresolved S-03 causes from being silently finalized.
- `migrations/023_route_no_pulse_through_watchdog.sql` prevents `no_pulse` observations from bypassing schedule-aware watchdog evaluation.
- `migrations/025_prevent_s05_downtime.sql` keeps S-05 issue telemetry observational and blocks new S-05 downtime rows.

## Tables

- `roles`: system roles used for dashboard access control.
- `users`: account records for admin and authorized personnel.
- `machines`: monitored production machines.
- `sensors`: five ESP32-backed sensor records assigned to a machine, including backend-only device key hashes.
- `sensor_events`: timestamped events received from sensors.
- `downtime_events`: machine downtime records with start/end timestamps and duration.
- `production_counts`: summarized production counts for dashboard/reporting windows.
- `audit_logs`: user/system activity history for accountability.
- `alerts`: active, acknowledged, and resolved operational alerts.
- `alert_revision_state`: service-role-only singleton counter for transactional global alert revisions.
- `machine_operational_settings`: service-role-readable per-machine sensor thresholds, shift schedule, version, and updater metadata.
- `machine_operational_settings_history`: immutable settings versions with effective intervals for stable historical metrics.
- `sensor_watchdog_state`: one bounded current heartbeat, connectivity, absence, and recovery state row per sensor.
- `sensor_watchdog_transitions`: bounded transition evidence for observation, connectivity, downtime, and recovery decisions.

## How To Run In Supabase

1. Open your Supabase project.
2. Go to SQL Editor.
3. Copy and run `schema.sql`.
4. Copy and run `seed.sql`.
5. For existing databases, run migration files in order from `Backend/database/migrations/`.
6. Generate one secret per ESP32, bcrypt-hash each secret locally, replace the placeholders in `device_key_setup.sql`, then run it.
7. Confirm the seeded rows:
   - 5 roles
   - 1 admin user
   - 1 machine
   - 5 sensors

For migration `006`, run it in staging first. It stops without changing the database if duplicate open downtime rows exist. After applying it, verify the database contract from `Backend`:

```bash
npm run db:verify:downtime
```

Deploy the backend only after verification passes. To roll back the application, deploy the previous backend version first. The added column, constraints, indexes, and functions can remain in place because they are backward-compatible with earlier read paths; do not drop `device_event_id` after new events have been ingested.

### Migration 007 deployment and verification

Apply migrations in numeric order. Migration `007` must be deployed together with the backend and frontend versions that use `ingest_iot_sensor_event`, `acknowledge_alert`, `get_alerts_snapshot`, and revisioned alert responses. It moves alert and transition-audit writes into the ingestion RPC, so the previous backend is unsafe against the migrated contract because it can run obsolete secondary alert/audit logic.

Use this rollout order in a tested maintenance window:

1. Quiesce IoT ingestion and alert acknowledgement writers so no transition enters during the contract change.
2. Take a database backup and verify the migration and restore plan on a disposable staging copy.
3. Apply migration `007`.
4. Deploy the revision-aware backend.
5. Verify backend health, ingestion, snapshot, acknowledgement, and post-commit publication contracts.
6. Deploy and verify the revision-aware frontend.
7. Resume IoT ingestion and alert acknowledgement writers.

Migration `007` has no supplied down migration. The pre-`007` backend is incompatible with the new ownership because it can repeat alert and audit work. After real writes occur, rollback requires a staging-tested database restore plus data-reconciliation plan; otherwise roll forward. Do not deploy the previous backend alone after `007`.

Migration `007` adds:

- `sensors.last_applied_recorded_at`, backfilled from the latest stored sensor event.
- `alerts.revision` and the locked `alert_revision_state` singleton. Revisions are transactional and globally ordered; they are not sequence values.
- Atomic, service-role-only `ingest_iot_sensor_event` and `acknowledge_alert` RPCs.
- Service-role-only `get_alerts_snapshot`, which returns alert rows and SQL field `snapshot_revision` from one statement with revisions cast to decimal strings. Express maps it to API property `snapshotRevision`.
- RLS and least-privilege grants for the revision counter and RPC boundary.

Run the local database and backend gates from `Backend` before staging:

```bash
node --test tests/alert-sync.migration.pglite.test.js tests/downtime.migration.pglite.test.js
npm test
```

PGlite verifies SQL execution, rollback, lifecycle, stale/duplicate handling, revision continuity, and privileges. Its `Promise.all` calls on one in-process database are serialized; they are not proof of real multi-connection PostgreSQL locking or deadlock behavior.

Before deployment, use a disposable real PostgreSQL staging database to run true multi-connection repeated-fault and acknowledgement-versus-recovery races. Verify one unresolved alert, lifecycle correctness, contiguous committed revisions, and no deadlock. This is a mandatory pre-deployment gate. Do not run concurrency attacks against the configured production Supabase project.

### Migrations 008 and 009

Migration `008` uses this sensor map:

- S-01 Raw Material and Coil Joint
- S-02 Inside Filler Wire
- S-03 Machine Main Sensor
- S-04 Outside Filler Wire
- S-05 Production Output Cutting

Migration `009` maps future S-02 and S-04 downtime faults to `Consumable Shortage`. S-03 faults remain `Pending Cause Review`. Existing historical cause values are preserved for reporting.

Migrations `008` and `009` have no supplied down migrations. Correct future changes with a new forward migration.

Run the focused checks from `Backend`:

```bash
node --test tests/downtime-cause.migration.pglite.test.js tests/downtime.model.test.js
```

### Migration 010

Apply migration `010` before deploying the machine-settings API. It requires the existing M-01 machine row and fails without changing the database if M-01 is missing. It provisions one M-01 settings row, enables RLS, grants service-role reads, and requires all changes to use the atomic `update_machine_operational_settings` RPC.

Migration `010` is forward-only. Do not add a destructive down migration that drops operational settings or audit history. Correct later changes with a new forward migration.

Run the focused checks from `Backend`:

```bash
node --test tests/settings.migration.pglite.test.js tests/settings.validation.test.js tests/settings.service.test.js
```

### Migrations 011 through 014

Apply migration `011` before deploying the heartbeat API. It reconstructs settings history, adds one current runtime row per sensor, and replaces the settings RPC so settings, history, and audit changes remain atomic. Migration `012` adds transition ownership and the atomic per-sensor evaluator. Migration `013` repairs heartbeat hashing for hosted Supabase. Migration `014` wraps the per-sensor evaluator in one batched cycle RPC.

All four migrations are forward-only. Do not drop settings history, runtime evidence, downtime, alerts, or audits during rollback. Disable the application behavior with `WATCHDOG_MODE=disabled`, then repair forward.

Required deployment order:

1. Back up and test a disposable staging copy.
2. Apply migration `011` and verify its history/runtime rows.
3. Apply migration `012` and verify its evaluator, ownership, and privilege contracts.
4. Apply migration `013` and verify authenticated heartbeat hashing.
5. Apply migration `014` and verify its batch, isolation, and privilege contracts.
6. Deploy this completed backend with `WATCHDOG_MODE=disabled`.
7. Verify heartbeats from the simulator or firmware without enabling absence detection.
8. Use `WATCHDOG_MODE=observe` only after heartbeat behavior is stable.
9. Use `WATCHDOG_MODE=enforce` only after physical calibration and parallel-run approval for each enabled sensor. Never enable S-05 absence detection.

Apply migrations `011`, `012`, `013`, and `014` in order before deploying the completed Phase 3 backend. Disabled mode does not call the evaluator, but the full schema must be present before a later switch to observe mode.

Focused automated checks:

```bash
node --test tests/watchdog-runtime.migration.pglite.test.js tests/watchdog-transition.migration.pglite.test.js tests/watchdog-batch.migration.pglite.test.js
node --test tests/heartbeat.api.test.js tests/heartbeat.service.test.js tests/watchdog.repository.test.js tests/watchdog.service.test.js
node --test tests/operationalTime.test.js tests/operationalMetrics.test.js tests/operationalRepositories.test.js
```

### Migration 013

Apply migration `013` after migrations `011` and `012`. Migration `011` originally referenced `digest` without its Supabase `extensions` schema, causing heartbeat ingestion to return PostgreSQL error `42883`. Migration `013` replaces only the heartbeat RPC with `extensions.digest(...)`, keeps its restricted security-definer search path, and reapplies service-role-only execution privileges.

Migration `013` is safe to reapply and does not delete or rewrite heartbeat runtime data. Do not rerun or edit an already-applied migration `011`.

Run the focused regression from `Backend`:

```bash
node --test tests/watchdog-runtime.migration.pglite.test.js tests/database.contract.test.js tests/heartbeat-simulator.test.js
```

### Migration 014

Apply migration `014` after migration `013`. It adds `evaluate_watchdog_cycle(evaluated_at, mode, stale_after_seconds)`, which evaluates configured sensors in deterministic order through one service-role-only request. Each sensor runs in its own PostgreSQL exception block, so a sensor failure does not undo successful sensor work. The RPC returns only controlled result fields and final aggregate state counts; database messages are not exposed.

Migration `014` reuses `evaluate_sensor_watchdog`, preserves migration `012` compatibility, keeps RLS and direct-mutation restrictions, is safe to reapply, and contains no destructive rollback SQL.

Run the focused regression from `Backend`:

```bash
node --test tests/watchdog-batch.migration.pglite.test.js tests/watchdog.repository.test.js tests/watchdog.service.test.js tests/database.contract.test.js
```

### Migration 015

Apply migration `015` after migration `014` and before deploying the Phase 4 backend. It adds `get_machine_live_snapshot(machine_code)`, which selects the machine, all configured sensors in deterministic order, each sensor's latest event through an independent lateral lookup, and current watchdog state in one read-only result.

The function is service-role-only, uses a fixed security-definer search path, is safe to reapply, mirrors `schema.sql`, and contains no destructive rollback. Public, anon, and authenticated roles cannot execute it.

Run the focused regression from `Backend`:

```bash
node --test tests/live-monitoring-snapshot.migration.pglite.test.js tests/database.contract.test.js tests/iot.service.test.js tests/api.test.js
```

### Migration 016

Apply migration `016_protect_base_tables.sql` after migration `015`. It enables Row Level Security on the nine legacy base tables and revokes all direct table privileges from `public`, `anon`, and `authenticated`. The server-side `service_role` retains only the direct reads and writes used by the Express backend; atomic sensor, downtime, alert, settings, and watchdog writes remain behind their existing security-definer RPCs.

Migration `016` is safe to reapply, fails closed if any required base table is missing, mirrors `schema.sql`, and contains no destructive data changes. It does not expose service-role policies to browser clients.

### Migration 017

Apply migration `017_secure_downtime_update_rpc.sql` after migration `016`. Migration `016` intentionally removes direct `UPDATE` access to `downtime_events`; migration `017` keeps that restriction and changes `update_downtime_record` to a security-definer function so the Express backend can resolve downtime and update approved manual fields through the existing RPC.

Migration `017` is safe to reapply. Execute permission remains revoked from `public`, `anon`, and `authenticated` and is granted only to `service_role`.

### Migration 018

Apply migration `018_add_manual_sensor_recovery_override.sql` after migration `017`. It adds a service-role-only, security-definer recovery override that atomically activates the selected sensor, recalculates its machine, resolves matching open downtime, records alert recovery metadata, and writes the required audit history. A non-empty reason is required.

The override does not insert a sensor event or advance the device event watermark. A later physical `pulse` or `recovered` event continues through the normal IoT ingestion path without duplicating downtime. Migration `018` also restores the security-definer boundary on `acknowledge_alert`, which is required to complete a recovered alert after migration `016` removed direct alert writes.

Run the focused regression from `Backend`:

```bash
node --test tests/base-table-security.migration.pglite.test.js tests/downtime-update-security.migration.pglite.test.js tests/manual-recovery-override.migration.pglite.test.js tests/database.contract.test.js
```

### Migration 023

Apply migration `023` after migration `022` and before accepting future ESP32 traffic. It replaces only the public `ingest_iot_sensor_event` wrapper. Every `downtime/no_pulse` input is routed to observational ingestion, so it can be retained and deduplicated but cannot directly create downtime or an alert. Only `evaluate_sensor_watchdog` may create absence-owned downtime after checking schedule, planned breaks, grace, thresholds, sensor enablement, and the permanent S-05 exclusion.

The migration is forward-only, safe to reapply, does not rewrite historical events or downtime, and preserves immediate `fault/fault` processing for S-01 through S-04. Existing suspicious downtime must be reviewed separately; do not delete operational history automatically.

### Migration 025

Apply migration `025` after migration `024`. S-05 `downtime` and `fault` inputs remain in `sensor_events` as observational history but cannot change sensor or machine operational state, create alerts, or create downtime. A table trigger also rejects new S-05 downtime rows from any database function. Historical S-05 rows remain unchanged and can still be resolved or annotated.

Use this read-only query to identify records that may require administrator review:

```sql
select downtime.id, sensor.sensor_code, downtime.started_at, downtime.status, downtime.cause
from public.downtime_events downtime
join public.sensors sensor on sensor.id = downtime.sensor_id
where downtime.detection_source = 'sensor_event'
  and exists (
    select 1
    from public.sensor_events event
    where event.sensor_id = downtime.sensor_id
      and event.machine_id = downtime.machine_id
      and event.recorded_at = downtime.started_at
      and event.event_type = 'downtime'
      and event.event_value ->> 'signal' = 'no_pulse'
  )
order by downtime.started_at, downtime.id;
```

Run the focused regression from `Backend`:

```bash
node --test tests/watchdog-transition.migration.pglite.test.js
```

## ESP32 Device Keys

For an existing Supabase database created before Phase 6, run `migrations/001_add_sensor_device_keys.sql` before running `device_key_setup.sql`.

Each ESP32 request uses:

```text
x-device-id: esp32-m01-s01
x-device-key: your-device-secret
```

Only the bcrypt hash of each device secret belongs in Supabase. Generate hashes locally with:

```bash
node -e "const bcrypt=require('bcryptjs'); bcrypt.hash(process.argv[1], 10).then(console.log)" "your-device-secret"
```

Paste the generated hashes into `device_key_setup.sql`. Do not commit real plaintext device secrets.

## ESP32 Simulator Before Hardware

Use the backend simulator while the physical ESP32 devices are not built yet.

1. Generate local simulator keys:

   ```bash
   cd Backend
   npm run iot:keys
   ```

2. Copy the printed `IOT_SIM_S01_KEY` to `IOT_SIM_S05_KEY` values into local `Backend/.env`.
3. Copy the printed SQL update statement into Supabase SQL Editor and run it.
4. Start the backend:

   ```bash
   npm run dev
   ```

5. Send one randomized batch of 5 ESP32 events:

   ```bash
   npm run iot:simulate:once
   ```

6. Or keep sending randomized events on an interval:

   ```bash
   npm run iot:simulate
   ```

7. For repeatable debugging, run deterministic mode:

   ```bash
   npm run iot:simulate:once -- --deterministic
   ```

8. To verify issue creation, duplicate retry handling, stale-event handling, and recovery on the dedicated S-04 simulator path:

   ```bash
   npm run iot:simulate:verify
   ```

The simulator uses the real ingestion endpoint:

```text
POST /api/iot/events
```

Every event body includes a client-generated UUID `eventId`. Retrying the same `eventId` returns the stored event without replaying sensor, machine, alert, or downtime transitions. Reusing it with conflicting content is rejected. Events whose NTP-synchronized `recordedAt` is stale or equal to the sensor watermark are retained in history with `stateApplied: false` and cannot overwrite current state. This timestamp watermark is interim; future firmware should add a per-sensor monotonic counter persisted across reboot, separate from the UUID event ID.

It keeps event history in `sensor_events`, updates `sensors.status`, updates `machines.status`, and randomly chooses one of S-01 through S-04 per batch to send a downtime/fault event. S-05 continues sending normal production activity and is rejected by downtime lifecycle verification. Non-issue sensors send active/recovery events often enough to clear old simulator alerts. Refresh `/dashboard/live` to see the latest backend data.

Local simulator environment values:

```env
IOT_SIM_BASE_URL=http://localhost:3000
IOT_SIM_INTERVAL_MS=5000
IOT_SIM_S01_KEY=
IOT_SIM_S02_KEY=
IOT_SIM_S03_KEY=
IOT_SIM_S04_KEY=
IOT_SIM_S05_KEY=
```

Common simulator issues:

- `Missing simulator keys`: add the `IOT_SIM_S##_KEY` values to local `Backend/.env`.
- `401 DEVICE_UNAUTHORIZED`: run the generated SQL hashes in Supabase, or confirm each key matches its ESP32 device ID.
- Backend connection error: confirm `npm run dev` is running and `IOT_SIM_BASE_URL` points to the backend port.
- No Live Feed changes: confirm the simulator received `201` responses and refresh `/dashboard/live`.

## Auth Session Migration 027

1. Back up the database and schedule a maintenance window. Stop old backend instances before changing auth RPCs.
2. For an existing database, apply all pending migrations in order, including `026_refresh_tokens.sql` followed by `027_harden_auth_sessions.sql`. If 026 is already applied, run only 027. Do not reapply 026 after 027.
3. Deploy the matching backend and frontend together on the same schemeful site; cross-site hosting does not send the `SameSite=Strict` refresh cookie. The backend now requires readiness version 27. Check `GET /api/health/ready` after deployment.
4. Sign in again. Migration 027 intentionally revokes legacy refresh tokens because migration 026 did not store session lineage. User and business records remain intact. Reapplying 027 preserves sessions created by 027.
5. Verify login, reload, two-tab refresh, logout, and cookie attributes over the deployed HTTPS origin. Local tests do not verify hosted permissions, proxy behavior, or HTTPS cookies.

For a fresh database, use `schema.sql`, which already includes the hardened auth objects; do not replay historical migrations over it. Logout revokes refresh sessions, not already-issued access JWTs; those remain valid until expiry (30 minutes for newly issued tokens). Plan privileged cleanup of expired `auth_sessions` separately; cascades remove their refresh-token rows. Never delete unexpired replay evidence.

Only `service_role` may execute the auth mutation RPCs. Direct refresh/session table writes are denied to that role. Never expose its key to the frontend.

### Local Verification

Run `node tests/helpers/auth-browser-server.js` from `Backend` for a disposable in-memory PostgreSQL-compatible auth API on port 3005. It uses the real auth routes, services, bcrypt, JWT, and cookies; only the Supabase transport and login audit writer are replaced. It never connects to Supabase. Dashboard APIs are intentionally absent and show unavailable states.

Start the frontend with `VITE_API_BASE_URL=http://localhost:3005` on `localhost:5175`. Test credentials are `reviewadmin` or `reviewother`, password `Review-only-123!`; these accounts exist only in the disposable database. Stop the helper when finished.

Run `node scripts/smoke-auth-session.js` with `AUTH_SMOKE_BASE_URL`, `AUTH_SMOKE_USERNAME`, and `AUTH_SMOKE_PASSWORD` set in the environment. **Use only a disposable account: the replay check revokes every refresh session for that account.**

Chrome DevTools verification on 2026-09-05 passed login, reload restore, empty legacy token storage, non-readable refresh cookies, two-tab single refresh, logout during delayed refresh, cross-account stale-write rejection, bounded refresh waiting, and sign-out with an expiry banner after the replacement token is rejected. A React regression also covers rejection before the refreshed state commits. Auth transport used the local helper; stale-write, timeout, and protected-route rejection checks injected controlled responses. Hosted HTTPS and Supabase deployment checks remain required.

## Seeded Admin Account

The seeded admin account is:

```text
username: admin
email: admin@petrohydropipe.local
temporary password: password123
```

The password is stored as a placeholder bcrypt hash for this setup phase. The real auth phase should replace this with a backend seed command or password reset flow.

## Current Scope

This database foundation now supports real auth, admin users, machine setup, and ESP32 event ingestion.

Current IoT backend endpoints:

```text
POST /api/iot/events
POST /api/iot/heartbeats
GET /api/iot/live
GET /api/operations/watchdog (Admin only)
```
