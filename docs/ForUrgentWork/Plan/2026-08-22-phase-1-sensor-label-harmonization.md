# Phase 1 Sensor Label Harmonization

Status: Complete

## Purpose

Phase 1 establishes one correct sensor identity map for the database, backend, frontend, reports, alerts, and documentation. It removes the previous S-02/S-04 filler-wire mismatch and defines the approved automatic downtime causes.

## How It Works

1. The shared sensor registry defines the canonical code, label, device identity, and operational purpose for S-01 through S-05.
2. Mirrored backend and frontend registries provide the same labels to every application layer.
3. Migration `008` aligns stored sensor labels without restoring incorrect legacy names.
4. Migration `009` maps S-02 and S-04 automatic filler-wire faults to `Consumable Shortage` while S-03 remains operator-reviewed.
5. Contract and migration tests prevent the code, seed data, schema, and documentation from drifting back to the old mapping.

## Importance

- Operators see the correct physical sensor names everywhere.
- Alerts and downtime causes point to the correct plant location.
- Backend and frontend behavior cannot silently disagree about S-02 and S-04.
- Later threshold, heartbeat, watchdog, and reporting work has a trustworthy sensor foundation.
- Historical reporting remains understandable because future labels and causes are aligned without a destructive rollback.

## Implemented Result

| Sensor | Canonical label |
|---|---|
| S-01 | Raw Material & Coil Joint |
| S-02 | Inside Filler Wire |
| S-03 | Machine Main Sensor |
| S-04 | Outside Filler Wire |
| S-05 | Production Output Cutting |

Backend and frontend use mirrored `sensor-registry.json` files protected by a contract test. Database seed and schema files use the same map.

## Implementation Boundary

Phase 1 standardizes identity and automatic causes. It does not store editable thresholds, evaluate missing activity, or create a watchdog; those responsibilities belong to Phases 2 and 3.

## Migrations

- `008_harmonize_plant_sensor_labels.sql` updates sensor labels and is safe to reapply.
- `009_align_sensor_downtime_causes.sql` assigns Consumable Shortage to S-02 and S-04 faults and is safe to reapply.
- There is no migration 008 rollback. The legacy labels were incorrect and must not be restored.

## Verification

Run:

```powershell
cd Backend
npm.cmd test
npm.cmd run test:integration
npm.cmd run db:verify:downtime

cd ..\Frontend
npm.cmd test
npm.cmd run build
```

The Supabase integration command requires the configured integration-test environment and must only run against the intended project.
