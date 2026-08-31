# Phase 1 Sensor Alignment Status

Phase 1 is implemented. Sensor codes are stable and labels now match the physical plant roles.

## Canonical sensor map

| Sensor | Label | Automatic downtime cause |
|---|---|---|
| S-01 | Raw Material & Coil Joint | Corrective Maintenance |
| S-02 | Inside Filler Wire | Consumable Shortage |
| S-03 | Machine Main Sensor | Pending Cause Review |
| S-04 | Outside Filler Wire | Consumable Shortage |
| S-05 | Production Output Cutting | Manual Cutting |

Only S-03 downtime causes are editable by an operator. The operator must choose one of the eight approved PRD causes.

## Database migrations

- Migration 008 aligns the five sensor labels.
- Migration 009 aligns S-02 and S-04 downtime causes to Consumable Shortage.
- Migration 008 has no rollback migration. Reverting to the known incorrect legacy labels is not supported.

## Before Phase 2

- Confirm the physical ESP32 wiring matches S-01 through S-05.
- Keep backend and frontend sensor registries identical.
- Run backend, frontend, migration and production-build verification.
