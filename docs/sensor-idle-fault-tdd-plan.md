# Sensor idle/fault implementation and compatibility plan

Date: 2026-09-09. Status: plan and local compatibility review; not a completed rollout.

## Intended rules

- S-01, S-02 and S-04 have independent process states. Missing material below the configured threshold is Idle; sustained absence reaching the threshold is a process Fault.
- A process Fault does not prove the physical sensor is broken. Diagnostic faults must remain distinguishable from missing material.
- One or two unresolved process faults do not create machine downtime. All three unresolved faults create one S-03-owned downtime interval, even if they started at different times.
- S-03 movement absence below its threshold is Idle; confirmed absence reaching its threshold creates direct S-03 downtime.
- Direct and grouped causes may overlap. Close the interval only when the direct cause is clear and the three-process group is no longer complete.
- Idle, a planned break, loss of communications, or S-03 stopping must not clear an existing fault.
- Scheduled breaks and configured grace exclude eligible detection time. Offline is unknown communication state, not proof of physical stoppage.
- No separate material-change exemption is included: an S-03 stop exceeding its eligible threshold can still create downtime. A process timeout alone is only a process fault.

## Audit compared with the plan

| Item | Existing behavior / evidence | Assessment and required action |
| --- | --- | --- |
| 1. Idle presentation | `livePresentation.js` maps fresh watchdog grace to Idle; operational sensor state and monitoring state are separate. | Trace every API/UI consumer before changing persistence. Add cross-module assertions for the same grace snapshot; do not fix only a badge. |
| 2. Presence versus movement | Activity timestamps drive absence detection. | Contract gap: define whether each ESP32 reports material presence or movement. Backend tests cannot prove the physical measurement is suitable. |
| 3. Explicit fault | Grouped ingestion accepts explicit faults independently of the absence timer. | Intentional diagnostic path, not automatically a bug. Never encode ordinary material absence as explicit fault if it must receive a grace period. |
| 4. Recovery | Explicit and watchdog faults have different recovery paths. | Preserve current behavior until tests define which sources require confirmed observations. Do not silently clear timed faults on one generic pulse. |
| 5. Break timing | Watchdog suspends nonincident detection and clears its baseline outside eligible time. | Test restart versus accumulated eligible-time policy explicitly. Preserve already-open incidents. |
| 6. Reconnect timing | Migration 035 can derive a resumed baseline from the previous suspended evaluation; fallback uses old activity/heartbeat timestamps. | Risk requiring deterministic reproduction: offline time must not cause an immediate new absence fault on reconnect. Separate this from break resumption. |
| 7. Machine Running | Migration 035 reconciliation marks a non-downtime machine Running when any sensor is Active. | Confirmed implementation difference from an S-03-motion-based machine status. Add tests where S-05 remains active but S-03 is idle before changing this rule. |
| 8. Atomic concurrency | Grouped decisions live in SQL RPCs. | Test duplicate and stale events locally; use real PostgreSQL concurrent sessions for lock ordering, races and rollback. Sequential PGlite success is not concurrency proof. |
| 9. Menu Back | Test submenu had ten entries while 9 was reserved for Back. | Fixed in this pass: options after 8 use 10 and 11. Regression failed before the fix and runner self-test passes afterward. |

These are a mixture of confirmed differences, contract decisions and unverified risks, not nine proven backend defects.

## Execution order and TDD gates

Complete each numbered gate before moving to the next implementation. For each new invariant: write the failing behavior test, verify the intended failure, make the smallest responsible change, rerun the test and adjacent regressions. Existing passing behavior needs preservation tests, not artificial failures.

### 1. Baseline and timing contract

Status: completed locally on 2026-09-09; Step 2 has not started.

- Record checkout changes, migration chain, readiness version and current configuration without changing hosted data.
- Define threshold comparison as elapsed eligible time greater than or equal to the configured threshold.
- Record interval start at threshold crossing, not at the start of the permitted wait.
- Test immediately before, exactly at and immediately after the threshold, with deterministic timestamps.
- Gate: current grouped/direct lifecycle regressions pass and unresolved policy differences are recorded.

Step 1 results:

- Baseline branch: `Script`, starting commit `0b03e0d`. The checkout already contained extensive unrelated modifications and untracked migrations 032–035. Those changes are excluded from the Step 1 commits; a clean checkout of these commits alone still needs that existing migration work.
- Backend readiness currently requires version 35. Repository default `WATCHDOG_MODE` is `disabled`; this is not proof of the running server's mode or hosted settings. Local tests explicitly use `enforce` and `observe`, a 60-second trigger, a 30-second recovery threshold and fresh communication fixtures. Hosted configuration and deployment were not inspected.
- Timing contract: a direct S-03 absence qualifies at exactly 60 eligible seconds for the test configuration. At 59 seconds it remains in grace; repeated evaluations after qualification must retain one interval. The interval starts at the eligible threshold crossing even if evaluation runs late.
- Confirmed bug: with last activity at 00:00 and first evaluation at 00:02, the grouped watchdog wrapper passed 00:02 to reconciliation despite the 60-second crossing at 00:01. The new regression failed with actual `00:02:00` versus expected `00:01:00`.
- Fix: additive draft migration `036_preserve_direct_watchdog_threshold_time.sql` derives the direct S-03 crossing from the existing baseline and configured threshold before reconciliation. Explicit faults, grouped confirmation and recovery keep their existing timestamps. Applied migrations were not rewritten.
- Tests: the five new timing tests pass, including 59/60/61-second boundaries, duplicate evaluation, delayed evaluation, observe-only behavior, migration reapplication, explicit direct/grouped recovery and RPC execution permissions. The existing grouped-downtime, sensor-audit and watchdog-transition files passed 48 tests against their existing migration fixtures. Those 48 tests do not independently prove migration 036; the five new tests load 036.
- Bug-hunter review checked duplicate intervals, explicit-fault timestamp preservation, group ownership, recovery and permissions. Debugger traced both an initial missing-Admin fixture error and the real timestamp defect. The fixture error was corrected before assessing production behavior.
- Observation decision retained for Step 2: heartbeat proves connectivity; activity must describe the actual sensor measurement. Material presence cannot be inferred from a heartbeat or an absence of movement alone. Payload design and physical verification remain pending.
- Pending later gates: grouped delayed-confirmation timing, break/reconnect policy, cross-module Idle presentation and machine Running authority. Break tests currently require pre-trigger timer reset. Do not infer these are fixed by the direct S-03 correction.
- Migration 036 is a local draft, not a deployment instruction. Step 8 must integrate the readiness contract, full migration test chain and database deployment documentation before release. No hosted migration was run.

Run Step 1 tests from Backend:

```powershell
node --test tests/sensor-timing-baseline.migration.pglite.test.js
```

### 2. Observation contract

Status: completed locally on 2026-09-09; Step 3 has not started.

- Trace ESP32 payload validation through `iot.service.js`, public ingestion RPC, watchdog state and reconciliation.
- Separate heartbeat connectivity, activity/material presence, no-activity observation and explicit diagnostic fault.
- Preserve legacy wire compatibility where needed, but label no-pulse records as observations rather than confirmed downtime.
- Test invalid pairs, authentication failure, duplicate IDs, stale timestamps and retries; none may incorrectly advance activity or recovery.
- Keep S-05 output counting outside process fault and recovery authority.
- Gate: contract tests prove raw event labels do not imply persisted downtime.

Step 2 contract and results:

