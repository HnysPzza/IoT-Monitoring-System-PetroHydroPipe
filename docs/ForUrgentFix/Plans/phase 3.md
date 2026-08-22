# Phase 3 Operational-Time Engine and Sensor Watchdog Architecture Plan

Status: Backend implementation completed on 2026-08-22. Automated verification is recorded below. Production enforcement is not active and still requires the physical, concurrency, soak, and parallel-run gates in this plan.

## 1. Outcome

Phase 3 will make the Phase 2 settings operational without confusing a disconnected ESP32 with a stopped production process.

It will add:

- A lightweight authenticated heartbeat contract for each ESP32.
- Persisted device-connectivity and sensor-activity runtime state.
- A restart-safe backend watchdog.
- Observe-only and enforced operating modes.
- Atomic and idempotent PostgreSQL transitions for watchdog-created downtime, alerts, machine state, and audits.
- Historical schedule versions so later setting changes do not rewrite old analytics.
- One break-aware interval engine used by downtime, dashboard, and reporting services.
- Operational diagnostics, bounded retries, safe shutdown, and complete failure-path tests.

Phase 3 will not add the Admin settings UI or the new live-status presentation. Those remain Phase 4.

## 2. Non-goals

- Do not enable any sensor automatically when Phase 3 is deployed.
- Do not treat an absent HTTP request as proof of production downtime.
- Do not use S-05 pulse absence as downtime. S-05 remains an output counter.
- Do not move threshold ownership back into ESP32 firmware.
- Do not add production-target configuration.
- Do not add overnight shifts, multiple shifts, holidays, or exception calendars.
- Do not replace the current Express monolith with microservices or add a message broker.
- Do not promise multi-instance realtime SSE behavior. The supported deployment remains one persistent Express process.
- Do not test destructive transition scenarios against the production Supabase project.

## 3. Current Baseline and Issues Found Early

| Current condition | Risk if Phase 3 is added without correction | Required Phase 3 response |
|---|---|---|
| The ingestion RPC runs only after an event arrives. | It cannot detect an event that never arrives. | Add periodic device heartbeats and a scheduled watchdog. |
| Device connectivity and production activity are not separate concepts. | Wi-Fi, power, or backend outages could create false production downtime. | Store connectivity and activity independently. Offline devices create connectivity state, not production downtime. |
| Existing `pulse` and `recovered` events immediately resolve any open sensor downtime. | They could bypass the configured `recoverySeconds` for watchdog-created downtime. | Preserve immediate recovery only for event-created downtime. Watchdog-created downtime must pass the recovery state machine. |
| Existing `downtime/no_pulse` events can open downtime immediately. | Firmware could bypass the server-managed threshold after backend enforcement is enabled. | Treat `downtime/no_pulse` as an inactivity observation for backend-managed sensors; retain legacy behavior only while backend detection is disabled. |
| The current schedule table keeps only the newest settings document. | A later schedule edit would reinterpret historical availability and loss. | Add immutable settings-version history with effective intervals. |
| Dashboard and report queries include records only when `started_at` is inside the requested window. | A downtime that begins before the window and overlaps it is omitted. | Query by interval overlap: `started_at < windowEnd` and open/ended after `windowStart`. |
| Current services sum sensor downtime durations. | Simultaneous sensor failures can double-count machine downtime and production loss. | Union machine-level intervals before calculating availability and total loss. |
| Availability currently uses 1,440 minutes per day. | Off-shift time, breaks, and ramp-up grace are incorrectly treated as planned production time. | Use scheduled operational seconds as the denominator. |
| Current calculations round each record to minutes before totaling. | Many short records accumulate rounding error. | Calculate in integer seconds and round only response fields. |
| An in-process timer would be lost during restart. | Missed ticks or duplicate processes could create inconsistent transitions. | Persist runtime state and make every per-sensor evaluation idempotent in PostgreSQL. |
| Phase 2 allows thresholds to be stored while disabled. | An unsafe short threshold could be enabled even when the heartbeat cadence cannot measure it. | Add an activation-capability check based on heartbeat cadence and recovery sampling. |
| The simulator emits explicit faults and downtime events, not heartbeats. | It cannot validate the no-event architecture. | Add a deterministic heartbeat simulator without removing existing event-lifecycle verification. |

## 4. Locked Architecture Decisions

| Decision | Selected approach | Why |
|---|---|---|
| Deployment shape | A focused watchdog module inside the existing Express backend | Five sensors and one machine do not justify another service or broker. |
| No-event signal | Periodic authenticated ESP32 heartbeat containing an activity observation | The backend needs proof that the device is online even when production activity is absent. |
| Connectivity clock | Backend database receipt time | Device clocks and buffered packets must not define whether a device is currently online. |
| Device ordering | Persistent boot counter plus per-boot sequence, both sent as decimal strings | A UUID alone cannot order packets across retries and reboot. The boot counter changes only once per reboot, reducing NVS wear. |
| Heartbeat storage | One current runtime row per sensor, not an unbounded raw-heartbeat table | Transition history is valuable; millions of repetitive heartbeat rows are not. |
| Watchdog scheduling | One non-overlapping in-process runner with one atomic RPC per sensor | It is simple for the supported deployment, isolates failures by sensor, and remains safe if two processes briefly overlap. |
| Concurrency | Row locks and idempotent database state transitions | Process-local locks do not survive restart and do not protect against another backend instance. |
| Rollout safety | Global `disabled`, `observe`, and `enforce` modes plus the per-sensor Phase 2 enable flag | Deployment, observation, and activation become separate decisions. |
| Break handling | Pause new absence accumulation during off-shift, breaks, and grace; never auto-resolve an existing downtime merely because a break begins | Planned time changes metrics and detection eligibility, not physical recovery. |
| Metric source | One pure operational-time domain module plus validated settings history | It keeps complex interval behavior deterministic and unit-testable across all API consumers. |
| Historical behavior | Effective-dated settings history | Current settings must not retroactively change old reports. |
| API evolution | Additive internal REST contracts; no `/v2` yet | Existing consumers remain compatible. A breaking payload change must introduce a version rather than silently replacing fields. |
| Rollback | Disable enforcement immediately and repair forward | Dropping watchdog/history data would destroy evidence and is not an acceptable rollback. |

