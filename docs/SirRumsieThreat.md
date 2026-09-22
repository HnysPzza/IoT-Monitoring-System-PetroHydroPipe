# Petro Hydro Pipe Corp. — Security Threat & Risk Assessment (Simplified)

**System**: IoT-Based Pipe Manufacturing Machine Monitoring System
**Source**: `Sir Rumsie Activity.docx` — 10 threat scenarios
**Method**: Every claim below was verified directly against the codebase (Backend, Frontend, database schema/migrations).
**Last updated**: September 22, 2026

Each asset follows the same pattern: the threat, what's already working, what's missing, and the fix.

**Status legend**: ✅ Fully implemented · 🟡 Near-complete (minor gap) · 🟠 Partially implemented · ❌ Core control missing · ⚠️ Hardware gate (cannot be verified in this repo)

---

## Status at a Glance

`DONE` means the control is implemented and locally verified. It does not mean hosted or hardware verification is complete. `PARTIAL` means a specific control is still missing. `HARDWARE GATE` means the repository cannot verify it.

| Asset | Status | Done | Not done / remaining |
| --- | --- | --- | --- |
| 1. Administrator credentials | **DONE - DEVELOPMENT** | Password policy, bcrypt, setup/change flow, session revocation, login protection, and focused regressions. | Hosted HTTPS, proxy, cookie, and shared rate-limit verification. |
| 2. ESP32 nodes and firmware | **HARDWARE GATE** | Backend heartbeat and absence-watchdog support. | Firmware security, enclosures, wiring, flash protection, and physical inspection. |
| 3. IoT telemetry ingestion | **DONE - DEVELOPMENT** | Device authentication, rate limits, validation, idempotency, stale-event classification, and atomic ingestion. | Hosted migration/deployment verification, physical-device proof, and historical review of pre-classification rows. |
| 4. S-03 downtime records | **DONE - DEVELOPMENT** | Grouped S-03 ownership, watchdog/recovery rules, S-05 isolation, actor-attributed atomic audit logging, retry idempotency, and local regressions. | Hosted migration/permission/backup verification and machine-floor validation. |
| 5. S-05 output counts | **NEAR-COMPLETE - HOSTED MIGRATION REPORTED** | Local control is implemented and verified; the user reports migration 044 has been added to Supabase. | Readiness/permission verification, a post-migration classified event, measured firmware/electrical debounce, physical cutter validation, and review of pre-migration unclassified rows. |
| 6. Database and secrets | **DONE - LOCAL ONLY** | RLS, restricted grants, backend-only service-role access, environment validation, and local recovery drill. | Production secret injection, real-project backup/restore, retention, and recovery-time evidence. |
| 7. JWT tokens and sessions | **DONE - DEVELOPMENT** | In-memory access tokens, HttpOnly rotating refresh cookies, session lineage, replay detection, and local browser/regression checks. | Hosted HTTPS, CORS/proxy/cookie verification, expired-row cleanup, and shared rate limiting before scaling. |
| 8. Real-time SSE stream | **DONE - SINGLE PROCESS** | Authentication, revalidation, connection caps, backpressure limits, keepalive, and bounded lifetime. | Cross-process/shared connection state; the current deployment remains single-process. |
| 9. Operational settings | **DONE** | Admin authorization, optimistic locking, effective-dated history, and transactional audit logging. | No documented control gap. |
| 10. Historical reports and exports | **DONE** | Server-side CSV/PDF generation, role checks, bounded dates, throttling, audit trail, and CSV hardening. | The lower-risk summary endpoint has no per-user rate limit. |

**Current local verification**: backend `525/525` tests passed with serialized database workers, including the downtime-audit rollback and retry-idempotency regressions; frontend `354/354` tests passed across 48 files; the frontend production build passed. Threat #5 focused regressions pass, and local readiness is version `44`. These results do not close hosted or hardware gates.

---

## 1. Administrator Credentials — ✅ Fully implemented for development; deployment verification pending

