# PetroHydroPipe Monitoring System Docs

This folder contains the technical documentation for the React + Node/Express + Supabase IoT monitoring system.

## Start Here

| Need | Open |
|---|---|
| Clone and run locally with your own Supabase project | [clone-and-run.md](./clone-and-run.md) |
| Product requirements | [PRD.md](./PRD.md) |
| Technical design | [TDD.md](./TDD.md) |
| System architecture | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Common commands and workflows | [RUNBOOK.md](./RUNBOOK.md) |

## Current System Summary

The system monitors **Spiral Mill 01 (`M-01`)** using five ESP32-backed sensors (`S-01` to `S-05`). The frontend is a React/Vite dashboard, the backend is Node/Express, and Supabase PostgreSQL stores users, roles, machines, sensors, events, downtime records, production specifications, alerts, operational settings, and audit logs (current schema readiness: **v58**).

## What Works Now

- **Authentication & Access Control**: Express login with bcrypt, JWT access tokens, `SameSite=Strict` refresh token rotation, CSRF protection, password setup/reset emails, and 5 consolidated roles (`Admin` displayed as **Managing Director**, `Operation Manager`, `Production Supervisor`, `Engineering Supervisor`, `Quality Control`).
- **IoT Ingestion & Chaos Resilience**: Authenticated ESP32 event and heartbeat ingestion (`POST /api/iot/events`, `POST /api/iot/heartbeats`), 5-second threshold cache, idempotent event UUID retries, `S-05` output validation, and automatic fault/downtime clearing when Absence Detection is disabled.
- **Live Feed, Alerts & Downtime**: SSE realtime stream with bounded connection caps, 10-second fallback polling, revisioned alert lifecycle (`Active` -> `Acknowledged` -> `Resolved`), direct `S-03` and grouped `S-01 + S-02 + S-04` downtime rules, and audited manual recovery override.
- **Production, Analytics & Reports**: Today vs. Yesterday pipe comparison, counterfactual output-loss estimation, inline/bulk pipe specification editing (`Customer`, `Diameter`, `Thickness`, `Length`, `Pipe Number`, `Tonnage`) with `409 Conflict` detection, and PDF/XLSX export.
- **Automated Verification**: `784` backend tests and `650` frontend tests across 67 suites passing (`0 fail`).

## Still Deferred (Cloud Cutover Gate)

- Applying migrations `056`–`058` to the live hosted Supabase project (`select public.get_backend_readiness();` = `58`).
- Flashing production HTTPS (`WiFiClientSecure`) and gitignored device secrets onto physical shop-floor ESP32 boards.
- Custom sibling domains or `/api/*` rewrite proxy on Render so `SameSite=Strict` refresh cookies operate across cloud origins.
- Hosted Supabase backup and restore verification drill on a disposable target.

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
- Never commit plaintext ESP32 production keys.
- Use `VITE_USE_MOCK_LOGIN=false` outside local development.
