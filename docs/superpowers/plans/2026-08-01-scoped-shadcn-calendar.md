# Scoped shadcn Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Downtime by Period native date/month input with an isolated shadcn Calendar date picker while preserving all existing state, request, and chart behavior.

**Architecture:** Acquire the official JavaScript Calendar and Popover source through the shadcn CLI in a disposable staging directory, then adapt those components into a namespaced UI island backed by React DayPicker and Radix Popover. A feature-local `TrendCalendarControl` translates calendar selections into the existing `trendAnchorDate`; `DashboardSection` retains ownership of range state and API loading.

**Tech Stack:** React 19, Vite 8, JavaScript JSX, React DayPicker, Radix Popover, Lucide React, custom CSS variables, Vitest, Testing Library.

## Global Constraints

- Do not install or configure Tailwind in the production frontend.
- Do not add a production `components.json`, `@/` alias, or global shadcn theme reset.
- Preserve Today, Weekly, Monthly, and disabled Last Hour behavior.
- Preserve `trendAnchorDate`, formatted `calendarValue`, and `getDashboardDowntimeImpact(token, { trendMode, date })`.
- Today and Weekly store the selected local date at the start of day.
- Monthly stores the first local day of the selected month and continues sending `YYYY-MM`.
- Dates after the current local day remain disabled.
- The popover closes on outside-click and Escape and restores focus to its trigger.
- Use existing dashboard tokens for dark, light, hover, focus, selected, and disabled states.
- Do not replace any other audited component during this implementation.
- Keep each implementation or documentation concern in its own commit.

---

## File Map

- Create `Frontend/src/shared/components/ui/Calendar.jsx`: adapted official shadcn Calendar wrapper around React DayPicker.
- Create `Frontend/src/shared/components/ui/Popover.jsx`: adapted shadcn Popover wrapper around Radix Popover.
- Create `Frontend/src/shared/components/ui/calendar.css`: namespaced Calendar, Popover, and trigger presentation using existing tokens.
- Create `Frontend/src/features/dashboard/overview/TrendCalendarControl.jsx`: feature adapter between the shared UI components and existing downtime chart state.
- Create `Frontend/src/features/dashboard/overview/TrendCalendarControl.test.jsx`: focused interaction, normalization, disabled-date, and focus tests.
- Modify `Frontend/src/features/dashboard/overview/DashboardSection.jsx`: replace only the native input block with `TrendCalendarControl`.
- Modify `Frontend/src/features/dashboard/overview/DashboardSection.test.jsx`: prove request parameters remain unchanged after calendar selection.
- Modify `Frontend/src/shared/styles/tokens.css`: retain layout rules and remove selectors that apply only to the deleted native input.
- Modify `Frontend/package.json` and `Frontend/package-lock.json`: add only runtime dependencies required by the scoped Calendar and Popover.
- Create `docs/SHADCN_COMPONENT_AUDIT.md`: ranked audit of additional shadcn candidates and components that should remain custom.

---

### Task 1: Add the scoped shadcn Calendar primitives and feature adapter

**Files:**
- Create: `Frontend/src/shared/components/ui/Calendar.jsx`
- Create: `Frontend/src/shared/components/ui/Popover.jsx`
- Create: `Frontend/src/shared/components/ui/calendar.css`
- Create: `Frontend/src/features/dashboard/overview/TrendCalendarControl.jsx`
- Test: `Frontend/src/features/dashboard/overview/TrendCalendarControl.test.jsx`
- Modify: `Frontend/package.json`
- Modify: `Frontend/package-lock.json`

**Interfaces:**
- `Calendar(props)` consumes React DayPicker single-selection props and passes them to `DayPicker`.
- `Popover`, `PopoverTrigger`, and `PopoverContent` expose the Radix Popover composition used by the feature adapter.
- `TrendCalendarControl({ mode, selectedDate, maxDate, rangeLabel, onDateChange })` calls `onDateChange(Date)` once per accepted selection.
- `mode` is one of `today`, `week`, or `month`.

- [ ] **Step 1: Inspect the official shadcn source without modifying the application**

Run from `Frontend`:

```powershell
npx.cmd shadcn@latest view calendar
npx.cmd shadcn@latest view popover
```

Confirm the Calendar is based on React DayPicker and the Popover follows the official shadcn composition. Then use a disposable staging directory to exercise the requested add command:

```powershell
$calendarStage = Join-Path $env:TEMP "petrohydropipe-shadcn-calendar"
New-Item -ItemType Directory -Force -Path $calendarStage | Out-Null
npx.cmd shadcn@latest init -t vite -b radix -y -c $calendarStage
npx.cmd shadcn@latest add calendar popover -y -c $calendarStage
```

Do not copy the staging Tailwind configuration, theme CSS, alias configuration, or `components.json` into the application.

- [ ] **Step 2: Write the failing feature-adapter tests**

