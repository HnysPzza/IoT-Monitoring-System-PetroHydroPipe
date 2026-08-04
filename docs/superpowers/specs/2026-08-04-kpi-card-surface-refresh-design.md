# KPI Card Surface Refresh Design

Date: 2026-08-04

Branch: `Final-Design`

## Objective

Remove the colored vertical strip from every KPI/statistics card identified by the attached `.stat-card::before` reference. Replace that decoration with a restrained layered surface so the cards retain hierarchy and tone without looking plain or generic.

This is a visual-only change. Data, API requests, card content, semantics, navigation, permissions, and dashboard behavior remain unchanged.

## Audit Findings

The colored left edge is generated globally in `Frontend/src/shared/styles/tokens.css` by `.stat-card::before`. Tone-specific rules change that strip to green or amber, while the base rule uses blue.

The rule currently affects 13 rendered KPI cards:

- Overview: four cards.
- Downtime: four cards.
- Reports: five cards.

Overview loading placeholders also use `.stat-card` and therefore inherit the same decorative rule while loading.

The following treatments are intentionally outside this issue:

- Top borders on the five machine-health sensor cards. These communicate actual sensor state.
- Error and success banner borders. These communicate notification severity.
- Chart reference lines, status badges, selected controls, and navigation accents.

## Approved Direction: Layered Surface

All `.stat-card` left-edge pseudo-elements will be removed, including the success and warning variants. The replacement will use the existing card footprint and theme tokens with four layers of hierarchy:

1. A neutral one-pixel outer border shared with the dashboard card system.
2. A subtle upper-right tonal wash derived from a per-card accent variable.
3. A restrained inner highlight and soft elevation shadow that separate the card from the dashboard background.
4. Existing label, value, helper, and icon-tile hierarchy.

The tonal wash is decorative, low-opacity, and contained inside the card. It must not form another edge stripe. The primary tone uses the current brand blue, success uses the current success green, warning uses amber, and neutral uses a subdued text/surface tone.

Overview icon tiles keep their current semantic green, amber, blue, and neutral treatments. This ensures meaning is communicated by icon, label, and text rather than by a colored card edge alone. Downtime and Reports cards keep their existing markup and use the default brand-toned surface wash.

## Visual Constraints

- No colored vertical border, rail, bar, or pseudo-element may remain on a `.stat-card` edge.
- Do not replace the left stripe with a top or bottom stripe.
- The tonal wash must remain subtle enough that card text keeps its current contrast.
- The card background must remain clearly distinct from the dashboard canvas in both themes.
- Static cards must not gain hover motion or pointer styling because they are not interactive.
- Card padding, grid layout, values, and responsive dimensions remain unchanged.
- Existing `prefers-reduced-motion` behavior remains unaffected.

## Component and CSS Scope

Primary implementation file:

- `Frontend/src/shared/styles/tokens.css`

Expected selectors:

- `.stat-card`
- `.stat-card-primary`
- `.stat-card-success`
- `.stat-card-warning`
- `.stat-card-neutral`
- Existing `.stat-card-icon` tone rules

No React component changes are expected unless browser verification reveals that a tone cannot be expressed with the existing classes. Any such change requires stopping and revising this design before implementation.

## Accessibility

- Text contrast remains unchanged and must continue meeting the existing light/dark theme standard.
- Semantic tone remains reinforced by visible icons and labels on Overview cards.
- Generic Downtime and Reports summaries do not rely on color to communicate meaning.
- No keyboard, focus, or screen-reader behavior changes are introduced.

## Verification

Completion requires all of the following evidence:

1. Source audit confirms the `.stat-card::before`, `.stat-card-success::before`, and `.stat-card-warning::before` edge rules are gone.
2. Browser-computed styles confirm all 13 rendered KPI cards have no colored left-edge pseudo-element.
3. Overview, Downtime, and Reports are visually checked in dark and light themes.
4. Responsive checks pass at 375, 768, 1024, and 1440 pixel widths without horizontal overflow or card clipping.
5. Overview loading cards retain a deliberate surface and do not expose an edge stripe.
6. The five machine-health sensor top borders and alert severity treatments remain unchanged.
7. The complete frontend test suite passes.
8. The production build succeeds.
9. Git diff review confirms the change remains visual-only and scoped to the approved card treatment.

## Non-Goals

- Redesigning sensor cards, charts, tables, alerts, navigation, or forms.
- Changing the number or content of KPI cards.
- Introducing a new component library or Tailwind dependency.
- Changing backend data, endpoints, authentication, roles, or production calculations.
- Adding new hover, click, or animation behavior to KPI cards.
