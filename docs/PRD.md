# Product Requirements Document (PRD)
## IoT-Based Pipe Manufacturing Machine Monitoring System
**Client:** Petro Hydro Pipe Corp. — Dunggoan, Danao City, Cebu, Philippines
**Team:** Aragon, Laroa, Tabliga · BSIT, Cebu Technological University – Naga Extension Campus
**Status:** DRAFT — scope and email vendor confirmed (see §0); remaining open items in §11
**Deadline:** December 2026

---

## 0. Read This First — Discrepancies Found Before Writing This PRD

I read `changes-summary.md` and `CAPSTONE1_PARTIAL_REVISED.pdf` (100 pages, OCR-extracted) side by side before drafting this. Three things don't line up. I'm not silently picking an answer for you — flagging them here, and I've made an explicit assumption for each so the rest of the document isn't just a pile of TODOs. **You need to confirm or correct these before this PRD is final.**

| # | Finding | Evidence | Resolution |
|---|---|---|---|
| 1 | **The paper specifies 5 ESP32 sensor nodes, not 4.** Objectives, Scope and Limitation, Table 1 (Functional Req.), Table 2 (Non-Functional Req.), Table 3 (Hardware), and Table 6 (Cause & Effect) *all* independently and repeatedly describe **Sensor 1–5**: Raw Materials/Coil Joint, Inside Filler Wire, Machine Downtime, Outside Filler Wire, and **Sensor 5 — Finished Pipe Output Counting** at the cutter area. | Table 2 NonFunc_002–006, Table 3 pricing ("x5 units" on every hardware line), Table 6 Cause & Effect | **CONFIRMED — 5 nodes is correct.** Prior "4 ESP32 nodes" note was stale; memory updated. This PRD/TDD proceed on 5 nodes as final. |
| 2 | **Email vendor conflict.** The paper (Overview paragraph + NonFunc_024) names **Brevo** for auth emails and temporary-password delivery. Our architecture notes settled on **Resend**. | Line: *"User authentication and transactional email notifications including one-time temporary password delivery are handled through Brevo."* | **CONFIRMED — Resend.** The paper's Brevo mention is outdated and needs a find-and-replace fix (Overview paragraph + NonFunc_024), same treatment as the Laravel/Arduino corrections. **Add this to `changes-summary.md`'s checklist — it isn't there yet.** |
| 3 | **Use-case numbering drifted.** Our notes refer to "UC017" as the alert-threshold use case with the missing clear-threshold problem. In the current paper, **UC017 is "Acknowledge Downtime Alerts"** and **UC018 is "Configure Sensor Alert Thresholds"** (the one that only covers the trigger duration, not the clear/resume condition). | Table 1, pp. 54 | This document uses **UC018** for the threshold-configuration gap. Update your own notes so you don't cite the wrong number during your defense — a panelist who flips to the actual table and finds "Acknowledge Downtime Alerts" under the number you quoted is a bad moment to have live. |

Separately, worth knowing while you read the rest of this: the paper's Table 2 (Non-Functional Requirements) has *already* been updated — Laravel is gone, ESP32 Sensor Nodes 1–5 are cleanly labeled, Node.js/Express/React/Supabase all appear correctly. But **Table 3's narrative paragraph, Table 4, and the Block Diagram narrative (Figure 10) still say "Laravel backend" / "Laravel (PHP)"**, and Table 3's narrative still has the voltage-sensor/power-outage sentence, and three separate section headers still carry the "...with Power Outage Tracking" subtitle. So `changes-summary.md`'s checklist is accurate for those — they're genuinely still open — but its "ESP32 Labels vs Sensor Labels Mismatch" table (Weld Wire / Consumable Inside / Consumable Outside / Consumable Flux) doesn't match *any* text in the current PDF at all. That table is either stale or the mismatch now lives only inside the Figure 6 (ERD) / Figure 10 (Block Diagram) images themselves, which OCR text search can't check. **Recommend you open those two figures directly and confirm they use the same Sensor 1–5 names as Table 2** before marking that checklist item done.

---

## 1. Executive Summary

Petro Hydro Pipe Corp. currently tracks machine downtime, process events, and production output on paper logbooks. This leads to delayed reporting, inaccurate records, and no way to quantify production loss. The system being built replaces that with five ESP32-based sensor nodes feeding a centralized Node.js/Express backend, a Supabase (managed Postgres) database, and a React.js dashboard, giving five named roles at Petro Hydro real-time visibility into machine status, downtime, process events, and output.

## 2. Problem Statement