## 5. Approaches Rejected

- Do not add only a `setInterval` that checks `sensor_events`. It cannot distinguish a stopped sensor from an offline device and loses state on restart.
- Do not use the browser SSE heartbeat. That heartbeat proves only that a dashboard connection is alive; it says nothing about an ESP32.
- Do not let firmware open absence downtime after its own threshold. The backend is the configuration authority.
- Do not trust `recordedAt` as the connectivity clock. Delayed or buffered packets could make an offline device look online.
- Do not write every heartbeat to `sensor_events`. At a 10-second cadence, five devices would create about 43,200 rows per day.
- Do not overload `sensors.status = 'Fault'` to represent a network outage. Connectivity and production state have different operational meanings.
- Do not open downtime while the device is offline. Lack of telemetry is unknown state, not proven production stoppage.
- Do not automatically resolve downtime at a break boundary, at settings disablement, or when watchdog mode changes.
- Do not calculate historical metrics using only the newest shift schedule.
- Do not sum overlapping sensor downtimes for machine availability or total production loss.
- Do not perform settings, downtime, alert, machine, and audit writes as separate application calls.
- Do not expose a public or Admin HTTP endpoint that manually runs the watchdog. Tests and operations should invoke the service internally.
- Do not rely on `pg_cron` for the first supported deployment. It would split ownership between Supabase and Express and complicate local verification.
- Do not add a destructive down migration.

## 6. Architecture Overview

```text
ESP32 device
  |
  | POST /api/iot/heartbeats
  v
Express validation, device auth, and rate limits
  |
  v
ingest_iot_heartbeat RPC
  |-- validates boot counter and sequence
  |-- records server receipt time
  |-- updates latest activity observation
  `-- returns duplicate/stale/applied outcome

Watchdog runner every 5 seconds
  |
  | one sensor at a time, no overlapping cycle
  v
evaluate_sensor_watchdog RPC
  |-- locks sensor, machine, settings, and runtime state
  |-- checks global mode, per-sensor flag, connectivity, schedule, and thresholds
  |-- updates persisted watchdog state
  |-- in observe mode records candidate transitions only
  |-- in enforce mode atomically updates downtime, alerts, machine/sensor state, and audits
  `-- returns committed transition descriptors
  |
  v
Post-commit SSE publication through the existing alert/downtime channels
```

The watchdog is not a second source of truth. PostgreSQL owns transition correctness; the Node runner only schedules evaluations and publishes committed results.

## 7. Safety and Activation Gates

### 7.1 Global mode

Add a validated environment variable:

```text
WATCHDOG_MODE=disabled | observe | enforce
```

Default: `disabled`.

- `disabled`: heartbeat ingestion may run, but no watchdog cycle changes candidate or operational state.
- `observe`: candidate watchdog state and transition evidence are stored, but machine, sensor, downtime, and alert records are not changed.
- `enforce`: operational transitions are allowed only for a sensor whose Phase 2 `absenceDetectionEnabled` value is also `true`.

Changing from `observe` to `enforce` requires a deployment configuration change. An Admin settings PATCH alone must not bypass the global safety gate.

### 7.2 Starting cadence

Proposed lab defaults:

```text
IOT_HEARTBEAT_EXPECTED_INTERVAL_MS=10000
IOT_HEARTBEAT_STALE_AFTER_MS=30000
WATCHDOG_TICK_INTERVAL_MS=5000
WATCHDOG_EVALUATION_TIMEOUT_MS=4000
```

Startup validation must enforce:

- Tick interval is shorter than stale-after.
- Expected heartbeat interval is shorter than stale-after.
- Evaluation timeout is shorter than the tick interval.
- In `enforce` mode, enabled trigger and recovery durations are measurable at the configured heartbeat cadence.
- A recovery duration must permit at least two accepted activity observations. One packet is not sustained recovery.

The values above are starting points, not physical proof. Lab measurements may change them before enforcement.

### 7.3 Physical gates

Infrastructure and observe mode may be implemented before these decisions close. Enforcement may not be enabled until:

- S-02 and S-04 Type A/Type B behavior is observed and approved.
- S-01 continuous heartbeat/activity behavior is confirmed.
- Recovery timing is calibrated for every enabled sensor.
- Device-offline behavior is tested separately from real production stoppage.
- Firmware implements the heartbeat ordering contract.
- Parallel-run evidence agrees with the manual log.

S-05 must remain permanently disabled for absence detection in every mode.

## 8. Heartbeat Contract

### 8.1 Endpoint

```text
POST /api/iot/heartbeats
```

Authentication and protection:

- Existing `x-device-id` and `x-device-key` headers.
- Existing untrusted-ingress IP limiter before device authentication.
- Existing verified-device limiter after authentication.
- Strict request schema; unknown fields are rejected.
- Maximum JSON body remains controlled by the global 100 KB limit, while the heartbeat schema itself remains small.

Request:

```json
{
  "heartbeatId": "6c5b65eb-7acd-4eef-86ee-a027f6c5651f",
  "bootId": "509538db-d526-477c-a4dc-bc217c9ce3df",
  "bootCounter": "12",
  "sequence": "184",
  "recordedAt": "2026-08-22T02:00:00.000Z",
  "activityObserved": true
}
```

Contract:

- `heartbeatId` is a UUID for exact latest-request retry detection.
- `bootCounter` is a positive unsigned decimal string persisted in ESP32 NVS and incremented once per boot.
- `bootId` is a new UUID for that boot and must remain paired with its boot counter.
- `sequence` is a positive unsigned decimal string that increments for every heartbeat within one boot.
- `recordedAt` is diagnostic device time and is checked for unreasonable future skew.
- `activityObserved` means at least one physically validated production-activity signal was observed during the heartbeat interval.
- Heartbeats are not buffered as historical production events. A device may retry its latest heartbeat, but it must not replay an old heartbeat as proof of current connectivity.
- The database receipt timestamp is authoritative for online/offline and absence timing.