**Inherent risk**: 4 × 5 = 20 (Critical — highest in the document)
**Threat**: Brute-force login, credential guessing, or stolen passwords reaching the management interface.

**Implemented controls**
- New passwords require at least 12 characters, at most 72 UTF-8 bytes, lowercase, uppercase, a number, and ASCII punctuation. Whitespace alone is not a special character. Setup and change-password enforce the same policy; login accepts existing credentials so legacy users can rotate them.
- Passwords use bcrypt cost 10. New accounts receive a hashed, one-hour, single-use setup token; no administrator-assigned password is emailed.
- `POST /api/auth/change-password` verifies the current password. The completion RPC changes the hash, clears the legacy flag, revokes all sessions/refresh tokens, and audits atomically.
- Flagged sessions cannot access business endpoints; the frontend sends them to password change.
- Protected requests check the current account and JWT session ID. Revoked sessions cannot authenticate subsequent requests; already-running requests are not recalled.
- Access JWTs default to 30 minutes, bounded to 15–60 minutes. Refresh sessions retain an absolute eight-hour lifetime.
- Migration 030 rechecks the verified password hash under the account lock during session creation. Login preceding password change is revoked; login following a password change rejects the stale verified hash.
- Migration 031 writes session issuance, last-login time, and LOGIN_SUCCESS together. Failed-login audit persistence errors produce a controlled failure and sanitized server log.
- Login remains limited to 10 requests per IP per 15 minutes. Public setup and authenticated password changes have separate allowances; password changes also have a 100-request IP ingress cap and 10-request account cap per 15 minutes.
- Password endpoint limits return JSON and Retry-After; parser errors no longer expose parser wording.
- The operational seed creates no accounts and cannot reset administrator credentials, profile data, or password-change flags.

**Verification and remaining gates**
- Focused regressions cover password categories/boundaries, legacy login compatibility, limiter isolation, safe errors, session race ordering, login audit rollback, and account-free seed reapplication.
- September 7: 396 backend tests passed, and four real PostgreSQL connection tests passed, including both login/password-change race orderings. Browser geometry checks confirmed the legacy form fits 1366x768, 390x844, and 375x667 viewports without page scrolling.
- Current development verification uses the migration chain through 044; `get_backend_readiness()` returns 44, and the database has exactly one active, ready, non-archived Admin.
- When hosting begins, deploy the matching backend and verify HTTPS, proxy topology, cookies, and shared rate-limit enforcement.
- Do not infer password strength from an existing bcrypt hash. The new policy applies when setting or changing passwords; existing passwords are not automatically reset.
- Process-local rate limiting remains appropriate for one backend process. Verify HTTPS, proxy topology, cookies, and shared rate-limit enforcement before multi-instance deployment.
- For fresh installations, provision exactly one private Admin before 029; operational seed data provides no default account.

---

## 2. ESP32 Sensor Nodes & Edge Firmware — ⚠️ Hardware gate

**Inherent risk**: 3 × 5 = 15 (High)
**Threat**: Physical tampering, unauthorized re-flashing, or simply unplugging a sensor on the factory floor.

**What's working (software side, verified)**
- Sensor heartbeats are ingested, and a batched absence watchdog flags sensors that stop reporting.

**What cannot be verified here**
- There is no firmware in this repository, so flash encryption, secure boot eFuses, UART/JTAG lockdown after provisioning, and IP65 locked enclosures are all unverifiable claims.

**The fix**
- Treat this as a physical inspection checklist, not a code task. Before the defense, either show the enclosures/fuses or state plainly that these controls live at the hardware layer.

---

## 3. IoT Telemetry Ingestion (`/api/iot/events`) — ✅ Complete for development; deployment verification pending

**Inherent risk**: 3 × 5 = 15 (High)
**Threat**: A rogue device or an attacker with a device key spoofing events, replaying old packets, or flooding the endpoint.

