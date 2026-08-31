# Whole System Audit

Date: 2026-08-24

Last updated: 2026-08-31

Scope: Frontend, backend, database, API security, reliability, performance, documentation, testing, and production readiness.

Excluded from this audit as requested:

- The seeded Admin password.
- User account creation and onboarding.

## Verdict

The system is locally stable and suitable for continued development, but it is not production-ready yet. One access-policy decision and several reliability and performance improvements should be addressed before enabling physical sensors or watchdog enforcement.

No application code was changed during the original audit. Findings that have since been addressed are removed from this document after their implementation and regression evidence are verified.

## High-Priority Findings

### 1. Assistant Operation Manager edit access remains unresolved

Managing Director read access is now implemented across database, backend, and frontend. Remaining mismatch: PRD says Assistant Operation Manager has the same operational access as Operation Manager, but the assistant cannot edit downtime.

Evidence:

- Backend policy: `Backend/src/modules/downtime/downtime.routes.js:13`
- Frontend policy: `Frontend/src/features/dashboard/downtime/DowntimeSection.jsx:27`

Recommended fix: confirm whether Assistant Operation Manager may edit downtime, then align backend policy, frontend controls, and tests with one authoritative RBAC matrix.

## Reliability and Performance Findings

### 2. Most Supabase requests have no server-side deadline

The frontend aborts ordinary requests after 15 seconds, but most backend Supabase calls do not receive an abort signal or database deadline. A backend query can continue using resources after the frontend has already stopped waiting.

Watchdog evaluation and SSE authorization revalidation have cancellation handling, but dashboard, reports, downtime, audit, machines, and most other database operations do not.

Recommended fix: add request-scoped cancellation and bounded Supabase query deadlines. Return controlled timeout responses and record upstream timeout metrics.

### 3. A watchdog timeout can leave the runner stuck

The watchdog reports a timeout through `Promise.race()`, but its `finally` block waits for the original work promise to settle before clearing `inFlight` and scheduling another cycle.

Evidence: `Backend/src/modules/watchdog/watchdog.runner.js:48-100`.

This prevents overlapping database mutations, which is correct for safety. However, a database request that never settles can stop all future watchdog cycles.

Recommended fix: guarantee that the database transport terminates after abort, track how long a timed-out cycle remains in flight, and add a controlled stuck-runner recovery policy.

### 4. Some audit records are not transactional

Machine, sensor, and downtime state can commit before the separate audit-log insert. Audit failures are caught and logged without failing the original operation.

Evidence:

- Best-effort audit insert: `Backend/src/modules/audit/audit.service.js:116-134`
- Machine status audit: `Backend/src/modules/machines/machines.service.js:119-129`
- Sensor status audit: `Backend/src/modules/machines/machines.service.js:152-162`
- Downtime update and later audit: `Backend/src/modules/downtime/downtime.service.js:293-325`

Recommended fix: move each critical mutation and its audit record into one transactional PostgreSQL RPC. Publish SSE events only after the transaction succeeds.

### 5. Downtime pagination loads the full filtered history

The downtime service retrieves every matching record in pages of 500, computes metrics for the full result, sorts it in Node.js, and only then returns the requested page.

Evidence: `Backend/src/modules/downtime/downtime.service.js:139-156` and `227-243`.

This becomes increasingly expensive as historical records grow, especially when no date filter is supplied.

Recommended fix: require a bounded date range, retrieve the requested page in PostgreSQL, and calculate summary metrics through a separate bounded aggregation RPC.

### 6. Health checking verifies only process liveness

`GET /api/health` always returns `status: ok` while the Express process is running. It does not verify Supabase connectivity, migration compatibility, or critical dependencies.

Evidence: `Backend/src/app.js:33-39`.

Recommended fix:

- `/api/health/live`: confirms the Node process is running.
- `/api/health/ready`: performs a short, read-only database check and confirms the expected migration level.

### 7. Graceful shutdown has no enforced completion deadline

The shutdown handler starts `server.close()` but does not await completion or forcibly close remaining connections after a bounded deadline.

Evidence: `Backend/src/server.js:17-32`.

Recommended fix: await server closure, add a hard shutdown deadline, close idle connections, and handle server listen errors.

### 8. IoT metadata is insufficiently bounded

The sensor-event endpoint accepts an arbitrary metadata object under the application's 100 KB JSON body limit.

Evidence:

- Body limit: `Backend/src/app.js:27`
- Metadata validation: `Backend/src/modules/iot/iot.model.js:21-38`

A valid or compromised device could repeatedly submit large or deeply nested metadata and increase database storage and processing cost.

Recommended fix: allow only defined metadata keys, limit nesting and string sizes, apply a smaller IoT request limit, and define retention or storage quotas.

### 9. Operational response caching is inconsistent

Settings, Live Monitoring, and Watchdog Diagnostics correctly return `Cache-Control: no-store`. Alerts, Reports, Overview, Audit, authentication responses, and some operational diagnostics do not consistently apply the same policy.

Express can therefore return ETag-based `304` responses for operational data even though backend database work has already occurred.

Recommended fix: standardize `Cache-Control: no-store` for authenticated, sensitive, and rapidly changing operational responses. Keep SSE on `no-cache, no-transform`.

### 10. Production observability is incomplete

Current production logging lacks consistent request identifiers, structured request latency, upstream database timing, persistent watchdog metrics, and alerting thresholds. Watchdog and SSE counters are stored only in process memory and reset after restart.

