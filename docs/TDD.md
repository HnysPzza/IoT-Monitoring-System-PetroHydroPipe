# Technical Design Document (TDD)
## IoT-Based Pipe Manufacturing Machine Monitoring System

**Companion to:** `PRD.md`, `changes-summary.md`
**Note on scope:** written against **5 ESP32 sensor nodes** per the current capstone paper (Objectives, Table 1–3, Table 6) — confirmed as final.

---

## 1. Architecture Overview

```
[Sensor 1: Coil Joint]      ─┐
[Sensor 2: Inside Filler]   ─┤
[Sensor 3: Downtime]        ─┼─► ESP32 nodes (x5) ─► MikroTik hAP lite (Cat6, wired) ─► Express.js API
[Sensor 4: Outside Filler]  ─┤                                                             │
[Sensor 5: Pipe Count]      ─┘                                                             ▼
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
| 1 | Raw Materials / Coil Joint | **A — discrete event** | One transmission per confirmed coil-joint detection |
| 2 | Inside Filler Wire | **A — discrete event** (tentative) | See note below |
| 3 | Machine Main Sensor | **B — continuous activity** | State machine: RUNNING ↔ DOWN, driven by absence/presence of signal over a threshold window |
| 4 | Outside Filler Wire | **A — discrete event** (tentative) | See note below |
| 5 | Finished Pipe Output | **A — discrete event** | One transmission per confirmed pipe count at the cutter |


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
- `X-Node-Token` header on every request, validated server-side before any data is accepted. This is a separate auth path from dashboard JWTs — a leaked node token should not grant dashboard access, and vice versa.

## 3. Backend Design (Node.js + Express)

### 3.1 Endpoints (representative, not exhaustive)

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/nodes/:nodeId/events` | `X-Node-Token` | Ingest a Type A discrete event |
| `POST /api/nodes/:nodeId/state` | `X-Node-Token` | Ingest a Type B state transition |
| `GET /api/dashboard/live` | JWT | Current machine state + latest reading per node |
| `GET /api/downtime` | JWT | Downtime event history, filterable by date/shift |
| `POST /api/alerts/:id/acknowledge` | JWT | UC017 — records who/when |
| `GET /api/stream` | JWT (via `Authorization` header, not query string) | SSE endpoint for real-time dashboard updates |
| `GET /api/reports?format=pdf\|csv` | JWT | UC022/UC023 |

### 3.2 Auth
- Dashboard users: JWT, `Authorization: Bearer <token>` header. `jsonwebtoken` + `bcrypt`/`argon2id` for password hashing.
- ESP32 nodes: `X-Node-Token` header, validated against a per-node secret stored server-side. Never share the JWT secret/signing key with the node auth path.
- Rate limiting via `express-rate-limit` on all public-facing auth endpoints (login, password reset).

### 3.3 Why SSE, not WebSocket or polling
- **Polling** wastes requests and adds latency proportional to the poll interval — bad fit for "alert the moment Sensor 3 goes down."
- **Raw WebSocket** adds bidirectional complexity the dashboard doesn't need (it only ever *receives* updates; it never needs to push anything back over the same channel).
- **SSE via Fetch + ReadableStream** gives one-directional server→client push over plain HTTP, works cleanly through the JWT `Authorization` header (no token-in-URL problem), and is simpler to reason about for a 3-person team maintaining this after graduation.
- Ruled out explicitly: JWT via query parameter (logged in server access logs and browser history — a real, not theoretical, exposure), and per-endpoint cookies (inconsistent auth model across the app, adds CSRF surface for no real benefit here).

## 4. Database Design (Supabase / Postgres)

### 4.1 Why Supabase, and why Pro tier
Supabase is not a separate "database engine choice" — it's managed Postgres with a REST layer (PostgREST) on top. The real decision was **managed vs. self-hosted Postgres**, and for a 3-person student team taking on a real company's production monitoring, self-hosting is the wrong call: no one on the team has the bandwidth for patching, backup verification, or on-call response if the box goes down mid-shift.

Within Supabase, **Free tier is disqualifying**: it auto-pauses after inactivity (unacceptable for a system meant to be always-on), caps storage at 500 MB, and has no automated backups. **Pro tier ($25/month, 8 GB, automated backups) is required** for anything actually running on Petro Hydro's floor. This is not yet funded — flagged as an open risk in PRD §11.

### 4.2 Core tables (proposed)

- `sensor_nodes` — id, machine_id, sensor_number (1–5), label, type (A/B), last_seen_at
- `sensor_events` — id, node_id, event_type, occurred_at (Type A discrete events: coil joint, filler wire, pipe count)
- `downtime_events` — id, node_id (Sensor 3), started_at, ended_at, duration, cause (nullable until categorized) — **sensor-driven only, never human-modified**
- `alerts` — id, downtime_event_id, state (OPEN/ACKNOWLEDGED/RESOLVED), acknowledged_by, acknowledged_at — the metadata layer decoupled from `downtime_events`
- `users` — id, name, role, email, password_hash, must_change_password
- `shifts` — id, name, start_time, end_time
- `production_counts` — derived/aggregated from `sensor_events` where node = Sensor 5, bucketed per shift/day
- `activity_logs` — UC027, user_id, action, timestamp

### 4.3 A note on TimescaleDB
Don't plan around it — it's deprecated on Supabase's Postgres 17 bundle (continuous aggregates are blocked by licensing there). It's also unnecessary: actual data volume from 5 event-based nodes is trivially small. The real scalability lever is firmware logging discipline (§2), not database engine choice. Fixing the raw-pulse-spam bug matters far more for data volume than any database-level optimization would.

## 5. Real-Time Architecture (detail)

Client opens `GET /api/stream` with `Authorization: Bearer <jwt>`, using `fetch()` + `ReadableStream` to consume a `text/event-stream` response. Express keeps the connection open and pushes:
- Machine state changes (RUNNING/DOWN) the moment Sensor 3 transitions.
- New alerts (OPEN state created).
- Alert acknowledgment updates (so multiple logged-in supervisors see acknowledgment in real time).

This stays entirely inside the Express-only rule in §1 — Supabase changes are picked up by Express (via its own query/trigger logic) and re-broadcast to clients, never exposed to the browser directly.

## 6. Alert Debounce (open design gap — needs a decision)

UC018 currently defines only the trigger threshold. The clear/resume threshold needs:
1. A concrete value (e.g., "Sensor 3 must show continuous activity for N seconds before the alert auto-resolves").
2. A decision on whether this value is **hardcoded in firmware** or **fetched from a server config endpoint** (also flagged open in PRD §11 — this determines whether a threshold change means re-flashing 5 boards or one API call).
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
| Threshold storage: firmware-hardcoded vs. server-config | Yes, before firmware fix | Recommend server-config given UC025 already implies per-machine sensor threshold configuration through the dashboard — hardcoding would contradict that use case |
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
