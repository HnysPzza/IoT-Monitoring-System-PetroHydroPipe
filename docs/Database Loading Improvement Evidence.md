# Database Loading Improvement Evidence

Measured September 5, 2026. Scope: threat item 6 verification and the plan's bounded downtime improvement. This is a partial implementation under the plan's explicit stop condition, not completion of database pagination or hosted verification.

## Change and Correctness

`listDowntime` selects the visible page before detailed record calculations. Only that page receives those calculations; full-result summaries still use all matching records. A repeated array membership scan was removed from this path. No API fields, authorization checks or migrations changed.

TDD evidence: the new test first failed with `30 !== 10`; after the change a 10-row page computes 10 details. Regression coverage verifies global summaries across pages, empty/out-of-range pages, tied ordering, overlaps, breaks/grace, effective settings, Manila date boundaries, status/cause filtering, fractional loss, open/zero-length records and missing-history failure.

## Comparable Local Service Runs

The previous service was loaded directly from Git revision `d2b6a56^` without modifying the checkout. Before and after used the same synthetic fixtures, real calculation helpers and mocked database/output-loss boundaries. Three page-1 samples per dataset followed a warm-up. Runs were sequential with the heavy test suite stopped. Earlier samples taken during the full suite were discarded due to resource contention.

| Matching records | Before median ms | After median ms | Detail calculations before/after |
|---:|---:|---:|---:|
| 100 | 39.8 | 28.9 | 100 / 25 |
| 1,000 | 371.6 | 188.3 | 1,000 / 25 |
| 5,000 | 1,713.0 | 877.7 | 5,000 / 25 |
| 10,000 | 3,247.2 | 1,758.2 | 10,000 / 25 |

At 10,000 matches, local service median improved about 45.9%. The after-run range was 1,660.3-1,801.5ms. Page 2 measured 3,228.9ms before and 2,005.4ms after in single samples; do not interpret single-sample changes as stable targets.

There are still 21 sequential downtime fetches at 10,000 matches plus settings/output-loss work. All history is still transferred. SQL execution, network transfer, HTTP/auth overhead and actual 30-day output-loss queries are excluded from these service timings. The proposed 50% end-to-end improvement target is not verified. This result is useful but does not establish production capacity.

Reproduction artifacts: `downtime-before-verified.cjs` and `downtime-after.cjs` under `C:/Users/Karl Joseph Laroa/.codex/visualizations/2026/09/05/01a06fb9-2177-79f2-b579-8d48bd12ee64/`. Pass the application repository root as the first argument to Node. The original baseline and script remain preserved in the Obsidian Sources folder.

## Native PostgreSQL Evidence

The opt-in `Backend/tests/integration/database-recovery.test.js` creates and shuts down an isolated local PostgreSQL cluster using synthetic data. On PostgreSQL 18.1, restoring 10,000 downtime records took 934ms for pg_restore alone; post-restore assertions passed. Roles were bootstrapped separately, and this used the current fresh schema rather than proving every legacy migration path.

Illustrative EXPLAIN (ANALYZE, BUFFERS) execution times on the 10,000-row fixture:

- First 500 rows, ascending start/id: 2.676ms.
- Offset 9,500 then 500 rows: 6.197ms.
- First 25 rows: 1.689ms.

These are simplified base-table queries, not the full joined endpoint. They exclude network and client startup. The plan shows scanning/sorting; no index was added because this small synthetic snapshot does not justify choosing an index for the unfinished final query. Evidence is retained in the temporary directory reported by the test, including query-plans.json and a synthetic dump. No project database was contacted.

## Why Full SQL Pagination Is Deferred

The legacy `get_downtime_summary` filters by start time, uses a fixed 2.3 loss factor and lacks the current summary contract. Reusing it changes results.

Even `watchdog_eligible_seconds` is not an exact substitute for the JS operational-time calculation. With the default morning break and grace, interval 09:59:59.500-10:25:00.500 Manila produces 0 eligible seconds in JS (floor each separate eligible interval) but 1 in SQL (floor the combined duration). This mismatch was reproduced against the current schema in PGlite. Existing malformed-history validation also differs between the implementations.

A correct compact SQL summary therefore needs an explicit parity implementation and its integration tests, not just connecting the old RPC. The approved plan says to stop after the measured incremental gain if a broader calculation implementation is required. That stop condition was taken. Existing SQL functions and rounding behavior remain unchanged.

## Security Verification and Limits

Local base-table/configuration/contract checks passed. Production credential tests cover each missing required value and explicitly supplied synthetic values. Runtime env files are ignored/untracked; Git history for the named runtime env paths was empty. A limited pattern scan of Backend/Frontend Git history found zero matching commits for long JWT/secret-key patterns, and frontend source/build search found no backend secret identifiers. This is not a comprehensive forensic secret scan and does not prove a secret was never exposed.

Actual backup coverage/retention, owner-approved RPO/RTO, real-backup restore, deployment secret injection and hosted negative-access checks remain pending. See RUNBOOK.md. Faster list processing does not close those gates.

## Validation

- Initial backend suite after the production change: 359 passed, 0 failed.
- Expanded focused downtime/operational suite: 35 passed, 0 failed.
- Production environment suite: 12 passed, 0 failed.
- Explicit native recovery test: 1 passed, 0 failed (not skipped).
- Final backend suite: 364 passed, 0 failed. This excludes the separately executed opt-in native recovery test.
- Frontend downtime suite: 9 passed, 0 failed on an isolated retry. The first attempt hit a Vitest worker-start timeout while the backend suite was consuming resources; no tests ran in that attempt. Frontend source and the response contract were unchanged, so no build was required for this patch.
