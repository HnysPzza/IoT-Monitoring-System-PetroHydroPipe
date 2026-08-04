---
name: petro-ui-orchestrator
description: Apply the ui-orchestrator workflow to PetroHydroPipe frontend design, styling, components, accessibility, responsiveness, navigation, dashboards, analytics, machine-health, alerts, and visual audits. Use for UI or UX work in the IoT-Based Monitoring System repository. Do not use for backend-only or documentation-only work unless it directly changes UI behavior.
---

# Petro UI Orchestrator

## Compose the Global Workflow

1. Announce that this project profile and `$ui-orchestrator` are being used.
2. Read `references/installation-contract.md` and verify the installed `$ui-orchestrator` package against its release manifest.
3. If the global skill is missing or mismatched, pause for human review and human-authorized manual installation. Never copy the tracked release snapshot into the global skills directory automatically.
4. Read and follow the verified `$ui-orchestrator` as the workflow source of truth. Treat `assets/ui-orchestrator/` only as a distribution snapshot, never as a second active workflow.
5. Read `references/petrohydropipe-constraints.md` before classifying or planning.
6. If `$ui-orchestrator`, `ui-ux-pro-max`, Superpowers, collaboration tools, or two independent reviewers are unavailable, pause and ask the human how to proceed.

Do not duplicate or weaken the global review, gate, branch, or Git rules.

## Inspect Current Project Evidence

Before every UI task, inspect:

- Active instructions and current Git state
- `docs/PRD.md`
- `docs/TDD.md`
- `docs/ARCHITECTURE.md`
- `docs/For Corrections.md`
- Relevant UI audit or approved design documents
- Current frontend implementation, tests, tokens, and API client behavior

Use current files as evidence; historical screenshots and prior audit claims may be stale. Surface material documentation-versus-code conflicts for human direction.

## Protect Project Scope

- Preserve one `M-01 / Spiral Mill 01` machine and five inductive proximity sensors unless explicitly changed by approved requirements.
- Do not introduce speed, pressure, temperature, RPM, bar, Celsius, line efficiency, voltage sensing, or power-outage telemetry.
- Do not guess unresolved sensor identity, downtime ownership, alert lifecycle, or production-target persistence rules.
- Do not present planned backend capabilities as live.
- Document every backend-dependent gap with its missing contract or capability and affected UI state; never merely hide the gap or fake it.
- Keep design-only work frontend-only and preserve API calls, permissions, authentication, data meaning, and business behavior.
- Treat Tailwind, shadcn additions, dependencies, global tokens, navigation, authentication UI, multi-route changes, and responsive rewrites as major.
- Treat the repository's current primary branch as `main` unless repository instructions or Git evidence establish a different primary branch; apply the global protected-branch policy to the detected branch.

## Preserve Current UI Contracts

- Keep the hamburger expand/retract interaction.
- Keep Logout in the sidebar footer/menu.
- Keep the alert trigger as a clean icon button with an accessible label; retain the count badge only when active.
- Keep the navigation label `Analytics` unless a new approved requirement changes it.
- Keep the downtime labels `Last Hour`, `Daily`, `Weekly`, and `Monthly`; keep `Last Hour` unavailable until its backend contract exists.
- Keep domain-specific machine-health cards custom and based on the five sensors.
- Keep shadcn integration scoped; each additional component requires its own approved design and behavior-preservation tests.

## Verify PetroHydroPipe UI Work

Use scripts actually defined in `Frontend/package.json`. On Windows PowerShell, prefer `npm.cmd` when script execution policy blocks `npm`.

In addition to the global verification protocol, verify relevant role permissions, sidebar expanded/collapsed states, desktop/mobile behavior, supported themes, alert behavior, machine and five-sensor rendering, API request values, and browser console/network state.

Never claim merge or push readiness from a narrow focused test alone.