**What's working**
- Bcrypt device authentication via decoupled `x-device-id` / `x-device-key` headers.
- Two-tier rate limiting: 300/min per IP, then 120/min per verified device.
- 100kb JSON body cap, strict schema validation, rejection of timestamps more than 5 minutes in the future, and device-event-ID reuse detection. This is not a five-minute maximum age for delayed events.
- Idempotent ACID ingestion RPC with a monotonic timestamp watermark that blocks machine-state regressions.

**Implemented September 6**
- Migration `028_persist_telemetry_staleness.sql` adds a database-owned `stale` classification. A shared insert trigger uses the locked sensor watermark, covering both legacy ingestion and watchdog observations in their existing transactions. Caller-supplied classifications are overwritten.
- Stale rows remain raw evidence, but no longer contribute to the shared Overview, Analytics, Reports, and output-loss pulse aggregation. The all-time start lookup uses the same exclusion.
- The live snapshot also excludes stale events, closing an equal-timestamp UUID tie that could otherwise display a rejected event as the latest observation.
- Exact event-ID retries remain idempotent; conflicting reuse stays rejected. Stale events still cannot advance current state or watchdog recovery.
- Backend readiness now requires version 28 and an enabled classification trigger. Focused local regression tests cover counts, both ingestion paths, legacy rows, permissions, readiness, and snapshot ties.
- Historical September 6 verification: 371 backend tests passed with zero failures or skips; a separate disposable PostgreSQL 18 concurrency test passed. The concurrency test verified that an older request waits for the newer transaction, persists `stale = true`, and leaves the aggregate count at one. The current local test count is recorded in the status summary above.

**Status: Complete for development**
- Migration 028 remains the stale-event milestone; the current migration chain continues through 044. Restart the matching backend and verify `/api/health/ready` returns HTTP 200 with readiness version 44.
- Existing rows receive `stale = NULL`, meaning unclassified. They retain their previous contribution through `stale IS NOT TRUE`; no historical records are deleted or falsely marked verified. Historical count inflation is not automatically repaired.
- Newly classified stale pulses are excluded even if they were legitimate delayed events. Supporting offline buffered production requires a separate reconciliation rule. New timestamps and IDs from a compromised device can still fabricate activity; this is not physical-event verification.
- Timestamp uniqueness was deliberately not added: separate legitimate events can share device timestamp precision. See `RUNBOOK.md` for migration and validation steps.

---

## 4. Machine Downtime Records (Sensor S-03) — ✅ Complete for local development; hosted and hardware verification pending

**Inherent risk**: 3 × 4 = 12 (Medium)
**Threat**: An operator or supervisor falsifying or suppressing downtime to inflate availability KPIs.

**What's working**
- Downtime causes are locked to a fixed enum and, for S-03, locked at the database level (a trigger rejects cause changes for non-S-03 sensors).
- Operators can review supported cause and notes fields without controlling sensor-managed recovery.
- Base tables are SELECT-only for the backend role — there is no delete or update path to exploit from the client side.
- Migration `032_grouped_downtime_rule.sql` now applies one backend-owned predicate: S-03 fault immediately confirms downtime, or unresolved faults on S-01, S-02, and S-04 together confirm one S-03-owned downtime interval.
- A single process fault remains a process issue. Process faults can accumulate at different times; the third outstanding fault starts downtime at its own event time. Watchdog-confirmed process faults use the same rule.
- Migration `034_route_output_telemetry_through_grouped_reconciliation.sql` fixes the normal-telemetry fallback so a process-only fault cannot revive the legacy any-fault machine-downtime status.
- Migrations 035 through 044 preserve audit ownership, threshold timing, Idle classification, S-03 authority, reconnect and break baselines, watchdog recovery, atomic downtime auditing, S-05 output classification, and release readiness 44.
- Direct event, watchdog, recovery, duplicate, stale, alert, API response, SSE owner, and simulator regressions are covered by focused local tests. S-05 remains output-only.
- The Machine Module is read-only: it cannot force machine or sensor status, and migration 032 revokes the legacy manual-recovery RPC from the backend role. Only accepted sensor telemetry or qualified watchdog recovery can clear a condition.
- Migration `043_atomic_downtime_update_audit.sql` adds a service-role-only six-argument downtime RPC that receives the authenticated actor, locks the row, updates it, and inserts `DOWNTIME_UPDATED` in the same transaction. The Express service no longer performs a separate best-effort audit insert.
- Invalid actor foreign keys roll the state change back, and repeating an identical update is a no-op so retries do not duplicate the audit trail.

