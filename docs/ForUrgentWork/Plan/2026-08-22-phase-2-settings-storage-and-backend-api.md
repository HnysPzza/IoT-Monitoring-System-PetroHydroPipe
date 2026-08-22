# Phase 2 Machine Operational Settings Storage and Backend API

Status: Implemented; final verification recorded in Section 8

## 1. Purpose

Phase 2 creates the persistent, audited configuration contract for Spiral Mill 01. It stores per-machine sensor absence thresholds and the shift schedule, then exposes authenticated backend APIs for reading and updating them.

Phase 2 does not make thresholds operational. Threshold enforcement, break-aware calculations, ESP32 behavior, and the frontend settings form are later phases.

## 2. Scope

### Included

- Migration 010 for one operational-settings row per machine.
- One validated default settings row for the existing machine M-01.
- Strict validation for sensor thresholds and same-day shift schedules.
- `GET /api/machines/:machineId/settings` for the five authenticated dashboard roles.
- `PATCH /api/machines/:machineId/settings` for Admin only.
- Optimistic concurrency through a decimal-string `version`.
- One atomic database operation for settings update and audit insertion.
- PGlite migration/RPC tests, service tests, API tests, and documentation contracts.

### Excluded

- Frontend settings controls. That remains Phase 4.
- Sensor-absence detection or automatic state transitions. That remains Phase 3.
- Break-aware availability or production-loss calculations. That remains Phase 3.
- An ESP32 configuration endpoint or firmware changes.
- Production targets are outside Phase 2. They need a separate effective-date and reporting design.
- Multiple shifts, overnight shifts, holidays, exceptions, and calendars.

## 3. Locked Architecture Decisions

| Decision | Selected approach | Reason |
|---|---|---|
| Ownership | Backend-managed server configuration | Admin changes must not require reflashing ESP32 devices. |
| Storage scope | One row per machine | Aligns with UC025 and avoids a global-singleton redesign. |
| Storage shape | Typed JSONB sections in `machine_operational_settings` | The document is small and read as one unit, while columns retain timestamps and versioning. |
| API style | Nested REST resource under a machine | Settings belong to a machine, not to the whole application. |
| Concurrency | Compare-and-swap using `version` | Prevents one admin from silently overwriting another admin's changes. |
| Mutation | Security-definer PostgreSQL RPC | Settings and their audit record must commit or roll back together. |
| Rollback | Forward-only after deployment | Dropping a populated settings table would destroy operational history. |
| Missing row | Fail closed | A missing row means migration/configuration failure and must not be hidden by code defaults. |
| Timezone | Fixed to `Asia/Manila` | Matches the existing business-time boundary. |
| Shift model | One same-day schedule for this phase | Overnight and exception calendars require a separate design. |

## 4. Approaches Rejected

- Do not use a global `system_settings` singleton. UC025 requires settings per machine.
- Do not use a generic key-value table. It weakens validation and makes atomic document reads harder.
- Do not store editable sensor descriptions. Labels and purposes already belong to the canonical sensor registry.
- Do not silently return hardcoded defaults when the database row is missing.
- Do not read, merge, update, and audit as separate unprotected writes.
- Do not suppress audit failures. An unaudited settings change must not commit.
- Do not allow arbitrary sensor keys through `z.record(z.string(), ...)`.
- Do not use `audit_logs.entity_id = 'default'`; the column requires a UUID.
- The ingestion RPC cannot detect an event that never arrives. No-event detection requires a later watchdog or device-side state machine.
- Do not add production targets to this phase.
- Do not automatically copy the M-01 sensor map to a future machine before that machine's sensors are defined.
- Do not create a destructive down migration that drops stored settings.

## 5. Configuration Contract

### Sensor thresholds

The persisted section contains exactly S-01 through S-05 for M-01.

