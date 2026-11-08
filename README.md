# IoT-Based Pipe Manufacturing Machine Monitoring System

Real-time industrial IoT monitoring system for **Petro Hydro Pipe Corp.'s** Spiral Mill machine (`M-01`). It uses five ESP32-backed inductive proximity sensors to track material presence, main spindle activity, machine downtime, alerts, and finished-pipe production output.

## System Overview

```text
ESP32 Sensors (S-01 to S-05) -> Express Backend -> Supabase PostgreSQL -> Express APIs / SSE -> React Dashboard
```

- **Monitored Machine**: `M-01` — `Spiral Mill 01`
- **Five Assigned Sensors**:
  - `S-01` — Raw Material & Coil Joint (process material presence)
  - `S-02` — Inside Filler Wire (process consumable presence)
  - `S-03` — Machine Main Sensor (spindle rotation & machine-running authority)
  - `S-04` — Outside Filler Wire (process consumable presence)
  - `S-05` — Production Output Cutting (finished pipe counter)

## Key Capabilities

- **Live Monitoring & Watchdog**: Real-time machine and sensor status with 10-second ESP32 heartbeats, server-owned Manila shift/break schedules, and configurable absence thresholds.
- **Downtime & Alert Management**: Direct `S-03` downtime, grouped `S-01 + S-02 + S-04` process-fault escalation, revision-ordered alert acknowledgements, and Server-Sent Events (SSE) with automatic REST polling fallback.
- **Production Specifications & Reports**: Finished pipe tracking (`S-05`) with inline and bulk specification editing (`Customer`, `Diameter`, `Thickness`, `Length`, `Pipe Number`, `Tonnage`), optimistic concurrency (`409 Conflict`), and PDF/XLSX report exports.
- **Security & Audit Integrity**: Custom Express JWT + `HttpOnly; SameSite=Strict` refresh session rotation, CSRF protection, five role-based access levels (`Admin` displayed as **Managing Director**, `Operation Manager`, `Production Supervisor`, `Engineering Supervisor`, `Quality Control`), and atomic PostgreSQL RPC mutations with `audit_logs` (schema readiness **v58**).

## Technology Stack

- **Frontend**: React 19 and Vite 8 (`Frontend/`)
- **Backend**: Node.js and Express 5 (`Backend/`)
- **Database**: Supabase PostgreSQL (`Backend/database/`, migrations through `058`)
- **Hardware**: ESP32 sensor nodes with hardware-interrupt pulse capture and idempotent network retries

## Quick Start

```bash
# 1. Start Backend (http://localhost:3000)
cd Backend
npm run dev

# 2. Start Frontend (http://localhost:5173)
cd Frontend
npm run dev

# 3. Run Full Verification Suite (784 Backend + 650 Frontend tests)
node scripts/run-tests.js --suite all
```

## Project Documentation

- [Documentation Index](docs/README.md)
- [Clone and Run Guide](docs/clone-and-run.md)
- [System Architecture](docs/ARCHITECTURE.md)
- [Operations Runbook](docs/RUNBOOK.md)
- [Database Setup & Migrations](Backend/database/README.md)
- [Product Requirements Document](docs/PRD.md)
- [Technical Design Document](docs/TDD.md)

## Scope

This project monitors one Spiral Mill machine (`M-01`) and five inductive proximity sensors (`S-01` to `S-05`). Analog speed, pressure, temperature, RPM, voltage sensing, and line-efficiency telemetry are outside the project scope.