- Events enter `iot.routes.js`, pass `sensorEventSchema`, authenticate through device middleware, and reach `iot.service.js`. The service calls `ingest_iot_sensor_event` once and publishes committed transition descriptors. Migration 035 dispatches no-pulse observations to `ingest_iot_watchdog_observation`; grouped operational events reach the existing atomic reconciliation path.
- Valid pairs remain `pulse/active`, `idle/idle`, `downtime/no_pulse`, `fault/fault` and `recovered/active`. The legacy wire name `downtime` with `no_pulse` records an observation; it does not itself confirm a downtime interval. All 20 event/signal combinations are checked, including rejection of the 15 invalid combinations.
- Heartbeat arrival establishes communication evidence. `activityObserved: false` does not establish material presence, movement or a fault. `activityObserved: true` means the device actually observed its configured activity; the boolean does not distinguish presence from movement. Hardware must supply that measurement honestly. No new material sensor or payload field is implied by this change.
- Ordinary missing-material observations must use the absence path, rather than explicit `fault/fault`, if they require the configured waiting period. Explicit faults retain the existing immediate fault path. Classification of absence as Idle or timed Fault belongs to Step 3.
- Confirmed defect: event timestamps rejected `2026-09-09T08:00:00+08:00`, while heartbeat validation accepted offsets. The new test failed before the fix. Event validation now accepts explicit timezone offsets and UTC `Z`, retaining rejection of timestamps without a timezone. No timestamp conversion or client clock authority changed.
- Full migration-chain tests through draft 036 exercise all five sensors: no-pulse creates no alerts or downtime; exact retries and stale recovery packets leave watchdog runtime unchanged; conflicting reuse of an event ID is rejected. A heartbeat without activity updates heartbeat evidence without advancing activity or recovery observations.
- Verification: 35 validation, heartbeat API/service, IoT service and historical runtime tests; 2 new full-chain observation tests; 54 API and simulator tests. Total: 91 passed, 0 failed, 0 skipped. Expected injected database errors in negative API tests verify safe responses and are not test failures.
- Bug-hunter review covered invalid pairs, stale/replayed input, event identity conflicts, missing/wrong device credentials, observation publication and S-05 isolation. Debugger isolated the offset mismatch to validation. No additional production defect was reproduced in these checks; this is not physical-device or hosted validation.
- Commits: `3d32af5` fixes validation with regression tests; `55fea66` adds database observation contract tests. Prior unrelated work remains outside these commits.
- No additional migration was needed for Step 2. Draft 036 remains subject to Step 8 release integration. Step 3 requires separate authorization.

Run the Step 2 checks from Backend:

```powershell
node --test tests/iot.validation.test.js tests/heartbeat.api.test.js tests/heartbeat.service.test.js tests/iot.service.test.js tests/watchdog-runtime.migration.pglite.test.js tests/sensor-observation-contract.migration.pglite.test.js tests/api.test.js tests/sensor-event-simulator.test.js
```

### 3. Process absence and fault

Status: completed and verified locally on 2026-09-09. Step 4 has not started.

- Test S-01, S-02 and S-04 individually with fresh communications and configured thresholds.
- Below threshold: Idle, no fault alert and no downtime. At threshold: one process fault alert; still no downtime for one or two faults.
- Repeated observations must not create duplicate alerts or reset the wait indefinitely.
- Test that an existing fault survives Idle, S-03 stopping and unrelated sensor activity.
- Fix classification in the existing atomic authority; do not create a second frontend/backend rule engine.
- Gate: all three process cases and negative downtime assertions pass.

Step 3 behavior:

- With watchdog enforcement, enabled absence detection and fresh communication, S-01/S-02/S-04 persist `Inactive` during watchdog grace; the existing live API maps that state to Idle. At the configured threshold they become `Fault` with source `absence_watchdog` and a Warning process alert.
- Each sensor uses its own configured threshold. One or two unresolved process faults do not create downtime. The existing three-fault S-03 ownership rule is preserved as a regression check; Step 4 machine-authority changes are not included.
- Fresh accepted process activity refreshes the server-received activity timestamp. Duplicate and stale activity cannot refresh it. Ordinary activity returning during grace restores Active; a watchdog-owned fault still requires the existing confirmed recovery flow.
- Communication-only heartbeats cannot restart an established process absence timer. The evaluator retains the existing baseline unless newer activity supersedes it. Existing break/offline suspension behavior is retained for the later Step 5 review.
- Existing Fault states are not downgraded to Idle by grace, idle packets, S-03 stopping or unrelated sensor activity. Observe and disabled modes retain their existing nonmutating operational behavior.
- These classifications describe observed process inactivity. They do not prove a sensor is physically broken or identify a material-change reason. ESP32 measurement meaning remains the Step 2 contract.

Root causes and fixes, using tests before implementation:

1. Grace left process sensors Active. All three boundary tests failed with `Active` instead of `Inactive`. The atomic watchdog wrapper now persists process Idle during grace, preserving existing faults.
2. Ordinary process pulses changed sensor status but did not refresh watchdog activity evidence. A returning-activity test failed. The existing grouped ingestion transaction now updates that evidence after duplicate and stale guards.
3. A healthy watchdog evaluation could leave the newly introduced grace Idle state stuck. A test failed with `Inactive` instead of `Active`. The wrapper restores Active when healthy activity evidence supports it, without bypassing fault recovery.
4. Before any activity had been received, a newer heartbeat restarted the timer. A test failed to produce Fault at the threshold. Process evaluation now uses the established absence baseline or newer actual activity instead of continually restarting from heartbeat time.

