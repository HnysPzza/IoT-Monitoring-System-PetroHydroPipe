# AGENTS.md

Guidance for Codex working with code in this repository.

## Project

- Frontend: React and Vite in `Frontend/`.
- Backend: Node.js and Express in `Backend/`.
- Database: Supabase PostgreSQL, accessed through the backend.
- Hardware: ESP32-backed sensors monitoring one Spiral Mill machine and five sensors.

## General Principles

- Review relevant existing files and callers before changing code.
- Prefer concise solutions and existing project patterns.
- Avoid over-engineering, unnecessary abstractions, and oversized files.
- Match the surrounding syntax, naming, and style.
- Preserve unrelated user changes.
- Explain major architectural changes and wait for confirmation unless the user  explicitly requested them.
- Do not use emojis or special characters in code comments.
- Keep comments to one sentence.
- Watch for obvious bugs and error blast radius.
- Avoid excessive cards and containers.
- Correctness over cleverness: never silently self-heal inconsistent state; surface it through logs, alerts, or errors.
- Do not swallow errors: propagate failures, log them to `audit_logs`, or trigger an alert.
- Make retryable writes idempotent; reconnects, resends, and ingestion must not duplicate rows or transitions.
- Watch for style mismatches with the codebase.

## Code Quality and Security

Good code is correct, clear, minimal, consistent, secure, and verifiable.

- Inspect code, trace the flow, and find callers before editing.
- Fix root causes in the narrowest responsible layer.
- Use the smallest correct change: question need, reuse code, then prefer standard library, native features, and existing dependencies.
- Keep functions small, names clear, and control flow simple; avoid cleverness, dead code, duplication, and one-use abstractions.
- Keep data, logic, and UI separate; frontend code uses Express, not Supabase.
- Preserve unrelated behavior and keep diffs focused.
- Keep validation, authorization, errors, accessibility, and data-loss protection.
- Retain calibration and configuration for real sensor and clock variation.
- Mark known shortcuts with `ponytail:` plus their ceiling and upgrade trigger.
- Add one focused regression check for non-trivial logic; run the nearest test or build.
- Validate trust-boundary input and use least privilege.
- Add dependencies only when necessary; use manifests and lockfiles.
- Never expose personal data, credentials, keys, tokens, connection strings, service-role keys, or plaintext ESP32 keys.
- Never commit `.env` or blindly install or download packages; verify the source first.
- Keep one source of truth for names: import sensor and machine labels from `sensorIdentity.js`; never hardcode them.
- Use RPC-only mutations: write to `machines`, `sensors`, `alerts`, or `downtime_events` through the atomic RPC layer.

## Testing Logic

- Test behavior and contracts, not implementation details.
- Define each case with setup, action, expected result, and invariant.
- Cover valid, invalid, boundary, unauthorized, failure, retry, and concurrent cases.
- Test auth/API roles, expired or replayed sessions, validation, CSRF, rate limits, and safe errors.
- Test telemetry duplicates, stale or out-of-order events, S-05 rules, and atomic alert/downtime rollback.
- Test time/report boundaries, overlaps, zero output, partial data, and future data as unobserved, not zero.
- Test watchdog states, migrations/RLS/RPC access, SSE limits, and accessible frontend loading/error/conflict states.
- Use deterministic isolated fixtures; add one regression case per changed invariant and report unverified hosted or hardware paths.

## Documentation

- Use `docs/` for technical project documentation.
- New Markdown files should use kebab-case names.
- Do not create an activity log unless the user requests one or the task genuinely requires it.

## Version Control

- Keep commits focused and atomic.
- Commit only when explicitly requested by the user.
- Never auto-push any branch.
- Do not commit unrelated work.
- Do not use force commands.
