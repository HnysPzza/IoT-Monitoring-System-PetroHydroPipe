---
name: ui-orchestrator
description: Orchestrate UI and UX design, implementation, accessibility, responsive styling, component, design-system, and visual-audit work using Superpowers, ui-ux-pro-max, two independent reviewer agents, and human gates for major changes. Use when a request changes frontend visuals or interactions. Do not use for backend-only or documentation-only work unless UI behavior is directly affected.
---

# UI Orchestrator

## Purpose

Supervise UI work from context discovery through verified handoff. Preserve product meaning and functionality while using independent evidence-based reviews.

## Required Skills and Roles

1. Announce use of this skill and why it applies.
2. Apply compatible stage mechanics from the installed Superpowers workflow. Use brainstorming for new design decisions, writing-plans after design approval, systematic-debugging for defects, and verification-before-completion before claiming success. Use subagent-driven-development only under the authorization rules below.
3. Read and apply `ui-ux-pro-max` before forming design recommendations. Require the implementation worker to use it as well.
4. The root agent is the supervisor. Skills provide instructions; the supervisor uses collaboration tools to spawn and manage agents.
5. Spawn Reviewer A and Reviewer B for every UI task. Keep their reviews independent.
6. After plan approval, use a separate implementation worker. Reuse the reviewers for the implementation audit.

If the required skills, collaboration tools, or two independent reviewers are unavailable, pause and ask the human how to proceed. Never silently replace independent review with one self-review.

## Compose with Superpowers

- Treat UI Orchestrator as the owner of UI task classification, Reviewer A/B product acceptance, the three-cycle UI review limit, Human Gates 1 and 2, Git and dependency authorization, and final UI reporting.
- Use Superpowers only for stage mechanics that are compatible with those controls. Superpowers defaults never grant commit authority.
- Before any workflow-required commit, obtain explicit human authorization. If authorization is withheld and the workflow cannot proceed without a commit, pause or select a compatible non-committing method; do not claim that workflow completed.
- Treat Superpowers engineering and task-review loops as distinct from Reviewer A/B UI acceptance loops. They do not substitute for Reviewer A/B, and they may retain their own separate loop limits.
- Use subagent-driven-development only when its local commit behavior has been explicitly authorized. Otherwise dispatch one direct UI implementation worker and use compatible non-committing Superpowers methods such as systematic-debugging and verification-before-completion.
- When subagent-driven-development is authorized, treat its implementer as the single UI worker, require that worker to use `ui-ux-pro-max`, and do not ask that worker to invoke subagent-driven-development again.
- Treat brainstorming design approval and commit authorization as separate decisions. A human-approved design does not authorize the design-document commit required by brainstorming.

## Start Every Task

1. Read active system, repository, and `AGENTS.md` instructions.
2. Inspect the current branch, worktree status, relevant docs, current implementation, shared components, and design tokens.
3. Identify protected behavior, data contracts, permissions, and accessibility semantics.
4. Preserve unrelated changes and stop if they overlap the requested work.
5. Classify the task before editing.

## Resolve Evidence and Design Guidance

Use sources in this exact order:

1. Active system, repository, and `AGENTS.md` instructions.
2. Explicit human requirements and approved decisions.
3. Approved plan or design specification.
4. PRD, TDD, architecture, and current implementation.
5. Existing components and design tokens.
6. `ui-ux-pro-max` recommendations.

If documentation and current code materially conflict, pause and request human direction; do not silently select a source.

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

- Detect the repository's primary or default branch from active repository instructions and Git remote HEAD when available.
- Protect `main`, `master`, `trunk`, the detected primary/default branch, and every repository-configured protected branch.
- Minor UI work may occur on a protected primary branch, including `main`.
- Never begin major UI edits on a protected branch. Create `ui-<task-name>` from the protected branch before major edits.
- On an existing non-protected feature branch, verify status and continue without creating an unnecessary branch.
- Never install or replace a dependency without explicit human approval; treat that work as major.
- Never auto-commit, merge, push, deploy, force-push, delete a branch, or discard user changes.

## Plan and Independent Review

1. Create a scoped plan that lists affected files, protected behavior, risks, verification, and rollback.
2. Spawn two reviewer agents with the same plan and evidence but distinct assignments:
   - Reviewer A: UX, visual consistency, accessibility, responsive behavior, and token reuse.
   - Reviewer B: feasibility, regressions, dependencies, performance, project alignment, branch safety, and scope.
