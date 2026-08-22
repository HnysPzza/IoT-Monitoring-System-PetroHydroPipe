# Phase 1 Sensor Label Harmonization

Status: Complete

## Result

| Sensor | Canonical label |
|---|---|
| S-01 | Raw Material & Coil Joint |
| S-02 | Inside Filler Wire |
| S-03 | Machine Main Sensor |
| S-04 | Outside Filler Wire |
| S-05 | Production Output Cutting |

Backend and frontend use mirrored `sensor-registry.json` files protected by a contract test. Database seed and schema files use the same map.

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
