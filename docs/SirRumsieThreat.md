# Petro Hydro Pipe Corp. — Security Threat Assessment

**System:** IoT-Based Pipe Manufacturing Machine Monitoring System
**Source:** `Sir Rumsie Activity.docx` — 10 threat scenarios
**Last updated:** September 23, 2026

This document states what the system protects, what is already implemented, and what still needs deployment or hardware evidence.

**Status:** **Complete locally** means the code and local tests cover the control. **Partial** means a specific control or verification step remains. **Hardware gate** means the repository cannot verify the control.

## Summary

| Asset | Status | Main protection | Still required |
| --- | --- | --- | --- |
| Administrator credentials | Complete locally | Password policy, secure hashing, session revocation, login limits | Hosted HTTPS, cookie, proxy, and shared-rate-limit checks |
| ESP32 nodes and firmware | Hardware gate | Backend heartbeat and absence watchdog | Firmware, enclosure, wiring, and physical inspection |
| IoT telemetry | Complete locally | Device authentication, validation, replay protection, idempotent writes | Hosted migration and physical-device evidence |
| S-03 downtime records | Complete locally | Database-owned downtime rules and atomic audit logging | Hosted database checks and machine-floor validation |
| S-05 output counts | Partial | Output-only sensor rules and pulse classification | Hosted readiness, post-migration event, and debounce calibration |
| Database and secrets | Complete locally | Row-level security, restricted grants, backend-only secrets | Production secret injection and real backup recovery drill |
| Browser tokens and sessions | Complete locally | In-memory access token, rotating refresh cookie, replay detection | Hosted HTTPS, cookie, proxy, and cleanup checks |
| Real-time event stream | Complete for one process | Authentication, connection limits, backpressure, and revalidation | Shared connection state before multi-process scaling |
| Operational settings | Complete | Admin-only changes, version checks, history, and audit | No documented local gap |
| Reports and exports | Complete locally | Server-generated CSV/PDF, role checks, throttling, and audit trail | Hosted verification of the same controls |

Local verification does not prove hosted configuration, production backups, or physical sensor behavior.

## 1. Administrator credentials

**Threat:** Brute-force login, stolen passwords, or unauthorized access to the management interface.

**Controls in place**

- Passwords must meet the same length and complexity rules during setup and change.
- Passwords are stored with bcrypt; setup uses a one-time, expiring token.
- Password changes verify the current password, revoke existing sessions, and write an audit record in one transaction.
- Protected requests verify the current account and session ID, not only the token claims.
- Access tokens are short-lived; refresh sessions use rotating, HttpOnly cookies with an absolute lifetime.
- Login and password endpoints are rate-limited and return safe error messages.
- The seed process creates no default administrator and cannot reset credentials.

**Remaining check:** Verify HTTPS, reverse-proxy behavior, cookie attributes, and shared rate limiting after deployment. Existing passwords are not automatically reset; the policy applies when a password is set or changed.

## 2. ESP32 nodes and firmware

**Threat:** A sensor is unplugged, physically altered, or re-flashed with unauthorized firmware.

**Controls in place**

- The backend accepts sensor heartbeats.
- An absence watchdog flags sensors that stop reporting.

**Hardware gate:** This repository contains no ESP32 firmware. Secure boot, flash encryption, UART/JTAG protection, wiring, power protection, and locked enclosures require a hardware inspection.

## 3. IoT telemetry ingestion

**Threat:** A rogue device spoofs events, replays old packets, or floods `/api/iot/events`.

**Controls in place**

- Devices authenticate with separate device ID and key headers.
- IP and verified-device rate limits protect the endpoint.
- Request size, fields, timestamps, and event IDs are validated.
- Duplicate event IDs are idempotent; conflicting reuse is rejected.
- An atomic database operation prevents state regression and assigns stale-event status.
- Stale events remain evidence but are excluded from dashboard, analytics, reports, and output-loss totals.

**Remaining check:** Apply and verify the matching hosted migration chain, then test with a real device. Historical rows created before classification remain unclassified and need separate review.

## 4. S-03 downtime records

**Threat:** Downtime is falsified, suppressed, or edited to inflate availability.

**Controls in place**

- Direct S-03 faults create downtime; unresolved faults across S-01, S-02, and S-04 can create one grouped S-03 interval.
- Cause values and S-03 ownership are enforced by the database.
- The client cannot directly force machine or sensor status.
- A downtime change records the authenticated actor in the same transaction as the update.
- Failed audit writes roll back the change; identical retries do not create duplicate audits.

