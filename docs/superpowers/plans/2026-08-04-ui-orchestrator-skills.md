# UI Orchestrator Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a reusable `ui-orchestrator` skill plus a PetroHydroPipe-specific `petro-ui-orchestrator` profile that enforce independent reviews, two human gates for major UI work, and repository-safe execution.

**Architecture:** Keep orchestration policy in the global skill and project facts in the repository profile. The root agent applies Superpowers as supervisor, dispatches two independent reviewers and a separate `ui-ux-pro-max` implementation worker, and requests human approval at the two major-work gates. Markdown references hold detailed review and report formats so both `SKILL.md` entrypoints remain concise.

**Tech Stack:** Codex skills (`SKILL.md`), `agents/openai.yaml`, Markdown references, Python Skill Creator utilities, PowerShell, Git

## Global Constraints

- Global skill path: `C:\Users\Karl Joseph Laroa\.codex\skills\ui-orchestrator\`.
- Project profile path: `.agents/skills/petro-ui-orchestrator/`.
- The global skill is the workflow source of truth; the project profile must not duplicate it.
- Every UI task uses two independent reviewer subagents and a separate implementation worker guided by `ui-ux-pro-max`.
- Normal progression requires both reviewers to return `PASS`.
- Stop after three unsuccessful review-and-revision cycles and ask the human to revise requirements, accept documented risk, or stop.
- Major UI work uses Human Gate 1 before implementation and Human Gate 2 after verified implementation.
- Major UI work is prohibited on `main`; minor UI work may occur on `main`.
- If major work starts on `main`, create `ui-<task-name>` before edits. Reuse an existing non-main feature branch after checking its status.
- Never auto-install dependencies or auto-commit, merge, push, deploy, force-push, or delete branches.
- Preserve unrelated work and stop when it overlaps the requested change.
- PetroHydroPipe remains scoped to one `M-01 / Spiral Mill 01` machine and five inductive proximity sensors.
- Do not invent unsupported telemetry, backend behavior, controls, sensor mappings, or resolved requirements.
- Keep both `SKILL.md` files below 500 lines and include no unused scripts or assets.

## File Map

| File | Responsibility |
|---|---|
| `C:\Users\Karl Joseph Laroa\.codex\skills\ui-orchestrator\SKILL.md` | Trigger definition and complete orchestration workflow |
| `C:\Users\Karl Joseph Laroa\.codex\skills\ui-orchestrator\agents\openai.yaml` | Global skill display metadata and implicit invocation policy |
| `C:\Users\Karl Joseph Laroa\.codex\skills\ui-orchestrator\references\review-protocol.md` | Independent reviewer roles, evidence, verdict, severity, and cycle rules |
| `C:\Users\Karl Joseph Laroa\.codex\skills\ui-orchestrator\references\report-templates.md` | Classification, gate, review, implementation, and escalation formats |
| `.agents/skills/petro-ui-orchestrator/SKILL.md` | Project trigger and composition with `$ui-orchestrator` |
| `.agents/skills/petro-ui-orchestrator/agents/openai.yaml` | Project profile display metadata and implicit invocation policy |
| `.agents/skills/petro-ui-orchestrator/references/petrohydropipe-constraints.md` | Stable project facts, known conflicts, protected behavior, and verification routes |

---

### Task 1: Build the reusable global UI orchestration skill

**Files:**
- Create: `C:\Users\Karl Joseph Laroa\.codex\skills\ui-orchestrator\SKILL.md`
- Create: `C:\Users\Karl Joseph Laroa\.codex\skills\ui-orchestrator\agents\openai.yaml`
- Create: `C:\Users\Karl Joseph Laroa\.codex\skills\ui-orchestrator\references\review-protocol.md`
- Create: `C:\Users\Karl Joseph Laroa\.codex\skills\ui-orchestrator\references\report-templates.md`

**Interfaces:**
- Consumes: installed Superpowers workflows, installed `ui-ux-pro-max`, collaboration-agent tools, repository instructions, current Git state, and task evidence.
- Produces: a classified and reviewed UI plan, two human gates for major work, an independently audited implementation, and structured handoff evidence.

- [ ] **Step 1: Initialize the global package**

Run:

```powershell
python "C:\Users\Karl Joseph Laroa\.codex\skills\.system\skill-creator\scripts\init_skill.py" ui-orchestrator `
  --path "C:\Users\Karl Joseph Laroa\.codex\skills" `
  --resources references `
  --interface 'display_name=UI Orchestrator' `
  --interface 'short_description=Two-gate UI planning and review workflow' `
  --interface 'default_prompt=Use $ui-orchestrator to plan and implement this UI change with independent reviews.'
```

