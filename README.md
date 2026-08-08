# IoT-Based Pipe Manufacturing Machine Monitoring System

An IoT-based monitoring system for Petro Hydro Pipe Corp.'s single Spiral Mill machine (`M-01`). It uses five ESP32-backed inductive proximity sensors to track machine activity, downtime, process events, and finished-pipe production output.

The system provides a role-aware web dashboard for live monitoring, alerts, downtime records, production analytics, reports, and audit activity.

## Technology

- Frontend: React and Vite
- Backend: Node.js and Express
- Database: Supabase PostgreSQL
- Hardware: ESP32 sensor nodes and inductive proximity sensors

## Project Documents

- [Product Requirements Document](docs/PRD.md)
- [Technical Design Document](docs/TDD.md)
- [Architecture](docs/ARCHITECTURE.md)

## Scope

This project monitors one machine and five sensors. Speed, pressure, temperature, RPM, voltage sensing, power-outage monitoring, and line-efficiency telemetry are outside the current scope.
