# Database Setup

This folder contains the Phase 2 Supabase/PostgreSQL database foundation for the PetroHydroPipe IoT monitoring system.

## Files

- `schema.sql` creates the first required tables, constraints, indexes, and timestamp triggers.
- `seed.sql` inserts the base roles, one admin account, one machine, and five sensors.
- `device_key_setup.sql` updates the five sensors with bcrypt hashes for ESP32 device authentication.
- `migrations/001_add_sensor_device_keys.sql` adds `sensors.device_key_hash` to an existing Phase 2 database.
- `migrations/002_update_sensor_identity_labels.sql` aligns existing sensor labels with the Phase 9 identity map.
- `migrations/003_add_user_archiving.sql` adds archive fields so user accounts are hidden without deleting history.
- `migrations/004_supabase_security_cleanup.sql` fixes Supabase advisor warnings for function permissions/search path and adds a downtime sensor index.
- `migrations/005_create_alerts.sql` adds persistent alert acknowledgement records for realtime dashboard notifications.

## Tables

- `roles`: system roles used for dashboard access control.
- `users`: account records for admin and authorized personnel.
- `machines`: monitored production machines.
- `sensors`: five ESP32-backed sensor records assigned to a machine, including backend-only device key hashes.
- `sensor_events`: timestamped events received from sensors.
- `downtime_events`: machine downtime records with start/end timestamps and duration.
- `production_counts`: summarized production counts for dashboard/reporting windows.
- `audit_logs`: user/system activity history for accountability.
- `alerts`: active, acknowledged, and resolved operational alerts.

## How To Run In Supabase

1. Open your Supabase project.
2. Go to SQL Editor.
3. Copy and run `schema.sql`.
4. Copy and run `seed.sql`.
5. For existing databases, run migration files in order from `Backend/database/migrations/`.
6. Generate one secret per ESP32, bcrypt-hash each secret locally, replace the placeholders in `device_key_setup.sql`, then run it.
7. Confirm the seeded rows:
   - 5 roles
   - 1 admin user
   - 1 machine
   - 5 sensors

## ESP32 Device Keys

For an existing Supabase database created before Phase 6, run `migrations/001_add_sensor_device_keys.sql` before running `device_key_setup.sql`.

Each ESP32 request uses:

```text
x-device-id: esp32-m01-s01
x-device-key: your-device-secret
```

Only the bcrypt hash of each device secret belongs in Supabase. Generate hashes locally with:

```bash
node -e "const bcrypt=require('bcryptjs'); bcrypt.hash(process.argv[1], 10).then(console.log)" "your-device-secret"
```

Paste the generated hashes into `device_key_setup.sql`. Do not commit real plaintext device secrets.

## ESP32 Simulator Before Hardware

Use the backend simulator while the physical ESP32 devices are not built yet.

1. Generate local simulator keys:

   ```bash
   cd Backend
   npm run iot:keys
   ```

2. Copy the printed `IOT_SIM_S01_KEY` to `IOT_SIM_S05_KEY` values into local `Backend/.env`.
3. Copy the printed SQL update statement into Supabase SQL Editor and run it.
4. Start the backend:

   ```bash
   npm run dev
   ```

5. Send one randomized batch of 5 ESP32 events:

   ```bash
   npm run iot:simulate:once
   ```

6. Or keep sending randomized events on an interval:

   ```bash
   npm run iot:simulate
   ```

7. For repeatable debugging, run deterministic mode:

   ```bash
   npm run iot:simulate:once -- --deterministic
   ```

The simulator uses the real ingestion endpoint:

```text
POST /api/iot/events
```

It keeps event history in `sensor_events`, updates `sensors.status`, updates `machines.status`, and randomly chooses one sensor per batch to send a downtime/fault event. Non-issue sensors send active/recovery events often enough to clear old simulator alerts. Refresh `/dashboard/live` to see the latest backend data.

Local simulator environment values:

```env
IOT_SIM_BASE_URL=http://localhost:3000
IOT_SIM_INTERVAL_MS=5000
IOT_SIM_S01_KEY=
IOT_SIM_S02_KEY=
IOT_SIM_S03_KEY=
IOT_SIM_S04_KEY=
IOT_SIM_S05_KEY=
```

Common simulator issues:

- `Missing simulator keys`: add the `IOT_SIM_S##_KEY` values to local `Backend/.env`.
- `401 DEVICE_UNAUTHORIZED`: run the generated SQL hashes in Supabase, or confirm each key matches its ESP32 device ID.
- Backend connection error: confirm `npm run dev` is running and `IOT_SIM_BASE_URL` points to the backend port.
- No Live Feed changes: confirm the simulator received `201` responses and refresh `/dashboard/live`.

## Seeded Admin

The seeded admin account is:

```text
username: admin
email: admin@petrohydropipe.local
temporary password: password123
```

The password is stored as a placeholder bcrypt hash for this setup phase. The real auth phase should replace this with a backend seed command or password reset flow.

## Current Scope

This database foundation now supports real auth, admin users, machine setup, and ESP32 event ingestion.

Current IoT backend endpoints:

```text
POST /api/iot/events
GET /api/iot/live
```
