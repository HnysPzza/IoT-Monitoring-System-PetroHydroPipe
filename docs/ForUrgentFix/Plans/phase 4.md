# Phase 4 Admin Settings and Live Monitoring

Status: Implementation completed on 2026-08-22. Migration `015` must be applied before deploying the Phase 4 backend. Production enforcement is still not approved.

## 1. Purpose

Phase 4 makes the Phase 2 configuration and Phase 3 watchdog understandable and manageable from the dashboard.

It gives an Admin a safe interface for changing sensor absence thresholds, shift times, breaks, and grace time. It also shows current watchdog meaning in the Live Feed without presenting connectivity loss or observe-only evidence as confirmed production downtime.

## How It Works

```text
Admin Settings page
  -> load M-01 settings, backend limits, and watchdog diagnostics
  -> validate one complete draft
  -> PATCH with expected version
  -> atomic settings, history, and audit update

Live Feed every 15 seconds
  -> GET /api/iot/live
  -> one get_machine_live_snapshot database RPC
  -> machine, five latest sensor events, and watchdog states
  -> frontend state mapping and filtering
```

The frontend does not read Supabase directly. PostgreSQL produces one consistent live snapshot, Express validates and maps it, and React displays it.

## Importance

- Admins can change timing values without editing code or reflashing ESP32 devices.
- Backend-provided limits keep the UI aligned with heartbeat measurability rules.
- Optimistic concurrency prevents one Admin from silently overwriting another Admin's changes.
- S-05 remains locked because it counts output and cannot use absence detection.
- Observe-only threshold evidence is not shown as confirmed downtime.
- Offline connectivity remains separate from production state.
- A slow refresh retains the last trusted snapshot and clearly marks it stale.
- One database request per refresh avoids inconsistent timestamps and excessive network round trips.

## Implemented Result

Phase 4 implements migration `015`, strict settings and live API contracts, the Admin operational-settings form, watchdog-aware Live Feed presentation, bounded polling, failure-state handling, security tests, and regression coverage. It does not enable production enforcement or add a watchdog mode control.

## 4. Implemented Architecture

### 4.1 Migration 015

`015_add_live_monitoring_snapshot.sql` adds:

```text
get_machine_live_snapshot(p_machine_code text)
```

The function:

- returns one machine and exactly its configured sensor rows in sensor-code order;
- obtains the latest event independently for every sensor;
- includes the current watchdog row when present;
- uses one PostgreSQL statement timestamp for the complete snapshot;
- is stable, read-only, and safe to reapply;
- has a fixed security-definer search path;
- permits execution only to `service_role`;
- exposes controlled data only and contains no destructive rollback.

### 4.2 Settings API

`GET /api/machines/:machineId/settings` is available to authenticated dashboard roles and returns:

```json
{
  "settings": {},
  "constraints": {
    "sensorCodes": ["S-01", "S-02", "S-03", "S-04", "S-05"],
    "outputSensorCode": "S-05",
    "triggerSeconds": { "minimum": 1, "maximum": 3600, "minimumWhenEnabled": 10 },
    "recoverySeconds": { "minimum": 1, "maximum": 300, "minimumWhenEnabled": 20 },
    "breaks": { "maximum": 10 },
    "rampUpGraceMinutes": { "minimum": 0, "maximum": 30 },
    "sameDayShiftOnly": true,
    "timeZone": "Asia/Manila"
  }
}
```

The heartbeat interval determines the two `minimumWhenEnabled` values. The frontend must use the returned values and must not invent different limits.

`PATCH /api/machines/:machineId/settings` remains Admin-only. It uses `expectedVersion`, validates the complete merged document, and updates settings, settings history, and audit evidence atomically.

Both routes reject unexpected query fields and return `Cache-Control: no-store`. PATCH returns `409 SETTINGS_ENFORCEMENT_ACTIVE` while `WATCHDOG_MODE=enforce`.

### 4.3 Admin Settings Interface

The Settings page:

- loads M-01 from the machine API;
- loads settings and Admin-only watchdog diagnostics;
- allows changes in `disabled` mode;
- allows changes in `observe` mode with a clear warning;
- becomes read-only in `enforce` mode;
- fails closed as read-only if diagnostics cannot be loaded;
- locks all S-05 absence controls;
- uses seconds for trigger/recovery and minutes for grace;
- allows at most ten named, non-overlapping same-day breaks;
- submits the complete settings document in one save;
- sorts breaks before saving;
- keeps the local draft on a version conflict and requires reload before retry;
- warns before browser unload or internal link navigation with unsaved changes;
- preserves the existing local theme preference.

There is intentionally no dashboard control for changing `WATCHDOG_MODE`. Mode changes are deployment actions and require the existing approval gates.

### 4.4 Live Monitoring Contract

`GET /api/iot/live` remains available to all authenticated dashboard roles. It rejects unexpected query fields, is not cacheable, and returns:

```json
{
  "monitoring": {
    "mode": "observe",
    "capturedAt": "2026-08-22T00:02:10.000Z"
  },
  "machine": {},
  "sensors": [
    {
      "sensorCode": "S-01",
      "status": "Idle",
      "monitoring": {
        "stateFresh": true,
        "connectivityState": "online",
        "detectionState": "grace",
        "lastHeartbeatAt": "2026-08-22T00:02:05.000Z",
        "lastActivityAt": "2026-08-22T00:02:00.000Z",
        "lastEvaluatedAt": "2026-08-22T00:02:05.000Z"
      }
    }
  ]
}
```

Express accepts watchdog state only when it was evaluated recently. Disabled or stale state is masked before it reaches the UI.

The frontend meanings are:

| Condition | Display |
|---|---|
| Operational state is already downtime | Confirmed operational downtime |
| Fresh grace state | Idle - grace period |
| Fresh recovery state | Downtime - recovery confirmation |
| Observe-mode threshold reached | Idle - threshold observed |
| Scheduled suspension | Monitoring paused for schedule |
| Disabled mode | Monitoring disabled |
| Stale evaluation | Monitoring data unavailable |
| Offline heartbeat | Separate Offline connection label |
| S-05 | Production output sensing; never an absence state |

The Live Feed makes one request on mount and one request every 15 seconds. Requests never overlap. Polling pauses while the tab is hidden and refreshes when the tab becomes visible. Manual refresh shares the same in-flight guard. A failed refresh keeps the last successful snapshot and displays a stale-data warning.

No new SSE channel, countdown timer, or browser-side downtime calculation was added.

## 5. Rejected Approaches

- Do not let the frontend query Supabase or combine several database reads.
- Do not add another live SSE stream; the bounded 15-second snapshot is sufficient for five sensors.
- Do not show observe candidates as confirmed downtime.
- Do not treat an offline ESP32 as proof that production stopped.
- Do not let the Admin UI change the global watchdog mode.
- Do not save one sensor or break at a time; the configuration is one versioned document.
- Do not overwrite a conflict automatically.
- Do not enable S-05 absence detection.
- Do not add a destructive rollback for migration `015`.

## 6. Test Coverage

Database tests cover migration order, safe reapplication, schema parity, service-role-only execution, five-sensor output, per-sensor latest-event selection, missing machine behavior, and read-only execution.

Backend tests cover one RPC per live request, strict snapshot validation, fresh/stale/disabled state, settings constraints, enforcement lockout, roles, unexpected queries, route tampering, no-store headers, and internal-error masking.

Frontend tests cover:

- backend-driven limits and S-05 locking;
- complete versioned saves and sorted breaks;
- unavailable diagnostics and enforce-mode lockout;
- conflict draft retention;
- valid and invalid shift/threshold documents;
- grace, observe, recovery, offline, stale, and S-05 presentation;
- retained last-good live data;
- non-overlapping polling;
- hidden-tab pause and visibility refresh.

Required local commands:

```powershell
cd Backend
node --test tests/live-monitoring-snapshot.migration.pglite.test.js tests/database.contract.test.js
node --test tests/iot.service.test.js tests/settings.validation.test.js tests/settings.service.test.js tests/api.test.js
node --test --test-concurrency=2 tests/*.test.js tests/contracts/*.test.js

cd ../Frontend
npm.cmd test -- src/features/dashboard/settings/SettingsSection.test.jsx src/features/dashboard/settings/settingsUtils.test.js
npm.cmd test -- src/features/dashboard/live/LiveSection.test.jsx src/features/dashboard/live/livePresentation.test.js
npm.cmd test
npm.cmd run build
```

## 7. Deployment and Manual Verification

1. Back up the hosted database and review migration `015`.
2. Apply migration `015` in Supabase SQL Editor.
3. Deploy the matching backend and frontend.
4. Start with `WATCHDOG_MODE=disabled`.
5. Log in as Admin and confirm Settings loads M-01, S-05 is locked, and saving a harmless reviewed change increments the version once.
6. Confirm the Live Feed refreshes every 15 seconds and retains its last snapshot during a temporary network interruption.
7. Confirm non-Admin dashboard roles can read Live Feed but cannot access the Admin Settings route.
8. Use `observe` only under the Phase 3 soak procedure.

Migration `015` does not authorize `enforce`. Physical sensor validation, recovery calibration, real PostgreSQL concurrency tests, restart/soak evidence, and manual-log comparison are still mandatory.

## 8. Completion Boundary

Phase 4 is implementation-ready when migration, backend, frontend, security, regression, build, dependency, and fuzz gates all pass.

Phase 4 is deployment-ready only after migration `015` is applied and the disabled-mode manual checks pass.

Production enforcement remains blocked until the Phase 3 physical and parallel-run gates are approved.