Expected: the initializer creates `SKILL.md`, `agents/openai.yaml`, and `references/` under the global skill directory.

- [ ] **Step 2: Confirm the scaffold is intentionally incomplete**

Run:

```powershell
rg -n "Structuring This Skill" "C:\Users\Karl Joseph Laroa\.codex\skills\ui-orchestrator"
```

Expected: matches in the generated `SKILL.md` prove the scaffold is not yet production-ready.

- [ ] **Step 3: Replace `SKILL.md` with the workflow entrypoint**

Write this exact structure and rules:

```markdown
---
name: ui-orchestrator
description: Orchestrate UI and UX design, implementation, accessibility, responsive styling, component, design-system, and visual-audit work using Superpowers, ui-ux-pro-max, two independent reviewer agents, and human gates for major changes. Use when a request changes frontend visuals or interactions. Do not use for backend-only or documentation-only work unless UI behavior is directly affected.
---

# UI Orchestrator

## Purpose

Supervise UI work from context discovery through verified handoff. Preserve product meaning and functionality while using independent evidence-based reviews.

## Required Skills and Roles

1. Announce use of this skill and why it applies.
2. Apply the stage-appropriate installed Superpowers workflow. Use brainstorming for new design decisions, writing-plans after design approval, subagent-driven-development for approved plans, systematic-debugging for defects, and verification-before-completion before claiming success.
3. Read and apply `ui-ux-pro-max` before forming design recommendations. Require the implementation worker to use it as well.
4. The root agent is the supervisor. Skills provide instructions; the supervisor uses collaboration tools to spawn and manage agents.
5. Spawn Reviewer A and Reviewer B for every UI task. Keep their reviews independent.
6. After plan approval, use a separate implementation worker. Reuse the reviewers for the implementation audit.

If the required skills, collaboration tools, or two independent reviewers are unavailable, pause and ask the human how to proceed. Never silently replace independent review with one self-review.

## Start Every Task

1. Read active system, repository, and `AGENTS.md` instructions.
2. Inspect the current branch, worktree status, relevant docs, current implementation, shared components, and design tokens.
3. Identify protected behavior, data contracts, permissions, and accessibility semantics.
4. Preserve unrelated changes and stop if they overlap the requested work.
5. Classify the task before editing.

## Classify the Change

Classify as major when any condition applies:

- Global styles or design tokens change.
- Navigation, authentication UI, information architecture, or multiple routes change.
- Dashboard data meaning, an API, backend behavior, permissions, or shared contracts may change.
- A dependency, Tailwind, shadcn component, font, or external asset is added or replaced.
- Responsive structure is substantially rewritten.
- The impact is uncertain or difficult to reverse.

Classify as minor only when all conditions apply:

- The change is localized and readily reversible.
- It affects one component or tightly scoped screen area.
- Shared architecture, data meaning, behavior, and dependencies remain unchanged.
- It does not substantially redesign responsive behavior.

When uncertain, classify as major. Use the classification template in `references/report-templates.md`.

## Enforce Branch Safety

- Minor UI work may occur on `main`.
- Never begin major UI edits on `main`.
- On `main`, create `ui-<task-name>` before major edits.
- On an existing non-main feature branch, verify status and continue without creating an unnecessary branch.
- Never install or replace a dependency without explicit human approval; treat that work as major.
- Never auto-commit, merge, push, deploy, force-push, delete a branch, or discard user changes.

## Plan and Independent Review

1. Create a scoped plan that lists affected files, protected behavior, risks, verification, and rollback.
2. Spawn two reviewer agents with the same plan and evidence but distinct assignments:
   - Reviewer A: UX, visual consistency, accessibility, responsive behavior, and token reuse.
   - Reviewer B: feasibility, regressions, dependencies, performance, project alignment, branch safety, and scope.
3. Instruct them not to read, copy, or defer to the other verdict.
4. Require the verdict format from `references/review-protocol.md`.
5. Continue only when both return `PASS`.
6. If either returns `REVISE`, correct the plan and resubmit it independently to both.
7. After three unsuccessful cycles, use the escalation template and ask the human to revise requirements, accept the documented risk, or stop. The supervisor cannot overrule a reviewer or treat silence as approval.

## Human Gate 1 for Major Work

After two plan passes, present the Gate 1 template. Do not implement until the human explicitly approves. Minor work proceeds without this blocking gate after both plan passes.

## Implement the Approved Plan

1. Spawn a separate implementation worker after the plan reviewers finish.
2. Give the worker the approved plan, protected behavior, reviewer findings, and verification requirements.
3. Require the worker to use `ui-ux-pro-max` and applicable Superpowers execution skills.
4. Prohibit scope expansion, unrelated cleanup, unapproved dependencies, backend changes, and invented data.
5. Require the worker to report files changed, verification executed, limitations, and rollback steps.

## Verify and Re-review

Run proportionate focused tests, relevant full tests, configured lint or static checks, a production build, final diff review, and browser checks for layout, interaction, console errors, failed requests, keyboard behavior, focus, supported themes, and required responsive widths.

Disclose unavailable checks. Never represent an unperformed check as passed.

Send the implementation diff and verification evidence independently to the original two reviewers. Corrections inside the approved scope return to the worker and then verification. Scope-changing corrections return to planning and repeat Gate 1 for major work. Apply the same three-cycle limit.

## Human Gate 2 for Major Work

After two implementation passes, present the Gate 2 template. Do not commit, merge, push, or deploy major work until the human approves. Those actions still require explicit authorization.

For minor work, report the result after two implementation passes. Git and deployment actions still require an explicit request.

## Reference Routing

- Read `references/review-protocol.md` when prompting reviewers or evaluating verdicts.
- Read `references/report-templates.md` when reporting classification, requesting a human gate, escalating disagreement, or handing off completed work.
```

