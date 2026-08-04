# KPI Card Surface Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the colored left-edge decoration from every KPI card and replace it with a restrained layered surface that preserves hierarchy in dark and light themes.

**Architecture:** Keep the change inside the existing shared card CSS. A rendered computed-style assertion will establish the current edge treatment as the failing baseline and then verify its removal; browser inspection remains the authority for visual quality, theme behavior, and responsive layout.

**Tech Stack:** React 19, Vite, Vitest, CSS custom properties, Chrome DevTools MCP

## Global Constraints

- Remove the colored vertical strip from all 13 rendered `.stat-card` KPI cards.
- Do not replace the strip with a top, bottom, or opposite-side accent rail.
- Keep Overview semantic icon colors.
- Keep machine-health sensor top borders and alert severity treatments unchanged.
- Preserve all markup, data, APIs, permissions, navigation, and behavior.
- Add no dependency, component library, Tailwind utility, card hover motion, or pointer styling.
- Preserve card padding, grids, responsive dimensions, text contrast, focus behavior, and reduced-motion behavior.

---

### Task 1: Protect and implement the layered KPI surface

**Files:**
- Modify: `Frontend/src/shared/styles/tokens.css:1789-1835`

**Interfaces:**
- Consumes: Existing `.stat-card`, `.stat-card-primary`, `.stat-card-success`, `.stat-card-warning`, `.stat-card-neutral`, and `.stat-card-icon` class names.
- Produces: CSS custom property `--stat-accent` on each tone; a radial surface wash, neutral border, inner highlight, and restrained shadow on `.stat-card`; no rendered `.stat-card*::before` edge.

- [ ] **Step 1: Run the failing rendered-style assertion**

Open `http://localhost:5173/dashboard` in Chrome and evaluate:

```javascript
() => {
  const cards = [...document.querySelectorAll('.stat-card')]
  const violations = cards.filter((card) => {
    const before = getComputedStyle(card, '::before')
    return before.content !== 'none' && parseFloat(before.width) > 0 && before.backgroundColor !== 'rgba(0, 0, 0, 0)'
  })

  if (violations.length > 0) {
    throw new Error(`${violations.length} KPI cards still render a colored edge.`)
  }

  return { cards: cards.length, violations: violations.length }
}
```

Expected: FAIL with `4 KPI cards still render a colored edge.` This is the real rendered behavior shown in the reported issue.

- [ ] **Step 2: Replace the edge rules with the approved layered surface**

In the later `.stat-card` section of `Frontend/src/shared/styles/tokens.css`, replace the base and tone-specific pseudo-element rules with:

```css
.stat-card {
  --stat-accent: var(--c-primary);
  position: relative;
  overflow: hidden;
  border-color: color-mix(in srgb, var(--subtle-border) 82%, var(--stat-accent) 18%);
  background:
    radial-gradient(
      circle at 92% 8%,
      color-mix(in srgb, var(--stat-accent) 9%, transparent) 0,
      transparent 46%
    ),
    var(--card-bg);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--c-text) 5%, transparent),
    0 10px 24px color-mix(in srgb, var(--stat-accent) 6%, transparent);
}

.stat-card-primary {
  --stat-accent: var(--c-primary);
}

.stat-card-success {
  --stat-accent: var(--c-success);
}

.stat-card-warning {
  --stat-accent: #F59E0B;
}

.stat-card-neutral {
  --stat-accent: var(--c-text-3);
}
```

Keep the existing `.stat-card-heading`, `.stat-card-icon`, `.stat-card-success .stat-card-icon`, and `.stat-card-warning .stat-card-icon` rules unchanged.

- [ ] **Step 3: Re-run the rendered-style assertion on all affected routes**

Run the Step 1 assertion on:

```text
http://localhost:5173/dashboard
http://localhost:5173/dashboard/downtime
http://localhost:5173/dashboard/reports
```

Expected results are `{ cards: 4, violations: 0 }`, `{ cards: 4, violations: 0 }`, and `{ cards: 5, violations: 0 }`.

- [ ] **Step 4: Review and commit the implementation unit**

Run:

```powershell
git diff --check
git diff -- Frontend/src/shared/styles/tokens.css
git add -- Frontend/src/shared/styles/tokens.css
git commit -m "fix(ui): replace KPI card edge accents"
```

Expected: only the approved shared card CSS is committed.

---

### Task 2: Prove visual, responsive, and regression completion

**Files:**
- Verify: `Frontend/src/shared/styles/tokens.css`
- Verify: `Frontend/src/features/dashboard/overview/DashboardSection.jsx`
- Verify: `Frontend/src/features/dashboard/downtime/DowntimeSection.jsx`
- Verify: `Frontend/src/features/dashboard/reports/ReportsSection.jsx`

**Interfaces:**
- Consumes: The layered `.stat-card` contract from Task 1 and the existing authenticated dashboard routes.
- Produces: Browser evidence for all 13 cards, both themes, four target widths, preserved sensor/alert styles, and a clean full regression run.

- [ ] **Step 1: Verify the source no longer contains KPI edge rules**

Run:

```powershell
rg -n '\.stat-card(?:-[\w-]+)?::before|border-left' Frontend/src/shared/styles/tokens.css
```

Expected: no `.stat-card*::before` matches. Any remaining `border-left` results must belong only to non-KPI banner or responsive-table rules and must be reviewed individually.

- [ ] **Step 2: Verify all affected routes in Chrome**

Open and inspect:

```text
http://localhost:5173/dashboard
http://localhost:5173/dashboard/downtime
http://localhost:5173/dashboard/reports
```

For each `.stat-card`, inspect `getComputedStyle(card, '::before')` and confirm `content` is `none`, the pseudo-element has no colored background, and the card background contains the radial gradient. Confirm route counts of 4, 4, and 5 respectively.

On Overview, temporarily emulate Slow 3G and reload. During the loading state, confirm all four skeleton `.stat-card` containers use the same layered background and expose no edge pseudo-element. Disable network throttling after this check.

- [ ] **Step 3: Verify theme and status invariants**

Inspect all three routes with `document.documentElement.dataset.theme` set to `dark` and `light`. Confirm readable label/value/helper contrast, visible neutral borders, subtle non-striped tonal washes, and restrained shadows.

On Overview, confirm the four icon tiles retain their success, warning, primary, or neutral tone. Confirm `.overview-sensor-card.status-running`, `.status-idle`, and `.status-downtime` retain their top status borders. Use source and computed-style inspection to confirm `.banner`, `.banner-error`, and `.banner-success` keep their existing severity-border rules; do not manufacture an application error merely to display one.

- [ ] **Step 4: Verify responsive behavior**

At 375, 768, 1024, and 1440 pixel widths, check Overview, Downtime, and Reports. For each viewport confirm:

```javascript
document.documentElement.scrollWidth <= window.innerWidth
```

Also confirm no KPI card clips its value/helper text and no tonal wash forms a visible edge rail.

- [ ] **Step 5: Run the complete frontend verification**

Run:

```powershell
cd Frontend
npm.cmd test -- --run
npm.cmd run build
```

Expected: every Vitest test passes and Vite exits successfully without a new chunk warning.

- [ ] **Step 6: Perform the completion diff audit**

Run:

```powershell
git status --short --branch
git diff --check
git show --stat --oneline HEAD
git show -- Frontend/src/shared/styles/tokens.css
```

Expected: clean worktree; the implementation commit changes only the approved shared CSS; no React, backend, API, dependency, or functional changes appear.
