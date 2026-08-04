# PRD and TDD — For Corrections

## Audit Scope

This document compares `PRD.md` and `TDD.md` with the implementation on the `Final-Design` branch at commit `662e9cc`.

The PRD and TDD match the general product direction, but they are not yet accurate as-built documents. They currently mix implemented behavior, proposed architecture, and older sensor assumptions.

## Overall Status

Strict assessment of UC001–UC027:

| Classification | Count |
|---|---:|
| Implemented | 6 |
| Partially implemented | 15 |
| Not implemented | 5 |
| Directly conflicts with implementation | 1 |

## Critical Corrections

### 1. Finalize the Sensor 1–5 Mapping

The PRD and TDD assign machine downtime to Sensor 3. The current frontend and backend use this mapping:

| Sensor | Current implementation |
|---|---|
| S-01 | Raw Material Detection |
| S-02 | Outside Filler |
| S-03 | Coil Joint |
| S-04 | Inside Filler |
| S-05 | Production Output Cutting |

This must be resolved before finalizing the documents because it affects firmware behavior, downtime detection, automatic causes, reporting, diagrams, and database rules.

Current authoritative implementation files:

- `Frontend/src/shared/constants/sensorIdentity.js`
- `Backend/src/shared/sensorIdentity.js`
- `Backend/database/seed.sql`

### 2. Correct the Downtime Model

The PRD describes `downtime_events` as Sensor 3 ground truth that is never human-modified. The current implementation differs:

- Any sensor can create downtime by sending a `downtime` or `fault` event.
- Different sensors receive different automatic causes.
- Authorized users can edit the cause and notes.
- Authorized users can manually resolve a downtime record.
- S-03 is treated as the sensor whose cause needs manual review, even though it is currently labeled Coil Joint.

A final decision is needed:

1. Restrict downtime detection to one designated machine-health sensor; or
2. Update the PRD/TDD to describe multi-sensor downtime and cause attribution.

### 3. Replace the Proposed API Contracts with the Current Contracts

| TDD contract | Current implementation |
|---|---|
| `POST /api/nodes/:nodeId/events` | `POST /api/iot/events` |
| `POST /api/nodes/:nodeId/state` | No separate state endpoint |
| `GET /api/dashboard/live` | `GET /api/iot/live` |
| `POST /api/alerts/:id/acknowledge` | `PATCH /api/alerts/:id/acknowledge` |
| `GET /api/stream` | `GET /api/alerts/stream` and `GET /api/downtime/stream` |
| `GET /api/reports?format=pdf\|csv` | `GET /api/reports/summary` |
| `X-Node-Token` | `x-device-id` and `x-device-key` |

The PRD/TDD should follow the implemented contract unless the team deliberately approves an API redesign.

### 4. Correct the Frontend Technology Description

The TDD says the frontend uses React and Tailwind. The current frontend uses:

- React
- Vite
- React Router
- Recharts
- Lucide icons
- Custom design tokens and CSS in `Frontend/src/shared/styles/tokens.css`

Tailwind is not installed and should be removed from the TDD unless the team plans a migration.

### 5. Correct Roles and Exact Role Names

The PRD describes Admin plus five business roles. The implementation currently has:

- Admin
- Operation Manager
- Asst. Operation Manager
- Engineering Supervisor
- Production Supervisor

Corrections needed:

- Managing Director is described in the PRD but is missing from the database seed and authorization rules.
- The PRD uses `Assistant Operation Manager`; the implementation uses `Asst. Operation Manager`.
- Role names must be standardized because backend authorization compares exact strings.

### 6. Correct the Database Design Section

| TDD proposal | Current database |
|---|---|
| `sensor_nodes` | `sensors` |
| `activity_logs` | `audit_logs` |
| `shifts` | Not present |
| Sensor Type A/B field | Not present |
| Alert status `OPEN` | Uses `Active` |
| Sensor-only downtime | Supports manual cause, notes, and resolution |

The TDD must clearly distinguish existing tables from proposed tables and migrations.

### 7. Correct the Alert Lifecycle

The PRD specifies:

`OPEN → ACKNOWLEDGED → RESOLVED`

The current implementation uses:

`Active → Acknowledged → Resolved`

Current behavior also keeps a recovered but unacknowledged alert visible until a user acknowledges it. If recovery occurs before acknowledgment, acknowledgment can complete the resolution. This differs from the strict sequence described in the PRD.

The documents should describe the implemented recovery-before-acknowledgment behavior or the code should be changed after an approved lifecycle decision.

### 8. Correct Production Counting in Reports

The overview dashboard correctly finds S-05 before counting production output events. The report fallback currently counts all `pulse` events for the machine when no summarized `production_counts` rows exist.

The report fallback should count only S-05 production-output pulses.

Affected file:

- `Backend/src/modules/reports/reports.service.js`

## Functional Requirements Status

### Implemented

| Use case | Status |
|---|---|
| UC001 — Login | Implemented with JWT authentication |
| UC004 — Logout | Implemented in the frontend session flow |
| UC016 — Realtime alerts | Implemented through alert SSE |
| UC017 — Alert acknowledgment | Implemented and audit-logged |
| UC022 — Daily, weekly, and monthly reports | Implemented |
| UC027 — Audit logs | Implemented for Admin |

Other implemented foundations:

- One monitored machine: M-01 / Spiral Mill 01.
- Five inductive proximity sensors.
- Express-only browser API access.
- JWT bearer authentication and backend role authorization.
- SSE consumed using `fetch()` and `ReadableStream`.
- CSV report export.
- Downtime history, pagination, filtering, loss estimates, and trend charts.
- Unsupported speed, pressure, temperature, RPM, and line-efficiency concepts are absent.

### Partially Implemented or Needs Work

| Use case | Current state | Work needed |
|---|---|---|
| UC002 — Role-based login | Existing roles can log in | Add or remove Managing Director based on the approved role list |
| UC003 — Forced password change | `must_change_password` exists and is returned | Add password-change endpoint, screen, and route enforcement |
| UC005 — Admin user creation/deletion | Admin can create and archive users | Generate temporary passwords automatically and deliver them securely |
| UC006 — Role assignment | Role is assigned during account creation | Add role editing for existing accounts if required |
| UC008 — System settings | Theme preference exists | Add real system configuration or narrow the requirement to display preferences |
| UC010 — Live monitoring | Current machine and five sensor states can be loaded | Decide whether sensor-state changes also need SSE instead of manual refresh/REST reload |
| UC013 — Production output | Dashboard counts S-05 correctly | Correct the report fallback so it does not count pulses from other sensors |
| UC014 — Downtime categorization | A predefined cause list exists | Align the list with the PRD and decide which causes are automatic or manual |
| UC015 — Production loss | Uses `2.3 pcs` per downtime minute | Document and validate the business formula |
| UC019 — Downtime trend charts | Today, Weekly, and Monthly are supported | Implement the Last Hour backend window before enabling the UI control |
| UC020 — Availability rate | An estimated availability value exists | Validate the denominator and monitored-time rules |
| UC021 — Current and historical analytics | Production comparisons and downtime trends exist | Add process-event and maintenance-pattern history |
| UC023 — PDF/CSV export | CSV works in the frontend | Add PDF generation and decide where export generation belongs |
| UC024 — Machine administration | M-01 and sensor statuses can be changed | Decide whether general machine registration is still needed for a one-machine system |
| UC025 — Sensor configuration | Sensor status can be changed | Add type, monitoring point, trigger threshold, clear threshold, and persistence if retained |

### Not Implemented

| Use case or subsystem | Missing work |
|---|---|
| UC007 — Password reset | Reset request, token lifecycle, password update, and email delivery |
| UC009 — Shift schedule configuration | Shift table, backend contract, Admin UI, and Manila-time rollover rules |
| UC012 — Historical process-event log | Query endpoint and UI for relevant sensor events |
| UC018 — Sensor alert thresholds | Persistent trigger/clear thresholds, Admin API, and firmware behavior |
| UC026 — Downtime-cause management | Cause-category table, CRUD API, validation, and Admin UI |
| ESP32 firmware | Debounce, state transitions, NTP sync, reconnection, buffering, and authentication headers |
| Email subsystem | Resend/Nodemailer integration and delivery monitoring |
| PDF export | Library decision and implementation |