**What's missing**
- The hosted Supabase project still needs a backup, forward-only migration review through 044, permission/readiness verification, and an end-to-end deployment run.
- The physical S-03 movement sensor/interface still needs machine-floor validation, including electrical isolation/level shifting, polarity, debounce, and fail-safe behavior.

**The fix**
- The local fix is implemented in migration 043: the mutation and audit now commit atomically, actor attribution comes from the authenticated request, and identical retries do not add a second audit row.
- For deployment, back up the hosted database, apply each unapplied forward migration through 044 in order, restart the matching backend, confirm readiness 44 through `/api/health/ready`, inspect a manual S-03 edit and its audit row, and run the named direct-S-03 and grouped simulators. Then validate the S-03 target, electrical isolation/level shifting, polarity, debounce, and fail-safe behavior on the real machine.

---

## 5. Pipe Output & Count Records (Sensor S-05) — 🟡 Near-complete for local development; hosted and hardware verification pending

**Inherent risk**: 3 × 4 = 12 (Medium)
**Threat**: Fabricated production counts — from sensor contact bounce, manual pulse generation, or replay.

**What's working**
- A database trigger permanently blocks S-05 downtime creation.
- Watchdog/no-pulse observations cannot create output state or downtime.
- Migration `044_validate_s05_output_pulses.sql` retains each S-05 pulse as raw evidence and classifies it against the latest non-stale S-03 activity and overlapping downtime.
- Stationary, S-03 downtime, stale, and sub-100 ms bounce pulses receive explicit rejection reasons and do not advance S-05 state/watermark.
- The shared aggregation, Analytics start-date, Reports, output-loss, and live-snapshot paths exclude explicitly rejected S-05 pulses.
- Exact event retries return the stored classification without replaying state transitions.

**What's missing**
- Supabase migration 044 was reported as applied, but readiness/permission verification and a post-migration classified event are still pending. The latest supplied query shows `recent_events = 0`, `classified_recent_events = 0`, and the latest S-05 row from September 11, so the new classifier has not yet been exercised in Supabase.
- Physical cutter-cycle correlation, sensor polarity, electrical isolation/level shifting, and measured firmware debounce remain unverified because no ESP32 hardware is in this repository.
- The 100 ms server debounce floor is a provisional safeguard based on the documented firmware example; replace or calibrate it from measured machine behavior before production enforcement.
- Rows from before migration 044 have `output_accepted = NULL` and remain historical/unclassified. They need separate evidence and review; the migration does not guess their validity.

**The fix**
- Migration 044 cross-checks each new S-05 pulse against S-03 evidence at the pulse timestamp, rejects pulses during stationary state or S-03-owned downtime, applies a server debounce floor, and filters rejected rows from every shared count consumer while preserving raw evidence.
- Before marking this threat fully complete, confirm `get_backend_readiness()` returns 44, verify the deployed backend's `/api/health/ready`, send a controlled post-migration event through the ingestion API in a disposable environment, calibrate the physical cutter/firmware debounce, and run a parallel hardware observation proving accepted and rejected cycles.

---

## 6. Supabase Database & Environment Secrets — ✅ Complete for local development; hosting pending

**Inherent risk**: 2 × 5 = 10 (Medium)
**Threat**: Direct database hijacking, SQL injection, or `.env` secret exfiltration.

