# Scoped shadcn Component Audit

Date: 2026-08-01

Branch reviewed: `Final-Design`

## Scope

This audit identifies places where selected shadcn-style primitives could improve consistency without replacing the current industrial dashboard design system. It does not authorize any migration beyond the calendar already implemented. Every additional component requires its own scoped design review, behavior tests, and approval.

The current CSS tokens, role-aware navigation, responsive layout, charts, machine model, API calls, and permissions remain the design and behavior source of truth.

## Candidate Matrix

| Priority | Current UI | shadcn candidate | Design value | Behavior risk | Effort | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| Implemented | Native downtime date/month input in `Frontend/src/features/dashboard/overview/DashboardSection.jsx`, now isolated in `TrendCalendarControl.jsx` | Calendar + Popover | Consistent date surface, clearer selected period, theme-aware states | Low; design/interaction surface only. Weekly and monthly request values remain unchanged and are covered by tests | Complete | Use this as the reference pattern for future scoped integrations; do not treat it as approval for a full shadcn conversion |
| High | Custom alert-bell dialog and focus handlers in `Frontend/src/features/dashboard/layout/AdminDashboard.jsx` | Popover | Cleaner bell-only trigger, consistent placement, collision handling, focus return, and Escape behavior | Medium; intended as design-only, but the primitive owns focus and dismissal. Preserve realtime loading and acknowledge behavior exactly | Medium | Good next candidate. Replace only the popover shell; retain the existing alert list, service calls, status rules, and tests |
| High | `window.confirm` archive prompt in `Frontend/src/features/dashboard/users/UsersSection.jsx` | Alert Dialog | Branded destructive-action confirmation with explicit cancel/archive hierarchy | Medium; interaction implementation changes even though archive business behavior must not | Small | Recommended. Add keyboard, cancel, confirm, loading, and focus-return tests before replacing `window.confirm` |
| High | Native selects in `ReportsSection.jsx`, `DowntimeSection.jsx`, `AuditSection.jsx`, `MachinesSection.jsx`, and `UserAccountForm.jsx` | Select | Consistent menus, status styling, focus treatment, and dark/light presentation | Medium; custom select keyboard and portal behavior differ from native controls | Medium to large | Migrate one module at a time. Start with a read-only filter, then verify keyboard, touch, disabled, and form-submission behavior before editing inline table selects |
| High | Browser `title` hints in `AdminDashboard.jsx`, `DashboardSection.jsx`, and `DowntimeSection.jsx` | Tooltip | Consistent labels for collapsed sidebar icons, disabled Last Hour, and constrained actions | Low to medium; design-only if accessible names remain present, but hover-only help must also work by keyboard and touch | Small | Recommended for icon-only and truncated controls. Never use Tooltip as the only accessible label or required instruction |
| High | Custom labels, inputs, validation text, and password control in `Frontend/src/features/auth/LoginPage.jsx` and `Frontend/src/features/dashboard/users/UserAccountForm.jsx` | Field + Input + Label | Shared spacing, invalid states, descriptions, and focus styling | Medium; intended as design-only, but validation IDs, autocomplete, password visibility, and submit behavior are sensitive | Medium | Extract a project-owned form-field wrapper first, then migrate one form while preserving all current validation and authentication behavior |
| Medium | Hand-built segmented buttons in `DashboardSection.jsx`, `ProductionAnalytics.jsx`, and `DowntimeSection.jsx` | Toggle Group | Standard selected, disabled, focus-visible, and arrow-key states | Medium; changes keyboard interaction and selection event handling | Medium | Useful only if the current visual styling is retained through project tokens. Migrate one range control with behavior tests before reusing it |
| Medium | Native tables and repeated wrappers in `UsersTable.jsx`, `DowntimeSection.jsx`, `ReportsSection.jsx`, and `AuditSection.jsx` | Table helpers | Shared headers, row density, responsive wrappers, and empty/loading presentation | Low for markup helpers; design-only if table semantics and responsive `data-label` behavior remain | Medium | Create small project-owned table primitives rather than replacing feature-specific rows and actions |
| Medium | Previous/next paging controls in `DowntimeSection.jsx` and `AuditSection.jsx` | Pagination | Consistent button sizing, disabled states, page labels, and screen-reader navigation | Low; design-only if page state and backend requests remain untouched | Small | Good shared primitive after both existing pagination test suites are used as the contract |
| Medium | Repeated inline notices in `DashboardSection.jsx`, `LiveSection.jsx`, `DowntimeSection.jsx`, `ReportsSection.jsx`, `AuditSection.jsx`, `MachinesSection.jsx`, and `UsersNotice.jsx` | Alert | Consistent status icon, title, spacing, and semantic variants | Low; design-only if `alert` versus `status` roles are preserved | Medium | Consolidate visual markup while keeping each feature's existing live-region role and message lifecycle |
| Medium | Repeated placeholder panels in `DashboardSection.jsx`, `LiveSection.jsx`, and `MachinesSection.jsx` | Empty | Consistent no-data hierarchy and optional recovery action | Low; design-only | Small | Introduce a project-owned Empty composition, keeping feature-specific copy and permissions |
| Medium | Persistent success/error notices in user, machine, report, audit, live, and downtime flows | Sonner | Compact transient confirmation that does not shift page layout | High; this changes feedback timing, persistence, and assistive-technology behavior | Medium | Defer. Use only for supplementary success feedback; keep critical errors and actionable state inline |

## Keep Custom

These areas carry the product's industrial identity or encode domain-specific behavior. Converting them to generic shadcn components would add churn without a clear design benefit.

| Current UI | Source | Decision |
| --- | --- | --- |
| Production and downtime Recharts visualizations | `Frontend/src/features/dashboard/overview/ProductionAnalytics.jsx` and `DowntimeTrendChart.jsx` | Keep custom; preserve chart semantics, colors, tooltips, thresholds, and responsive sizing |
| Five inductive proximity sensor machine-health cards | `Frontend/src/features/dashboard/overview/DashboardSection.jsx` | Keep custom; the fixed five-sensor model and machine status language are domain-specific |
| Production analytics card and KPI strip | `Frontend/src/features/dashboard/overview/ProductionAnalytics.jsx` | Keep custom; its comparison hierarchy and target insight are feature-specific |
| Role-aware sidebar, collapse behavior, logout placement, and mobile drawer | `Frontend/src/features/dashboard/layout/AdminDashboard.jsx` | Keep custom; permissions, navigation state, and responsive behavior are tightly coupled |
| Responsive dashboard grid and industrial theme tokens | `Frontend/src/shared/styles/tokens.css` | Keep custom; this remains the visual foundation for every adopted primitive |

## Recommended Order

1. Alert bell Popover shell.
2. Archive Alert Dialog.
3. Tooltip for collapsed sidebar and icon-only controls.
4. One low-risk filter Select as a pilot.
5. Shared Alert, Empty, Pagination, and Table presentation helpers.

Stop after each item for behavior tests, desktop/mobile inspection, light/dark inspection, and explicit approval. Do not install or migrate another component as part of this audit.