- [ ] **Step 4: Add the review protocol**

Create `references/review-protocol.md` with these required sections:

```markdown
# Independent Review Protocol

## Independence

Give both reviewers the same plan or implementation evidence. Do not reveal either verdict to the other before both respond. Reviewers must cite evidence and must not defer to one another.

## Reviewer A

Check visual hierarchy, consistency, component and token reuse, widths 375/768/1024/1440, keyboard navigation, visible focus, 4.5:1 normal-text contrast, approximately 44 by 44 pixel targets, reduced motion, and non-color status cues.

## Reviewer B

Check requirements and PRD/TDD alignment, regressions, API and data contracts, dependencies, bundle and performance impact, branch policy, tests/build/browser evidence, and unrelated drift.

## Finding Format

- Severity: `BLOCKER`, `MAJOR`, `MINOR`, or `SUGGESTION`
- Evidence: file and line, screenshot, command output, console message, or reproduced behavior
- Impact: concrete user, product, accessibility, or engineering consequence
- Required correction: exact bounded change, or `None` for a suggestion

## Verdict Format

- Verdict: `PASS`, `REVISE`, or `HUMAN DECISION`
- Blocking findings: numbered list
- Non-blocking findings: numbered list
- Evidence inspected: numbered list
- Scope drift detected: `Yes` or `No`, with details

`BLOCKER` and `MAJOR` findings require `REVISE`. Fix an in-scope `MINOR` when reasonable; otherwise disclose it. `SUGGESTION` is non-blocking. Normal progress requires two independent `PASS` verdicts.

## Cycle Limit

Count plan review and implementation review separately. After three unsuccessful cycles in a stage, pause for human direction. Only the human may accept documented unresolved risk.
```

- [ ] **Step 5: Add the report templates**

Create `references/report-templates.md` with exact templates for:

```markdown
# Orchestration Report Templates

## Classification

- Classification: `MINOR` or `MAJOR`
- Evidence:
- Current branch:
- Branch action:
- Requested scope:
- Protected behavior and contracts:
- Dependencies affected:

## Reviewer Result

- Reviewer:
- Stage: `PLAN` or `IMPLEMENTATION`
- Cycle:
- Verdict:
- Blocking findings:
- Non-blocking findings:
- Evidence inspected:
- Scope drift:

## Human Gate 1

- Why this is major:
- Proposed files and components:
- Protected behavior and contracts:
- Dependency or migration impact:
- Reviewer A verdict:
- Reviewer B verdict:
- Verification plan:
- Rollback plan:
- Decision requested: approve implementation, request revision, or stop

## Human Gate 2

- Implemented changes:
- Screens and states verified:
- Commands and results:
- Browser console and network findings:
- Reviewer A verdict:
- Reviewer B verdict:
- Remaining risks or deferred issues:
- Rollback instructions:
- Decision requested: approve completion, request revision, or stop

## Three-Cycle Escalation

- Stage:
- Disputed findings:
- Supporting evidence:
- Attempted resolutions:
- Remaining options and tradeoffs:
- Assistant recommendation, labeled as advice:
- Decision requested: revise requirements, accept documented risk, or stop

## Minor Work Handoff

- Classification evidence:
- Changes made:
- Verification evidence:
- Reviewer A verdict:
- Reviewer B verdict:
- Remaining issues:
- Rollback instructions:
- Git or deployment actions taken: `None` unless explicitly requested
```

- [ ] **Step 6: Set exact UI metadata**

Ensure `agents/openai.yaml` contains:

```yaml
interface:
  display_name: "UI Orchestrator"
  short_description: "Two-gate UI planning and review workflow"
  default_prompt: "Use $ui-orchestrator to plan and implement this UI change with independent reviews."

policy:
  allow_implicit_invocation: true
```

- [ ] **Step 7: Validate the global package**

Run:

```powershell
python "C:\Users\Karl Joseph Laroa\.codex\skills\.system\skill-creator\scripts\quick_validate.py" "C:\Users\Karl Joseph Laroa\.codex\skills\ui-orchestrator"
if (Select-String -Path "C:\Users\Karl Joseph Laroa\.codex\skills\ui-orchestrator\SKILL.md" -Pattern "Structuring This Skill") { throw "Generated scaffold remains" }
(Get-Content "C:\Users\Karl Joseph Laroa\.codex\skills\ui-orchestrator\SKILL.md").Count
```

Expected: validator prints `Skill is valid!`; scaffold search returns no matches; line count is below 500. The global package is outside the repository and therefore has no Git commit.

---

### Task 2: Build the PetroHydroPipe project profile

**Files:**
- Create: `.agents/skills/petro-ui-orchestrator/SKILL.md`
- Create: `.agents/skills/petro-ui-orchestrator/agents/openai.yaml`
- Create: `.agents/skills/petro-ui-orchestrator/references/petrohydropipe-constraints.md`

**Interfaces:**
- Consumes: `$ui-orchestrator`, tracked project documentation, current implementation, package scripts, and PetroHydroPipe product decisions.
- Produces: repository-specific UI orchestration that detects documented requirement conflicts and protects current machine, sensor, navigation, alert, analytics, and API behavior.

- [ ] **Step 1: Initialize the project package**

Run:

```powershell
python "C:\Users\Karl Joseph Laroa\.codex\skills\.system\skill-creator\scripts\init_skill.py" petro-ui-orchestrator `
  --path ".agents/skills" `
  --resources references `
  --interface 'display_name=Petro UI Orchestrator' `
  --interface 'short_description=PetroHydroPipe UI safety and review profile' `
  --interface 'default_prompt=Use $petro-ui-orchestrator to plan and implement this PetroHydroPipe UI change safely.'
```

Expected: the initializer creates the project profile package.

- [ ] **Step 2: Confirm the project scaffold is intentionally incomplete**

Run:

```powershell
rg -n "Structuring This Skill" ".agents/skills/petro-ui-orchestrator"
```

Expected: matches in the generated `SKILL.md`.

- [ ] **Step 3: Replace the project entrypoint**

Write:

```markdown
---
name: petro-ui-orchestrator
description: Apply the ui-orchestrator workflow to PetroHydroPipe frontend design, styling, components, accessibility, responsiveness, navigation, dashboards, analytics, machine-health, alerts, and visual audits. Use for UI or UX work in the IoT-Based Monitoring System repository. Do not use for backend-only or documentation-only work unless it directly changes UI behavior.
---

# Petro UI Orchestrator

## Compose the Global Workflow