**What's working**
- Row Level Security on all base tables; direct `anon`/`public` access revoked — the Express backend is the only gateway, using parameterized queries.
- `Backend/.env` is gitignored and untracked (only `.env.example` files are committed).
- `JWT_SECRET` must be at least 24 characters, validated at boot; production fails fast if any required secret is missing.
- September 5 local verification: base-table security/configuration checks passed; an isolated PostgreSQL backup restored 10,000 synthetic downtime records with grants, constraints and session RPC behavior intact. See `RUNBOOK.md` for the reproducible drill.

**What's pending for hosting**
- Secrets sit in plaintext `.env` on the host — acceptable for this deployment tier, but not a secrets manager.
- Actual project backup availability, retention, acceptable data loss/recovery time, and restoration of a real project backup remain unverified. The successful synthetic local drill does not verify these production controls.

**The fix**
- In production, provision `SUPABASE_SERVICE_ROLE_KEY` and `JWT_SECRET` via environment injection or a secrets manager. Schedule one backup-restore verification drill.
- Use the deployment and actual-project recovery gates in `RUNBOOK.md`. RLS does not block a stolen service-role key; restricted grants and backend-only secret handling remain necessary.

**Related loading improvement**: Detailed downtime calculations are now limited to the requested page, preserving full-result summaries. Local synthetic benchmarks show reduced service work; full database pagination/summary replacement is deferred because existing SQL helpers do not exactly match operational-time semantics. This performance change does not close item 6's remaining deployment/recovery gates and needs no migration.

---

## 7. JWT Tokens & Active Browser Sessions — ✅ Fully implemented for development; hosting not started

**Inherent risk**: 2 × 4 = 8 (Medium)
**Threat**: XSS or network eavesdropping stealing the session token and replaying it.
**Implemented**: September 5, 2026 (in-memory access token + rotating HttpOnly refresh cookie).
**Current status**: Application code, local regression coverage, and development migrations 026 and 027 are complete. The project is still in development, so hosted HTTPS/Supabase verification has not started and is intentionally deferred until deployment.

**What's working now**
- **No tokens in localStorage, ever.** The access token lives only in React state; any pre-fix `iot_monitoring_auth` entry is removed on app boot. This removes persistent token theft, but does not make an injected script harmless: it can still act as the signed-in user or capture an in-memory bearer token until it expires.
- **15–60 minute JWT window met.** Access tokens now default to 30 minutes (`ACCESS_TOKEN_EXPIRES_MINUTES`, bounded 15–60 in `config/env.js`), replacing the hardcoded 8 hours.
- **Secure storage at rest.** The refresh token is an HttpOnly, SameSite=Strict cookie scoped to `path=/api/auth` (Secure in production) — invisible to JavaScript, never sent on telemetry, analytics, or SSE requests.
- **No response caching.** Login, refresh, and logout responses send `Cache-Control: no-store` so bearer tokens are not retained by compliant browser or intermediary caches.
- **Absolute session expiry.** Refresh tokens live 8 hours from login; rotation preserves the original expiry in both database row and cookie. Migrations 026 and 027 store only token hashes and add explicit session lineage. Expired ancestors cannot revoke newer sessions.
- **Atomic rotation and reuse detection.** Auth RPCs lock the account before changing session/token rows. Rotation returns safe user data in the same transaction; active-token replay revokes all account sessions and records `REFRESH_TOKEN_REUSED`. Logout through any ancestor revokes its whole session family. A failed safe-user lookup rolls back the rotation without consuming the original token.
- **Multi-tab coordination.** Modern browsers use same-origin Web Locks and BroadcastChannel to share one refresh result across tabs; browser tabs also clear local auth together on logout. Lock acquisition is bounded and never falls back to an uncoordinated refresh after timeout.
- **Real refresh-cookie logout.** `POST /api/auth/logout` revokes the presented token's session family and clears the cookie. The UI clears immediately. Login, logout, and refresh share the browser lock; late restore results and old-account write retries are rejected.
- **Bounded recovery.** Staggered failures reuse the replacement access token. Waiting callers retain their own cancellation/deadline without cancelling other callers. A failed retry notifies the replacement session rather than the obsolete token. SSE updates its active token after recovery.
- **Session identity binding.** JWT `sub` and `sid` are checked against the current browser session before accepting refresh results or retrying a request, preventing delayed old-account writes and cross-account session adoption.
- **Existing controls remain.** Every protected request revalidates current role/status; SSE revalidates every 60 seconds, refreshes only after a 401, and treats a 403 as terminal rather than rotating tokens in a loop.

