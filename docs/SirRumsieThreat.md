# Petro Hydro Pipe Corp. — Security Threat & Risk Assessment (Simplified)

**System**: IoT-Based Pipe Manufacturing Machine Monitoring System
**Source**: `Sir Rumsie Activity.docx` — 10 threat scenarios
**Method**: Every claim below was verified directly against the codebase (Backend, Frontend, database schema/migrations).
**Last updated**: September 6, 2026

Each asset follows the same pattern: the threat, what's already working, what's missing, and the fix.

**Status legend**: ✅ Fully implemented · 🟡 Near-complete (minor gap) · 🟠 Partially implemented · ❌ Core control missing · ⚠️ Hardware gate (cannot be verified in this repo)

---

## Status at a Glance

1. Administrator Credentials — 🟠 Partially implemented
2. ESP32 Sensor Nodes & Firmware — ⚠️ Hardware gate
3. IoT Telemetry Ingestion — ✅ Complete for development; deployment verification pending
4. Machine Downtime Records (S-03) — 🟡 Near-complete
5. Pipe Output Counts (S-05) — ❌ Core control missing
6. Database & Secrets — ✅ Complete for local development; hosting pending
7. JWT Tokens & Sessions — ✅ Fully implemented for development; hosting not started
8. Real-time SSE Stream — ✅ Fully implemented
9. Operational Settings — ✅ Fully implemented
10. Historical Reports & Exports — ✅ Fully implemented

---

## 1. Administrator Credentials — 🟠 Partially implemented

**Inherent risk**: 4 × 5 = 20 (Critical — highest in the document)
**Threat**: Brute-force login, credential guessing, or stolen passwords reaching the management interface.

**What's working**
- Passwords hashed with Bcrypt (salt round 10).
- Login rate limited per IP: 10 attempts per 15 minutes.
- Every request re-validates the user's role and status from the database, so disabled accounts lose access instantly.

**What's missing**
- Passwords only need 8 characters — the document requires 12+ with uppercase, lowercase, number, and symbol. `"12345678"` is accepted today.
- There is no change-password endpoint anywhere. Temporary passwords cannot be rotated through the system.
- The `must_change_password` flag is dead code end-to-end: it is set at user creation but ignored by the backend routes and never read by any frontend component.
- Sessions last 8 hours instead of the documented 15–60 minutes.

**The fix**
- Enforce the 12+ character complexity rule in `users.model.js`.
- Add `POST /api/auth/change-password` (verify current password, then rotate).
- Reject non-password requests while `must_change_password` is true — on the backend middleware and in the frontend.
- Cut the token lifetime to 30 minutes.

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
- Final local verification: 371 backend tests passed with zero failures or skips; a separate disposable PostgreSQL 18 concurrency test passed. The concurrency test verified that an older request waits for the newer transaction, persists `stale = true`, and leaves the aggregate count at one.

**Status: Complete for development**
- Migration 028 has been applied to the development database (user-confirmed). Restart the matching backend and verify `/api/health/ready` returns HTTP 200 with readiness version 28.
- Existing rows receive `stale = NULL`, meaning unclassified. They retain their previous contribution through `stale IS NOT TRUE`; no historical records are deleted or falsely marked verified. Historical count inflation is not automatically repaired.
- Newly classified stale pulses are excluded even if they were legitimate delayed events. Supporting offline buffered production requires a separate reconciliation rule. New timestamps and IDs from a compromised device can still fabricate activity; this is not physical-event verification.
- Timestamp uniqueness was deliberately not added: separate legitimate events can share device timestamp precision. See `RUNBOOK.md` for migration and validation steps.

---

## 4. Machine Downtime Records (Sensor S-03) — 🟡 Near-complete

**Inherent risk**: 3 × 4 = 12 (Medium)
**Threat**: An operator or supervisor falsifying or suppressing downtime to inflate availability KPIs.

