# Operational Configuration and Tolerances

This document defines the approved direction for machine operational settings. The detailed implementation contract is in `docs/ForUrgentWork/Plan/2026-08-22-phase-2-settings-storage-and-backend-api.md`.

## Phase boundaries

| Phase | Responsibility |
|---|---|
| Phase 2 | Store, validate, version, expose, and audit per-machine settings. |
| Phase 3 | Consume settings in a heartbeat/watchdog calculation engine and break-aware metrics. |
| Phase 4 | Add Admin settings controls and live refill/idle visuals. |
| Phase 5 | Validate with hardware, adversarial tests, browser tests, and parallel-run evidence. |

Phase 2 does not change machine state, downtime, alerts, availability, production loss, firmware, or frontend controls.

Phase 2 is implemented through migration `010`, strict backend validation, and the versioned machine-settings API. Phase 3 backend support is implemented through migrations `011` and `012`, the authenticated heartbeat API, the restart-safe watchdog, and shared break-aware metrics. Apply migrations in numeric order. Keep `WATCHDOG_MODE=disabled` until the deployment gates below are satisfied.

## Sensor absence settings

Proposed trigger values:

| Sensor | Trigger | Recovery | Initial status |
|---|---:|---:|---|
| S-01 Raw Material & Coil Joint | 600 seconds | Pending calibration | Disabled |
| S-02 Inside Filler Wire | 300 seconds | Pending Type A/B validation | Disabled |
| S-03 Machine Main Sensor | 60 seconds | Pending calibration | Disabled |
| S-04 Outside Filler Wire | 300 seconds | Pending Type A/B validation | Disabled |
| S-05 Production Output Cutting | Not applicable | Not applicable | Permanently disabled for absence detection |

These are configuration defaults, not proof that the physical sensors emit the heartbeats required for absence detection.

Phase 3 implements these transitions:

1. Confirmed heartbeat/activity keeps the applicable sensor running.
2. Missing activity below the trigger threshold is a grace state and does not open downtime.
3. Missing activity beyond the trigger threshold opens downtime through an atomic transition.
4. Sustained recovered activity for the configured recovery duration permits recovery.

Automatic causes remain aligned with Phase 1:

- S-01: Corrective Maintenance.
- S-02 and S-04: Consumable Shortage.
- S-03: Pending Cause Review and operator-editable.
- S-05: Manual Cutting only for an explicit fault event, not output-pulse absence.

## Shift and breaks

Default same-day schedule in Asia/Manila:

- Work window: 08:00 to 17:00.
- Morning break: 10:00 to 10:15.
- Lunch break: 12:00 to 13:00.
- Afternoon break: 15:00 to 15:15.
- Ramp-up grace after each break: 10 minutes.

The stored/API fields are `workStart`, `workEnd`, named `breaks` with `startTime` and `endTime`, and `rampUpGraceMinutes`. The timezone is fixed by the backend and is not editable.

The work window is nine elapsed hours with 90 minutes of breaks, leaving 7.5 scheduled production hours before grace treatment.

Phase 3 calculates interval overlap rather than labeling an entire stoppage from its start time. Only the portions overlapping a break or approved grace window are excluded from unplanned downtime metrics. Simultaneous sensor downtime is unioned once for machine availability and total loss.

Overnight shifts, holidays, temporary schedule exceptions, and multiple shifts are outside the current design.

## Selected technical approach

- Store settings in `machine_operational_settings`, keyed by machine UUID.
- Keep the backend as the source of truth so configuration changes do not require ESP32 reflashing.
- Use versioned GET/PATCH machine-settings APIs.
- Update settings and audit history atomically in PostgreSQL.
- Use the backend heartbeat watchdog for no-event detection. The ingestion RPC cannot detect an event that never arrives.
- Keep production-target management separate until effective dates and reporting behavior are designed.

## Required validation before enabling enforcement

- Confirm Type A/Type B behavior for S-02 and S-04 on physical hardware.
- Confirm whether S-01 produces a reliable continuous heartbeat for absence monitoring.
- Calibrate recovery confirmation timing through parallel-run evidence.
- Distinguish a device/network outage from a real production stoppage.
- Verify the watchdog after backend restart and against duplicate/stale heartbeats.

## Runtime modes

Set these values in `Backend/.env`:

```env
IOT_HEARTBEAT_EXPECTED_INTERVAL_MS=10000
IOT_HEARTBEAT_STALE_AFTER_MS=30000
WATCHDOG_MODE=disabled
WATCHDOG_TICK_INTERVAL_MS=5000
WATCHDOG_EVALUATION_TIMEOUT_MS=4000
```

- `disabled`: heartbeat storage and diagnostics work, but the evaluator cannot create operational transitions.
- `observe`: threshold candidates and connectivity are recorded, but production downtime is not created.
- `enforce`: enabled sensors may create or resolve watchdog-owned downtime through the atomic database function.

Changing a sensor threshold or schedule uses the Admin settings API and an expected version. Changing the global mode is an environment/deployment action and requires a backend restart. There is intentionally no public mode-mutation endpoint.

## Safe activation order

1. Apply migration `011` and deploy with `WATCHDOG_MODE=disabled`.
2. Send authenticated heartbeats and verify ordered boot counter, boot ID, sequence, and connectivity behavior.
3. Apply migration `012` and use `observe` only after heartbeat behavior is stable.
4. Enable absence observation one physically validated sensor at a time. Never enable S-05.
5. Compare observe-mode evidence with the manual log through the parallel run.
6. Request separate approval before using `enforce`.
