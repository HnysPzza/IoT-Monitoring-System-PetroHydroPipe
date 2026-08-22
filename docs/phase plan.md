# Spiral Mill 01: Phased Implementation Plan

**Document Purpose:** This document provides the step-by-step roadmap for harmonizing physical sensor identities and implementing configurable operational tolerances (refill thresholds, scheduled break windows, and ramp-up grace periods) for Petro Hydro Pipe Corp.'s Spiral Mill 01 monitoring system.

---

## Strategic Implementation Overview

The implementation is divided into four sequential, low-risk phases:

* **Phase 1: Foundation (Label Harmonization)** — Immediate, zero-risk alignment of sensor codes, labels, and purposes across the codebase and documentation to match the plant floor.
* **Phase 2: Settings Storage & Backend API** — Creation of persistent data structures and REST endpoints for configurable thresholds and break windows.
* **Phase 3: Calculation Engine & Ingestion Logic** — Dynamic evaluation of downtime thresholds and planned break deductions in the backend and database RPCs.
* **Phase 4: Frontend Settings UI & Live Visuals** — Building the user interface in the Settings section and reflecting active refill states in the Live Feed.

---

## Phase 1: Foundation — Label Harmonization

### Goal
Align all sensor labels across the codebase and documentation to reflect Petro Hydro's physical plant floor with zero code-breaking risk.

### Action Items
* **Frontend Constants (`Frontend/src/shared/constants/sensorIdentity.js`):**
  * `S-01`: Raw Material & Coil Joint
  * `S-02`: Inside Filler Wire
  * `S-03`: Machine Main Sensor
  * `S-04`: Outside Filler Wire
  * `S-05`: Production Output Cutting
* **Backend Constants (`Backend/src/shared/sensorIdentity.js`):**
  * Mirror the exact labels and purpose strings from the frontend constants.
* **Database Seeds (`Backend/database/seed.sql`):**
  * Update sensor seed names and descriptions for fresh deployments.
* **Documentation (`docs/PRD.md` & `docs/TDD.md`):**
  * Update Table 2 and architecture narratives to eliminate label mismatches.

---

## Phase 2: Settings Storage & Backend API

### Goal
Establish persistent per-machine storage and management APIs for sensor absence thresholds and same-day shift schedules. This phase stores and audits configuration; it does not enforce thresholds or alter downtime calculations.

### Action Items
* **Database Schema Migration:**
  * Create `machine_operational_settings`, keyed by machine UUID, with typed JSONB sections, an optimistic-concurrency version, updater, and timestamp.
  * Seed only the known M-01 configuration. Future machines require explicit settings provisioning after their sensors are defined.
  * Store proposed trigger durations for `S-01` (`600s`), `S-02` (`300s`), `S-03` (`60s`), and `S-04` (`300s`). Keep absence enforcement disabled until signal classification and recovery timing are validated.
  * Keep `S-05` absence detection permanently disabled because it is a discrete output counter.
  * Store the same-day shift window, break ranges (`10:00-10:15`, `12:00-13:00`, `15:00-15:15`), and `10-minute` ramp-up grace.
* **Backend Endpoints:**
  * `GET /api/machines/:machineId/settings` - Returns current machine configuration to authenticated dashboard roles.
  * `PATCH /api/machines/:machineId/settings` - Validates and updates settings for Admin only, using an expected version to prevent lost updates.
* **Audit Logging:**
  * Update settings and record `SETTINGS_UPDATED` with previous/new values in one PostgreSQL transaction.

---

## Phase 3: Calculation Engine & Ingestion Logic

### Goal
Upgrade the backend and database ingestion logic to use dynamic thresholds and exclude planned breaks from production loss calculations.

### Action Items
* **Business Time Module (`Backend/src/shared/businessTime.js`):**
  * Read configured break windows and ramp-up grace periods dynamically.
  * Deduct scheduled rest periods and startup buffers from unplanned downtime loss metrics ($2.3\text{ pcs/min}$).
* **Absence Watchdog & Atomic Transitions:**
  * Add a backend watchdog that evaluates periodic sensor heartbeats against the configured threshold. The existing ingestion RPC cannot detect an event that never arrives.
  * Persist watchdog-created state, downtime, alerts, and audits through an idempotent atomic database function.

---

## Phase 4: Frontend Settings UI & Live Visuals

### Goal
Provide an intuitive interface for supervisors to adjust parameters and visually monitor active refill states.

### Action Items
* **Settings Module (`Frontend/src/features/dashboard/settings/`):**
  * Build the **Sensor Refill Tolerances Card** (numeric inputs and time units for each consumable sensor).
  * Build the **Shift & Break Windows Card** (time pickers for break windows and number input for ramp-up grace minutes).
* **Live Feed Module (`Frontend/src/features/dashboard/live/`):**
  * When a sensor is empty but still within its allowable threshold, display machine and sensor status cleanly as **`Idle (Refill in progress)`** without triggering equipment alarms.

---

## Phase 5: Verification & Regression Testing

### Action Items
* **Vitest Frontend Tests:** Run `AdminDashboard.test.jsx`, `DashboardSection.test.jsx`, and `SettingsSection.test.jsx`.
* **Backend Unit Tests:** Run test suites for `businessTime.test.js`, `settings.service.test.js`, and `iot.service.test.js`.
* **Browser Verification:** Verify in Chrome that live feeds, machines list, and analytics display consistent sensor names and status badges.
