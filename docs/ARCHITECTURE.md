# System Architecture

## Goal

Give plant operators and supervisors a reliable, real-time view of **Spiral Mill 01 (`M-01`)**—tracking whether the machine is running, why it stopped, and how many finished pipes were cut—without losing or double-counting data when factory Wi-Fi or browsers disconnect.

---

## High-Level Data Flow

```text
ESP32 Sensors (S-01 to S-05) -> Express Backend -> Supabase PostgreSQL -> Express APIs / SSE -> React Dashboard
```

- **One boundary**: The React dashboard and ESP32 boards never talk directly to Supabase. Every read, write, login, and sensor event goes through the Express backend.
- **Database as the source of truth**: Critical operational writes (sensor events, downtime transitions, alerts, operational settings, and user status changes) run inside single atomic PostgreSQL functions (RPCs) together with their `audit_logs` entry. If any part of a write fails, the entire change rolls back.

---

## The Machine and Five Sensors

The system monitors one production machine:

- `M-01` — **Spiral Mill 01**

Five ESP32-backed inductive proximity sensors are assigned to `M-01`:

- `S-01` — Raw Material & Coil Joint (process material presence)
- `S-02` — Inside Filler Wire (process consumable presence)
- `S-04` — Outside Filler Wire (process consumable presence)
- `S-03` — Machine Main Sensor (main spindle rotation and **machine-running authority**)
- `S-05` — Production Output Cutting (finished pipe counter)

No physical ESP32 nodes are integrated yet on the hosted cloud environment; device flows in this document define the backend contract and local firmware behavior. The UI only displays supported proximity and count states—never unsupported telemetry such as speed, pressure, temperature, or RPM.

---

## Core System Components

### 1. Frontend (`Frontend/`)
React and Vite single-page dashboard providing role-aware views:
- **Overview & Analytics**: Real-time pipe counts, Today vs. Yesterday production comparison, availability, and downtime trends.
- **Live Feed**: Current machine and sensor states polled every 15 seconds (paused when the tab is hidden).
- **Downtime & Production Logs**: Paginated tables with inline/batch editing and `409 Conflict` protection when two users edit the same record.
- **Reports & Audit Logs**: Filterable operational history with PDF and XLSX export.
- **Settings & User Management**: Admin controls for shift schedules, sensor thresholds, and role-based user accounts.

### 2. Backend (`Backend/`)
Node.js and Express server handling security, validation, and coordination:
- **Authentication & Sessions**: Username/password login verified with bcrypt, short-lived access JWTs, and `HttpOnly; SameSite=Strict` refresh token cookies with replay detection.
- **Role Authorization**: Five roles (`Admin` displayed as **Managing Director**, `Operation Manager`, `Production Supervisor`, `Engineering Supervisor`, and `Quality Control`).
- **IoT Ingestion**: Authenticates ESP32 headers (`x-device-id`, `x-device-key` matched against SHA-256/bcrypt hashes), caches machine thresholds for 5 seconds to reduce database load, and forwards events to PostgreSQL RPCs.
- **Realtime SSE & Watchdog**: Publishes post-commit Server-Sent Events (SSE) for instant dashboard refreshes and runs the optional background watchdog evaluator.

### 3. Database (`Backend/database/`)
Supabase PostgreSQL schema (current readiness version: **58**):
- **Core tables**: `roles`, `users`, `machines`, `sensors`, `sensor_events`, `downtime_events`, `production_outputs`, `alerts`, `alert_revision_state`, `machine_operational_settings`, `machine_operational_settings_history`, `sensor_watchdog_state`, `sensor_watchdog_transitions`, and `audit_logs`.
- **RPC-only mutations**: Direct `INSERT`, `UPDATE`, and `DELETE` privileges are revoked from client roles and restricted on `service_role` so state changes must pass through audited PostgreSQL functions.

---

## Key Operational Rules (Plain English)

### 1. How Machine Downtime Works (`S-03` Authority & Grouped Rule)
- **Direct downtime**: `S-03` (Main Spindle) is the authority for whether the machine is running. If `S-03` faults, the machine enters **Downtime** immediately.
- **Process faults vs. grouped downtime**: A fault on `S-01`, `S-02`, or `S-04` alone is a **process fault** (it raises an alert without stopping machine status). If all three (`S-01`, `S-02`, and `S-04`) have unresolved faults at the same time, the database automatically opens one `S-03`-owned machine downtime record.
- **Disabling Absence Detection**: If an Admin turns off Absence Detection while a sensor is in an absence fault or downtime, both the database (`056_clear_fault_on_absence_disable.sql`) and ESP32 firmware immediately clear the fault, resolve the process alert, and close the downtime.