**Verification evidence**
- 356 backend tests pass, including migration, rollback, privilege, and real PostgreSQL concurrency checks; 286 frontend tests pass; frontend production build passes.
- Migrations 026 and 027 are complete in the development workflow. No hosted migration or production environment was independently queried from this workspace.
- Disposable-account smoke test passes login, JWT identity, cookie rotation, replay revocation, and logout.
- Chrome DevTools passes login, reload restore, no localStorage token, unreadable refresh cookie, two-tab single refresh, logout during delayed refresh, account-switch protection, bounded refresh timeout, and replacement-token failure handling.

**Remaining gates and residual risk**
- When hosting begins, do not rerun 026 after 027; migration 027 intentionally revokes legacy refresh sessions. Deploy the matching backend/frontend, apply each unapplied forward migration through 044 in order, and confirm `/api/health/ready` succeeds with database readiness version 44.
- Hosted HTTPS, proxy behavior, Supabase RPC/table privileges, CORS origin, cookie attributes, and the live disposable-account smoke test are deferred deployment checks. Local browser verification used a disposable in-memory database and cannot prove hosted configuration.
- Protected requests now check JWT `sid` against `auth_sessions`. Logout and password changes revoke sessions server-side; old JWTs without `sid` are rejected. Existing SSE connections revalidate periodically, and requests already executing are not cancelled by revocation.
- Refresh rows expire but are not automatically deleted. Schedule a database cleanup of expired rows before long-running production use. Browsers without Web Locks or BroadcastChannel retain only per-tab refresh coordination. The refresh limiter is process-local; use a shared store before scaling the backend to multiple instances.

---

## 8. Real-time SSE Stream — ✅ Fully implemented

**Inherent risk**: 3 × 3 = 9 (Medium)
**Threat**: Connection-exhaustion DoS, unauthenticated sniffing, or memory leaks on the event stream.

**What's working — every documented safeguard, verified**
- Connection caps: 4 per user, 20 per IP, 100 total — over the cap returns HTTP 429 with `Retry-After`.
- Bounded backpressure queues with drop/disconnect thresholds.
- JWT authentication at handshake plus re-validation every 60 seconds.
- An undocumented bonus: connections are force-recycled at 60 minutes.

**Only note**
- Connection state lives in process-local `Map`s, which wouldn't sync if the server were scaled to multiple processes. The deployment is single-process, so this is out of scope — not a gap.

---

## 9. Operational Settings & Threshold Config — ✅ Fully implemented

**Inherent risk**: 2 × 4 = 8 (Medium)
**Threat**: An operator tampering with sensor thresholds or shift schedules.

**What's working — meets the full documented spec, verified**
- Strict `authorizeRole('Admin')` guard on the settings route.
- Optimistic locking via a version token (conflict error code 40001).
- Effective-dated configuration history in `machine_operational_settings_history`.
- Audit logging inside the database transaction — the pattern Asset 4 should copy.

**Nothing is missing against the documented controls.**

---

## 10. Historical Reports & PDF/CSV Exports — ✅ Fully implemented

**Inherent risk**: 2 × 3 = 6 (Low)
**Threat**: Unauthorized bulk exfiltration or automated scraping of analytics.
**Remediated**: September 3, 2026. Re-verified line-by-line: September 4, 2026.