**Remaining check:** Back up and migrate the hosted database, verify permissions and readiness, then validate the S-03 sensor and electrical behavior on the machine.

## 5. S-05 output counts

**Threat:** Contact bounce, replay, or manual pulses inflate production counts.

**Controls in place**

- S-05 is output-only and cannot create downtime.
- The database classifies new pulses against S-03 state, downtime, stale status, and a debounce floor.
- Rejected pulses remain raw evidence but do not advance output totals or state.
- Exact retries return the stored classification without repeating transitions.

**Remaining checks:** Confirm hosted migration readiness, send a controlled post-migration event, calibrate debounce against the physical cutter, and review pre-migration rows that remain unclassified.

## 6. Database and environment secrets

**Threat:** Direct database access, SQL injection, or leaked environment secrets.

**Controls in place**

- Row-level security and restricted grants block direct client writes.
- The Express backend is the database gateway and uses parameterized queries.
- Secret files are ignored by Git; startup validates required secrets.
- A local backup and restore drill covers schema, grants, constraints, and session behavior.

**Remaining checks:** Inject production secrets through the host or a secret manager, configure backups and retention, and restore a real project backup.

## 7. Browser tokens and sessions

**Threat:** XSS or network interception steals a reusable session.

**Controls in place**

- Access tokens live in React memory and are not stored in local storage.
- Refresh tokens use rotating, HttpOnly, SameSite cookies and are never exposed to JavaScript.
- Session lineage detects replay and can revoke the full session family.
- Protected requests and real-time streams periodically re-check the current session.
- Login, refresh, and logout responses disable caching.
- Browser tabs coordinate refresh and logout events.

**Remaining checks:** Verify HTTPS, CORS, proxy, cookie behavior, expired-session cleanup, and shared rate limiting in the hosted environment.

## 8. Real-time event stream

**Threat:** Unauthenticated access, connection exhaustion, or unbounded memory use.

**Controls in place**

- The stream authenticates the user and revalidates the session periodically.
- Per-user, per-IP, and total connection caps return a retryable limit response.
- Backpressure queues are bounded; slow consumers are dropped or disconnected.
- Keepalives and a maximum connection lifetime prevent abandoned streams.

**Remaining check:** Connection state is process-local. Add shared state before running multiple backend processes.

## 9. Operational settings

**Threat:** An operator changes sensor thresholds or schedules without authorization or history.

**Controls in place**

- Only administrators can change settings.
- Version checks reject conflicting updates.
- Effective-dated history preserves prior values.
- The update and audit record commit together.

**Status:** No documented local control gap.

## 10. Reports and exports

**Threat:** Unauthorized bulk extraction or automated report scraping.

**Controls in place**

- CSV and PDF files are generated on the server through `POST /api/reports/export`.
- Only Admin, Managing Director, and Operation Manager roles can export.
- Report type and date are limited to daily, weekly, or monthly selections.
- Exports are throttled and recorded in the audit log with user, format, period, and row count.
- CSV fields are quoted and embedded quotes are escaped to prevent formula injection.

**Remaining note:** The summary endpoint is role-protected and date-bounded but does not have the export endpoint's per-user throttle.

## Verification boundaries

- Local tests and builds verify application behavior only.
- Hosted verification must cover migrations, permissions, HTTPS, proxy behavior, cookies, CORS, rate limits, backups, and recovery.
- Hardware verification must cover firmware security, sensor wiring, debounce, polarity, isolation, enclosures, and fail-safe behavior.
- Do not claim that a local test proves a hosted or physical control.

## Defense reminders

- Say **HTTPS** only for environments where HTTPS has actually been configured and verified.
- The database validates telemetry timestamps and state transitions; it does not prove a physical product count by itself.
- Avoid claims such as “100% audit integrity” or “completely neutralized telemetry.” The controls reduce risk but do not replace deployment and hardware evidence.

## Priority before deployment

1. Verify the hosted migration chain, readiness, permissions, HTTPS, cookies, proxy, and shared rate limits.
2. Complete a real backup and restore drill.
3. Validate S-03 and S-05 behavior on the machine and calibrate debounce.
4. Document ESP32 firmware protections and physical safeguards.