Response:

```json
{
  "heartbeat": {
    "sensorCode": "S-03",
    "receivedAt": "2026-08-22T02:00:00.250Z",
    "duplicate": false,
    "stale": false,
    "applied": true
  }
}
```

Expected errors:

| Status | Code | Condition |
|---:|---|---|
| 400 | `VALIDATION_ERROR` | Invalid UUID, decimal string, timestamp, type, or unknown property |
| 400 | `HEARTBEAT_REJECTED` | Invalid device ordering or impossible timestamp |
| 401 | `DEVICE_UNAUTHORIZED` | Missing or invalid device credentials |
| 409 | `HEARTBEAT_SEQUENCE_CONFLICT` | Same boot/sequence is reused with different heartbeat data |
| 429 | Existing rate-limit code | Ingress or verified-device limit reached |
| 500 | `HEARTBEAT_PROCESSING_FAILED` | Unexpected RPC/database failure |

Internal PostgreSQL messages must never be returned.

### 8.2 Ordering behavior

- Same boot counter, boot ID, sequence, heartbeat ID, and payload: duplicate success; no mutation.
- Same boot counter and sequence with different content: conflict; no mutation.
- Lower sequence in the active boot: stale success; no current-state mutation.
- Higher sequence in the active boot: apply.
- Higher boot counter with a new boot ID: accept as device restart and reset the activity baseline safely.
- Same boot counter with another boot ID: conflict.
- Lower boot counter: stale; never switch back to an old boot.
- A device restart begins in unknown/online observation state and cannot inherit yesterday's absence timer.

## 9. Persisted State and Migration Design

Use forward migrations after migration 010. Do not edit the already-applied migration 010.

### 9.1 Migration 011: settings history and heartbeat runtime

Create `machine_operational_settings_history`:

```text
machine_id         uuid -> machines.id
version            bigint > 0
sensor_thresholds  jsonb object
shift_schedule     jsonb object
effective_from     timestamptz nullable; null means beginning of known history
effective_to       timestamptz nullable; null means current
changed_by         uuid nullable -> users.id
created_at         timestamptz
primary key (machine_id, version)
one current row per machine where effective_to is null
```

Migration behavior:

- Backfill history from the current Phase 2 settings row.
- If `SETTINGS_UPDATED` audit rows exist, reconstruct contiguous versions from their full previous/current metadata.
- Fail the migration if audit versions are missing, duplicated, malformed, or non-contiguous. Do not guess historical schedules.
- For the current live database, the verified Phase 2 audit count was zero, so the current version becomes the baseline history row.
- Replace `update_machine_operational_settings` with the same signature so the existing API remains compatible.
- The replacement RPC closes the current history interval and inserts the new version in the same transaction as the settings update and audit row.
- A no-op PATCH creates no settings version, history row, or audit row.

Create `sensor_watchdog_state`:

```text
sensor_id                    uuid primary key -> sensors.id
machine_id                   uuid -> machines.id
boot_counter                 bigint nullable
boot_id                      uuid nullable
last_sequence                bigint nullable
last_heartbeat_id            uuid nullable
last_heartbeat_payload_hash  text nullable
last_heartbeat_received_at   timestamptz nullable
last_device_recorded_at      timestamptz nullable
last_activity_received_at    timestamptz nullable
connectivity_state           unknown | online | offline
detection_state              disabled | suspended | healthy | grace | downtime | recovering
absence_baseline_at          timestamptz nullable
recovery_started_at          timestamptz nullable
open_downtime_id             uuid nullable -> downtime_events.id
settings_version             bigint nullable
last_evaluated_at            timestamptz nullable
updated_at                   timestamptz
```

The payload hash is calculated inside PostgreSQL from canonical input fields. Plain device keys or other secrets are never stored.

Create `sensor_watchdog_transitions`:

```text
id                uuid primary key
sensor_id         uuid -> sensors.id
machine_id        uuid -> machines.id
mode              observe | enforce
from_state        text
to_state          text
reason            text
evaluated_at      timestamptz
settings_version  bigint nullable
metadata          jsonb with bounded non-secret fields
created_at        timestamptz
```

This table stores state changes only, not every tick or heartbeat. It provides restart-safe observation evidence for parallel-run comparison.

Permissions:

- Enable RLS.
- Revoke public, anon, and authenticated access.
- Grant the service role only the reads required by Express.
- Require all runtime mutations through service-role-only security-definer RPCs with a fixed search path.

### 9.2 Migration 012: watchdog transition ownership

Alter `downtime_events` additively:

```text
detection_source  sensor_event | absence_watchdog
settings_version  bigint nullable
```

- Backfill existing rows as `sensor_event`.
- Watchdog-created rows store the settings version used at transition time.
- Keep `duration_seconds` as raw elapsed duration for historical compatibility.
- Do not add destructive rollback SQL.

Create service-role-only RPCs:

```text
ingest_iot_heartbeat(...)
evaluate_sensor_watchdog(sensor_id, evaluated_at, mode)
```

Update the existing ingestion function without changing its public signature:

- Activity events refresh watchdog activity state.
- An event-created downtime keeps the current explicit recovery behavior.
- A watchdog-created downtime is not immediately resolved by one pulse/recovered event; it enters `recovering` and waits for `recoverySeconds`.
- For a sensor with backend absence detection enabled, `downtime/no_pulse` becomes an inactivity observation instead of bypassing the configured trigger.
- Explicit `fault/fault` remains an immediate fault path.
- If an explicit fault arrives while watchdog downtime is open, reuse the one open row, record the confirmation in audit metadata, and preserve one alert rather than creating competing incidents.