Implementation resides in draft migration `037_process_absence_idle.sql`, following 036. It replaces the existing RPC function definitions and adds no second classification service or new dependency. Scoped commits: `cbfdb47` persists process grace Idle; `d2f1c01` fixes activity evidence and timer continuity with regression tests. Applied migrations and unrelated checkout work were not included in these commits.

Final verification: 19 database tests passed against the completed local changes (12 Step 3 process tests, 5 timing tests and 2 observation tests). The preceding broader run also passed 50 IoT service, watchdog service/runner and simulator checks. No failures or skipped tests remain in those completed runs. Bug-hunter review and debugger tracing produced the four findings above; each failing regression was observed before its correction. `git diff --cached --check` passed before the implementation commits.

Validation includes process thresholds, repeated observations, duplicate/stale activity, one-pulse recovery rejection, fault preservation, audit-failure rollback, migration reapplication and RPC access. Step 1 timing and Step 2 observation tests now load migration 037 as well. Browser, hosted database and physical-device verification remain pending; readiness and rollout integration remain Step 8. Do not deploy drafts 036/037 from this completion note.

Run the Step 3 database checks from Backend:

```powershell
node --test --test-concurrency=1 tests/process-absence.migration.pglite.test.js tests/sensor-timing-baseline.migration.pglite.test.js tests/sensor-observation-contract.migration.pglite.test.js
```

### 4. S-03 authority and machine state

Status: completed and verified locally on 2026-09-10. Step 5 has not started.

- Test short and threshold-length S-03 stops independently of process faults.
- Fault S-01, then S-04, then S-02: only the last unresolved fault opens the S-03 interval.
- Test overlapping direct/group causes, first process recovery, continued direct fault, duplicate transitions and stale recovery.
- Test active S-05 cannot turn an idle or down machine into Running or recover S-03.
- Preserve physical S-03 input separately from ownership of grouped downtime.
- Gate: one interval, correct cause metadata and correct machine state throughout; rollback leaves no partial alert or interval.

Step 4 behavior and findings:

- Machine Downtime still means S-03 is faulted or all three process sensors remain faulted. Otherwise machine Running now requires S-03 to be Active; an active S-01, S-02, S-04 or S-05 cannot make an idle S-03 machine Running.
- S-03 watchdog grace persists Inactive, which the existing API presents as Idle. At its configured threshold, direct downtime opens at the threshold crossing. Returning activity refreshes S-03 watchdog evidence; confirmed healthy evidence restores Active. Communication-only heartbeats cannot restart an established absence timer.
- Sequential process faults open one S-03-owned interval when the third fault is confirmed. Group ownership does not turn a healthy physical S-03 input into Fault. Grouped confirmation retains its existing confirmation timestamp; this step does not reconstruct historical physical stop times from delayed process packets.
- Direct and grouped causes can overlap. Both recovery orders preserve the same interval until neither cause remains. Original contributing sensors stay in metadata while current contributors track the remaining cause. Duplicate faults, stale recovery and S-05 output activity cannot resolve the interval.
- A watchdog-owned S-03 fault still needs confirmed recovery observations and the configured recovery duration. One pulse does not clear it. Break/reconnect policy changes remain Step 5.
- Four failing checks established the fixes: other active sensors incorrectly kept the machine Running; S-03 grace did not persist Idle; fresh S-03 pulses did not refresh the activity timer; and communication-only heartbeats could postpone S-03 timeout indefinitely. Debugger tracing located these in the existing reconciliation, ingestion and watchdog functions. Draft migration `038_s03_machine_authority.sql` updates those functions without adding another state authority.
- Scoped implementation commits: `9eaf54f` corrects S-03 machine status and activity handling; `40b8546` preserves its absence baseline and adds authority/regression coverage. Existing whitespace-only edits in migration 037 were preserved and excluded from Step 4 commits. Migrations 036–038 remain local drafts pending readiness/deployment integration in Step 8; no hosted migration was applied.
- Bug-hunter checks cover both overlapping-cause recovery orders, unchanged interval identity, original/current cause metadata, stale and duplicate events, S-05 isolation, audit-failure rollback, migration reapplication and RPC access restrictions. Real PostgreSQL concurrency, hosted state and browser/hardware behavior are not proven by the isolated PGlite tests and remain release verification work.

