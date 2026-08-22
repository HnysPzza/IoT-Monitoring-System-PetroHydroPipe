# Technical Design Document (TDD)
## IoT-Based Pipe Manufacturing Machine Monitoring System

**Companion to:** `PRD.md`, `changes-summary.md`
**Note on scope:** written against **5 ESP32 sensor nodes** per the current capstone paper (Objectives, Table 1–3, Table 6) — confirmed as final.

---

## 1. Architecture Overview

```
[Sensor 1: Raw Material & Coil Joint]  ─┐
[Sensor 2: Inside Filler Wire]         ─┤
[Sensor 3: Machine Main Sensor]        ─┼─► ESP32 nodes (x5) ─► MikroTik hAP lite (Cat6, wired) ─► Express.js API
[Sensor 4: Outside Filler Wire]        ─┤                                                             │
[Sensor 5: Production Output Cutting]  ─┘                                                             ▼
                                                                                   Supabase (Postgres, Pro tier)
                                                                                             │
                                                                                             ▼
                                                                              React.js + Tailwind Dashboard
                                                                              (SSE for real-time updates)
```

**Firm rule:** the production frontend calls the Express API only. It never talks to Supabase directly, and never uses the Supabase Realtime SDK — that opens a direct browser↔Supabase WebSocket, which bypasses the one auth/authorization boundary the team actually controls. If this rule gets violated "just for one chart," you've silently created a second, ungoverned way for the browser to read the database, and every access-control decision made in Express becomes unenforceable for that data path.

**Why wired Cat6, not a WiFi extender:** the production floor is a welding environment. WiFi extenders are unreliable under EMI from welding. A Cat6 run from the main building to a router positioned near the machine gives the ESP32 nodes a short, stable hop instead of fighting interference over a longer wireless one.

## 2. Firmware Design (ESP32, all 5 nodes)

### 2.1 The bug this section fixes

Nodes currently transmit on **every raw sensor pulse**, not on confirmed state transitions. Concretely: if a proximity sensor chatters (mechanical bounce, partial detection, vibration from the welder), the node fires an HTTP request for every blip instead of once per real event. Two consequences:
- UC018's threshold logic can't work — "duration of absence" is meaningless if you're also getting spurious presence pulses.
- The core downtime detection (Sensor 3) is unreliable — the whole `downtime_events` table depends on this being fixed first.

### 2.2 Node classification (proposed — needs sign-off)

| Sensor | Monitoring Point | Type | Behavior |
|---|---|---|---|
| 1 | Raw Material & Coil Joint | **A — discrete event** | One transmission per confirmed coil-joint detection |
| 2 | Inside Filler Wire | **A — discrete event** (tentative) | See note below |
| 3 | Machine Main Sensor | **B — continuous activity** | State machine: RUNNING ↔ DOWN, driven by absence/presence of signal over a threshold window |
| 4 | Outside Filler Wire | **A — discrete event** (tentative) | See note below |
| 5 | Production Output Cutting | **A — discrete event** | One transmission per confirmed pipe count at the cutter |


### 2.3 Type A firmware logic (discrete event nodes: 1, 2*, 4*, 5)
- Debounce the raw GPIO signal in firmware (simple hardware debounce + a short software debounce window, e.g. 50–100ms, tuned during lab testing).
- On a confirmed transition (LOW→HIGH past debounce), transmit **one** event with a local timestamp.
- Do not transmit on the falling edge — only the confirmed rising edge (or whichever edge represents "event occurred," confirm physically during lab testing).

### 2.4 Type B firmware logic (continuous activity node: 3, and possibly 2/4)
- Track state locally: `RUNNING` or `DOWN`.
- On sustained absence of signal past the **trigger threshold** (UC018, currently the only defined value) → transition to `DOWN`, transmit one `downtime_start` event.
- On sustained presence of signal past the **clear threshold** (not yet defined — see PRD §8 and §6 below) → transition to `RUNNING`, transmit one `downtime_end` event.
- Do **not** transmit on every signal blip in between — only on the two state transitions.

