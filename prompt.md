# Teamwork Production Reusable Prompt Template

> **Usage:** Copy the template below, fill in the `<PLACEHOLDERS>` for your specific task, and paste it directly when launching `/teamwork`.
> The `[skip-interview]` header and explicit parameters force the Sentinel to bypass the interview/clarification phase and immediately route execution to `teamwork_orchestrator`.

---

```markdown
[skip-interview]
DIRECTIVE: Bypass interview and discovery phase. Do not prompt user for clarification, choices, or architectural decisions. All domain specifications, scope allowlists, verification commands, and acceptance criteria are fully specified below. Route immediately to General SWE pipeline via teamwork_orchestrator.

Run 3-reviewer pipeline, output caveman End-of-Step Report.
Task: <TASK_TITLE> (e.g., Task 1: Database Migration 051 & PGLite Tests)
Target Plan: docs/ProductionModule/<PLAN_FILE>.md (e.g., docs/ProductionModule/2026-11-01-pipe-manufacturing-specs-plan.md)

Integrity mode: development

## Verification Resources
- Primary Skill: `.agents/skills/agents-production/SKILL.md`
- Domain PRD: `docs/ProductionModule/PRD-Production.md`
- Redesign Spec: `docs/ProductionModule/ProductionLogsRedesign.md`
- Reference Guides: `.agents/teamwork/reference/` (`frontend-architecture.md`, `production-spec-rules.md`, `testing-patterns.md`)
- Backend Test: `npm --prefix Backend test -- <TEST_PATH>`
- Frontend Test: `npm --prefix Frontend test -- <TEST_PATH>`
- Frontend Build: `npm --prefix Frontend run build`
- Live DevTools Browser Check: Chrome at `127.0.0.1:9222` (for UI tasks)

## Domain Context (Petro Hydro Pipes Corporation)
- Station: S-05 (`Production Output Cutting`), Spiral Mill M-01.
- Each accepted S-05 cut pulse (`event_type = 'pulse'` and `output_accepted = true`) = 1 steel pipe.
- Standard Pipe Specifications: `customer`, `diameter` (OD in mm), `thickness` (mm), `length` (mm), `pipe_number`, `tonnage` (calculated metric tons).
- Formulas:
  - Weight (kg/m) = (OD - Thickness) * Thickness * 0.02466
  - Weight (metric tons) = (Weight (kg/m) * Length (mm)) / 1,000,000
- Legacy `radius` and `circumference`: Nullable/deprecated. Never require in UI or new APIs.

## Scope Allowlist (Strict Module Boundary)
DO NOT TOUCH FILES OUTSIDE THIS ALLOWLIST:
- Backend Core: `Backend/src/modules/production/**`
- Backend Reports: `Backend/src/modules/reports/**` (production category and serializers only)
- Backend Database: `Backend/database/migrations/<next-number>_*.sql` (new migration files only; never edit existing migrations)
- Backend Tests: `Backend/tests/production*.test.js`, `Backend/tests/reports*.test.js`
- Frontend Core: `Frontend/src/features/dashboard/production/**`
- Frontend Reports: `Frontend/src/features/dashboard/reports/**` (production exports only)
- Shared Touchpoints: Minimal surgical additions only to `Backend/src/routes/index.js`, `Frontend/src/app/App.jsx`, and `Frontend/src/shared/constants/dashboardMeta.js`

## Hard Guardrails
1. Git: Never commit, never push, never use force flags. Leave changes unstaged in git working tree.
2. Database Mutations: RPC-only. Mutate `production_item_specs`, `sensor_events`, and `audit_logs` strictly via PostgreSQL RPC functions with row-level locks (`FOR UPDATE`), input constraints, and audit logging.
3. Migration Numbering: Check highest existing number in `Backend/database/migrations/` before creating new migrations. Bump `get_backend_readiness()` incrementally.
4. Single Source of Truth: Import sensor and machine names from `sensorIdentity.js`. Never hardcode sensor names.
5. Reporting Location: Export buttons strictly live in `/dashboard/reports` under Production category. No export buttons in `/dashboard/production`.
6. UI Rules: Sans-serif font (`Inter`/system) with `font-variant-numeric: tabular-nums` for numbers; no rounded-full pills; light `#F8FAFC` table header; `#FFFFFF` cards; 1px borders; suppress number spin buttons (`▲/▼`).
7. Progress Tracking: Update execution plan in `docs/ProductionModule/`, never edit `SKILL.md`.

## Requirements
<INSERT_REQUIREMENTS_HERE>
### R1. <TITLE>
<DETAILS>

### R2. <TITLE>
<DETAILS>

## Acceptance Criteria
- [ ] <CRITERION_1>
- [ ] <CRITERION_2>
- [ ] Backend tests passing (`node --test`)
- [ ] Frontend tests passing (`npm test`) and `npm run build` passing cleanly
- [ ] 3-reviewer verification swarm completed with unanimous APPROVE / CLEAN
- [ ] Independent Victory Audit triggered and VICTORY CONFIRMED
- [ ] Caveman End-of-Step Report outputted
```

---

## Ready-to-Use Example: Pipe Manufacturing Specs Alignment (Plan 2026-11-01)

```markdown
[skip-interview]
DIRECTIVE: Bypass interview and discovery phase. Do not prompt user for clarification, choices, or architectural decisions. All domain specifications, scope allowlists, verification commands, and acceptance criteria are fully specified below. Route immediately to General SWE pipeline via teamwork_orchestrator.

Run 3-reviewer pipeline, output caveman End-of-Step Report.
Task: Implement Task 1 through Task 4 of Spiral-Welded Pipe Specifications Alignment Plan
Target Plan: docs/ProductionModule/2026-11-01-pipe-manufacturing-specs-plan.md

Integrity mode: development

## Verification Resources
- Primary Skill: `.agents/skills/agents-production/SKILL.md`
- Target Plan: `docs/ProductionModule/2026-11-01-pipe-manufacturing-specs-plan.md`
- Domain PRD: `docs/ProductionModule/PRD-Production.md`
- Redesign Spec: `docs/ProductionModule/ProductionLogsRedesign.md`
- Reference Guides: `.agents/teamwork/reference/`
- Backend Migration Test: `node --test Backend/tests/production-specs-v51.migration.pglite.test.js`
- Backend API Test: `node --test Backend/tests/production.api.test.js`
- Frontend Tests: `npm --prefix Frontend test -- src/features/dashboard/production/ProductionSection.test.jsx`
- Frontend Build: `npm --prefix Frontend run build`
- DevTools Browser Check: Chrome at `127.0.0.1:9222`

## Domain Context (Petro Hydro Pipes Corporation)
- Station: S-05 (`Production Output Cutting`), Spiral Mill M-01.
- Each accepted S-05 cut pulse (`event_type = 'pulse'` and `output_accepted = true`) = 1 steel pipe.
- Pipe Specs: `customer` (text, max 100), `diameter` (numeric OD mm), `thickness` (numeric mm), `length` (numeric mm), `pipe_number` (int), `tonnage` (calculated metric tons).
- Formulas:
  - Weight (kg/m) = (OD - Thickness) * Thickness * 0.02466
  - Weight (metric tons) = (Weight (kg/m) * Length (mm)) / 1,000,000
- `radius` and `circumference`: Nullable/deprecated.

## Scope Allowlist
- `Backend/database/migrations/051_align_production_specs_pipe_manufacturing.sql`
- `Backend/tests/production-specs-v51.migration.pglite.test.js`
- `Backend/src/modules/production/**`
- `Backend/tests/production.api.test.js`
- `Backend/src/modules/reports/**` (production category & serializers)
- `Backend/tests/reports.production.test.js`
- `Frontend/src/features/dashboard/production/**`
- `Frontend/src/features/dashboard/reports/**`
- `docs/ProductionModule/2026-11-01-pipe-manufacturing-specs-plan.md`

## Hard Guardrails
1. Git: Never commit or push. Leave all changes unstaged.
2. Database Mutations: RPC-only. Replace `update_production_log_spec` and `batch_update_production_log_specs` to accept `customer`, `diameter`, `thickness`, `length`, `pipe_number`.
3. Readiness Check: Bump `get_backend_readiness()` from 50 to 51.
4. Single Source of Truth: Import sensor labels from `sensorIdentity.js`.
5. Exports: PDF/Excel exports stay in `/dashboard/reports`.
6. UI Rules: Sans-serif font (`Inter`), `tabular-nums`, 1px borders, square badges, `#FFFFFF` cards on `#F8FAFC` background.

## Requirements
Implement tasks defined in `docs/ProductionModule/2026-11-01-pipe-manufacturing-specs-plan.md`:
- Task 1: Migration 051 & PGLite tests (add customer, thickness, length, pipe_number; make radius/circumference nullable; update RPC functions; bump readiness to 51).
- Task 2: Backend Zod validation & repository callers for updated pipe specs.
- Task 3: Backend weight calculation helper ($(\text{OD}-\text{Thickness})\times\text{Thickness}\times 0.02466$) and reports serializer alignment.
- Task 4: Frontend production table, single inline edit, and bulk editor updates to support customer, OD, thickness, length, pipe number, and calculated tonnage.

## Acceptance Criteria
- [ ] Migration 051 applies cleanly and passes `Backend/tests/production-specs-v51.migration.pglite.test.js`.
- [ ] Backend API tests pass with new pipe spec validation.
- [ ] Production Reports PDF & Excel serializers output customer, OD, thickness, length, pipe_number, tonnage.
- [ ] Frontend table renders new pipe spec columns with `tabular-nums` and clean layout.
- [ ] Frontend single inline edit and bulk edit save new fields via updated RPC callers.
- [ ] `npm --prefix Frontend test` and `npm --prefix Frontend run build` pass with 0 errors.
- [ ] All modified files remain unstaged and uncommitted.
- [ ] Victory Audit passes with unanimous APPROVE.
- [ ] Output caveman End-of-Step Report.
```

