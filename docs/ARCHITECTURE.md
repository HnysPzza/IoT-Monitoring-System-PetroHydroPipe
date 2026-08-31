# Architecture

## System Flow

```text
ESP32 Sensors -> Express Backend -> Supabase PostgreSQL -> Express APIs -> React Dashboard
```

The frontend never talks directly to Supabase in production. All database access goes through the Express backend.

For internet deployment, keep the same boundary:

```text
React Dashboard -> Express Backend -> PostgreSQL Database
ESP32 Devices -> Express Backend -> PostgreSQL Database
```

Supabase may be used as managed PostgreSQL, but production auth and authorization remain backend-managed.

## Frontend

Location: `Frontend/`

Main responsibilities:

- Login page.
- Dashboard shell and role-aware navigation.
- Overview analytics.
- Live Feed.
- Downtime records.
- Reports and CSV export.
- User management.
- Machine/sensor management.
- Audit log viewer.
- Settings.

## Backend

Location: `Backend/`

Main responsibilities:

- Auth and JWT issuance.
- Current-user validation on protected routes.
- Role authorization.
- User account management.
- Machine and sensor APIs.
- Versioned machine operational-settings API.
- IoT device authentication.
- Sensor event ingestion.
- Dashboard, downtime, report, and audit APIs.
- Rate limiting and production middleware.

## Downtime and Realtime Model

Current IoT transition flow:

```text
ESP32 event -> Express IoT API -> PostgreSQL atomic transition -> post-commit SSE -> React dashboard
```

The backend receives ESP32 sensor events through the IoT API. The database function `ingest_iot_sensor_event` performs one ACID transaction for the raw sensor event, the applied sensor and machine state, downtime, alert state, and transition audit rows. If any required write fails, none of those operational changes commit. Exact duplicate event IDs are idempotent. Events with a `recordedAt` timestamp that is stale or equal to the locked sensor watermark remain in `sensor_events`, but do not change state, downtime, alerts, revisions, or transition audits.

The downtime list is loaded through the backend API:

```text
React dashboard -> GET /api/downtime -> Express backend -> Supabase PostgreSQL
```

The frontend sends status, cause, date, page, and limit query parameters. The backend applies interval-overlap filters, pages deterministically through all metric rows, returns paginated records, and computes break-aware summaries from effective-dated settings history. Machine totals union simultaneous sensor intervals so availability and loss are not counted twice.

Realtime dashboard updates currently use Server-Sent Events:

```text
React dashboard -> GET /api/downtime/stream -> Express backend
```

The backend publishes downtime updates with an in-memory Node `EventEmitter`. The dashboard listens to the SSE stream and silently reloads downtime records when downtime is created, resolved, or manually updated.

Current reliability layer:

- SSE gives fast dashboard refreshes during a healthy connection.
- Frontend fallback polling starts when the SSE stream repeatedly disconnects or receives repeated connection-cap responses.
- Streams close at JWT expiry and periodically revalidate the current database user and role.
- Alerts and downtime share process-local connection caps: four streams per user, 20 per source IP, and 100 total by default. This supports two dashboard tabs per user while retaining bounded admission.
- Heartbeats advertise their configured interval so the browser can detect and reconnect a half-open stream with a bounded inactivity watchdog.
- Slow clients use a bounded per-stream queue and backpressure deadline; overflow or a stalled socket closes the stream instead of growing memory or holding a lease indefinitely.
- The frontend treats stream authorization loss as terminal, honors `Retry-After` for connection caps, and reconnects normally after the configured maximum stream lifetime.
- Unplanned and planned reconnects include bounded jitter to reduce synchronized retry bursts.
- Admins can inspect aggregate, non-identifying SSE counters through `GET /api/operations/sse`.
- Pagination is handled by the backend, not only by frontend state.
- The current design is acceptable for a single persistent Express backend process.

### Alert integrity and reconnect repair

Alert lifecycle is intentionally limited to `Active`, `Acknowledged`, and `Resolved`:

- A new fault creates an `Active` alert. A repeated fault refreshes the one unresolved alert, preserves `Active` or `Acknowledged`, and clears recovery metadata.
- Recovery while `Active` keeps the alert `Active` and records `metadata.recoveryPending` so an operator must still acknowledge it.
- Recovery while `Acknowledged` resolves the alert.
- Acknowledgement during an ongoing fault produces `Acknowledged`; acknowledgement after recovery produces `Resolved`.

Every meaningful alert insert or update receives a global revision from a locked singleton counter row inside the same transaction. This is a transactional commit-order mechanism, not a PostgreSQL sequence or a per-alert counter. No-op acknowledgements do not consume revisions. `get_alerts_snapshot` returns alert rows plus SQL field `snapshot_revision` from one database statement; Express maps that field to API property `snapshotRevision`. All `BIGINT` revisions cross the JavaScript boundary as canonical decimal strings.

Downtime and alert SSE frames are published only after the database transaction commits. Publication is process-local, observable, and best-effort: one failed listener is logged and isolated, and can never roll back the committed IoT response. There is no outbox, queue, or worker in the current design.

The alerts dashboard treats REST as the repair source and SSE as the low-latency signal. Mount, manual retry, fallback polling, and every successful stream open use one snapshot coordinator with at most one request in flight, a five-second minimum between starts, and at most one queued trailing request. The stream `onOpen` payload reports `isReconnect: true` only after a prior successful connection and `isRetry: true` when a successful open follows failed attempts. Even the first successful open requests one bounded repair because the client has no server-provided open watermark.

Snapshot and event revisions are parsed with `BigInt` only after strict decimal-string validation. Events at or below the applied watermark are ignored. Buffered events newer than a snapshot are sorted and applied only when the complete chain is contiguous; malformed data, a revision gap, buffer overflow, or a snapshot older than current live state preserves the newest trusted state and schedules a coalesced REST repair.

Important deployment constraint:

The SSE publishers and connection registry are process-local. Events and connection counts exist only in the Node process that handled them. This is fine for local development, capstone demonstration, and a single backend server. It is not fully realtime-safe or globally rate-limited for serverless, autoscaled, or load-balanced deployments with multiple backend instances.

Example limitation:

```text
IoT event hits Backend Process A
Browser SSE connection is attached to Backend Process B
Process B does not receive Process A's in-memory EventEmitter event
Frontend catches up only after a successful stream open, a manual reload, or degraded-mode polling
```

This means the current architecture provides practical realtime behavior only for the supported single-process setup. There is no background alert poll while a stream remains healthy. In an unsupported multi-instance deployment, a stable stream on Process B can remain stale indefinitely after a write on Process A until a successful stream open, manual reload, or degraded fallback poll triggers REST repair.

## Database

Location: `Backend/database/`

Main tables:

- `roles`
- `users`
- `machines`
- `sensors`
- `sensor_events`
- `downtime_events`
- `production_counts`
- `audit_logs`
- `alerts`
- `alert_revision_state`
- `machine_operational_settings`

## Auth Model

Users log in with username/password. The backend verifies bcrypt hashes and returns a JWT. Protected requests validate both the token and the current user record in Supabase.

Planned production auth direction:

- Keep custom Express auth.
- Add email-based login/identity if required by deployment.
- Add email verification and password reset.
- Keep the email sending provider undecided behind an email service adapter.
- Do not use Supabase Auth unless the architecture is explicitly revisited.

See [DEPLOYMENT_AUTH_PLANNING.md](./DEPLOYMENT_AUTH_PLANNING.md) for the deployment and auth planning note.

## IoT Model

ESP32 devices use separate device auth headers:

```http
x-device-id: esp32-m01-s01
x-device-key: device-secret
```

Device keys are stored as bcrypt hashes in Supabase.

## Current Monitoring Scope

The current `main` branch is designed around one production machine:

- `M-01` - `Spiral Mill 01`

Five ESP32-backed inductive proximity sensors are assigned to that machine:

- `S-01` - Raw Material & Coil Joint
- `S-02` - Inside Filler Wire
- `S-03` - Machine Main Sensor
- `S-04` - Outside Filler Wire
- `S-05` - Production Output Cutting

The monitoring UI should describe these sensor states and events. It should not introduce unsupported machine telemetry such as speed, pressure, temperature, RPM, bar, or degrees Celsius.

