# Add user onboarding

## Current implementation

- Admin chooses **Add user**, enters name, username, email, and a non-Admin role.
- The database saves the account, SHA-256 setup-token hash, and audit entry together. No temporary password is generated, stored, displayed, or emailed.
- Brevo sends the user a one-hour, single-use password-setup link. Only the user chooses the password; bcrypt hashes it before the atomic completion RPC.
- Completion locks the account and token, checks expiry and access, writes the password, consumes the token, marks setup Ready, revokes sessions, and records the audit event. Any database failure rolls the whole operation back.
- Resend invalidates earlier setup links. A database-enforced one-minute cooldown prevents rapid resends. Email acceptance does not prove inbox delivery.
- If email sending fails or times out, the account remains saved and awaiting setup. The UI reports unconfirmed delivery; inspect the directory and use resend rather than adding a duplicate account.

## Password and login protection

- Setup and password changes require 12 or more characters, at most 72 UTF-8 bytes, uppercase, lowercase, a digit, and ASCII punctuation. Whitespace alone does not satisfy the punctuation requirement.
- Existing passwords remain valid for login; the new policy is enforced on replacement.
- Session creation rechecks the verified credential under the account lock. Password rotation cannot be followed by a session created from stale credentials.
- Session issuance, last-login timestamp, and successful-login audit commit together.
- Failed-login audit persistence failures return a controlled 503 and a sanitized server log.
- Public setup cannot exhaust the password-change account allowance. Limits remain process-local.

## Access and directory

- Exactly one existing active, non-archived Admin is required before migration. The database blocks a second Admin, demotion, archival, deletion, and deactivation of that Admin. Password changes remain allowed.
- Active/Inactive is administrative access; Invited/Expired/Ready is setup progress. Active pending accounts still cannot sign in. Expired is derived from the current link, not a background job.
- Deactivation or archival revokes sessions and setup links. Reactivating a pending account requires sending a new setup link.
- Existing temporary-password accounts can sign in only to change their password. Business API routes reject them until completion.
- Protected requests verify the JWT session ID against the database. Revoked sessions and old JWTs without a session ID require fresh login.
- Directory pagination, search, role/status/setup filtering, and sorting happen in PostgreSQL. The default is 10 rows, newest first, with a stable ID tie-breaker. Global totals do not count only the visible page.

## Endpoints

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /api/users` | Admin | `page`, `limit`, `search`, `role`, `status`, `onboarding`, `sort`, `direction` |
| `POST /api/users` | Admin | Add account without a password; returns account ID and email delivery result |
| `POST /api/users/:id/resend-setup` | Admin | Replace setup link and send email |
| `PATCH /api/users/:id/status` | Admin | Enable or disable a non-Admin account |
| `PATCH /api/users/:id/archive` | Admin | Archive a non-Admin account |
| `POST /api/auth/setup-password` | Setup token | Choose password and complete setup |
| `POST /api/auth/change-password` | Signed-in user | Verify current password, replace it, revoke sessions |

## Apply locally before testing real accounts

1. Back up the development database; verify there is exactly one Admin, active and not archived. Resolve duplicate case-insensitive usernames/emails explicitly if migration reports them.
2. Apply migrations through `028`, then migrations `029_account_onboarding.sql`, `030_verify_login_credentials.sql`, and `031_atomic_login_audit.sql` in order. The migration deliberately refuses ambiguous Admin state; it never silently picks or deletes an account.
3. For a new database, load the base schema and credential-free operational seed. Privately provision exactly one active Admin with a bcrypt hash before applying `029`, then apply `030` and `031`. The seed never creates an Admin or changes existing accounts.
   Backend readiness requires schema version 31 and reports unavailable until all three migrations are applied.
4. Set backend `ACCOUNT_SETUP_ORIGIN=http://localhost:5173` alongside the existing Brevo variables. Restart the backend and frontend. A recipient on another device cannot use your localhost URL; use a reachable development origin and align CORS when testing across devices.
5. Sign in, replace any temporary password, then add a test user. Follow the received link, choose a password, and sign in as that user. Reopening the consumed link must fail.
6. Test resend, expired links, deactivation, reactivation, directory filters, and pagination. Never paste setup links, passwords, or API keys into logs or commits.

## Boundaries

- Email transmission is outside the database transaction. Delivery status is the immediate request result, not a persisted provider-delivery timeline; there is no automatic retry worker or webhook integration.
- HTTP rate limiting remains per backend process; resend cooldown is shared through PostgreSQL. No Redis or additional dependencies were introduced for onboarding.
- Minimum password length counts Unicode code points; the bcrypt maximum counts UTF-8 bytes. Existing passwords cannot be assessed for complexity from their hashes and are not automatically reset.
- The setup token lives only in the email and browser memory; its URL fragment is removed on page load. Reload by reopening the email link if needed. GET requests do not consume the link.
- Hosted migration, HTTPS, provider sender/IP authorization, and real-inbox end-to-end verification remain deployment/test-environment steps, not proven by isolated tests.

## Verification

- Local PGlite checks cover repeatable migration, protected Admin, token replay/expiry/resend, setup rollback on audit failure, revoked links after deactivation/reactivation, directory filtering/totals, and denied anonymous/authenticated access.
- API checks cover public setup validation/origin rejection, temporary-password business-route denial, and the allowed password-change route. Service checks verify token hashing and partial email-failure reporting.
- Frontend checks cover credential-free Add user, hidden Admin role option, server pagination/filter reset, email failure feedback, protected Admin actions, and password-setup token scrubbing/confirmation.
- Both existing suites passed locally after an isolated rerun of the frontend suite; the first frontend run had one timing failure while the backend suite was consuming resources. The production frontend build passed.
- The current live browser displayed the forced password-change page. No real password was changed and no hosted migration or end-to-end real email onboarding was performed during implementation.
