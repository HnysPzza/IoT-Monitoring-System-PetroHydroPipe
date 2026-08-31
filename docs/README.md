# PetroHydroPipe Monitoring System Docs

This folder is the project documentation for the React + Node/Express + Supabase IoT monitoring system.

Use this folder for technical project documentation. Use the Obsidian vault for personal study notes and quick review.

## Start Here

| Need | Open |
|---|---|
| Product requirements | [PRD.md](./PRD.md) |
| Technical design | [TDD.md](./TDD.md) |
| Current whole-system audit | [ForUrgentFix/Whole System Audit.md](./ForUrgentFix/Whole%20System%20Audit.md) |
| Setup instructions | [SETUP.md](./SETUP.md) |
| System architecture | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Deployment and auth planning | [DEPLOYMENT_AUTH_PLANNING.md](./DEPLOYMENT_AUTH_PLANNING.md) |
| Common commands and workflows | [RUNBOOK.md](./RUNBOOK.md) |
| Phase 1 sensor alignment | [ForUrgentWork/Plan/2026-08-22-phase-1-sensor-label-harmonization.md](./ForUrgentWork/Plan/2026-08-22-phase-1-sensor-label-harmonization.md) |
| Phase 2 settings and backend API | [ForUrgentWork/Plan/2026-08-22-phase-2-settings-storage-and-backend-api.md](./ForUrgentWork/Plan/2026-08-22-phase-2-settings-storage-and-backend-api.md) |
| Phase 3 operational-time watchdog | [ForUrgentFix/Plans/phase 3.md](./ForUrgentFix/Plans/phase%203.md) |
| Phase 4 settings and live monitoring | [ForUrgentFix/Plans/phase 4.md](./ForUrgentFix/Plans/phase%204.md) |

## Current System Summary

The system monitors Spiral Mill 01 using 5 ESP32-backed sensors. The frontend is a React/Vite dashboard. The backend is Node/Express. Supabase PostgreSQL stores users, roles, machines, sensors, events, downtime records, production counts, and audit logs.

## What Works Now

- Real backend login with JWT and role checks.
- Admin user management and account archiving.
- Machine and sensor management.
- ESP32 event ingestion and live feed.
- ESP32 simulator for hardware-free testing.
- Admin operational settings with version conflict protection.
- Watchdog-aware Live Feed with bounded non-overlapping polling.
- Backend-backed dashboard overview, downtime, reports, and audit logs.
- Persistent alert acknowledgement and realtime dashboard notifications.
- Backend and frontend automated test baselines.
- Production hardening: rate limiting, CORS allowlist, JSON body limit, stale-token validation, Supabase security cleanup.

## Still Deferred

- Backend PDF report generation.
- Manual alert resolve/escalation workflow.
- Real ESP32 firmware and physical device testing.
- Dedicated Supabase test project for write integration tests.
- Final production deployment domains.
- Final email provider for custom email verification and password reset.

## Sensor Map

| Sensor | Label |
|---|---|
| S-01 | Raw Material & Coil Joint |
| S-02 | Inside Filler Wire |
| S-03 | Machine Main Sensor |
| S-04 | Outside Filler Wire |
| S-05 | Production Output Cutting |

## Safety Rules

- Never commit `.env` files.
- Never place Supabase service role keys in frontend code.
- Never commit plaintext ESP32 keys.
- Use `VITE_USE_MOCK_LOGIN=false` outside local development.
