# UI/UX Backend-Dependent Gaps

Date: 2026-07-23
Implementation branch: `Final-Design`

The UI/UX pass does not change backend code or API contracts. The following features remain intentionally unavailable until their data contracts are implemented.

| Feature | Current frontend state | Backend work required |
|---|---|---|
| Admin-managed production target | Target output is displayed as read-only data | Persistent target configuration, Admin-only create/update endpoints, validation, effective dates, and audit logging |
| Last Hour downtime | The range is visible but disabled | Add an hourly range to the dashboard contract, define the rolling time window and chart buckets, and test Manila-time boundaries |
| Plant, shift, and connection context | Not shown | Define authoritative plant and shift configuration plus connection-freshness rules before exposing the deferred header strip |

<details>
<summary>Admin-managed production target</summary>

The backend currently uses fixed daily, weekly, and monthly values in `Backend/src/modules/dashboard/dashboard.service.js`. A frontend-only edit action would not persist reliably and could misrepresent the operating target.

Before enabling an Admin edit or add action:

- Decide whether a target applies by machine, shift, date, day, week, or month.
- Store target values and effective dates in the database.
- Add role-protected read and write endpoints.
- Validate units, ranges, and overlapping effective periods.
- Record changes in the audit log.
- Define how charts handle a target change inside an active reporting period.

</details>

<details>
<summary>Last Hour downtime</summary>

The backend dashboard request currently accepts `today`, `week`, and `month`. The disabled frontend control must remain disabled until the backend supports an hourly window.

Before enabling it:

- Add the hourly range to request validation.
- Define whether it means a rolling 60 minutes or the current clock hour.
- Return stable chart buckets and labels.
- Apply the `Asia/Manila` business-time rules.
- Add service, route, and frontend contract tests.

</details>

<details>
<summary>Deferred plant and shift context</summary>

The proposed plant, location, shift, and live-connection strip is not part of the current data model. Do not populate it with static or invented values.

Before adding it:

- Define where plant identity and location are managed.
- Define shift schedule ownership and rollover behavior.
- Define how connection health and freshness are calculated.
- Decide whether the values are global, machine-specific, or derived.

</details>
