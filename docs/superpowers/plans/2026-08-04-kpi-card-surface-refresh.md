# KPI Card Surface Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the colored left-edge decoration from every KPI card and replace it with a restrained layered surface that preserves hierarchy in dark and light themes.

**Architecture:** Keep the change inside the existing shared card CSS. A small Vitest source-contract test will protect the absence of edge pseudo-elements and the presence of the approved tone variables; browser inspection remains the authority for visual quality, theme behavior, and responsive layout.

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
- Create: `Frontend/src/shared/styles/tokens.test.js`
- Modify: `Frontend/src/shared/styles/tokens.css:1789-1835`

**Interfaces:**
- Consumes: Existing `.stat-card`, `.stat-card-primary`, `.stat-card-success`, `.stat-card-warning`, `.stat-card-neutral`, and `.stat-card-icon` class names.
- Produces: CSS custom property `--stat-accent` on each tone; a radial surface wash, neutral border, inner highlight, and restrained shadow on `.stat-card`; no `.stat-card*::before` rules.

- [ ] **Step 1: Add the failing CSS contract test**

Create `Frontend/src/shared/styles/tokens.test.js`:

```javascript
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')

function declarationsFor(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = css.matchAll(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'g'))
  return Array.from(matches, (match) => match[1]).join('\n')
}

describe('KPI stat-card surface', () => {
  it('uses layered tone surfaces without colored edge pseudo-elements', () => {
    expect(css).not.toMatch(/\.stat-card(?:-[\w-]+)?::before/)

    const baseDeclarations = declarationsFor('.stat-card')
    expect(baseDeclarations).toContain('--stat-accent: var(--c-primary)')
    expect(baseDeclarations).toContain('radial-gradient(')
    expect(baseDeclarations).toContain('box-shadow:')

    expect(declarationsFor('.stat-card-primary')).toContain('--stat-accent: var(--c-primary)')
    expect(declarationsFor('.stat-card-success')).toContain('--stat-accent: var(--c-success)')
    expect(declarationsFor('.stat-card-warning')).toContain('--stat-accent: #F59E0B')
    expect(declarationsFor('.stat-card-neutral')).toContain('--stat-accent: var(--c-text-3)')
  })
})
```

- [ ] **Step 2: Run the focused test and confirm the old design fails**

Run:

```powershell
cd Frontend
npm.cmd test -- --run src/shared/styles/tokens.test.js
```

Expected: FAIL because `.stat-card::before` still exists and the layered `--stat-accent` rules do not.

- [ ] **Step 3: Replace the edge rules with the approved layered surface**

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

- [ ] **Step 4: Run the focused test and confirm it passes**

Run:

```powershell
cd Frontend
npm.cmd test -- --run src/shared/styles/tokens.test.js
```

Expected: one test file and one test pass.

- [ ] **Step 5: Review and commit the implementation unit**

Run:

```powershell
git diff --check
git diff -- Frontend/src/shared/styles/tokens.css Frontend/src/shared/styles/tokens.test.js
git add -- Frontend/src/shared/styles/tokens.css Frontend/src/shared/styles/tokens.test.js
git commit -m "fix(ui): replace KPI card edge accents"
```

Expected: only the shared card CSS and its contract test are committed.

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
git show -- Frontend/src/shared/styles/tokens.css Frontend/src/shared/styles/tokens.test.js
```

Expected: clean worktree; the implementation commit changes only the approved shared CSS and its contract test; no React, backend, API, dependency, or functional changes appear.