Recommended fix: introduce structured redacted logs, request IDs, database duration and timeout metrics, persistent monitoring, and alert thresholds for repeated watchdog, API, SSE, and authentication failures.

### 11. Horizontal scaling is not currently safe

Rate limits, SSE connections, EventEmitter notifications, and operational counters are process-local. Multiple backend instances would not share these states or guarantee consistent event delivery.

Recommended fix: keep deployment explicitly single-instance for now. Before horizontal scaling, add shared rate-limit storage, distributed pub/sub, persistent metrics, and a documented trusted-proxy topology.

### 12. Most authoritative documentation remains untracked

The broken links previously listed in `docs/README.md` have been removed. This audit is now deliberately force-tracked, but `docs/` remains ignored by Git, so other locally available planning and architecture documents are not automatically included when the repository is pushed.

Recommended fix: deliberately track every authoritative project document and verify repository links from a clean checkout.

## Remaining Requirement Gaps

The following requirements remain incomplete:

- Historical process-event log for S-01, S-02, and S-04.
- PDF report export; CSV export exists.
- Machine registration and complete machine metadata editing.
- Downtime-cause category management.
- Physical ESP32 validation and calibration.
- Production deployment, monitoring, backup, and recovery evidence.
- ISO 25010 and UTAUT evaluation evidence.

Physical sensor validation remains a production blocker, not a current code-test failure.

## Verified Remediation Added 2026-08-31

The IoT ingestion wrapper previously sent `downtime/no_pulse` through legacy immediate-downtime processing whenever absence detection was disabled or the sensor was S-05. This allowed planned-break observations and S-05 silence to create false downtime and Critical alerts.

Migration `023_route_no_pulse_through_watchdog.sql` now routes every `downtime/no_pulse` input to observational ingestion. Only watchdog evaluation may create absence-owned downtime after schedule, break, grace, threshold, sensor-enablement, and S-05 checks. Explicit `fault/fault` events remain immediate, including during breaks. No historical records are rewritten.

Regression evidence covers disabled S-01 during production and a planned break, S-05, enabled-threshold behavior, explicit break-time faults, migration reapplication, raw-event retention, and absence of downtime and alerts.


## Controls That Are Working Well

- Frontend traffic goes through Express rather than accessing Supabase directly.
- Helmet, CORS allowlisting, body limits, JWT validation, and role checks are present.
- Device credentials, source-IP rate limiting, and verified-device rate limiting protect IoT ingestion.
- Heartbeat ordering and idempotency are enforced in PostgreSQL.
- Settings, heartbeat, alerts, and watchdog mutations use atomic database functions.
- Watchdog supports disabled, observe, and enforce modes.
- S-05 is protected from absence detection.
- Disabled watchdog mode schedules no evaluation cycles while heartbeats remain accepted.
- SSE includes authorization revalidation, expiry handling, connection limits, heartbeat frames, cleanup, and polling fallback.
- Live Monitoring uses one snapshot RPC and strict response validation.
- Loading, error, empty, stale, and retry states have substantial frontend coverage.
- Environment files are ignored by Git.

## Verification Results

| Gate | Result |
|---|---:|
| Backend full suite | 291/291 passed |
| Watchdog transition migration suite | 15/15 passed |
| No-pulse disabled/break/S-05 regression | 2/2 passed after both failed before the fix |
| Frontend isolated suite | 250/250 passed across 40 files |
| Frontend production build | Passed |
| Hosted Supabase service-role read-only integration | Skipped because `RUN_SUPABASE_INTEGRATION_TESTS=true` was not enabled |
| Backend production dependency audit | 0 vulnerabilities |
| Frontend production dependency audit | 0 vulnerabilities |
| `git diff --check` | Passed |
| Token-session stream regression | 34/34 passed in five consecutive focused runs after deterministic synchronization |
| Branch integration check | Synchronized with `origin/main` without conflicts; backend 291/291, frontend 250/250, and production build passed afterward |

Heavy frontend and PGlite suites were run sequentially to avoid Windows worker starvation. All final gates passed. Hosted migration `023` application and live device traffic remain deployment checks because no physical ESP32 nodes are integrated.

## Recommended Fix Order

1. Confirm and implement the authoritative Assistant Operation Manager permission matrix.
2. Add backend database deadlines and watchdog stuck-cycle recovery.
3. Make remaining critical state changes and their audit records transactional.
4. Move downtime pagination and metrics aggregation into bounded database queries.
5. Implement the historical process-event log.
6. Add readiness checks and production observability.
7. Resolve documentation tracking.
8. Begin physical sensor validation only after the software hardening gates pass.

Deployment verification, not an open code finding: apply pending migrations through `Backend/database/migrations/023_route_no_pulse_through_watchdog.sql` to hosted Supabase. Run live negative access checks for public, anonymous, and authenticated roles, then verify disabled, break-time, and S-05 `no_pulse` inputs create no downtime or alerts.

## Readiness Decision

Development ready: Yes.

Phase 5 software hardening ready: Yes.

Physical deployment ready: No, because physical sensors are not available for validation.

Watchdog observe ready: Only after the remaining software hardening and migration `016` access controls are verified in the hosted environment.

Watchdog enforce ready: No. It remains blocked by physical sensor validation, calibration, concurrency testing, restart and soak evidence, and manual-log comparison.