| Sensor | Proposed trigger | Initial enforcement | Initial automatic cause |
|---|---:|---|---|
| S-01 Raw Material & Coil Joint | 600 seconds | Disabled pending physical validation | Corrective Maintenance |
| S-02 Inside Filler Wire | 300 seconds | Disabled pending Type A/B validation | Consumable Shortage |
| S-03 Machine Main Sensor | 60 seconds | Disabled pending recovery calibration | Pending Cause Review |
| S-04 Outside Filler Wire | 300 seconds | Disabled pending Type A/B validation | Consumable Shortage |
| S-05 Production Output Cutting | None | Always disabled for absence detection | Manual Cutting only for an explicit fault event |

Each sensor entry has this shape:

```json
{
  "absenceDetectionEnabled": false,
  "triggerSeconds": 600,
  "recoverySeconds": null
}
```

Rules:

- Only canonical sensor codes assigned to the requested machine are accepted.
- `triggerSeconds` is an integer from 1 to 3600 when present.
- `recoverySeconds` is either `null` or an integer from 1 to 300.
- Enabling absence detection requires both trigger and recovery values.
- S-05 must always have absence detection disabled and both values set to `null`.
- Proposed values are stored for configuration work, but Phase 3 must not enable them until physical signal behavior and recovery timing are approved.

### Shift schedule

Default schedule:

| Item | Value |
|---|---|
| Work window | 08:00 to 17:00 |
| Morning break | 10:00 to 10:15 |
| Lunch break | 12:00 to 13:00 |
| Afternoon break | 15:00 to 15:15 |
| Post-break grace | 10 minutes |
| Timezone | Asia/Manila, fixed and not editable |

The work window spans nine elapsed hours and contains 90 minutes of scheduled breaks, leaving 7.5 scheduled production hours before later grace-period treatment.

Persisted/API shape:

```json
{
  "workStart": "08:00",
  "workEnd": "17:00",
  "breaks": [
    { "name": "Morning Break", "startTime": "10:00", "endTime": "10:15" },
    { "name": "Lunch Break", "startTime": "12:00", "endTime": "13:00" },
    { "name": "Afternoon Break", "startTime": "15:00", "endTime": "15:15" }
  ],
  "rampUpGraceMinutes": 10
}
```

Rules:

- Times use strict 24-hour `HH:MM` values.
- `workStart` must be earlier than `workEnd`; overnight shifts are rejected in Phase 2.
- Breaks must be inside the work window, have unique case-insensitive names, and have `start < end`.
- Breaks and their post-break grace windows must not overlap the next break or exceed `workEnd`.
- At most 10 break windows are accepted.
- `rampUpGraceMinutes` is an integer from 0 to 30.
- When a shift section is patched, the complete shift section is required; arrays are replaced, never index-merged.

## 6. Database Design

Migration: `Backend/database/migrations/010_create_machine_operational_settings.sql`

Table:

```text
machine_operational_settings
  machine_id         uuid primary key -> machines.id on delete cascade
  sensor_thresholds  jsonb not null
  shift_schedule     jsonb not null
  version            bigint not null default 1 check version > 0
  updated_at         timestamptz not null default now()
  updated_by         uuid null -> users.id on delete set null
```

Database safeguards:

- Run migration 010 in one transaction with `SET LOCAL lock_timeout = '2s'`.
- Add JSON object-type checks for both JSONB columns.
- Resolve M-01 by `machine_code` and fail migration 010 if it does not exist.
- Insert exactly one M-01 default row with `ON CONFLICT DO NOTHING`.
- Do not add an automatic machine-insert trigger. Future machine onboarding must explicitly provision settings after its sensor registry is defined.
- Enable RLS and revoke public, anon, and authenticated access.
- Grant the backend service role read access only; updates go through the RPC.
- Reproduce the migration objects in `schema.sql` for clean installations.
- Update `seed.sql` to provision M-01 settings after the machine row exists.
- Do not add a rollback file. Before commit, transaction failure rolls back migration 010. After deployment, repair through a forward migration.

Atomic update RPC:

```text
update_machine_operational_settings(
  machine id,
  expected version,
  complete sensor-threshold JSON,
  complete shift-schedule JSON,
  actor user id
)
```

The function must:

