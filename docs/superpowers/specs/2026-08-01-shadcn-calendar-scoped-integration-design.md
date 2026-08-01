# Scoped shadcn Calendar Integration Design

Status: Approved on 2026-08-01

## Context

The dashboard currently uses a browser-native `date` or `month` input for the Downtime by Period control. The frontend is a JavaScript React and Vite application styled by custom CSS tokens. It has no Tailwind configuration, shadcn `components.json`, or `@/` import alias.

The calendar appearance should change to the shadcn Calendar pattern without changing chart modes, date values, API requests, backend behavior, or unrelated dashboard styling.

## Goals

- Replace the native calendar presentation with the official shadcn Calendar source pattern.
- Keep the existing compact trigger and industrial dashboard appearance.
- Preserve Today, Weekly, Monthly, and disabled Last Hour behavior.
- Preserve the existing `trendAnchorDate`, `calendarValue`, and downtime API contract.
- Support mouse, keyboard, Escape, outside-click, dark and light themes, and responsive layouts.
- Audit other existing UI elements that could selectively adopt shadcn components.

## Non-goals

- Do not migrate the frontend to Tailwind.
- Do not initialize shadcn globally in the application.
- Do not change backend routes, request parameters, chart calculations, or available periods.
- Do not replace other dashboard components during this implementation.
- Do not redesign the overall dashboard.

## Selected Approach

Use the user-specified `npx shadcn@latest add calendar` command in a disposable staging setup configured for JavaScript. Use the generated output as the source for the project Calendar component. Retrieve the official shadcn Popover source from the same staging registry because the compact date picker requires the documented Popover and Calendar composition.

Bring the source into the application as a namespaced UI island:

- No Tailwind import or Vite Tailwind plugin in the production application.
- No global shadcn theme reset.
- No global utility-class dependency.
- Use relative imports that match the current project structure.
- Translate the generated presentation classes into calendar-specific CSS that consumes the existing dashboard tokens.
- Retain the generated component structure and React DayPicker behavior instead of recreating a visual imitation.
- Keep only dependencies actually required by the copied components and remove unused staging dependencies.

This is preferred over a full shadcn initialization because it prevents preflight, utility, and theme styles from affecting existing screens. It is preferred over a handwritten lookalike because the resulting calendar remains based on the official component source.

## Component Boundaries

### Shared Calendar

A shared `Calendar` component will contain the adapted shadcn Calendar and React DayPicker integration. Its CSS will use a unique calendar namespace and existing variables from `tokens.css`.

Responsibilities:

- Render month navigation, weekday headings, day buttons, outside days, selected state, today state, and disabled future dates.
- Preserve accessible names and keyboard behavior supplied by the underlying calendar primitive.
- Accept standard selected-date and selection callback props.

### Supporting Popover

An adapted shadcn Popover component from the same staging setup will provide the official date-picker composition around the Calendar. It will be scoped to this integration and will not establish a global shadcn component layer.

Responsibilities:

- Position the calendar below the trigger without leaving the viewport.
- Close after selection, on Escape, and on outside-click.
- Restore focus to the trigger after closing.
- Remain usable on narrow mobile layouts.

### Downtime Calendar Control

A feature-local wrapper will connect the shared Calendar to the existing Downtime by Period state.

Responsibilities:

- Display the existing `trendRangeLabel` in the trigger.
- Pass the current `trendAnchorDate` into the Calendar.
- Disable dates after the current local day, matching the existing input `max` value.
- Preserve the current selection semantics described below.

## Preserved Data Flow

The existing state and request flow remains authoritative:

1. The range buttons continue to set `trendMode` and reset `trendAnchorDate` to today.
2. The Calendar reads `trendAnchorDate` as its selected date.
3. In Today and Weekly modes, selecting a date stores that local date at the start of day.
4. In Monthly mode, selecting any date stores the first local day of that selected month.
5. Existing formatters continue to produce `YYYY-MM-DD` for Today and Weekly and `YYYY-MM` for Monthly.
6. `getDashboardDowntimeImpact` continues receiving the same `{ trendMode, date }` object.
7. The existing request-loading, success, empty, and error states remain unchanged.

No new backend request is introduced. Selecting a date causes the same state-driven request that the native input currently causes.

## Visual Design

- Retain the existing 48-pixel compact trigger height.
- Retain the calendar icon and current range label.
- Use the dashboard panel background, subtle border, and 8-pixel radius.
- Use the current primary blue for selected dates.
- Use existing text, muted text, hover, focus, and disabled tokens.
- Keep density appropriate for an industrial monitoring dashboard; avoid oversized cells, decorative gradients, or excessive rounding.
- Render a clear focus indicator and a distinct today indicator that does not compete with the selected state.
- Use the same visual treatment in dark and light themes.

## Accessibility and Interaction Contract

- The trigger remains a semantic button with a mode-specific accessible label.
- The popover is keyboard reachable and closes with Escape.
- Focus returns to the trigger when the popover closes.
- Arrow-key calendar navigation remains available through the calendar primitive.
- Future dates are visibly and programmatically disabled.
- The selected date or month remains understandable from the trigger label after the popover closes.

## Testing and Verification

Add focused tests that prove:

- The trigger opens and closes the calendar.
- Today and Weekly selection return the chosen local date.
- Monthly selection normalizes to the first day of the selected month.
- Future dates cannot be selected.
- The existing request still receives the same trend mode and formatted date.
- Escape closes the popover and restores trigger focus.

Run:

- The focused calendar and dashboard tests.
- The complete Vitest suite.
- The production Vite build.
- `git diff --check`.

Use Chrome to verify:

- Dark and light themes.
- Desktop and mobile widths.
- Today, Weekly, and Monthly selection.
- No clipping, unexpected page movement, console errors, or changed network parameters.

## shadcn Candidate Audit Deliverable

Create a separate audit document after the calendar is verified. Rank candidates by design value, behavior risk, and implementation effort. The audit will consider at least:

- Alert bell popover.
- Confirmation and account dialogs.
- Select and combobox controls.
- Toggle groups and period selectors.
- Form inputs, labels, and validation messages.
- Tables and pagination controls.
- Alerts, empty states, tooltips, and toast notifications.
- Components that should remain custom, including charts, sensor cards, machine-health visualization, and the role-aware dashboard shell.

The audit does not authorize replacing those components.

## Commit Boundaries

Keep changes reviewable and reversible:

1. Design specification.
2. Calendar dependency and component integration with tests.
3. shadcn candidate audit document.