- Machine stoppages (corrective maintenance, manual cutting) are recorded only after the fact, so their duration and cause are unreliable.
- Process events (coil joint replacement, filler wire activity) go unmonitored entirely under the manual system.
- Production output and production loss cannot be quantified with any precision.
- Management has no centralized, real-time source of truth — only what supervisors write down and remember to report.

## 3. Goals

1. Detect and timestamp machine downtime automatically via Sensor 3, with duration and eventually a user-assigned cause.
2. Log process events (coil joint, inside/outside filler wire) as timestamped records, separate from downtime, via Sensors 1, 2, 4.
3. Automatically count finished pipe output at the cutter via Sensor 5.
4. Compute estimated production loss from downtime duration/frequency.
5. Provide a shift-aware, role-based web dashboard with real-time status, historical logs, trend charts, and exportable reports (PDF/CSV).
6. Evaluate the finished system against **ISO 25010** software quality characteristics and **UTAUT** (performance expectancy, effort expectancy, social influence, facilitating conditions) for user acceptance.

## 4. Explicitly Out of Scope

- **Power outage detection / voltage sensing.** Removed from the design. No voltage sensor exists in the current hardware list (Table 3) — any remaining paper text describing one is a documentation defect, not a live requirement. Do not let this creep back into implementation because an old section header still says "with Power Outage Tracking."
- **Direct browser-to-Supabase access of any kind**, including the Supabase Realtime SDK. This is a firm architectural rule (see TDD §5) — production frontend talks to Express only.
- Anything not tied to Sensors 1–5 or the roles listed in §5.

## 5. Users & Roles

| Role | Access Level | Notes |
|---|---|---|
| Admin | Full system config, user management, sensor/threshold config | Distinct from the 5 business roles (UC001, UC005, UC006) |
| Managing Director | Full read access, analytics, reports | Highest authority per Table 1 |
| Operation Manager | Real-time monitoring, downtime response | |
| Assistant Operation Manager | Same as above, supports Operation Manager | |
| Engineering Supervisor | Downtime records, maintenance-pattern analytics | Key stakeholder for corrective maintenance program |
| Production Supervisor | Real-time floor visibility, downtime cause categorization | Key stakeholder for daily operations |

First login always forces a password change from a one-time temporary password (UC003, UC005) — this is a functional requirement, not optional polish.

## 6. Functional Requirements (mapped to the paper's Table 1, UC001–UC027)

### 6.1 Auth & Account Management (UC001–UC009)
- Admin login (UC001), role-based user login (UC002), forced first-login password change (UC003), logout (UC004), admin-managed user creation/deletion with auto-generated temp password (UC005), role assignment (UC006), self-service password reset (UC007), system settings management (UC008), shift schedule configuration (UC009).

### 6.2 Real-Time Monitoring & Alerts (UC010–UC020)
- Live dashboard showing machine run/downtime state and all 5 sensor node readings with timestamps (UC010).
- Downtime log: start, end, duration, cause per event, sourced from Sensor 3 (UC011).
- Process events log for Sensors 1, 2, 4 (UC012).
- Production output count per shift/day from Sensor 5 (UC013).
- Manual downtime-cause categorization from a predefined list: corrective maintenance, manual cutting, misalignment, consumable shortage, hydraulic failure, electrical failure, crane failure, other (UC014).
- Production loss estimate derived from downtime duration/frequency (UC015).
- Real-time dashboard alert on downtime detection (UC016).
- Alert acknowledgment — who, when (**UC017**).
- Sensor alert threshold configuration — **currently trigger-duration only; clear/resume threshold is a documented gap, see §8** (**UC018**).
- Downtime trend charts (UC019).
- Machine availability rate — % running time over total monitored time (UC020).

### 6.3 Analytics & Reporting (UC021–UC023)
- Current-vs-historical data analytics across downtime, maintenance patterns, process events, output, and loss (UC021).
- Daily/weekly/monthly summary report generation (UC022).
- Export to PDF/CSV (UC023).

### 6.4 Machine & Sensor Administration (UC024–UC026)
- Register/edit machine records (UC024).
- Configure sensor settings per machine — type, monitoring point, detection threshold, for all 5 sensor nodes (UC025).
- Manage downtime-cause categories (UC026).

### 6.5 Audit (UC027)
- User activity logs — login history, actions performed.

## 7. Non-Functional Requirements (ISO 25010–aligned)