1. Run as `SECURITY DEFINER` with a fixed safe search path.
2. Lock the settings row with `FOR UPDATE`.
3. Return not-found if the machine or settings row is missing.
4. Reject a stale expected version without changing anything.
5. Update both JSON sections, increment version, and set `updated_by`/`updated_at`.
6. Derive changed sections by comparing the locked previous document with the supplied complete document; never trust a caller-provided change list.
7. If values are identical, return the existing row without incrementing version or creating audit noise.
8. Insert `SETTINGS_UPDATED` into `audit_logs` using `entity_id = machine_id`.
9. Store changed sections plus previous and new values in audit metadata.
10. Return the committed row.
11. Roll back the settings update if audit insertion fails.
12. Revoke execution from public, anon, and authenticated; grant only to service role.

## 7. API Contract

Mount the settings router before the existing `/machines` router:

```text
router.use('/machines/:machineId/settings', settingsRoutes)
router.use('/machines', machinesRoutes)
```

The settings router uses `express.Router({ mergeParams: true })`, `authenticate`, its own role policy, `validateRequest`, and `asyncHandler`. Do not place it behind the existing machine router's Admin/Engineering-only middleware because GET must support all five dashboard roles.

### GET `/api/machines/:machineId/settings`

Allowed roles: Admin, Operation Manager, Asst. Operation Manager, Engineering Supervisor, Production Supervisor.

Response:

```json
{
  "settings": {
    "machineId": "30000000-0000-4000-8000-000000000001",
    "timeZone": "Asia/Manila",
    "sensorThresholds": {},
    "shiftSchedule": {},
    "version": "1",
    "updatedAt": "2026-08-22T00:00:00.000Z",
    "updatedBy": null
  }
}
```

`BIGINT` versions cross the JavaScript/API boundary as canonical decimal strings.

### PATCH `/api/machines/:machineId/settings`

Allowed role: Admin only.

Request:

```json
{
  "expectedVersion": "1",
  "sensorThresholds": {
    "S-03": {
      "absenceDetectionEnabled": false,
      "triggerSeconds": 60,
      "recoverySeconds": null
    }
  }
}
```

Patch behavior:

- `expectedVersion` is required.
- At least one settings section is required.
- Sensor entries may be patched by canonical sensor code, but each supplied entry must be complete.
- The service merges the patch into the current document, validates the complete result, then calls the compare-and-swap RPC.
- The service validates settings loaded from the database before returning or merging them; malformed stored data fails closed.
- A supplied shift schedule replaces the complete shift section.
- Unknown top-level fields, sensor codes, and nested fields are rejected.
- The response uses the same `{ settings }` shape as GET.

Controlled errors:

| Status | Code | Condition |
|---:|---|---|
| 400 | `VALIDATION_ERROR` | Invalid UUID, time, bounds, sensor key, overlap, or unknown field |
| 401 | `UNAUTHENTICATED` | Missing or invalid current session |
| 403 | `FORBIDDEN` | Non-Admin PATCH |
| 404 | `MACHINE_NOT_FOUND` | Machine does not exist |
| 409 | `SETTINGS_VERSION_CONFLICT` | Another update committed first |
| 500 | `SETTINGS_NOT_CONFIGURED` | Machine exists but migration/default row is missing |
| 500 | `SETTINGS_QUERY_FAILED` | Unexpected database read failure |
| 500 | `SETTINGS_UPDATE_FAILED` | Unexpected atomic RPC failure |

Internal database messages must not be returned to clients.

## 8. Implementation Tasks

### Task 1 Database contract and migration - Complete

Files:

- Create `Backend/database/migrations/010_create_machine_operational_settings.sql`.
- Modify `Backend/database/schema.sql`.
- Modify `Backend/database/seed.sql`.
- Create `Backend/tests/settings.migration.pglite.test.js`.

Steps:

1. Write PGlite tests for migration reapplication, the M-01 default, missing-M-01 failure, permissions, version conflict, no-op behavior, successful update/audit, and audit-failure rollback.
2. Implement the table, atomic update RPC, grants, and default M-01 row.
3. Mirror the final objects into fresh `schema.sql` and provision M-01 in `seed.sql` after machine creation.
4. Verify both paths: migration 010 on a legacy database, and fresh `schema.sql` plus `seed.sql`.
5. Run the migration test twice from a clean database.
6. Commit only this database unit with message `add machine settings storage`.