Migration 012 and fresh `schema.sql` must remain equivalent.

## 10. State Machines

### 10.1 Connectivity

```text
unknown -- accepted heartbeat --> online
online  -- stale-after elapsed --> offline
offline -- two ordered heartbeats --> online
```

Rules:

- Offline creates no production downtime.
- In `observe` mode, offline/online candidate transitions are recorded only.
- In `enforce` mode, offline creates or refreshes one Warning connectivity alert using `source_type = sensor_connectivity`.
- Connectivity recovery resolves only the connectivity alert. It does not resolve production downtime.
- Require two ordered heartbeats for connectivity recovery to reduce flapping.
- Backend restart does not make old device timestamps current. Runtime state is loaded from PostgreSQL and evaluated immediately.

### 10.2 Absence detection

```text
disabled   per-sensor flag off or global mode disabled
suspended  outside work window, scheduled break, post-break grace, or device offline
healthy    device online and recent activity observed
grace      device online, eligible production time, absence below trigger
downtime   eligible accumulated absence reached trigger
recovering activity returned but recovery duration not yet satisfied
```

Evaluation precedence:

1. Validate settings and runtime row.
2. Apply the global mode and S-05 prohibition.
3. Evaluate connectivity using server receipt time.
4. Determine whether `evaluatedAt` is eligible production time.
5. Calculate eligible absence seconds, excluding off-shift, break, and grace intervals.
6. Apply the trigger transition.
7. If watchdog downtime is open, evaluate sustained recovery.
8. Persist only a real state change; a repeated evaluation is a no-op.

Rules:

- The downtime start is the exact instant accumulated eligible absence reaches `triggerSeconds`, not the later timer tick.
- Starting a scheduled break pauses a pre-trigger grace state. The next eligible period starts a fresh baseline at the end of break grace.
- A downtime already open across a break remains open. Metrics exclude the planned overlap; the break does not claim recovery.
- Disabling settings or changing global mode does not auto-resolve an open downtime.
- An inactive heartbeat resets a recovery candidate.
- A stale heartbeat or connectivity loss resets a recovery candidate.
- Recovery requires at least two ordered activity observations and the configured eligible recovery duration.
- Grace state is exposed for Phase 4, but Phase 3 does not invent a new machine-state rule for it. Existing machine/sensor operational rows change only when an enforced downtime or recovery commits.

### 10.3 Atomic enforced transition

For one sensor, `evaluate_sensor_watchdog` must commit or roll back together:

- Watchdog runtime state.
- Watchdog transition evidence.
- Sensor status when a downtime/recovery transition requires it.
- Machine status recomputation.
- One open downtime row per machine/sensor.
- Alert creation/update/recovery metadata and revision.
- Required audit rows.

The function returns committed downtime and alert transition descriptors for post-commit SSE publication. A publication failure is logged and isolated; it cannot change the committed RPC response.

Lock order must match the existing ingestion path to reduce deadlock risk:

```text
sensor -> machine -> settings/history -> watchdog state -> downtime -> alert
```

## 11. Break-aware Operational-Time Engine

Create a pure module:

```text
Backend/src/shared/operationalTime.js
```

Responsibilities:

- Build recurring same-day Manila work intervals from validated settings history.
- Subtract breaks and each post-break grace interval.
- Split intervals exactly at settings effective-time boundaries.
- Intersect downtime with request windows and eligible production intervals.
- Union overlapping machine downtime intervals before machine-level totals.
- Advance by N eligible seconds to find the exact trigger instant.
- Return integer seconds; response layers perform final minute/percentage rounding.

All intervals are half-open `[start, end)`. Exact boundary behavior must be consistent:

- A signal at `workStart` is eligible.
- A signal at break start is not eligible.
- A signal at break end remains excluded during ramp-up grace.
- A signal exactly at grace end is eligible.
- A signal exactly at `workEnd` is not eligible.

With the current default schedule:

- Work window: 540 minutes.
- Breaks: 90 minutes.
- Three 10-minute post-break grace windows: 30 minutes.
- Eligible scheduled production time: 420 minutes per day.

### 11.1 Historical schedules

- Every calculation loads all settings-history intervals overlapping the requested range.
- A mid-day schedule change splits that day at the effective timestamp.
- Old reports use the schedule version effective at that time, not today's schedule.
- If settings history is missing, malformed, overlapping, or has a gap, metric APIs fail closed with a controlled 500 error.

### 11.2 Downtime semantics

For each record expose additive fields while retaining existing fields:

```json
{
  "durationMinutes": 90,
  "unplannedMinutes": 45,
  "plannedExcludedMinutes": 45,
  "estimatedLoss": 104
}
```

- `durationMinutes` remains raw elapsed downtime for compatibility.
- `unplannedMinutes` is overlap with eligible scheduled production time.
- `plannedExcludedMinutes` is raw overlap excluded by off-shift, breaks, and grace.
- `estimatedLoss` changes to use unplanned seconds, rounded once at the response boundary.

Machine-level totals:

- Query every downtime interval that overlaps the requested window, including rows that started earlier.
- Clip to the request window.
- Union simultaneous downtime intervals before total minutes, availability, and production loss.
- If multiple causes overlap, report the overlap as `Concurrent causes` rather than arbitrarily assigning all loss to one sensor.
- Per-record durations remain individually visible and are not safe to sum for machine totals.

Availability:

```text
available eligible seconds = scheduled eligible seconds - unioned unplanned downtime seconds
availability percent = available eligible seconds / scheduled eligible seconds * 100
```

If scheduled eligible seconds is zero, return `null`/not-applicable. Never use `100` as a fallback for an undefined denominator.

### 11.3 Internal data access

- Add one repository query that pages through only downtime interval columns in deterministic `(started_at, id)` order.
- Never rely on Supabase's default row limit or silently truncate metrics.
- Capture one `asOf` timestamp per HTTP request so open-record calculations do not drift between fields.
- Apply the same engine in downtime summaries, dashboard availability/downtime impact, and reports.
- Keep the older `get_downtime_summary` RPC temporarily for backward compatibility, but stop using it for break-aware API results. Remove it only in a later reviewed migration.

