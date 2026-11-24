# OrderLedger bug and security checklist

Source baseline is local main at `7e35110`. Checked items have a local code change. Release checks confirm deployed behavior. Record the commit and test result beside each release check.

## P0 — AI keys and service availability

- [x] Add **Use server default** per slot. Reset removes the tenant override. Clearing a saved key still disables that slot.
- [x] Show the effective provider, model, and credential source per slot. Distinguish server default, saved business key, incomplete setup, and disabled.
- [x] Initialize fallback only after a primary provider failure. Preserve both sanitized error codes in order import.
- [x] Preserve primary and fallback error codes in import responses and WhatsApp operator logs. Disabled or incomplete primary settings require correction before extraction.
- [x] Clear the saved key when switching providers unless a replacement was supplied.
- [x] Reject unsupported providers and endpoints when saving. Require a model when saving a credential.
- [x] Add separate Groq text and vision models for saved connections. Existing slots continue to use their text model when the vision field is blank.
- [x] Add independent primary and fallback tests for text and photo. Show which slot passed and whether fallback ran.
- [ ] Verify settings-only saves, clear/reset, invalid keys, quota errors, and primary/fallback failures through Settings, New order, and WhatsApp.
- [ ] Verify the live Render configuration and affected business using sanitized status and error codes. Keep credential values out of logs and reports.

## P0 — Security and abuse controls

- [x] Add in-process limits for login, signup, text/photo import, and AI connection tests.
- [x] Perform bcrypt comparison for both known and unknown login emails. Return generic signup conflict text.
- [ ] Remove the remaining signup enumeration signal with email verification and matching public responses.
- [x] Cache public health readiness for three seconds and signup templates for 30 seconds, sharing concurrent database reads.
- [x] Scope the login account counter to the client IP and normalized email. Keep the separate per-IP limit.
- [x] Verified Vercel production login and signup use an authenticated client IP for rate limiting on build `b51e11e`. Direct API and unverified proxy requests use the immediate peer IP.
- [ ] Use shared rate-limit counters if the deployment moves to multiple instances.
- [x] Add database-backed limits of 30 shared requests per business and 300 globally per UTC day. Manual imports, provider tests and WhatsApp all reserve from the same budget. A configured `SHARED_AI_BUSINESS_IDS` allowlist gates access.
- [ ] Configure the production allowlist and decide whether to add a separate in-flight concurrency limit.
- [x] Require certificate and hostname verification for remote PostgreSQL. Trust the published Supabase CA for its pooler and support `DATABASE_CA_CERT` for other private CAs.
- [x] Verified the Supabase pooler certificate and hostname against the published CA and confirmed production database readiness on Render build `607729c`.
- [x] Support a separate `PROVIDER_ENCRYPTION_KEY` for new AI and WhatsApp secrets, with legacy decryption during migration.
- [x] Add a transactional migration command for existing AI and WhatsApp credentials. Run `node dist/database/rotate-provider-credentials.js` from the built backend with the configured keys and database connection.
- [x] Configured the AI-only encryption key on Render. Startup migration on build `c67cd81` found zero older AI credential rows. A disposable PostgreSQL test verified migration of an existing key and safe reruns.
- [x] Replace reflected CORS with configured browser origins. Set the production frontend origin in the Render blueprint.
- [x] Verified production CORS allows the Vercel frontend and emits no authorization header for a foreign origin.
- [ ] Verify any additional self-hosted development origins used by the team.
- [x] Limit new registration passwords to 72 UTF-8 bytes.
- [x] Apply the same policy to every future team-member and password-change entry point or migrate password hashing. Preserve existing login compatibility.
- [x] Use an HttpOnly, Secure, SameSite cookie on the default production frontend with origin checks on writes. Retain bearer sessions for development and explicitly configured servers. Default to two-hour sessions and recheck membership and permissions on each authenticated request. Revoke issued sessions server-side on logout.
- [x] Add a frontend Content Security Policy and anti-framing protection in Vercel configuration.
- [x] Verified production CSP, cookie attributes, authenticated reads and customer writes, and logout via the public Vercel URL on 2026-11-24. The HTTP smoke test used a separate QA workspace and archived its test customer.
- [ ] Verify session rollout on the deployed app. Legacy tokens without session IDs are rejected. Affected users must sign in again.
- [x] Scan local Git history for Gemini, Groq and OpenAI project-key patterns. No matching history entries found.
- [ ] Scan the deployed configuration and published assets for exposed credentials. Rotate confirmed exposures.

## P1 — Bugs and release verification

- [ ] Run backend typecheck and the full disposable PostgreSQL suite, plus frontend build and API recovery tests against the release commit.
- [ ] Add focused regression coverage for key changes, unreadable fallback isolation, credential rotation, quotas, session revocation, CORS, and TLS configuration.
- [ ] Verify tenant and role isolation across customers, products, orders, invoices, payments, reports, settings, and WhatsApp.
- [ ] Verify financial invariants in staging. Cover concurrent orders, invoice generation, payment caps, retries, and rollback. Use disposable tenants and synthetic payments.
- [x] Verified live Gemini text and photo imports and the server-default reset in a QA workspace. Both imports returned one item at quantity two.
- [x] Verified live Groq text, photo and automatic fallback on build `b51e11e`. Removed the temporary credential and archived the QA product after testing.
- [ ] Verify signed WhatsApp webhooks, retry behavior, and one controlled staging reply.
- [ ] Verify startup recovery, mobile and desktop flows, and matching frontend/backend release versions.
- [x] Upgrade flagged dependencies in both lockfiles. npm audit reported zero findings after the updates.