Final verification: 28 database tests passed (9 Step 4 authority tests and 19 earlier-step regressions), plus 50 IoT service, watchdog service/runner and simulator checks. No failures or skipped tests remained. The failing tests were observed before each production correction. Staged whitespace checks passed before the implementation commits; no push was made.

Run Step 4 and earlier-step database regressions from Backend:

```powershell
node --test --test-concurrency=1 tests/machine-authority.migration.pglite.test.js tests/process-absence.migration.pglite.test.js tests/sensor-timing-baseline.migration.pglite.test.js tests/sensor-observation-contract.migration.pglite.test.js
```

### 5. Breaks, offline and recovery

- Test exact break start/end, grace end, settings boundaries and a break during an existing incident.
- Reproduce long offline periods followed by fresh heartbeats without activity. Start a valid observation window without treating offline time as measured absence.
- Test watchdog recovery with two ordered observations and the full configured eligible recovery duration; duplicates and stale observations cannot count.
- Test explicit recovery independently so a diagnostic recovery does not accidentally bypass an unrelated watchdog cause.
- Gate: no false reconnect incident and no automatic clearing of existing faults merely because monitoring pauses.

### 6. All consumer consistency

- Use identical fixtures across Live Feed, Machines, Overview, notifications, Audit, Downtime, Analytics and Reports.
- Assert Idle, process Fault, active S-03 downtime, recovered downtime and Offline labels separately.
- Process-only faults must not increase downtime totals. Grouped downtime must appear once under S-03.
- Verify SSE transitions, reconnect/refetch and historical records; keep raw event details available without misleading summaries.
- Gate: frontend tests and backend read-model tests agree on the same state; browser proof is recorded separately.

### 7. Deterministic simulation

- Provide simple scenario names: short material pause, material fault, three process faults, short machine stop, machine downtime, planned break, offline/reconnect and recover faults.
- Reuse the existing centralized runner and simulator. Keep 9 reserved for Back and every suite selectable.
- Assert actual API state, alerts and downtime results rather than printing an expected success message.
- Use controlled clocks in isolated tests; live simulations must honor real configured timing, check baseline state and avoid clearing unrelated incidents.
- Document authentication and data impact; never store a bearer token in source or output.
- Gate: simulator contract tests pass, menu self-test passes, and live scenarios are run only against an explicitly selected safe baseline.

### 8. Migration and release verification

- Inspect migration 035 deployment before choosing the next additive migration number. Do not rewrite applied migrations.
- Keep readiness expectations, SQL permissions, contract tests and database documentation aligned.
- Run focused tests after each issue, then full relevant backend/frontend suites and frontend build.
- Validate migration and concurrency in staging PostgreSQL; separately validate browser behavior and physical ESP32 measurements.
- Preserve historical incidents and unrelated faults. Do not use cleanup scripts to hide mismatches.
- Gate: report local, staging, browser and hardware results separately; failed or unrun gates remain explicit.

## Local verification commands

From repository root:

```powershell
node scripts/run-tests.js --self-test
```

From Backend (isolated PGlite and simulator contract tests, not hosted simulation):

```powershell
node --test tests/grouped-downtime.migration.pglite.test.js tests/sensor-audit.migration.pglite.test.js tests/watchdog-transition.migration.pglite.test.js tests/sensor-event-simulator.test.js
```

## This pass

- Saved the plan and mapped audit concerns to implementation gates.
- Fixed the confirmed centralized submenu collision using a failing regression first; self-test passes.
- Ran the four focused test files above: 71 passed, 0 failed, 0 skipped. They cover existing grouped/direct ownership, watchdog recovery, break handling, rollback and simulator contracts; they do not implement or prove every proposed rule.
- Existing break tests explicitly require pre-trigger accumulation to reset during break/post-break grace. Preserve that behavior unless an accumulated-time policy is deliberately approved and tested.
- `git diff --check` passed; Git reported line-ending warnings only.
- Sensor-policy changes, hosted migrations, browser validation and hardware verification are not claimed complete by this document.