## 12. Backend Module Boundaries and Clean Code

Use current CommonJS and Express conventions. Do not introduce TypeScript, a base controller hierarchy, or a generic repository framework in this phase.

Proposed files:

```text
Backend/src/shared/operationalTime.js

Backend/src/modules/iot/heartbeat.model.js
Backend/src/modules/iot/heartbeat.controller.js

Backend/src/modules/watchdog/watchdog.repository.js
Backend/src/modules/watchdog/watchdog.service.js
Backend/src/modules/watchdog/watchdog.runner.js
Backend/src/modules/watchdog/watchdog.metrics.js

Backend/src/modules/operations/transitionPublisher.js
```

Responsibilities:

- `operationalTime.js`: pure interval functions only; no database, environment, logger, or current-clock imports.
- `heartbeat.model.js`: strict API schemas and decimal-string validation.
- `heartbeat.controller.js`: translate validated HTTP input to the IoT service and return the response envelope.
- `watchdog.repository.js`: Supabase queries/RPC calls and controlled database error mapping only.
- `watchdog.service.js`: one evaluation cycle, sensor isolation, result validation, and post-commit publication.
- `watchdog.runner.js`: start, stop, immediate startup cycle, non-overlap, timeout/abort, and shutdown waiting.
- `watchdog.metrics.js`: bounded in-memory counters and timestamps for diagnostics.
- `transitionPublisher.js`: one shared validator/publisher for committed alert/downtime descriptors used by ingestion and watchdog paths.

Clean-code rules:

- Pass `clock`, repository, publisher, and logger dependencies into the runner for deterministic tests.
- Keep state-machine decisions named and explicit; do not hide them in nested ternaries.
- Use small pure functions for interval creation, intersection, subtraction, union, and duration.
- Validate database/RPC outputs before publishing or returning them.
- Use canonical decimal strings at every JavaScript BIGINT boundary.
- Never use `||` for valid zero metrics. Use nullish handling and explicit denominator checks.
- Never catch an error without classifying, logging safely, or rethrowing a controlled error.
- Never log device keys, JWTs, raw headers, or full payloads.
- Keep one transition owner. Application code must not repeat audit or alert writes already owned by the RPC.
- Add comments for invariants and reasons, not line-by-line narration.
- Keep each implementation commit cohesive and run focused tests before starting the next task.

## 13. Runner Lifecycle and Resilience

Startup:

1. Validate environment relationships.
2. Start the HTTP server.
3. Start heartbeat/watchdog diagnostics.
4. Run one immediate watchdog cycle so restart recovery does not wait for the first interval.
5. Schedule later cycles only after the prior cycle settles.

Cycle behavior:

- No overlapping cycle in one process.
- Query the small configured sensor set.
- Evaluate sensors sequentially or with a bounded concurrency of two; five unbounded promises are unnecessary.
- Failure for one sensor is logged and counted, then other sensors continue.
- A cycle timeout aborts pending Supabase requests where supported.
- Repeated database failures do not create local fallback transitions.
- The next normal interval retries; do not use an unbounded rapid retry loop.

Shutdown:

1. Mark the runner stopping and clear the next timer.
2. Abort or wait up to the bounded evaluation timeout for the in-flight cycle.
3. Close SSE streams.
4. Close the HTTP server.

Multiple-process safety:

- The supported deployment remains one backend process.
- If two processes briefly run, both may schedule evaluations, but row locks and idempotent state changes prevent duplicate operational transitions.
- Do not add a distributed leader lease until multi-instance deployment is actually approved.
- Before any future multi-instance release, replace process-local SSE publication with a shared event channel.

## 14. Operations API and Observability

Extend the existing Admin-only operations resource additively:

```text
GET /api/operations/watchdog
```

Response:

```json
{
  "watchdog": {
    "mode": "observe",
    "running": true,
    "inFlight": false,
    "lastStartedAt": "2026-08-22T02:00:00.000Z",
    "lastCompletedAt": "2026-08-22T02:00:00.120Z",
    "lastSuccessAt": "2026-08-22T02:00:00.120Z",
    "lastErrorCode": null,
    "counters": {
      "cycles": 10,
      "cycleFailures": 0,
      "sensorEvaluations": 50,
      "sensorFailures": 0,
      "transitions": 3
    },
    "states": {
      "unknown": 0,
      "online": 5,
      "offline": 0,
      "grace": 1,
      "downtime": 0,
      "recovering": 0
    }
  }
}
```

Security:

- Admin only; no public diagnostics expansion.
- Do not expose device IDs, source IPs, device keys, heartbeat IDs, payload hashes, or per-user information.
- Use the existing `{ error: { code, message } }` failure shape.
- No manual-run or state-mutation operation endpoint.

Structured logs:

- Runner start/stop and mode.
- Cycle timeout/failure with safe error code.
- Sensor evaluation failure with sensor code and machine code only.
- Candidate transition in observe mode.
- Committed transition and post-commit publication failure.
- Connectivity offline/recovered transition.
- Never log every successful heartbeat at info level.

## 15. Failure Handling Matrix