### Task 2 Validation contract - Complete

Files:

- Create `Backend/src/modules/settings/settings.model.js`.
- Create `Backend/tests/settings.validation.test.js`.

Steps:

1. Define strict schemas for params, patch input, sensor entries, the complete sensor document, breaks, and the complete shift document.
2. Import canonical sensor codes instead of duplicating label text.
3. Test valid boundaries and reject unknown keys, missing sections, arbitrary sensor codes, enabled S-05, missing recovery values, overnight shifts, duplicate break names, overlaps, grace overlaps, and out-of-range values.
4. Commit only validation and tests with message `validate machine settings`.

### Task 3 Service and API - Complete

Files:

- Create `Backend/src/modules/settings/settings.service.js`.
- Create `Backend/src/modules/settings/settings.controller.js`.
- Create `Backend/src/modules/settings/settings.routes.js`.
- Modify `Backend/src/routes/index.js`.
- Create `Backend/tests/settings.service.test.js`.
- Modify `Backend/tests/api.test.js`.

Steps:

1. Use the existing `getSupabaseClient`, `authenticate`, `authorizeRole`, `validateRequest`, `asyncHandler`, and central error handler.
2. GET the database row and fail closed if it is missing or malformed.
3. PATCH by loading the current document, merging allowed fields, validating the complete result, and calling the atomic RPC with `req.user.sub`.
4. Map not-found, conflict, and database failures to controlled errors.
5. Never call `recordAuditLog` separately for this mutation; the RPC owns the audit transaction.
6. Add API authorization, validation, response-shape, concurrency, and internal-error-masking tests.
7. Commit only this API unit with message `add machine settings api`.

### Task 4 Documentation and full verification - Complete

Files:

- Update `docs/phase plan.md`, `docs/ForUrgentWork/Configure.md`, `docs/PRD.md`, `docs/TDD.md`, and `docs/ARCHITECTURE.md`.
- Extend the documentation contract test to prevent global-singleton, production-target, and ingestion-no-event claims from returning.

Verification:

```powershell
cd Backend
npm.cmd test

cd ..\Frontend
npm.cmd test
npm.cmd run build
```

Verified on 2026-08-22:

- Backend: 142 tests passed.
- Frontend: 201 tests passed across 28 files.
- Frontend production build: passed.

If a configured read-only Supabase integration environment exists, verify migration 010 objects and the M-01 default row without changing production settings.

Commit only documentation/contracts with message `align phase 2 settings docs`.

## 9. Definition of Done

Phase 2 is complete only when:

- Migration 010 and fresh schema produce identical settings objects.
- Fresh schema plus seed provisions the same M-01 defaults as migration 010.
- M-01 receives exactly one settings row; future machines require explicit provisioning after sensor definition.
- GET works for all five authenticated roles.
- PATCH works only for Admin.
- Invalid, unknown, malicious, and oversized settings input is rejected.
- Concurrent updates cannot silently overwrite each other.
- Every successful mutation has one committed `SETTINGS_UPDATED` audit row.
- An audit failure rolls back the settings change.
- Missing settings never fall back silently.
- S-05 cannot be configured for absence-based downtime.
- Backend tests, frontend tests, and production build pass.
- No Phase 3 enforcement or Phase 4 UI is claimed as implemented.

## 10. Phase 3 Handoff

Phase 3 must select and test an actual no-event detection mechanism. The recommended direction is a backend watchdog using server-managed configuration and periodic sensor heartbeats, because the ingestion RPC cannot run when no event arrives. Physical Type A/Type B classification and recovery timing remain mandatory before enabling absence detection.

The later Phase 3 design must address:

- watchdog ownership in the supported single-backend-process deployment;
- periodic heartbeats and stale-device handling;
- planned-break and grace-window overlap calculations;
- atomic transition functions for watchdog-created idle, downtime, and recovery changes;
- restart recovery and idempotency;
- device-offline versus real-production-stoppage distinction;
- multi-instance leadership if deployment expands beyond one backend process.