**What's working**
- Downtime causes are locked to a fixed enum and, for S-03, locked at the database level (a trigger rejects cause changes for non-S-03 sensors).
- Resolving a downtime requires a reviewed cause (migration 022).
- Base tables are SELECT-only for the backend role — there is no delete or update path to exploit from the client side.

**What's missing**
- The audit log for downtime cause updates is written by the Express layer *after* the database RPC returns. If the process dies in that instant, the change commits without an audit entry. (Contrast: operational-settings audits are inserted inside the database transaction.)

**The fix**
- Move the downtime audit insert into the `update_downtime_record` stored procedure so the mutation and its audit commit atomically.

---

## 5. Pipe Output & Count Records (Sensor S-05) — ❌ Core control missing

**Inherent risk**: 3 × 4 = 12 (Medium)
**Threat**: Fabricated production counts — from sensor contact bounce, manual pulse generation, or replay.

**What's working**
- A database trigger permanently blocks S-05 downtime creation.
- Watchdog-forced counts are excluded.
- Shift-anchored aggregation RPCs.

**What's missing**
- **Zero cutter-cycle cross-correlation.** The document's primary safeguard — checking that a count pulse coincides with actual machine movement — does not exist. Pulses arriving while the mill is Idle or in Downtime are still recorded and still count toward shift totals.
- Debounce filtering depends entirely on unverified firmware (Asset 2).
- Asset 3's new stale-event exclusion protects new ingestion after migration 028. Previously stored unclassified events remain a historical integrity limitation.

**The fix**
- Cross-check S-05 pulses against S-03 machine state: reject or flag pulses received when the mill has been stationary longer than the minimum cycle threshold. Combined with the Asset 3 stale-flag fix, this closes the fabrication paths that don't require hardware.

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
- When hosting begins, do not rerun 026 after 027; migration 027 intentionally revokes legacy refresh sessions. Deploy the matching backend/frontend and confirm `/api/health/ready` reports readiness version 27.
- Hosted HTTPS, proxy behavior, Supabase RPC/table privileges, CORS origin, cookie attributes, and the live disposable-account smoke test are deferred deployment checks. Local browser verification used a disposable in-memory database and cannot prove hosted configuration.
- Already-issued JWTs survive until their original expiry (new tokens default to 30 minutes; legacy tokens may last longer). Disabled or archived accounts are still blocked by per-request database revalidation. Add a session-ID check on protected requests only if immediate server-side access-token revocation is required.
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
- **Slide 7** ("Forces immediate password reset"): the flag is ignored end-to-end. Soften to "provides a flag for" — or implement the fix in Asset 1 and keep the claim.
- **Slide 10** ("Monotonic Count Validation"): the database validates *timestamps*, not counts. Rephrase.
- **Slide 11** ("50 readings buffered locally"): unverifiable without firmware.
- **Slide 17** ("completely neutralize rogue telemetry" / "100% audit integrity"): overclaims given Assets 3 and 4.
- The deck skips document assets **#2, #7, and #10** — be ready to speak to the token-storage gap and the export controls verbally.

---

## Fix Priority

1. **Password rotation flow** — complexity rule, change-password endpoint, enforce `must_change_password` in backend and frontend (Asset 1; also makes PPT slide 7 true).
2. **Token storage and lifetime** — ✅ DEVELOPMENT COMPLETE September 5, 2026 (Asset 7): session-lineage revocation, account-serialized RPCs, identity-bound retries, bounded refresh waits, replacement-token error handling, and migrations 026/027 complete. Perform hosted readiness and HTTPS verification only when deployment begins.
3. **Stale pulse flag** — ✅ COMPLETE for development. Migration 028 is applied, 371 backend tests and the PostgreSQL concurrency test passed. Existing unclassified history requires separate review (Assets 3 and 5); deployment verification remains pending.
4. **Cutter-cycle cross-correlation** — reject pulses while the mill is stopped (Asset 5).
5. **Atomic downtime audit** — move the insert into the stored procedure (Asset 4).
6. **Secrets and backups** — env-injected secrets in production, one restore drill (Asset 6).
7. **PPT corrections** — the five items above.
