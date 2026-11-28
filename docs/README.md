# PetroHydroPipe Monitoring System Docs

This folder contains the technical documentation for the React + Node/Express + Supabase IoT monitoring system.

## Start Here

| Need | Open |
|---|---|
| Product requirements | [PRD.md](./PRD.md) |
| System architecture | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Common commands and workflows | [RUNBOOK.md](./RUNBOOK.md) |

## Current System Summary

The system monitors **Spiral Mill 01 (`M-01`)** using five ESP32-backed sensors (`S-01` to `S-05`). The frontend is a React/Vite dashboard, the backend is Node/Express, and Supabase PostgreSQL stores users, roles, machines, sensors, events, downtime records, production specifications, alerts, operational settings, and audit logs (current schema readiness: **v64**).

## What Works Now

- **Authentication & Access Control**: Express login with bcrypt, JWT access tokens, `SameSite=Strict` refresh token rotation, CSRF protection, password setup/reset emails, and 5 consolidated roles (`Admin` displayed as **Managing Director**, `Operation Manager`, `Production Supervisor`, `Engineering Supervisor`, `Quality Control`).
- **IoT Ingestion & Chaos Resilience**: Authenticated ESP32 event and heartbeat ingestion (`POST /api/iot/events`, `POST /api/iot/heartbeats`), Plant NAT per-device failure isolation, 5-second threshold cache, idempotent event UUID retries, `S-05` WAN-outage/recovery output validation (`v63`), and automatic fault/downtime clearing when Absence Detection is disabled.
- **Live Feed, Alerts & Downtime**: SSE realtime stream with bounded connection caps, 10-second fallback polling, revisioned alert lifecycle (`Active` -> `Acknowledged` -> `Resolved`), direct `S-03` and grouped `S-01 + S-02 + S-04` downtime rules, 366-day downtime query range caps, and audited manual recovery override.
- **Production, Analytics & Reports**: Today vs. Yesterday pipe comparison, counterfactual output-loss estimation, chunked (`100`-UUID) production spec lookups, inline/bulk pipe specification editing (`Customer`, `Diameter`, `Thickness`, `Length`, `Pipe Number`, `Tonnage`) with `409 Conflict` detection, and concurrency-bounded PDF/XLSX export (`10k` PDF / `25k` XLSX rows).
- **Automated Verification**: Backend contracts/system/module (`612` tests), PGlite migration suites, and Frontend Vitest (`807` tests) passing (`0 fail`).

## Still Deferred (Cloud Cutover Gate)

- Applying migrations `059`–`064` to the live hosted Supabase project (`select public.get_backend_readiness();` = `64`).
- Setting production `CORS_ORIGIN` and `ACCOUNT_SETUP_ORIGIN` on Render for the single Node web service in `render.yaml` (which builds and serves `Frontend/dist` directly from Express).
- Flashing production HTTPS (`WiFiClientSecure`) and rotated gitignored device secrets onto physical shop-floor ESP32 boards.
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