1. Announce that this project profile and `$ui-orchestrator` are being used.
2. Read and follow `$ui-orchestrator` as the workflow source of truth.
3. Read `references/petrohydropipe-constraints.md` before classifying or planning.
4. If `$ui-orchestrator`, `ui-ux-pro-max`, Superpowers, collaboration tools, or two independent reviewers are unavailable, pause and ask the human how to proceed.

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
- Keep design-only work frontend-only and preserve API calls, permissions, authentication, data meaning, and business behavior.
- Treat Tailwind, shadcn additions, dependencies, global tokens, navigation, authentication UI, multi-route changes, and responsive rewrites as major.

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
```

- [ ] **Step 4: Add project constraints and open decisions**

Create `references/petrohydropipe-constraints.md` containing:

```markdown
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
```

- [ ] **Step 5: Set exact project UI metadata**

Ensure `agents/openai.yaml` contains:

```yaml
interface:
  display_name: "Petro UI Orchestrator"
  short_description: "PetroHydroPipe UI safety and review profile"
  default_prompt: "Use $petro-ui-orchestrator to plan and implement this PetroHydroPipe UI change safely."

policy:
  allow_implicit_invocation: true
```

- [ ] **Step 6: Validate and commit the project profile**

Run:

```powershell
python "C:\Users\Karl Joseph Laroa\.codex\skills\.system\skill-creator\scripts\quick_validate.py" ".agents/skills/petro-ui-orchestrator"
if (Select-String -Path ".agents/skills/petro-ui-orchestrator/SKILL.md" -Pattern "Structuring This Skill") { throw "Generated scaffold remains" }
(Get-Content ".agents/skills/petro-ui-orchestrator/SKILL.md").Count
git diff --check
git status --short
```

Expected: validator prints `Skill is valid!`; scaffold search returns no matches; line count is below 500; Git shows only the project skill package.

Commit:

```powershell
git add -- ".agents/skills/petro-ui-orchestrator"
git commit -m "feat: add Petro UI orchestration profile"
```

---

### Task 3: Validate metadata, guardrails, and scenario behavior

**Files:**
- Verify: `C:\Users\Karl Joseph Laroa\.codex\skills\ui-orchestrator\**`
- Verify: `.agents/skills/petro-ui-orchestrator/**`
- Modify only if a validation or forward-test finding requires correction.

**Interfaces:**
- Consumes: both completed skill packages and the approved design specification.
- Produces: validator output, metadata assertions, five scenario verdicts, clean project diff, and a final requirement-by-requirement audit.

- [ ] **Step 1: Run deterministic package checks**

Run:

```powershell
$validator = "C:\Users\Karl Joseph Laroa\.codex\skills\.system\skill-creator\scripts\quick_validate.py"
$globalSkill = "C:\Users\Karl Joseph Laroa\.codex\skills\ui-orchestrator"
$projectSkill = ".agents\skills\petro-ui-orchestrator"

python $validator $globalSkill
python $validator $projectSkill

@'
from pathlib import Path
import yaml

expected = {
    Path(r"C:\Users\Karl Joseph Laroa\.codex\skills\ui-orchestrator\agents\openai.yaml"): ("UI Orchestrator", "$ui-orchestrator"),
    Path(r".agents\skills\petro-ui-orchestrator\agents\openai.yaml"): ("Petro UI Orchestrator", "$petro-ui-orchestrator"),
}
for path, (display_name, prompt_token) in expected.items():
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert data["interface"]["display_name"] == display_name, path
    assert prompt_token in data["interface"]["default_prompt"], path
    assert data["policy"]["allow_implicit_invocation"] is True, path
print("Metadata valid")
'@ | python -

if ((Get-Content "$globalSkill\SKILL.md").Count -ge 500) { throw "Global SKILL.md is too long" }
if ((Get-Content "$projectSkill\SKILL.md").Count -ge 500) { throw "Project SKILL.md is too long" }

$allSkillFiles = @(
  "$globalSkill\SKILL.md",
  "$globalSkill\references\review-protocol.md",
  "$globalSkill\references\report-templates.md",
  "$projectSkill\SKILL.md",
  "$projectSkill\references\petrohydropipe-constraints.md"
)

if (Select-String -Path $allSkillFiles -Pattern "Structuring This Skill") {
  throw "Scaffold marker remains"
}

$checks = @(
  @{ Path = "$globalSkill\SKILL.md"; Pattern = 'Spawn Reviewer A and Reviewer B for every UI task' },
  @{ Path = "$globalSkill\SKILL.md"; Pattern = 'After three unsuccessful cycles' },
  @{ Path = "$globalSkill\SKILL.md"; Pattern = 'Human Gate 1' },
  @{ Path = "$globalSkill\SKILL.md"; Pattern = 'Human Gate 2' },
  @{ Path = "$globalSkill\SKILL.md"; Pattern = 'Never begin major UI edits on `main`' },
  @{ Path = "$globalSkill\SKILL.md"; Pattern = 'Minor UI work may occur on `main`' },
  @{ Path = "$globalSkill\SKILL.md"; Pattern = 'Never install or replace a dependency without explicit human approval' },
  @{ Path = "$globalSkill\SKILL.md"; Pattern = 'Never auto-commit, merge, push, deploy' },
  @{ Path = "$projectSkill\SKILL.md"; Pattern = 'one `M-01 / Spiral Mill 01` machine and five inductive proximity sensors' },
  @{ Path = "$projectSkill\SKILL.md"; Pattern = 'keep `Last Hour` unavailable until its backend contract exists' },
  @{ Path = "$projectSkill\references\petrohydropipe-constraints.md"; Pattern = 'Do not select a mapping' }
)

foreach ($check in $checks) {
  if (-not (Select-String -LiteralPath $check.Path -SimpleMatch $check.Pattern)) {
    throw "Missing guardrail: $($check.Pattern)"
  }
}
```

- [ ] **Step 2: Forward-test five scenarios with fresh agents**

Give each fresh evaluating agent the approved specification and both skill packages, using this prompt plus one scenario from the table:

```text
Audit the UI Orchestrator skills against the approved design specification for one assigned scenario. Do not edit files. Trace the exact required workflow, branch behavior, reviewers, human gates, prohibited actions, and final output. Return PASS only if the skill text unambiguously produces the assigned expected behavior. Otherwise return REVISE with severity, exact file evidence, and the bounded correction. Do not rely on another reviewer's verdict.

Scenario 1: Brighten one active sidebar label without behavior changes.
Expected 1: Minor; may run on main; two independent reviews; no human gates; no automatic Git action.

Scenario 2: Install Tailwind and rewrite the dashboard while on main.
Expected 2: Major; create a feature branch before edits; two plan passes; Human Gate 1.

Scenario 3: Replace navigation across routes while already on a feature branch.
Expected 3: Major; reuse the feature branch; do not create a branch from it; Human Gate 1.

Scenario 4: One reviewer still rejects after three cycles.
Expected 4: Pause; summarize evidence; human chooses revision, documented-risk acceptance, or stop.

Scenario 5: Reviewer tools or the second reviewer are unavailable.
Expected 5: Pause and request human direction; do not silently self-review.
```

| Scenario | Expected behavior |
|---|---|
| Brighten one active sidebar label without behavior changes | Minor; may run on `main`; two independent reviews; no human gates; no automatic Git action |
| Install Tailwind and rewrite the dashboard while on `main` | Major; create a feature branch before edits; two plan passes; Human Gate 1 |
| Replace navigation across routes while already on a feature branch | Major; reuse the feature branch; do not create a branch from it; Human Gate 1 |
| One reviewer still rejects after three cycles | Pause; summarize evidence; human chooses revision, documented-risk acceptance, or stop |
| Reviewer tools or the second reviewer are unavailable | Pause and request human direction; do not silently self-review |

- [ ] **Step 3: Correct every blocking forward-test finding**

Keep corrections inside the file responsible for the failed rule. Re-run both validators and all affected scenarios after each correction. Do not weaken a guardrail to make a scenario pass.

- [ ] **Step 4: Perform the completion audit**

Check every acceptance criterion in `docs/superpowers/specs/2026-08-04-ui-orchestrator-design.md` against current files and scenario evidence. Inspect Git status and the final diff. Verify that the global package exists, the project package is tracked, no app code changed, and no push or merge occurred.

- [ ] **Step 5: Commit validation-driven project fixes if any**

If Task 3 changed tracked project files, commit only those corrections:

```powershell
git add -- ".agents/skills/petro-ui-orchestrator"
git commit -m "fix: harden Petro UI orchestration guardrails"
```

If no tracked file changed, create no empty commit.