Production targets currently come from fixed backend values for day, week, and month. The dashboard can display those values, but there is no current admin workflow or persistent configuration API for adding or editing targets.

### Machine Operational Settings

Phase 2 adds one `machine_operational_settings` row per explicitly provisioned machine and exposes it through `GET` and Admin-only `PATCH` requests at `/api/machines/:machineId/settings`. Updates use optimistic concurrency and one PostgreSQL transaction for both the settings change and its `SETTINGS_UPDATED` audit row. Migration `010` provisions M-01; future machines require explicit settings provisioning after their sensors are defined.

The event-ingestion RPC still cannot detect an event that never arrives. Phase 3 therefore adds authenticated device heartbeats, persisted watchdog runtime, and idempotent atomic evaluation. Migration `014` evaluates the configured sensor set through one service-role-only database request while isolating each sensor's work. `WATCHDOG_MODE` defaults to `disabled`, which keeps heartbeat ingestion active without starting periodic evaluation cycles; `observe` records candidates without operational mutations, while `enforce` may create or resolve watchdog-owned downtime only for sensors whose absence detection is explicitly enabled. Connectivity loss creates a separate connectivity condition and cannot create production downtime. S-05 absence detection is permanently prohibited.

Settings updates now also maintain `machine_operational_settings_history` in the same transaction. Downtime, dashboard, and report metrics use the schedule version effective at the requested time, exclude breaks and post-break grace, include records that overlap a window even if they started earlier, and return not-applicable availability when scheduled eligible time is zero.

Phase 3 operational flow:

```text
ESP32 heartbeat -> device-authenticated API -> atomic heartbeat state
watchdog tick -> one batched database evaluation -> isolated atomic sensor transitions -> post-commit SSE
settings history + downtime overlap -> shared operational-time engine -> dashboard/report metrics
```

The watchdog runner starts only from `server.js` in observe or enforce mode, runs immediately without overlapping its own cycles, uses one database RPC per cycle, applies a bounded timeout, and stops before SSE during graceful shutdown. Cycles are classified as success, partial, failed, or cancelled; disabled mode remains idle. Admins can inspect nested aggregate, non-identifying state through `GET /api/operations/watchdog`, which is Admin-only and not cacheable.

Phase 4 adds a controlled frontend over this backend state. The Admin Settings route loads settings plus backend-derived constraints and separately checks Admin-only watchdog diagnostics. It saves the complete versioned document, locks S-05, fails closed when mode is unknown, and refuses writes while enforcement is active. The global watchdog mode remains deployment-owned and has no mutation endpoint.

Migration `015` adds the service-role-only `get_machine_live_snapshot` function. It returns M-01, all five sensors, each sensor's independently selected latest event, and current watchdog state from one consistent read. `GET /api/iot/live` strictly validates that result, masks disabled or stale evaluation state, rejects unexpected query fields, and sends `Cache-Control: no-store`.

The Live Feed makes one request every 15 seconds with an in-flight guard. Hidden tabs pause polling, visibility restoration triggers a refresh, and failures retain the last trusted snapshot. A pure presentation layer keeps connectivity, grace, observe-only thresholds, recovery confirmation, and confirmed operational downtime distinct. S-05 is always presented as production output sensing and never receives an absence state. No additional SSE stream or browser-side transition calculation is used.

Code support does not authorize enforcement. Physical signal classification, heartbeat reliability, recovery calibration, disposable PostgreSQL concurrency tests, and parallel-run evidence remain required before changing `WATCHDOG_MODE` to `enforce`.

Production targets are deliberately outside Phase 2. They require a separate effective-date and reporting-period design before replacing the current fixed values.

## Future Work

For the current capstone/local/single-server setup, keep the existing SSE plus revisioned REST repair design. It is simple and avoids extra infrastructure.

Recommended near-term improvement:

- Keep SSE for instant updates.
- Keep fallback polling after repeated SSE disconnects.
- Keep the bounded snapshot repair on every successful stream open.
- Use faster polling, such as every 10 seconds, only when SSE fallback mode starts.

If the backend is later deployed as multiple Node processes, containers, replicas, serverless functions, or behind a load balancer, replace the process-local realtime publisher with a shared event channel.

Possible shared-channel options:

- Redis pub/sub.
- Supabase Realtime.
- PostgreSQL `LISTEN/NOTIFY`.
- A dedicated message queue or event bus.

The target production flow would be:

```text
IoT event hits any backend instance
Backend writes downtime state to PostgreSQL
Backend publishes event to shared channel
All backend instances receive the event
Browser SSE connection receives the update from whichever instance it is connected to
```

Until that shared channel exists, one persistent Express backend instance is the supported realtime architecture. Successful-open snapshot repair and degraded-mode polling can recover some missed events, but they are not a cross-instance delivery guarantee.

### Deferred Dashboard Context Strip

A future dashboard header may show:

- Plant name.
- Plant location.
- Active shift name.
- Shift start and end time.
- Live connection state.
- A short connection-health message.

This context strip is not implemented on the current `main` branch and should not be added as static or invented UI data. Before implementation, define authoritative sources for plant identity, plant location, shift schedules, and connection freshness. Also define whether those values are global configuration, machine-specific configuration, or derived operational state.

Example future flow:

```text
Admin-managed plant and shift configuration
        +
Backend-derived connection freshness
        |
        v
Dashboard context strip
```

### Production Output Comparison

Overview production analytics compares the current Manila calendar day with the immediately preceding Manila calendar day. It does not evaluate production against a configured target.

The backend uses S-05 Output Cutting pulse events as the single source for both totals. One bounded query covers yesterday through the end of today, then the service derives:

- Today's pipe count.
- Yesterday's pipe count.
- The signed difference in pipes.
- The percentage difference when yesterday is greater than zero.
- Cumulative Today and Yesterday chart points.

When yesterday is zero, the API returns a null percentage so the frontend displays a no-baseline state instead of a misleading zero-percent change. Day, week, and month selectors remain available for downtime analysis only.

### Estimated Output Loss

Estimated output loss is a counterfactual calculation, not a directly measured sensor value. The backend resolves one current production-rate basis per request and applies it to unplanned downtime across Analytics, Overview, Reports, and Downtime.

The rate uses recorded S-05 output divided by productive minutes. Productive minutes are scheduled eligible minutes minus unioned unplanned downtime, so breaks, grace periods, and overlapping downtime are not double-counted. Only fully completed Manila days with recorded S-05 output qualify.

The backend uses the previous seven completed days when the sample contains at least three qualified production days, 360 productive minutes, and 10 output pieces. It expands to 30 completed days when the seven-day sample is insufficient. If both samples are insufficient, it uses `OUTPUT_LOSS_FALLBACK_PIECES_PER_MINUTE`, which defaults to `0.05` pieces per minute (one piece per 20 minutes).

API responses include the source, rate, window, qualified day count, productive minutes, and recorded output used for the estimate. Existing sensor and downtime history is never rewritten. Historical heartbeat completeness remains unavailable, so zero-output days are not treated as proven production observations, and S-05 absence detection remains prohibited.

### Manual Sensor Recovery Override

Physical `pulse` and `recovered` events remain the normal authority for sensor recovery. Production administrators may use a separate manual recovery override when the physical issue has been verified but the recovery event is unavailable.

The override requires a reason and atomically activates the selected sensor, recalculates the machine from all sensor states, resolves matching open downtime, marks the matching alert as recovered, and writes an audit record. It does not insert or imitate an IoT sensor event. A later physical event remains valid and is processed idempotently through the normal ingestion flow.

An Active alert becomes recovered and waits for acknowledgement. An already acknowledged alert resolves immediately when recovery is recorded. Machine status must not be used by itself to recover a sensor-specific incident.

### Downtime Period Expansion

The planned overview control uses `Last Hour`, `Today`, `Weekly`, and `Monthly`. The current dashboard supports today, week, and month ranges. `Last Hour` requires an additional backend time-window contract and should not be treated as implemented until the API and chart aggregation support it.

Daily downtime uses non-overlapping Manila-time periods (`12-6AM`, `6-9AM`, `9AM-12PM`, `12-3PM`, `3-6PM`, and `6-9PM`). The current period is calculated only through the request time, while future periods return no observed value. Production comparison checkpoints remain cumulative and use a separate boundary calculation.