**What's working — every documented safeguard, verified in code**
- **Server-side generation only.** `POST /api/reports/export` builds CSV and PDF on the server (pdfkit). The old client-side CSV blob constructor is gone; the frontend now downloads whatever the API streams.
- **Docx-exact export roles.** Export requires `Admin`, `Managing Director`, or `Operation Manager` — precisely the documented list. (Summary *viewing* keeps the wider operational list including Asst. Operation Manager, by design.)
- **Per-user throttling.** `exportRateLimiter` caps exports at 10 per user per minute (configurable via `EXPORT_RATE_LIMIT*`).
- **Bounded queries.** The schema only accepts `daily`/`weekly`/`monthly` plus a single date — no arbitrary date ranges to abuse.
- **Audit trail.** Every export writes a `REPORT_EXPORTED` log with user ID, report type, date, format, row count, and period state before the file streams.
- **Quality PDF output.** Corporate logo, address, document reference code, three structured sections (KPIs, sensor telemetry, downtime attribution with totals), dynamic row heights, clean multi-page pagination with repeated headers, page footers, and a preparation/review/approval sign-off block.
- **CSV hardening.** Every cell is quoted with embedded-quote escaping, and cause values come from a fixed enum — so CSV formula injection has no realistic path.

**Residual minor notes (not violations of the documented controls)**
- `GET /api/reports/summary` has no per-user rate limit (only the heavier export does). Role-gated and date-bounded, so risk is low.
- The audit entry is written before the response streams, so a mid-stream failure still leaves the log — the conservative direction, which is fine.

**Verdict: fully implemented. No gaps against the documented safeguards.**

---

## Verified Strengths Beyond the Documented Controls

- `audit_logs` immutability is enforced at the **grant level** — the backend role has only `SELECT, INSERT`, so updates and deletes are impossible in the database itself, not just blocked by policy.
- Per-request session re-validation on every authenticated call (Assets 1 and 7).
- Ingress bounds: 100kb body cap, ±5-minute future-timestamp rejection, device-event-ID reuse detection (Asset 3).
- SSE 60-minute connection lifetime cap (Asset 8).

---

## PPT Corrections to Make Before the Defense

- **Slide 5 vs Slide 11**: one says HTTP, the other claims HTTPS everywhere. Pick one story — no firmware in the repo settles it either way.
- **Slide 7** ("Forces immediate password reset"): legacy password-change enforcement is implemented in backend middleware and the frontend; new users set their password through the setup link.
- **Slide 10** ("Monotonic Count Validation"): the database validates *timestamps*, not counts. Rephrase.
- **Slide 11** ("50 readings buffered locally"): unverifiable without firmware.
- **Slide 17** ("completely neutralize rogue telemetry" / "100% audit integrity"): overclaims given Assets 3 and 4.
- The deck skips document assets **#2, #7, and #10** — be ready to speak to the token-storage gap and the export controls verbally.

---

## Fix Priority

1. **Administrator credentials** — ✅ Complete for development with regression coverage, migrations 030/031 applied, and readiness 44 verified in the current migration chain. Deployment verification remains pending (Asset 1).
2. **Token storage and lifetime** — ✅ DEVELOPMENT COMPLETE September 5, 2026 (Asset 7): session-lineage revocation, account-serialized RPCs, identity-bound retries, bounded refresh waits, replacement-token error handling, and migrations 026/027 complete. Perform hosted readiness and HTTPS verification only when deployment begins.
3. **Stale pulse flag** — ✅ COMPLETE for development. Migration 028 is part of the current migration chain, 512 serialized backend tests passed, and the PostgreSQL concurrency test passed. Existing unclassified history requires separate review (Assets 3 and 5); deployment verification remains pending.
4. **Cutter-cycle cross-correlation** — 🟡 Implemented for local development in migration 044: reject pulses while the mill is stopped, in S-03 downtime, stale, or inside the provisional debounce floor. Hardware calibration and hosted verification remain pending (Asset 5).
5. **Atomic downtime audit** — ✅ Implemented for local development in migration 043 with actor attribution, rollback protection, and retry idempotency. Hosted and hardware verification remain pending (Asset 4).
6. **Secrets and backups** — env-injected secrets in production, one restore drill (Asset 6).
7. **PPT corrections** — the five items above.