| Failure | Required behavior |
|---|---|
| Missing/malformed machine settings | Fail that sensor closed; no transition; controlled diagnostic error |
| Missing settings-history interval | Metrics/evaluation fail closed; never substitute today's schedule |
| Heartbeat database failure | Return controlled 500; do not update local runtime state |
| Duplicate heartbeat retry | Return success with `duplicate: true`; no state/audit noise |
| Stale boot/sequence | Return success with `stale: true`; no current-state mutation |
| Sequence reused with different payload | Return 409; preserve state |
| Device heartbeat becomes stale | Mark connectivity offline; do not open production downtime |
| Heartbeat resumes | Require two ordered heartbeats; resolve connectivity only |
| Runner starts twice | Second start is a no-op/error in process; DB idempotence protects cross-process overlap |
| Cycle takes longer than interval | Skip overlap and count it; do not queue unlimited cycles |
| One sensor RPC fails | Continue other sensors; retry failed sensor next cycle |
| Audit, alert, downtime, or machine write fails | Entire per-sensor transition rolls back |
| Settings change races evaluation | Database lock/version determines one consistent settings snapshot |
| Explicit event races watchdog | Row locks and one-open-downtime invariant serialize ownership |
| SSE listener throws | Log and isolate after commit; HTTP/RPC result remains successful |
| Backend restarts during absence | Persisted receipt state is reevaluated; stale device becomes offline, not automatic downtime |
| Backend outage causes buffered heartbeats | Old heartbeats remain stale and cannot prove current connectivity |
| Downtime spans a break or midnight | Raw duration remains continuous; metrics intersect all eligible windows |
| Two sensors fail simultaneously | Per-sensor rows remain visible; machine totals union time once |
| No scheduled production in range | Availability is null/not-applicable, not 100% |
| Global mode changes to disabled | Stop new enforcement; do not auto-resolve existing incidents |

## 16. Test Plan

No Phase 3 implementation is complete until every applicable category below passes.

### 16.1 Pure operational-time unit tests

- Exact work-start inclusion and work-end exclusion.
- Break-start exclusion, break-end grace, and exact grace-end inclusion.
- Empty break list and zero grace.
- Default schedule yields exactly 420 eligible minutes.
- Before shift, after shift, entire break, entire grace, and entire off-day intervals.
- Downtime starting before a work window and ending inside it.
- Downtime starting inside and ending after work end.
- Downtime spanning morning break, lunch, afternoon break, and multiple days.
- Open downtime uses one injected `asOf` value.
- Mid-day settings version change splits intervals at the exact effective timestamp.
- Adjacent settings versions have no double-count or gap.
- Missing/overlapping history fails closed.
- Union of adjacent intervals, nested intervals, identical intervals, and simultaneous multi-sensor intervals.
- Trigger crossing advances by eligible seconds across a break/grace boundary.
- Recovery crossing pauses/resets correctly around an ineligible interval.
- Integer-second precision and rounding only at response formatting.
- Invalid dates, reversed intervals, and impossible inputs are rejected.

### 16.2 Heartbeat validation and API tests

- Valid request returns 200 and the standard heartbeat envelope.
- Missing/invalid device headers return 400/401 through the existing boundary.
- Invalid UUIDs, timestamps, decimal strings, booleans, and unknown fields return 400.
- Zero, negative, signed, exponential, decimal, whitespace, leading-zero, and unsafe numeric sequence forms are rejected.
- Oversized body returns 413 through existing middleware.
- Unknown device, wrong key, missing key hash, and missing machine fail closed.
- Ingress, per-device, and IP-rotation rate-limit behavior remains bounded.
- Internal RPC messages are masked.
- The endpoint never accepts a dashboard JWT as device authentication.

### 16.3 Migration 011 PGlite tests

- Migration applies to the Phase 2 schema and is safe to reapply.
- Fresh schema/seed and migration paths are equivalent.
- Current settings become exactly one open history interval.
- Complete audit chains reconstruct versions and effective boundaries.
- Missing, duplicate, malformed, or non-contiguous audit versions roll back migration.
- Phase 2 settings PATCH success closes/inserts history atomically.
- Stale settings version, no-op PATCH, and audit failure preserve settings/history.
- Runtime rows provision only known sensors.
- RLS and grants deny anon/authenticated direct access and direct service-role mutation.
- RPC execution is service-role-only.

### 16.4 Heartbeat RPC tests

- First boot/sequence applies and uses database receipt time.
- Exact retry is duplicate/no-op.
- Same sequence with different content conflicts and rolls back.
- Lower sequence and lower boot counter are stale/no-op.
- Higher sequence applies.
- Higher boot counter with new boot ID resets safely.
- Same boot counter with changed boot ID conflicts.
- Future device timestamp is rejected; late diagnostic timestamp cannot refresh connectivity incorrectly.
- Activity true updates last activity; false does not.
- S-05 heartbeat updates connectivity but can never activate absence detection.
- Audit/constraint failures roll back the entire heartbeat state change.

### 16.5 Migration 012 and watchdog RPC tests

Test every state and boundary in `disabled`, `observe`, and `enforce` modes:

- Disabled sensor performs no operational transition.
- Observe mode records candidate state only.
- Enforce mode below threshold remains grace.
- Exact trigger boundary creates one downtime, alert, transition, and required audits.
- Repeated evaluations create no duplicates or revision noise.
- Evaluation tick after the boundary stores the exact calculated threshold-crossing start.
- Off-shift, break, and grace time do not accumulate toward a new absence.
- Pre-break grace resets at the next eligible interval.
- Existing downtime remains open across planned time.
- Offline device creates no production downtime.
- Connectivity warning alert is independent from the sensor operational alert.
- First recovery heartbeat enters recovering; one packet never resolves.
- Inactive/stale/offline observation resets recovery.
- Exact recovery boundary resolves one watchdog-created downtime.
- Event-created downtime keeps its current explicit recovery behavior.
- Watchdog-created downtime cannot be bypassed by one pulse/recovered event.
- `downtime/no_pulse` cannot bypass an enabled backend threshold.
- Explicit fault remains immediate and safely reuses/confirms an open watchdog incident.
- Settings disablement or global mode change does not auto-resolve open downtime.
- Settings version change during grace uses one locked consistent version.
- Machine status recomputation is correct with active, inactive, and faulted peer sensors.
- Simultaneous sensor evaluation preserves one open downtime per sensor.
- Forced downtime, alert, audit, runtime, or machine-write failure rolls back everything.
- Returned transition descriptors exactly match committed rows.
- Privilege tests reject direct client execution.