Create `TrendCalendarControl.test.jsx` with fixed local dates and these assertions:

```jsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import TrendCalendarControl from './TrendCalendarControl.jsx'

const selectedDate = new Date(2026, 6, 15)
const maxDate = new Date(2026, 6, 20)

afterEach(() => vi.restoreAllMocks())

describe('TrendCalendarControl', () => {
  it('opens the shadcn calendar and returns a selected local date', async () => {
    const user = userEvent.setup()
    const onDateChange = vi.fn()
    render(<TrendCalendarControl mode="today" selectedDate={selectedDate} maxDate={maxDate} rangeLabel="Jul 15, 2026" onDateChange={onDateChange} />)

    const trigger = screen.getByRole('button', { name: 'Select chart date' })
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: /july 14th, 2026/i }))

    expect(onDateChange).toHaveBeenCalledWith(new Date(2026, 6, 14))
    expect(trigger).toHaveFocus()
  })

  it('normalizes a monthly selection to the first local day of the month', async () => {
    const user = userEvent.setup()
    const onDateChange = vi.fn()
    render(<TrendCalendarControl mode="month" selectedDate={selectedDate} maxDate={maxDate} rangeLabel="July 2026" onDateChange={onDateChange} />)

    await user.click(screen.getByRole('button', { name: 'Select chart month' }))
    await user.click(screen.getByRole('button', { name: /july 8th, 2026/i }))

    expect(onDateChange).toHaveBeenCalledWith(new Date(2026, 6, 1))
  })

  it('disables future dates and returns focus on Escape', async () => {
    const user = userEvent.setup()
    render(<TrendCalendarControl mode="week" selectedDate={selectedDate} maxDate={maxDate} rangeLabel="Jul 13, 2026 - Jul 19, 2026" onDateChange={vi.fn()} />)

    const trigger = screen.getByRole('button', { name: 'Select chart date' })
    await user.click(trigger)
    expect(screen.getByRole('button', { name: /july 21st, 2026/i })).toBeDisabled()
    await user.keyboard('{Escape}')

    expect(trigger).toHaveFocus()
  })

  it('closes when the user clicks outside the calendar', async () => {
    const user = userEvent.setup()
    render(<TrendCalendarControl mode="today" selectedDate={selectedDate} maxDate={maxDate} rangeLabel="Jul 15, 2026" onDateChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Select chart date' }))
    expect(screen.getByRole('grid')).toBeInTheDocument()
    await user.click(document.body)

    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the focused test and verify the missing component failure**

Run:

```powershell
npm.cmd test -- --run src/features/dashboard/overview/TrendCalendarControl.test.jsx
```

Expected: FAIL because `TrendCalendarControl.jsx` does not exist.

- [ ] **Step 4: Install the scoped runtime dependencies**

Run:

```powershell
npm.cmd install react-day-picker@latest @radix-ui/react-popover@latest
```

Confirm `package.json` gains only those two direct runtime dependencies.

- [ ] **Step 5: Implement the adapted shadcn Calendar**

Create `Calendar.jsx` using the current generated shadcn structure: import `DayPicker` and `getDefaultClassNames` from `react-day-picker`, import `ChevronLeft` and `ChevronRight` from `lucide-react`, merge caller class names, and render namespaced semantic class names.

The exported interface must be:

```jsx
export function Calendar({ className = '', classNames = {}, showOutsideDays = true, ...props }) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={`shadcn-calendar ${className}`.trim()}
      classNames={{
        root: `${defaultClassNames.root} shadcn-calendar-root`,
        months: 'shadcn-calendar-months',
        month: 'shadcn-calendar-month',
        month_caption: 'shadcn-calendar-caption',
        caption_label: 'shadcn-calendar-caption-label',
        nav: 'shadcn-calendar-nav',
        button_previous: 'shadcn-calendar-nav-button',
        button_next: 'shadcn-calendar-nav-button',
        month_grid: 'shadcn-calendar-grid',
        weekdays: 'shadcn-calendar-weekdays',
        weekday: 'shadcn-calendar-weekday',
        week: 'shadcn-calendar-week',
        day: 'shadcn-calendar-day',
        day_button: 'shadcn-calendar-day-button',
        selected: 'is-selected',
        today: 'is-today',
        outside: 'is-outside',
        disabled: 'is-disabled',
        hidden: 'is-hidden',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => orientation === 'left' ? <ChevronLeft size={16} /> : <ChevronRight size={16} />,
      }}
      {...props}
    />
  )
}
```

Adjust only property names required by the installed React DayPicker version; keep the namespaced output contract unchanged.

- [ ] **Step 6: Implement the adapted shadcn Popover**

Create `Popover.jsx` with this interface:

```jsx
import * as PopoverPrimitive from '@radix-ui/react-popover'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger

