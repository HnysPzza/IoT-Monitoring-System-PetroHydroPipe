# Independent Review Protocol

## Independence

Give both reviewers the same immutable plan or implementation evidence identified by base/head commit IDs or snapshot hashes. Do not reveal either verdict to the other before both respond. Reviewers must cite evidence and must not defer to one another.

Reviewer agents are read-only. They must not edit files, run mutating commands, change Git state, message each other, or inspect the other verdict before responding.

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

`HUMAN DECISION` means product authority is required immediately. Pause without waiting for the cycle limit, present the conflict and evidence, and ask the human to revise, explicitly accept documented risk, or stop. Apply the stage transition defined in `SKILL.md` and label every accepted unresolved risk in the run report.

## Cycle Limit

Count plan review and implementation review separately. After three unsuccessful cycles in a stage, pause for human direction. Only the human may accept documented unresolved risk.