3. Give each reviewer an immutable evidence package identified by base/head commit IDs or snapshot hashes.
4. Instruct each reviewer to remain read-only: do not edit files, run mutating commands, change Git state, message the other reviewer, inspect the other verdict before responding, copy it, or defer to it.
5. Require the verdict format from `references/review-protocol.md`.
6. Continue normally only when both return `PASS`.
7. If either returns `HUMAN DECISION`, pause immediately without waiting for three cycles. Present the conflict and ask the human to revise, explicitly accept the documented risk, or stop. Revision returns the plan to both reviewers; risk acceptance makes major work eligible for Human Gate 1 and minor work eligible for implementation; stop terminates the run.
8. If either returns `REVISE`, correct the plan and resubmit it independently to both.
9. After three unsuccessful cycles, pause and use the escalation template. The human may: require a revision, which returns the plan to both independent reviewers; explicitly accept the documented unresolved risk, which makes major work eligible for Human Gate 1 and minor work eligible for implementation; or stop, which terminates the run.
10. Label every human-accepted unresolved risk in the final report. The supervisor cannot overrule a reviewer, self-approve, or treat silence as approval.

## Human Gate 1 for Major Work

After either two plan `PASS` verdicts or explicit human documented-risk acceptance from an immediate `HUMAN DECISION` or post-limit escalation, present the Gate 1 template. Do not implement until the human explicitly approves. Minor work proceeds without this blocking gate after both plan passes or that explicit human documented-risk acceptance.

## Implement the Approved Plan

1. Spawn a separate implementation worker after the plan reviewers finish.
2. Give the worker the approved plan, protected behavior, reviewer findings, and verification requirements.
3. Require the worker to use `ui-ux-pro-max` and applicable Superpowers execution skills.
4. Prohibit scope expansion, unrelated cleanup, unapproved dependencies, backend changes, and invented data.
5. Require the worker to report files changed, verification executed, limitations, and rollback steps.

## Verify and Re-review

Run proportionate focused tests, relevant full tests, configured lint or static checks, a production build, final diff review, and browser checks for layout, interaction, console errors, failed requests, keyboard behavior, focus, supported themes, and required responsive widths.

Disclose unavailable checks. Never represent an unperformed check as passed.

Send the implementation diff and verification evidence independently to the original two reviewers as immutable evidence identified by base/head commit IDs or snapshot hashes. Reviewers remain read-only and isolated under the same rules used for plan review. Corrections inside the approved scope return to the worker and then verification. Scope-changing corrections return to planning and repeat Gate 1 for major work. Apply the same three-cycle limit.

If either implementation reviewer returns `HUMAN DECISION`, pause immediately without waiting for three cycles. Present the conflict and ask the human to revise, explicitly accept the documented risk, or stop. In-scope revision returns to the worker, reverification, and both reviewers; a scope-changing revision returns to planning; risk acceptance sends major work to Human Gate 2 and minor work to handoff; stop terminates the run.

After three unsuccessful implementation-review cycles, pause and use the escalation template. The human may require an in-scope revision, which returns to the worker, reverification, and both independent reviewers; require a scope-changing revision, which returns to planning; explicitly accept the documented unresolved risk, which sends major work to Human Gate 2 and minor work to handoff; or stop, which terminates the run. Label every accepted unresolved risk in the report. The supervisor cannot self-approve or treat silence as approval.

## Human Gate 2 for Major Work

After either two implementation `PASS` verdicts or explicit human documented-risk acceptance from an immediate `HUMAN DECISION` or post-limit escalation, present the Gate 2 template and label unresolved risks. Do not commit, merge, push, or deploy major work until the human approves. Those actions still require explicit authorization.

For minor work, hand off after either two implementation `PASS` verdicts or explicit human documented-risk acceptance from an immediate `HUMAN DECISION` or post-limit escalation. Label unresolved risks. Git and deployment actions still require an explicit request.

## Reference Routing

- Read `references/dependency-contract.md` at task entry and verify the reviewed dependency paths and hashes. Pause for human review if a dependency is missing or its hash changed; never auto-install or overwrite it.
- Read `references/review-protocol.md` when prompting reviewers or evaluating verdicts.
- Read `references/report-templates.md` when reporting classification, requesting a human gate, escalating disagreement, or handing off completed work.

## Required Run Report

Every orchestration run must report:

1. Task classification and evidence.
2. Current branch and branch action.
3. Proposed scope and protected functionality.
4. Reviewer A plan verdict and findings.
5. Reviewer B plan verdict and findings.
6. Human Gate 1 request, when applicable.
7. Implementation and verification evidence.
8. Reviewer A and Reviewer B implementation verdicts.
9. Remaining issues and rollback guidance.
10. Human Gate 2 request, when applicable.

## Operational Limits

- Prefer a localized correction over a broad redesign when it satisfies the request.
- Do not create additional skills during ordinary UI work.
- Do not copy the full `ui-ux-pro-max` knowledge base into this skill.