### Direct Conflict

UC011 says downtime is sourced from Sensor 3. The current sensor identity says S-03 is Coil Joint, while the backend allows downtime and fault events from any sensor. This is the most important requirement-to-code conflict.

## Current Design Decisions Missing from the PRD/TDD

### Admin-Managed Target Production Output

The dashboard displays fixed targets:

- Daily: 1,400 pieces
- Weekly: 7,600 pieces
- Monthly: 30,000 pieces

These are constants in `Backend/src/modules/dashboard/dashboard.service.js`. The agreed future requirement is that an Admin can add or edit target production output.

Required work:

- Decide whether targets apply by machine, shift, day, week, month, or effective date.
- Add persistent target storage.
- Add Admin-only create/update endpoints.
- Add validation and audit logging.
- Replace backend constants with persisted targets.
- Add the Admin editing UI only after the backend contract exists.

### Last Hour Downtime

The desired periods are:

- Last Hour
- Today
- Weekly
- Monthly

Today, Weekly, and Monthly are implemented. Last Hour is visible but disabled because the backend only accepts `today`, `week`, and `month`.

Required work:

- Define a rolling 60-minute window.
- Define chart bucket sizes.
- Add backend validation and aggregation.
- Test Asia/Manila boundary behavior.
- Enable the frontend control after the API is implemented.

### One-Machine Scope

The current system intentionally monitors only M-01 / Spiral Mill 01. The PRD's general machine-registration requirement may be wider than the approved scope.

Decide whether UC024 should be changed from “register machines” to “manage the configuration and status of M-01.”

### Machine Health Scope

Machine health must be based only on the five inductive proximity sensors and their event freshness/status. Do not add:

- Speed
- Pressure
- Temperature
- RPM
- Line efficiency

### Deferred Plant and Shift Header

Plant name, location, shift, schedule, and connection freshness must not be presented as invented static data. Add the header only after authoritative configuration and data-source rules exist.

## Open Decisions

The following decisions must be resolved before treating the PRD and TDD as final:

1. Final Sensor 1–5 identity and physical monitoring-point mapping.
2. Which sensor or sensors can create downtime.
3. Whether users may manually resolve downtime or only edit its cause and notes.
4. Final alert lifecycle and recovery-before-acknowledgment behavior.
5. Final role list, including Managing Director.
6. Whether general machine registration is needed for a one-machine deployment.
7. Trigger and clear threshold values and where they are stored.
8. Shift ownership, schedule, and rollover behavior.
9. Production-loss formula and its approved business source.
10. Production-target scope and effective-date rules.
11. PDF generation library and server/client responsibility.
12. Email vendor configuration and deployment funding decisions.

## Recommended Correction Order

1. Finalize and document the physical Sensor 1–5 mapping.
2. Align downtime creation and resolution rules with that mapping.
3. Update all PRD/TDD endpoints, headers, schema names, role strings, and frontend technologies.
4. Add Admin-managed production targets to the PRD and TDD.
5. Clarify UC024 for the approved one-machine scope.
6. Implement forced password change, password reset, and temporary-password delivery.
7. Implement shift and threshold configuration.
8. Add historical process-event reporting.
9. Correct S-05 filtering in report production totals.
10. Add PDF export and firmware implementation.

## Verification Record

Audit verification completed on the `Final-Design` branch at commit `662e9cc`:

- Backend tests: 42 passed, 0 failed.
- Frontend tests: 24 passed, 0 failed.
- Frontend production build: passed.
- No application source files were changed during the audit.

## Document Limitations

- `PRD.md`, `TDD.md`, and this correction report are under the repository's ignored `docs/` directory and are currently local-only unless explicitly force-added or the ignore rule is changed.
- The PRD and TDD refer to `changes-summary.md` and `CAPSTONE1_PARTIAL_REVISED.pdf`, but neither file is currently present in this workspace. Claims attributed only to those files could not be independently verified during this audit.
