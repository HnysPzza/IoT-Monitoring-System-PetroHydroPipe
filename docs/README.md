# PetroHydroPipe Monitoring System Docs

This folder is the project documentation for the React + Node/Express + Supabase IoT monitoring system.

Use this folder for technical project documentation. Use the Obsidian vault for personal study notes and quick review.

## Start Here

| Need | Open |
|---|---|
| Product requirements | [PRD.md](./PRD.md) |
| Technical design | [TDD.md](./TDD.md) |
| 2026-08-09 system audit verdicts | [audit-2026-08-09/README.md](./audit-2026-08-09/README.md) |
| Project status | [SYSTEM_AUDIT_README.md](./SYSTEM_AUDIT_README.md) |
| Frontend UI review | [FRONTEND_UI_AUDIT.MD](./FRONTEND_UI_AUDIT.MD) |
| Full implementation history | [IMPLEMENTATION_HISTORY.md](./IMPLEMENTATION_HISTORY.md) |
| Phase maintenance rule | [PHASES.md](./PHASES.md) |
| Setup instructions | [SETUP.md](./SETUP.md) |
| System architecture | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Deployment and auth planning | [DEPLOYMENT_AUTH_PLANNING.md](./DEPLOYMENT_AUTH_PLANNING.md) |
| Common commands and workflows | [RUNBOOK.md](./RUNBOOK.md) |
| Analytics module comprehensive audit | [superpowers/audits/2026-08-16-analytics-module-comprehensive-audit.md](./superpowers/audits/2026-08-16-analytics-module-comprehensive-audit.md) |
| Phase 30 alert acknowledgement | [phase-30-alert-acknowledgement-realtime-notifications/README.md](./phase-30-alert-acknowledgement-realtime-notifications/README.md) |

## Current System Summary

The system monitors Spiral Mill 01 using 5 ESP32-backed sensors. The frontend is a React/Vite dashboard. The backend is Node/Express. Supabase PostgreSQL stores users, roles, machines, sensors, events, downtime records, production counts, and audit logs.

## What Works Now

- Real backend login with JWT and role checks.
- Admin user management and account archiving.
- Machine and sensor management.
- ESP32 event ingestion and live feed.
- ESP32 simulator for hardware-free testing.
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