PGlite validates SQL logic but is not evidence of true multi-connection locking.

### 16.6 Service and runner tests

- Immediate startup cycle.
- No overlapping in-process cycle.
- Bounded concurrency and deterministic sensor order.
- One sensor failure does not stop others.
- Cycle timeout aborts or settles without unhandled rejection.
- Repeated failures wait for the next interval and do not busy-loop.
- Stop before start, double start, double stop, and shutdown during an in-flight cycle.
- Database result validation rejects malformed transition descriptors.
- Publisher exceptions are isolated after commit.
- In-memory metrics increment accurately and remain bounded.
- `WATCHDOG_MODE` and interval relationships fail fast at startup.

### 16.7 Downtime, dashboard, and report service tests

- Queries include downtime that starts before but overlaps the selected range.
- Raw, planned-excluded, and unplanned durations are consistent across all modules.
- Estimated loss uses unplanned seconds.
- Availability uses eligible scheduled time and returns null for zero denominator.
- Overlapping sensors are unioned once at machine level.
- Per-record durations remain independent and are not silently summed for totals.
- Concurrent causes are labeled without arbitrary double attribution.
- Current and historical schedule versions produce stable historical reports.
- Supabase paging retrieves more than one page without truncation or duplication.
- Settings/history query failure returns controlled errors with no hardcoded fallback.
- Existing response fields remain present; new fields are additive.

### 16.8 API security tests

- Admin-only watchdog diagnostics reject missing JWT, stale JWT role, inactive user, archived user, and all non-Admin roles.
- Heartbeat endpoint rejects JWT-only access and accepts only verified device credentials.
- Resource IDs cannot be changed through mass-assignment fields.
- Unknown HTTP methods do not mutate state.
- Errors contain stable codes and safe messages but no SQL, stack, key, token, payload hash, or internal IDs.
- Rate limits cannot be bypassed with untrusted forwarded headers or device-ID rotation.

### 16.9 Disposable real PostgreSQL concurrency tests

Run only in a disposable staging database:

- Two evaluators hit the same sensor at the trigger boundary.
- Watchdog evaluation races an explicit fault.
- Watchdog recovery races an explicit recovered event.
- Heartbeat ingestion races watchdog evaluation.
- Settings PATCH races watchdog evaluation.
- Two sensors on one machine transition simultaneously.
- Force deadlock-prone timing and verify lock order/retry behavior.

Expected result: one committed transition per logical state change, one open downtime per sensor, contiguous alert revisions, and no partial audit/state.

### 16.10 Restart, chaos, and load tests

- Stop backend before a trigger, wait, restart, and verify offline rather than false downtime.
- Restart during observe and enforce transitions.
- Simulate Supabase unavailable, slow, and recovered.
- Simulate delayed, duplicated, stale, reordered, and conflicting heartbeat packets.
- Simulate device reboot with higher boot counter.
- Run five devices at the 10-second heartbeat cadence for an extended soak.
- Verify rate-limit headroom, bounded memory, no timer accumulation, and stable database row counts.
- Verify no heartbeat history table grows during the soak.

### 16.11 Hardware and parallel-run acceptance

These tests block enforcement but not observe-mode implementation:

- Confirm each enabled sensor's physical signal interpretation.
- Confirm heartbeat cadence under normal Wi-Fi and EMI conditions.
- Disconnect Wi-Fi/device power without stopping production: expect offline, no production downtime.
- Stop production while device remains online: expect grace then candidate/enforced downtime.
- Resume briefly below recovery duration: expect no recovery.
- Resume continuously through recovery duration: expect one recovery.
- Cross each scheduled break and grace boundary.
- Compare observe-mode transitions against the manual log for multiple operating days.
- Record false positive, false negative, and timing-difference evidence per sensor.

## 17. Implementation Sequence and Commits

### Task 1: Operational-time domain engine

Files:

- Create `Backend/src/shared/operationalTime.js`.
- Create `Backend/tests/operationalTime.test.js`.

Work:

- Implement pure interval primitives and settings-history segmentation.
- Add the complete boundary, overlap, union, multi-day, trigger, recovery, and rounding tests first.

Commit:

```text
Calculate Operational Time
```

### Task 2: Migration 011 settings history and heartbeat runtime

Files:

- Create `Backend/database/migrations/011_add_settings_history_and_watchdog_runtime.sql`.
- Update `Backend/database/schema.sql` and `Backend/database/seed.sql`.
- Create `Backend/tests/watchdog-runtime.migration.pglite.test.js`.
- Extend settings migration/service tests.

Work:

- Add history, runtime state, transition evidence, grants, and heartbeat ingestion RPC.
- Replace the settings update RPC compatibly so history, settings, and audit remain atomic.

Commit:

```text
Add Heartbeat Runtime Storage
```

### Task 3: Heartbeat API and simulator

Files:

- Create `Backend/src/modules/iot/heartbeat.model.js`.
- Create `Backend/src/modules/iot/heartbeat.controller.js`.
- Extend `Backend/src/modules/iot/iot.service.js` and `iot.routes.js`.
- Extend `Backend/scripts/simulate-sensor-events.js` or add a focused heartbeat simulator.
- Add service and API tests.

Work:

- Implement strict heartbeat validation, existing device auth/rate limits, controlled outcomes, and deterministic simulator ordering.

Commit:

```text
Add Device Heartbeat Api
```

### Task 4: Migration 012 atomic watchdog transitions

Files:

- Create `Backend/database/migrations/012_add_atomic_watchdog_transitions.sql`.
- Update fresh schema parity.
- Extend the existing ingestion RPC carefully.
- Create `Backend/tests/watchdog-transition.migration.pglite.test.js`.
- Update migration 007 fixture boundaries so later schema functions do not make legacy tests fragile.

Work:

- Add downtime source attribution, per-sensor evaluation RPC, state machines, connectivity alerts, operational alerts, audits, and committed transition descriptors.
- Preserve legacy event behavior where explicitly required and prevent threshold/recovery bypasses.

