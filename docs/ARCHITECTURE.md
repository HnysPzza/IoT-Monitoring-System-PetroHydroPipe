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

The frontend sends status, cause, date, page, and limit query parameters. The backend applies the filters, returns paginated records, and computes summary totals through the database summary function.

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

This storage/API phase does not enforce sensor absence thresholds. The current ingestion RPC runs only when an event arrives, so it cannot detect an event that never arrives. Phase 3 must add periodic heartbeats plus a backend watchdog and an idempotent atomic transition function before stored thresholds affect machine state or downtime.

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

### Admin-Managed Production Targets

Admins should eventually be able to add and edit target production output. This requires replacing the current fixed backend constants with persistent configuration and a role-protected API.

Before implementation, define:

- Whether targets apply by day, week, month, shift, machine, or effective date.
- Validation rules and units.
- Change history and audit-log requirements.
- How charts handle target changes inside a reporting period.

The design may show an Admin-only edit affordance, but it must remain documented as planned until the storage model, API contract, authorization, and audit behavior are implemented.

### Downtime Period Expansion

The planned overview control uses `Last Hour`, `Today`, `Weekly`, and `Monthly`. The current dashboard supports today, week, and month ranges. `Last Hour` requires an additional backend time-window contract and should not be treated as implemented until the API and chart aggregation support it.