| ISO 25010 Characteristic | Requirement | Source |
|---|---|---|
| **Functional Suitability** | System must correctly attribute every logged event to the correct sensor node (1–5) and correct shift | UC009, UC013 |
| **Reliability** | Database must survive the free-tier failure modes: no auto-pause, automated backups. **Requires Supabase Pro ($25/mo, 8 GB, automated backups) — funding not yet confirmed with Petro Hydro (open risk, §11)** | Team decision |
| **Reliability** | ESP32 nodes must buffer up to 50 readings locally during WiFi/EMI dropouts and flush on reconnect; must resync NTP time on boot/reconnect | `changes-summary.md` firmware additions |
| **Security** | Dashboard users authenticated via JWT; ESP32 nodes authenticated via a separate `X-Node-Token` header — the two auth paths must never be interchangeable | Team decision |
| **Security** | JWT must travel via `Authorization` header only. Query-parameter tokens are rejected (they leak into server logs and browser history) | Team decision |
| **Maintainability** | Production frontend calls the Express API only — never Supabase directly, and never the Supabase Realtime SDK (that opens a direct browser↔Supabase WebSocket and bypasses the one API surface the team controls) | Firm architecture rule |
| **Performance Efficiency** | Real-time updates delivered via Server-Sent Events (SSE) over Express, not polling, not raw WebSocket | Team decision, see TDD §5 |
| **Compatibility** | Sensor nodes are read-only observers — inductive proximity sensors cannot affect machine operation, so there is zero risk of the monitoring system disrupting production | Verified, hardware nature |
| **Usability** | Evaluated post-deployment via UTAUT: performance expectancy, effort expectancy, social influence, facilitating conditions, across all 5 named roles | Paper Objectives |

## 8. Alert Lifecycle (Design Decision — Locked)

Two tables, strictly decoupled:
- `downtime_events` — sensor-driven only. Never human-modified. This is the ground truth of what Sensor 3 actually observed.
- `alerts` — metadata layer on top, for acknowledgment tracking (who, when).

State machine: **OPEN → ACKNOWLEDGED → RESOLVED**. Resolution is always sensor-triggered (the alert cannot be manually closed by a human — only Sensor 3 resuming activity resolves it). This is intentional: it prevents a supervisor from closing an alert to make a dashboard look clean while the machine is still actually down.

**Open gap:** UC018 as currently written only defines the *trigger* threshold (how long Sensor 3 must be silent before the system logs a downtime event). It does not define a *clear* threshold — how long Sensor 3 must show renewed activity before the alert is considered resolved. Without a debounce on the clear condition, a machine that's intermittently active near the resume point will flap the alert open/closed repeatedly. **This needs a decided value (e.g., N consecutive seconds of activity) before implementation, and UC018's text needs to be corrected in the paper to describe both thresholds.**

## 9. Deployment Plan (4 Stages)

1. **Lab Testing** — all 5 nodes, full event simulation, end-to-end verification before touching the site.
2. **Site Survey** (observation only, no installation) — confirm sensor mounting points, verify WiFi signal ≥ -67 dBm, get supervisor sign-off.
3. **Parallel Run** — system runs alongside the manual logbook for 3–5 days; daily reconciliation of discrepancies.
4. **Full Deployment** — only after the parallel run validates; manual logbook kept as backup; management signs off.

## 10. Success Metrics

- ISO 25010 evaluation completed across the characteristics in §7.
- UTAUT acceptance survey completed with all 5 named roles at Petro Hydro.
- Parallel-run discrepancy rate between manual log and system log approaching zero by day 5.
- Zero missed downtime events during the parallel run (false negatives are worse than false positives here).

## 11. Open Decisions & Risks (must close before Capstone 2 defense)

| Item | Status | Why it matters |
|---|---|---|
| 5-node scope | **Resolved** — 5 nodes confirmed | Hardware BOM, firmware classification already written for 5 in the TDD |
| Email vendor | **Resolved** — Resend | Paper still says Brevo; needs a text correction, add to `changes-summary.md` |
| UC018 debounce/clear-threshold value | Open | Needed before firmware can implement Sensor 3 state tracking correctly |
| UC018 threshold source: hardcoded in firmware vs. fetched from server config | Open | Affects whether admin changes require a re-flash or just an API call |
| Supabase Pro tier funding ($25/mo) | Open — Petro Hydro has not confirmed | Free tier auto-pauses and has no backups — disqualifying for a production deployment on a real company's floor |
| ESP32 firmware Type A (discrete event) vs Type B (continuous activity) classification for all 5 nodes | Open — proposed in TDD §2, needs sign-off | Determines whether each node is currently spamming raw pulses (breaking UC018/downtime logic) or transmitting confirmed state transitions |

---

*This PRD should be read alongside `TDD.md` (Technical Design Document) for implementation-level detail, and `changes-summary.md` as the live paper-correction tracker.*
