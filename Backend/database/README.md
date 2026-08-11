# Database Setup

This folder contains the Phase 2 Supabase/PostgreSQL database foundation for the PetroHydroPipe IoT monitoring system.

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

It keeps event history in `sensor_events`, updates `sensors.status`, updates `machines.status`, and randomly chooses one sensor per batch to send a downtime/fault event. Non-issue sensors send active/recovery events often enough to clear old simulator alerts. Refresh `/dashboard/live` to see the latest backend data.

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

## Seeded Admin

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
GET /api/iot/live
```