### 2. How Pipe Counting Works (`S-05` Output Rule)
- Every `S-05` pulse is saved in `sensor_events` as raw evidence.
- A pipe pulse is **accepted** (`output_accepted = true`) unless `S-03` machine downtime is active, the event timestamp is stale, or the pulse arrives within the 100 ms server debounce floor (`054_s05_output_only_reject_on_downtime.sql`).
- Rejected pulses stay in the database with a rejection reason for forensic review, but never increase pipe counts, reports, or analytics.
- **S-05 absence detection is permanently prohibited** because a quiet pipe cutter does not mean the machine is broken.

### 3. Server-Owned Schedules, Heartbeats, and Watchdog
- **Backend is authoritative for shift and break classification** in the `Asia/Manila` timezone. Future ESP32 firmware must not store or independently interpret the plant schedule, preventing clock drift from turning a lunch break into false downtime.
- **Device heartbeats remain independent from production pulses**. Sensors send `POST /api/iot/heartbeats` every 10 seconds to prove network connectivity (`Online` vs. `Offline`). Connectivity loss creates a separate connectivity condition and cannot create production downtime.
- **Event meanings**:
  - `pulse` (`active`): Confirmed sensor activity or pipe cut.
  - `idle` (`idle`): Sensor is powered and waiting; updates live state without creating downtime.
  - `downtime` (`no_pulse`): Absence observation only. Firmware must not emit downtime merely because a pulse did not arrive without threshold evaluation.
  - `fault` (`fault`): Explicit physical sensor or machine fault. An explicit fault during a break remains recorded because it may prevent restart, though break overlap is excluded from unplanned downtime minutes.
  - `recovered` (`active`): Confirmed recovery after a fault; atomically clears the sensor fault and reconciles machine downtime (`055_atomic_confirmed_device_recovery.sql`).
- **Live Snapshot**: `GET /api/iot/live` calls `get_machine_live_snapshot` to return `M-01`, all five sensors, their latest non-stale events, and watchdog status in a single consistent database read.

### 4. Handling Bad Wi-Fi and Duplicate Events
- **Idempotent retries**: Each ESP32 event carries a latched UUID (`eventId`) and timestamp (`recordedAt`). If Wi-Fi drops mid-request and the ESP32 retries, PostgreSQL recognizes the `eventId` and returns the saved result without duplicating pipes, alerts, or downtime.
- **Stale event protection**: Each sensor tracks `last_applied_recorded_at`. If an old delayed packet arrives after a newer state change, it is stored with `stale = true` and `stateApplied = false` so it cannot overwrite current machine status.

### 5. Realtime Alerts, SSE, and Single-Server Scope
- **Alert lifecycle**: Alerts move strictly through `Active` -> `Acknowledged` -> `Resolved` using a locked global revision counter (`snapshotRevision`).
- **SSE + REST repair**: After a database transaction commits, Express pushes an SSE notification to connected browsers. If SSE disconnects or hits connection caps (4 per user, 20 per IP, 100 total), the dashboard automatically falls back to 10-second REST polling and repairs its snapshot on reconnect.
- **Single-process boundary**: The SSE publisher is an in-memory Node `EventEmitter`. This is fast and reliable for a single Express server (local, shop-floor, or single Render container). If the backend is ever scaled to multiple load-balanced instances, replace the in-memory emitter with Redis pub/sub or PostgreSQL `LISTEN/NOTIFY`.

### 6. Production Comparison & Estimated Output Loss
- **Today vs. Yesterday**: Overview analytics compares accepted `S-05` pipe counts for the current Manila day against yesterday. If yesterday had zero pipes, percentage change returns `null` rather than a misleading `0%`.
- **Estimated Output Loss**: Calculated across Analytics, Overview, Reports, and Downtime by multiplying unplanned downtime minutes (excluding scheduled breaks and grace periods) by the historical pipe rate from the last 7 or 30 qualified Manila production days (falling back to `0.05` pcs/min or `3 pcs/hr` when historical data is insufficient).
