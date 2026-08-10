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
- IoT device authentication.
- Sensor event ingestion.
- Dashboard, downtime, report, and audit APIs.
- Rate limiting and production middleware.

## Downtime and Realtime Model

Current downtime flow:

```text
ESP32 event -> Express IoT API -> PostgreSQL downtime transaction -> Express downtime SSE -> React dashboard
```

The backend receives ESP32 sensor events through the IoT API. The event is processed by the database function `ingest_iot_sensor_event`, which records the sensor event, updates the sensor and machine state, creates downtime when a downtime/fault event starts, and resolves downtime when a pulse/recovered event arrives.

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
- Frontend fallback polling starts when the SSE stream repeatedly disconnects.
- Streams close at JWT expiry and periodically revalidate the current database user and role.
- Alerts and downtime share process-local connection caps: two streams per user, five per source IP, and 100 total by default.
- Slow clients use a bounded per-stream queue; overflow closes the stream instead of growing memory without limit.
- The frontend treats stream authorization loss as terminal, honors `Retry-After` for connection caps, and reconnects normally after the configured maximum stream lifetime.
- Pagination is handled by the backend, not only by frontend state.
- The current design is acceptable for a single persistent Express backend process.

Important deployment constraint:

The SSE publishers and connection registry are process-local. Events and connection counts exist only in the Node process that handled them. This is fine for local development, capstone demonstration, and a single backend server. It is not fully realtime-safe or globally rate-limited for serverless, autoscaled, or load-balanced deployments with multiple backend instances.

Example limitation:

```text
IoT event hits Backend Process A
Browser SSE connection is attached to Backend Process B
Process B does not receive Process A's in-memory EventEmitter event
Frontend eventually catches up through polling
```

This means the current architecture provides practical realtime behavior for the current setup, with polling as the safety net, but it does not provide strict cross-instance realtime delivery.

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

- `S-01` - Raw Material Detection
- `S-02` - Outside Filler
- `S-03` - Coil Joint
- `S-04` - Inside Filler
- `S-05` - Production Output Cutting

The monitoring UI should describe these sensor states and events. It should not introduce unsupported machine telemetry such as speed, pressure, temperature, RPM, bar, or degrees Celsius.

Production targets currently come from fixed backend values for day, week, and month. The dashboard can display those values, but there is no current admin workflow or persistent configuration API for adding or editing targets.

## Future Work

For the current capstone/local/single-server setup, keep the existing SSE plus polling fallback design. It is cheap, simple, and avoids extra infrastructure.

Recommended near-term improvement:

- Keep SSE for instant updates.
- Keep fallback polling after repeated SSE disconnects.
- Optionally add low-frequency background polling, such as every 30 to 60 seconds, even while SSE is healthy.
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

Until that shared channel exists, the deployment assumption is: one persistent Express backend instance is the supported realtime architecture, and polling is the recovery path for missed SSE events.

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