### 2.5 Required firmware additions
- NTP time sync on boot and after every reconnect — without this, timestamps across 5 nodes will drift relative to each other and to the server, corrupting the "duration" fields everywhere.
- WiFi reconnection handler (EMI from welding will drop connections; this must be automatic, not require a manual power-cycle).
- Local buffer, up to 50 readings, flushed on reconnect — prevents data loss during dropouts.
- `x-device-id` and `x-device-key` headers on every request, validated server-side before any data is accepted. This is a separate auth path from dashboard JWTs.
- An NTP-synchronized `recordedAt` value for the current interim ordering guard.
- A future per-sensor monotonic counter persisted across reboot in ESP32 NVS. This ordering counter is separate from the random UUID `eventId` used for retry deduplication. Pair it with a persisted boot/session ID only if a reset-capable counter is unavoidable.

## 3. Backend Design (Node.js + Express)

### 3.1 Endpoints (representative, not exhaustive)

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/iot/events` | `x-device-id` + `x-device-key` | Atomically ingest a sensor event or state transition |
| `GET /api/iot/live` | JWT | Current machine state + latest event per sensor |
| `GET /api/downtime` | JWT | Paginated downtime history with supported status, cause, and date filters |
| `GET /api/alerts` | JWT | One alert snapshot with `{alerts, snapshotRevision}` |
| `PATCH /api/alerts/:id/acknowledge` | JWT | Atomically record acknowledgement and resulting lifecycle state |
| `GET /api/alerts/stream` | JWT `Authorization` header | Alert SSE stream |
| `GET /api/downtime/stream` | JWT `Authorization` header | Downtime SSE stream |
| `GET /api/reports/summary?type=daily\|weekly\|monthly` | Management-role JWT | Report summary; optional `date` selects the business period anchor |

### 3.2 Auth
- Dashboard users: JWT, `Authorization: Bearer <token>` header. The backend uses `jsonwebtoken` and `bcryptjs`.
- ESP32 nodes: `x-device-id` and `x-device-key`, validated against a per-sensor bcrypt hash stored server-side. Never share the JWT secret/signing key with the device auth path.
- Rate limiting via `express-rate-limit` on login and layered source-IP/verified-device buckets for IoT ingestion.

### 3.3 Why SSE, not WebSocket or polling
- **Polling** wastes requests and adds latency proportional to the poll interval — bad fit for "alert the moment Sensor 3 goes down."
- **Raw WebSocket** adds bidirectional complexity the dashboard doesn't need (it only ever *receives* updates; it never needs to push anything back over the same channel).
- **SSE via Fetch + ReadableStream** gives one-directional server→client push over plain HTTP, works cleanly through the JWT `Authorization` header (no token-in-URL problem), and is simpler to reason about for a 3-person team maintaining this after graduation.
- Ruled out explicitly: JWT via query parameter (logged in server access logs and browser history — a real, not theoretical, exposure), and per-endpoint cookies (inconsistent auth model across the app, adds CSRF surface for no real benefit here).

### 3.4 Atomic IoT and alert operations

The backend uses three service-role-only PostgreSQL RPCs:

- `ingest_iot_sensor_event` performs raw event insertion, applied sensor/machine state, downtime, alert, and transition-audit writes in one transaction.
- `acknowledge_alert` locks the alert, applies the acknowledgement/recovery lifecycle, writes audits, and returns an explicit outcome.
- `get_alerts_snapshot` returns alert rows and the global snapshot watermark from one database statement.

Stale or equal `recordedAt` values are retained as raw events but apply no operational transition. Alert revisions come from a locked singleton counter row held inside the transaction; they do not use a sequence. PostgreSQL `BIGINT` values are cast to canonical decimal strings before reaching JavaScript.

## 4. Database Design (Supabase / Postgres)

### 4.1 Why Supabase, and why Pro tier
Supabase is not a separate "database engine choice" — it's managed Postgres with a REST layer (PostgREST) on top. The real decision was **managed vs. self-hosted Postgres**, and for a 3-person student team taking on a real company's production monitoring, self-hosting is the wrong call: no one on the team has the bandwidth for patching, backup verification, or on-call response if the box goes down mid-shift.

Within Supabase, **Free tier is disqualifying**: it auto-pauses after inactivity (unacceptable for a system meant to be always-on), caps storage at 500 MB, and has no automated backups. **Pro tier ($25/month, 8 GB, automated backups) is required** for anything actually running on Petro Hydro's floor. This is not yet funded — flagged as an open risk in PRD §11.

### 4.2 Core tables (current)

- `roles` and `users` - backend-managed authorization and accounts.
- `machines` and `sensors` - monitored equipment, device identity, state, and the per-sensor `last_applied_recorded_at` watermark.
- `sensor_events` - raw timestamped device events, including UUID `device_event_id` deduplication.
- `downtime_events` - observed downtime intervals.
- `alerts` - `Active`, `Acknowledged`, and `Resolved` operator workflow with a global `revision`.
- `alert_revision_state` - singleton transactional revision counter; direct access is restricted to `service_role`.
- `production_counts` - summarized output counts.
- `audit_logs` - user and system activity history.

### 4.3 A note on TimescaleDB
Don't plan around it — it's deprecated on Supabase's Postgres 17 bundle (continuous aggregates are blocked by licensing there). It's also unnecessary: actual data volume from 5 event-based nodes is trivially small. The real scalability lever is firmware logging discipline (§2), not database engine choice. Fixing the raw-pulse-spam bug matters far more for data volume than any database-level optimization would.

## 5. Real-Time Architecture (detail)

Clients open `GET /api/alerts/stream` and `GET /api/downtime/stream` with `Authorization: Bearer <jwt>`, using `fetch()` plus `ReadableStream`. Express publishes process-local SSE only after the database transaction commits. Listener failures are logged and isolated; they do not change the committed HTTP result.

Alert events are exactly `alert.created`, `alert.updated`, `alert.acknowledged`, and `alert.resolved`. The frontend validates the event/status pair and the canonical decimal-string revision. REST snapshot loading is the repair path: one coordinator covers mount, manual retry, fallback polling, and every successful stream open, with one request in flight, at least five seconds between starts, and at most one trailing request.

`onOpen({isReconnect, isRetry})` uses exact semantics: `isReconnect` means a prior successful connection existed; `isRetry` means this successful open followed one or more failed attempts. The first successful open also schedules a bounded snapshot repair because there is no server-provided open watermark. Buffered deltas are discarded at or below `snapshotRevision`; newer deltas are sorted and applied only as a contiguous chain. Malformed data, gaps, overflow, or an older snapshot preserve newer trusted state and schedule repair.

This stays inside the Express-only rule in section 1. The current publisher is an in-memory Node `EventEmitter`, so the supported realtime deployment is one persistent Express process. There is no outbox, queue, or worker; multi-instance delivery requires a future shared channel.

### 5.1 Alert integrity acceptance matrix

| Layer | Bad path | Required result |
|---|---|---|
| Database | Alert or audit write fails during IoT ingestion | Entire operational transaction rolls back; no partial sensor, machine, downtime, alert, audit, or revision state |
| Database | Duplicate UUID or stale/equal `recordedAt` | Exact duplicate is idempotent; stale/equal timestamp is raw-history-only; conflicting UUID reuse is rejected |
| Database | Concurrent fault, acknowledgement, and recovery | One unresolved alert, serialized lifecycle, and contiguous committed revisions; verify on disposable real PostgreSQL before deployment |
| Backend | Post-commit downtime or alert listener throws | Log safe identifiers, isolate listeners/channels, and keep the committed success response |
| Backend | Missing/unknown acknowledgement outcome or malformed revision | Controlled 4xx/5xx response; never publish an unverified alert frame |
| Frontend | Duplicate, stale, malformed, or gapped SSE/ACK delta | Ignore stale/duplicate; do not apply malformed/gapped data; request one coalesced snapshot repair |
| Frontend | Snapshot resolves while newer SSE deltas arrive | Replace from one snapshot, discard old deltas, replay only a sorted contiguous newer chain, and never roll back a higher applied revision |
| Frontend | Token changes or component unmounts | Ignore stale completions and clear queued timers, polling, and stream ownership |

## 6. Alert Debounce (open design gap — needs a decision)

UC018 currently defines only the trigger threshold. The clear/resume threshold needs:
1. A concrete value (e.g., "Sensor 3 must show continuous activity for N seconds before the alert auto-resolves").
2. The source is **resolved as backend-managed per-machine configuration**. Phase 2 stores and audits it; Phase 3 adds the heartbeat/watchdog consumer. The concrete recovery value remains open pending calibration.
3. A rewrite of UC018's description in the paper to state both thresholds explicitly — right now a panelist reading UC018 would reasonably assume the system already has a defined resume condition, and it doesn't.

## 7. Reporting & Export (UC022, UC023)
- PDF generation: Puppeteer or PDFKit (Laravel's built-in PDF generation is being replaced by one of these — pick one and standardize, don't mix).
- CSV export: straightforward from query results.
- Reports: daily/weekly/monthly, covering downtime, process events, output counts, availability rate, and estimated loss.

## 8. Email / Notification Subsystem
Needed for: temporary password delivery on account creation (UC005), forced first-login password change (UC003), password reset (UC007).
- **Confirmed vendor: Resend** (SendGrid ruled out, free tier eliminated 2025). The paper still says Brevo — that's a text correction owed to Table 2/NonFunc_024 and the Overview paragraph, not a real implementation ambiguity.
- `Nodemailer` as the sending library, integrated against Resend's API.

## 9. Deployment (technical detail, see PRD §9 for the 4-stage plan)
- Stage 2 (Site Survey): confirm ≥ -67 dBm WiFi signal at each of the 5 mounting points before ordering enclosure hardware.
- Stage 3 (Parallel Run): log every discrepancy between manual and system records daily — this is your best real-world validation that the Type A/B classification in §2 is actually correct, not just theoretically sound.
- Sensor installation carries no risk of disrupting machine operation — inductive proximity sensors are purely observational.

## 10. Open Technical Decisions (mirrors PRD §11, technical framing)

| Decision | Blocking? | Next step |
|---|---|---|
| ~~5-node vs 4-node scope~~ | **Resolved — 5 nodes** | Order the 5th ESP32/sensor/enclosure set now if not already procured (Table 3 already prices for x5) |
| Sensor 2 & 4: Type A or Type B | Yes, before firmware fix | Physically inspect signal behavior during lab testing, don't assume |
| Debounce/clear threshold value | Yes, before firmware fix | Pick a starting value (e.g. 5–10s), validate/tune during parallel run |
| ~~Threshold storage: firmware-hardcoded vs. server-config~~ | **Resolved - backend-managed per-machine configuration** | Implement storage/API in Phase 2 and the heartbeat/watchdog consumer in Phase 3; do not claim the ingestion RPC can detect an event that never arrives |
| ~~Email vendor~~ | **Resolved — Resend** | Update the paper (Overview paragraph + NonFunc_024) to replace "Brevo" |
| Supabase Pro funding | Yes, before production deployment | Confirm with Petro Hydro management |
| PDF library: Puppeteer vs PDFKit | No | Pick one, avoid mixing two rendering approaches |

## 11. Appendix — Hardware BOM (Table 3, as currently documented)

| Item | Price |
|---|---|
| Laptop (8GB RAM, 256GB SSD, Windows 11) | ₱29,999.00 |
| ESP32 DevKit Microcontroller ×5 | ₱250–350 each |
| Inductive Proximity Sensor M30 PNP N.O. IP67 ×5 | ₱360 each (₱1,800 total) |
| PCB Prototype Board ×5 | ₱80–120 each |
| IP65 Waterproof Enclosure Box ×5 | ₱350–500 each |
| Flexible Metal Conduit (per meter) | ₱60–120 |
| Metal Mounting Bracket ×5 | ₱80–120 each |
| MikroTik hAP lite Router | ₱1,500–2,500 |
| Cat5e/Cat6 LAN Cable (25m) | ₱400–600 |
| 12V DC Power Adapter ×5 | ₱100–150 each |
| DC Barrel Jack Socket ×5 | ₱20–50 each |
| Jumper Wires and Breadboard | ₱100–200 |

*Note: this BOM already prices for 5 units across every line — another point of evidence for the 5-node scope in §0 of the PRD.*