export function PopoverContent({ className = '', align = 'end', sideOffset = 8, ...props }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={12}
        className={`shadcn-calendar-popover ${className}`.trim()}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}
```

- [ ] **Step 7: Implement the feature adapter**

Create `TrendCalendarControl.jsx` with controlled Popover state. The selection handler must be exactly equivalent to:

```jsx
function normalizeSelection(mode, date) {
  if (mode === 'month') {
    return new Date(date.getFullYear(), date.getMonth(), 1)
  }

  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function handleSelect(date) {
  if (!date || date > maxDate) return
  onDateChange(normalizeSelection(mode, date))
  setIsOpen(false)
}
```

Render a `PopoverTrigger` using `asChild`, retain the `CalendarDays` icon and `rangeLabel`, and render:

```jsx
<Calendar
  mode="single"
  selected={selectedDate}
  defaultMonth={selectedDate}
  onSelect={handleSelect}
  disabled={{ after: maxDate }}
  autoFocus
/>
```

The trigger accessible name is `Select chart month` only for `month`; otherwise it is `Select chart date`.

- [ ] **Step 8: Add namespaced component CSS**

Create `calendar.css`, import it from `TrendCalendarControl.jsx`, and define only selectors beginning with `.shadcn-calendar`, `.trend-calendar-trigger`, or `.trend-calendar-control`. Include:

- A 48-pixel trigger with existing panel, border, text, focus, and hover tokens.
- A fixed-density seven-column calendar grid using 36-pixel day cells on desktop and 34-pixel cells at narrow widths.
- Selected, today, outside, disabled, hover, and focus-visible states.
- A portaled popover with `z-index` above the sticky topbar, panel background, subtle border, 8-pixel radius, and dashboard shadow.
- Dark and light compatibility through existing variables only.
- Reduced-motion handling for the popover animation.

- [ ] **Step 9: Run the focused test and make only compatibility corrections**

Run:

```powershell
npm.cmd test -- --run src/features/dashboard/overview/TrendCalendarControl.test.jsx
```

Expected: PASS. If React DayPicker exposes different accessible day labels, update the test queries to match its rendered labels without weakening them to test IDs.

- [ ] **Step 10: Commit the scoped primitives and adapter**

```powershell
git add Frontend/package.json Frontend/package-lock.json Frontend/src/shared/components/ui/Calendar.jsx Frontend/src/shared/components/ui/Popover.jsx Frontend/src/shared/components/ui/calendar.css Frontend/src/features/dashboard/overview/TrendCalendarControl.jsx Frontend/src/features/dashboard/overview/TrendCalendarControl.test.jsx
git commit -m "feat(ui): add scoped shadcn calendar control"
```

---

### Task 2: Replace the native Downtime by Period input without changing requests

**Files:**
- Modify: `Frontend/src/features/dashboard/overview/DashboardSection.jsx`
- Modify: `Frontend/src/features/dashboard/overview/DashboardSection.test.jsx`
- Modify: `Frontend/src/shared/styles/tokens.css`

**Interfaces:**
- Consumes `TrendCalendarControl({ mode, selectedDate, maxDate, rangeLabel, onDateChange })` from Task 1.
- Preserves `setTrendAnchorDate(Date)` and `getDashboardDowntimeImpact(token, { trendMode, date })`.

- [ ] **Step 1: Add a failing request-contract test**

Extend `DashboardSection.test.jsx` with a test that fixes the system date, renders the successful dashboard, switches to Weekly, opens `Select chart date`, selects July 14, and expects:

```jsx
await waitFor(() => {
  expect(getDashboardDowntimeImpact).toHaveBeenLastCalledWith(
    'test-token',
    { trendMode: 'week', date: '2026-07-14' },
  )
})
```

Add a Monthly assertion in the same test after choosing a July date:

```jsx
expect(getDashboardDowntimeImpact).toHaveBeenLastCalledWith(
  'test-token',
  { trendMode: 'month', date: '2026-07' },
)
```

Use `vi.useFakeTimers({ shouldAdvanceTime: true })` and `vi.setSystemTime(new Date(2026, 6, 20, 12))`, restoring real timers after the test.

- [ ] **Step 2: Run the dashboard test and verify the new trigger is missing**

Run:

```powershell
npm.cmd test -- --run src/features/dashboard/overview/DashboardSection.test.jsx
```

Expected: FAIL because the dashboard still renders the native input.

- [ ] **Step 3: Replace only the native input block**

In `DashboardSection.jsx`:

- Import `TrendCalendarControl`.
- Remove `fromDateInputValue` and `fromMonthInputValue` from the `DowntimeTrendChart` import.
- Delete only the current `.trend-calendar-control` JSX containing the icon, label, and native input.
- Insert:

```jsx
<TrendCalendarControl
  mode={trendMode}
  selectedDate={trendAnchorDate}
  maxDate={today}
  rangeLabel={trendRangeLabel}
  onDateChange={setTrendAnchorDate}
/>
```

Do not change `calendarValue`, the loading effect, the range-button handler, or the service call.

- [ ] **Step 4: Remove obsolete native-input CSS only**

From `tokens.css`, remove the rules for:

```css
.trend-calendar-control label
.trend-calendar-control span
.trend-calendar-control input
.trend-calendar-control input:focus
.trend-calendar-control input:focus-visible
```

Remove the narrow-screen input and label width overrides. Keep the existing `.trend-calendar-control { width: 100%; }` responsive layout rule because the new component root uses that class.

- [ ] **Step 5: Run focused integration tests**

Run:

```powershell
npm.cmd test -- --run src/features/dashboard/overview/TrendCalendarControl.test.jsx src/features/dashboard/overview/DashboardSection.test.jsx
```

Expected: PASS.

- [ ] **Step 6: Run the full automated verification**

Run:

```powershell
npm.cmd test -- --run
npm.cmd run build
git diff --check
```

Expected: all tests pass, production build completes, and diff check prints no errors.

- [ ] **Step 7: Verify the rendered behavior in Chrome**

At desktop and mobile widths, verify:

- The compact trigger retains the existing visual hierarchy.
- The popover is not clipped and remains inside the viewport.
- Selected, today, future-disabled, hover, and focus styles are distinct.
- Today, Weekly, and Monthly selections update only the downtime chart request.
- Dark and light themes remain readable.
- Escape closes the popover and restores trigger focus.
- Outside-click closes the popover without changing the selected date.
- The console has no new errors.
- Network requests retain `trendMode` and `date` values in their existing format.

- [ ] **Step 8: Review and commit the dashboard replacement**

Inspect `git diff`, confirm no Tailwind, Vite, backend, or unrelated UI files changed, then commit:

```powershell
git add Frontend/src/features/dashboard/overview/DashboardSection.jsx Frontend/src/features/dashboard/overview/DashboardSection.test.jsx Frontend/src/shared/styles/tokens.css
git commit -m "feat(ui): replace downtime date input with shadcn calendar"
```

---

### Task 3: Document the shadcn component candidate audit

**Files:**
- Create: `docs/SHADCN_COMPONENT_AUDIT.md`

**Interfaces:**
- Produces a read-only recommendation document. It authorizes no additional component migrations.

- [ ] **Step 1: Inspect each current component family**

Use `rg` and browser inspection to collect evidence for the alert bell, dialogs, selects, toggle groups, forms, tables, pagination, alerts, tooltips, empty states, toasts, charts, sensor cards, machine-health UI, and dashboard shell.

- [ ] **Step 2: Write the ranked audit**

Create a table with these exact columns:

```markdown
| Priority | Current UI | shadcn candidate | Design value | Behavior risk | Effort | Recommendation |
```

The report must include these decisions:

- High-value candidates: Alert bell Popover, confirmation Dialog/Alert Dialog, Select, Tooltip, and form Field/Input patterns.
- Medium-value candidates: Toggle Group, Table presentation helpers, Pagination, Alert, Empty, and Sonner.
- Keep custom: Recharts visualizations, five-sensor machine-health cards, production analytics, role-aware sidebar shell, and responsive dashboard layout.
- Calendar is marked implemented as the scoped reference pattern.

For every candidate, name the current source file and state whether adoption is design-only or would require behavior changes.

- [ ] **Step 3: Self-review the audit**

Search for placeholders and verify no recommendation claims a component was implemented when it was only audited:

```powershell
rg -n "T(BD)|T(ODO)|implement\s+later|already\s+migrated" docs/SHADCN_COMPONENT_AUDIT.md
```

Expected: no placeholders or false migration claims.

- [ ] **Step 4: Commit the ignored documentation deliberately**

```powershell
git add -f docs/SHADCN_COMPONENT_AUDIT.md
git diff --cached --check
git commit -m "docs: audit scoped shadcn component candidates"
```

---

### Task 4: Final completion audit

**Files:**
- Verify only; no planned edits.

**Interfaces:**
- Confirms every approved specification requirement has authoritative evidence.

- [ ] **Step 1: Re-run final project checks**

```powershell
npm.cmd test -- --run
npm.cmd run build
git status --short
git log -4 --oneline
```

Expected: all tests pass, build succeeds, worktree is clean, and the design, implementation, and audit commits are visible.

- [ ] **Step 2: Re-check the browser evidence**

Confirm desktop/mobile, dark/light, keyboard, future-date disabling, Monthly normalization, console, and request parameters against the specification.

- [ ] **Step 3: Report the exact deliverables**

Report:

- The Calendar component and dependencies added.
- The unchanged API and state contract.
- Automated and browser verification results.
- The audit document path.
- The focused commit hashes.
