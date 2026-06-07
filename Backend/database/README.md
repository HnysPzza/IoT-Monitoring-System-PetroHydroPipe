# Database Setup

This folder contains the Phase 2 Supabase/PostgreSQL database foundation for the PetroHydroPipe IoT monitoring system.

## Files

- `schema.sql` creates the first required tables, constraints, indexes, and timestamp triggers.
- `seed.sql` inserts the base roles, one admin account, one machine, and five sensors.

## Tables

- `roles`: system roles used for dashboard access control.
- `users`: account records for admin and authorized personnel.
- `machines`: monitored production machines.
- `sensors`: five ESP32-backed sensor records assigned to a machine.
- `sensor_events`: timestamped events received from sensors.
- `downtime_events`: machine downtime records with start/end timestamps and duration.
- `production_counts`: summarized production counts for dashboard/reporting windows.
- `audit_logs`: user/system activity history for accountability.

## How To Run In Supabase

1. Open your Supabase project.
2. Go to SQL Editor.
3. Copy and run `schema.sql`.
4. Copy and run `seed.sql`.
5. Confirm the seeded rows:
   - 5 roles
   - 1 admin user
   - 1 machine
   - 5 sensors

## Seeded Admin

The seeded admin account is:

```text
username: admin
email: admin@petrohydropipe.local
temporary password: password123
```

The password is stored as a placeholder bcrypt hash for this setup phase. The real auth phase should replace this with a backend seed command or password reset flow.

## Current Scope

This phase only prepares database structure. It does not connect the frontend, implement login, or receive ESP32 data yet.

Next backend phase:

```text
POST /api/auth/login
GET /api/auth/me
GET /api/users
POST /api/users
```
