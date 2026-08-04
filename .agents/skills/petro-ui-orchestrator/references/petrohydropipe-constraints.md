# PetroHydroPipe UI Constraints

## Stable Scope

- Product: IoT-Based Pipe Manufacturing Machine Monitoring System
- Machine: one `M-01 / Spiral Mill 01`
- Hardware: five ESP32-backed inductive proximity sensors
- Frontend: React and Vite
- Backend: Node.js and Express
- Database: Supabase PostgreSQL

## Unsupported Concepts

Do not add speed, pressure, temperature, RPM, bar, Celsius, line efficiency, voltage sensing, or power-outage monitoring. Do not invent plant, shift, connection, or sensor data for a static context strip.

## Mandatory Conflict Checks

`docs/PRD.md` and `docs/TDD.md` assign downtime to Sensor 3, while `docs/For Corrections.md` records a different current sensor identity and multi-sensor downtime behavior. Do not select a mapping or rewrite UI meaning until the human resolves it.

The alert lifecycle, manual downtime resolution, downtime-cause ownership, production-loss formula, general machine registration, production-target persistence, and sensor threshold model also contain open decisions. Preserve current behavior during design-only work and report the conflict when a requested design depends on it.

## Current and Planned UI Behavior

- Sidebar hamburger expansion and retraction exist and must remain functional.
- Logout remains in the sidebar footer/menu in expanded and collapsed states.
- The active sidebar label needs sufficient contrast, not only an active background.
- The alert trigger remains icon-only with an accessible label and an active count badge when needed.
- Navigation uses `Analytics`, not `Analyze`.
- Overview downtime options are `Last Hour`, `Daily`, `Weekly`, and `Monthly`.
- The UI label is `Daily`; the current API value remains `today`.
- `Last Hour` stays disabled until backend aggregation is implemented and tested.
- Target production output is currently fixed; Admin add/edit behavior is planned and requires persistent configuration plus a role-protected API.
- Machine health uses exactly five sensor cards and no unsupported telemetry.
- Domain-specific sidebar, charts, machine-health cards, and production analytics remain project-owned rather than generic shadcn replacements.

## Project Evidence Order

Apply the global source priority. Use `docs/For Corrections.md` to identify known drift rather than treating either documentation or current code as silently authoritative. Inspect relevant current code and tests before every recommendation.

## Required Browser Coverage

- Widths: 375, 768, 1024, and 1440 pixels
- Expanded and collapsed sidebar
- Mobile navigation drawer
- Keyboard focus and icon accessible names
- Supported light and dark themes
- Console errors and failed network requests
- Relevant Admin and non-Admin permissions