Commit:

```text
Add Watchdog Transitions
```

### Task 5: Watchdog runner and diagnostics

Files:

- Create the watchdog repository/service/runner/metrics modules.
- Extract the committed transition publisher from the IoT service.
- Update `Backend/src/server.js`, environment validation, and operations routes.
- Add runner, shutdown, diagnostics, and API authorization tests.

Work:

- Start in `disabled` mode, add immediate/non-overlapping cycles, timeouts, safe shutdown, structured metrics, and Admin diagnostics.

Commit:

```text
Run Sensor Watchdog
```

### Task 6: Break-aware downtime and analytics

Files:

- Add a small settings-history repository.
- Update downtime, dashboard, and report services.
- Extend their unit/API tests.

Work:

- Correct overlap queries, apply one operational-time engine, union machine downtime, preserve raw duration, and add break-aware fields.

Commit:

```text
Apply Break Aware Metrics
```

### Task 7: Documentation and release evidence

Files:

- Update database guide, environment example, architecture, PRD/TDD boundary notes, Configure.md, phase plan, and runbook.
- Add documentation contract tests.

Work:

- Document firmware contract, modes, deployment order, diagnostics, incident response, and evidence from all verification gates.

Commit:

```text
Align Phase 3 Operations Docs
```

## 18. Deployment and Rollback Plan

### Stage 1: additive database foundation

1. Back up the staging database.
2. Apply migration 011 in disposable staging.
3. Verify history reconstruction and runtime rows.
4. Apply migration 012 and verify its evaluator, ownership, and privilege contracts.
5. Deploy the completed backend with `WATCHDOG_MODE=disabled`.
6. Verify old event ingestion and the Phase 2 settings API remain compatible.

The completed backend must not start between migrations 011 and 012 because its runner expects the migration 012 evaluator RPC even in disabled mode. Only the earlier heartbeat-API-only commit can be deployed after migration 011 alone.

### Stage 2: heartbeat protocol

1. Update the simulator and firmware with boot counter/boot ID/sequence.
2. Send heartbeats while the watchdog remains disabled.
3. Verify ordering, rate limits, connectivity timestamps, restart behavior, and no unbounded row growth.

### Stage 3: observe mode

1. Change the deployed watchdog runner to `WATCHDOG_MODE=observe` and restart it.
2. Keep every sensor's Phase 2 absence flag disabled initially.
3. Enable observation for one physically validated sensor configuration at a time without operational enforcement.
4. Compare transition evidence with the manual log.

### Stage 4: controlled enforcement

1. Close the physical and parallel-run gates for the selected sensor.
2. Set valid trigger and recovery values.
3. Enable that sensor's Phase 2 flag.
4. Change global mode to `enforce` in a controlled maintenance window.
5. Start with one approved sensor, recommended S-03 only after its continuous-signal and recovery timing are validated.
6. Monitor diagnostics, alerts, false positives, and false negatives before enabling another sensor.
7. Never enable S-05.

### Immediate rollback

If behavior is unsafe:

1. Set `WATCHDOG_MODE=disabled` and restart the backend.
2. Do not drop tables, history, runtime evidence, downtime, alerts, or audits.
3. Reconcile any already-open watchdog incidents through the authorized downtime workflow and document the reason.
4. Fix forward with a new migration/code commit.
5. A previous backend may be deployed only after confirming it remains compatible with the additive migrations and modified settings RPC signature.

## 19. Definition of Done

Phase 3 is complete only when:

- Heartbeat and activity semantics are documented and implemented in simulator/firmware.
- Connectivity loss cannot create production downtime.
- Watchdog state survives backend restart.
- Disabled, observe, and enforce modes behave exactly as documented.
- S-05 absence detection is impossible.
- Trigger and recovery boundaries use eligible operational seconds.
- One heartbeat cannot bypass sustained recovery.
- Event ingestion and watchdog evaluation cannot create competing or partial transitions.
- Settings history prevents schedule edits from rewriting later historical reports.
- Downtime overlapping a report window is included even when it started earlier.
- Machine availability and loss do not double-count simultaneous sensor downtime.
- Break, grace, and off-shift time are excluded consistently across downtime, dashboard, and reports.
- All database mutations and required audits are atomic.
- All errors are controlled and internal details are masked.
- Focused, full backend, frontend regression, build, disposable PostgreSQL concurrency, restart, soak, and hardware observe-mode tests pass.
- Enforcement remains disabled until physical sign-off and parallel-run evidence exist.
- Documentation states exactly what is active and what remains Phase 4.

## 20. Implementation Evidence

Implemented commits:

- `0729ae1` Calculate Operational Time
- `0d67e76` Add Heartbeat Runtime Storage
- `74dd7fe` Add Device Heartbeat Api
- `21c85aa` Add Watchdog Transitions
- `a77e042` Run Sensor Watchdog
- `71d209d` Apply Break Aware Metrics

Automated verification completed on 2026-08-22:

- Backend: `npm test` - 208 passed, 0 failed.
- Frontend: `npm test` - 28 files and 201 tests passed, 0 failed.
- Frontend: `npm run build` - production build completed successfully.
- Migration 011/012, privilege, atomic rollback, heartbeat ordering, watchdog modes, runner lifecycle, overlap, history, pagination, dashboard, downtime, and report tests are included in the backend result.

These results complete the local automated implementation gate. They do not replace disposable real-PostgreSQL multi-connection races, extended restart/soak tests, physical sensor classification, calibration, or the manual-log parallel run. Those checks still block `WATCHDOG_MODE=enforce`.

## 21. Approval Boundary

Approval of this plan authorizes implementation of the additive database foundation, heartbeat API, observe-mode watchdog, and break-aware calculation engine.

It does not authorize production enforcement. Moving any sensor to enforced absence detection requires separate evidence and approval after the physical and parallel-run gates in Sections 7 and 16.
