---
status: resolved
trigger: "Internal server error when saving a product, customer, order, or payment; settings and catalog must be editable."
created: 2026-10-17
updated: 2026-10-17
---

## Symptoms
- Expected: create/edit records and settings with clear validation and durable saved data.
- Actual: user sees Internal server error; UI lacks editing and real settings controls.
- Reproduction: saving products, customers, orders, or payments. Exact production request unknown.
- Scope: fix core ledger and provide a reusable business configuration blueprint. Cashew-inspired UI throughout; WhatsApp deferred.

## Current Focus
hypothesis: Confirmed API field-mapping, ledger, settings, PDF and production-secret defects are repaired and locally verified.
test: Completed the prior 34-test backend suite, six focused production-configuration tests, typechecks, final frontend/backend builds and the parent's 20-check browser acceptance suite.
expecting: Local configuration, record editing, invoicing, payments and PDF export behave as documented; unsafe production JWT secrets fail during configuration loading.
next_action: Local debugging is complete. Keep QA API session 55742 running for the parent's final verification/publication work; preserve this record in place. The original production deployment remains unverified.

reasoning_checkpoint:
  hypothesis: "Production configuration exposes the public development JWT secret when no explicit value is configured, and accepts example placeholders because the module has no production validation."
  confirming_evidence:
    - "The red subprocess regression imported the real env.ts under NODE_ENV=production with JWT_SECRET absent and observed exit code 0, directly reproducing acceptance."
    - "env.ts unconditionally uses the public development fallback; server.ts checks only environment-variable presence, while auth and provider-key encryption consume the exported config."
  falsification_test: "The same isolated production import rejects before the change, or generated 32-character and longer secrets are rejected after the change."
  fix_rationale: "Validate at the shared configuration boundary before exporting the key; reject missing, short, whitespace, repeated-character and known placeholder values without altering valid values or nonproduction behavior."
  blind_spots: "Syntactic validation cannot prove secret entropy or uniqueness. Actual deployment credentials are not inspected; generated Render-compatible values and isolated dotenv fixtures cover supported configuration sources."

## Evidence
- Technical review: TECHNICAL_REVIEW_2026-10-17.md.
- Business PATCH passes invoiceTrigger as a SQL column; product/customer PATCH also pass API keys directly.
- Existing tests do not exercise production repositories and npm test is broken.
- 2026-10-17: No running PostgreSQL listener/binaries found on the local paths checked. Installing dev-only embedded-postgres for disposable integration tests; no real database has been touched.
- 2026-10-17: Existing customer list aggregates SUM(DISTINCT monetary values), collapsing equal invoices/payments. Detail endpoint already uses independent sums.
- 2026-10-17: Existing order/payment repositories throw generic Error for inactive/missing entities and invalid transitions; errorHandler turns them into 500 responses.
- 2026-10-17: Billing configuration worker owns business routes/repository/service/validator and migration 004; investigator owns other backend and migration 005. Frontend remains root-owned.
- 2026-10-17: Real isolated PostgreSQL API regression failed exactly as predicted: product PATCH {currentPrice:125} -> 500, PostgreSQL 42703 column currentprice missing; customer PATCH {creditTermsDays:14} -> 500, PostgreSQL 42703 column credittermsdays missing. The same calls create records successfully. Business mapping worker's fix already passed the corresponding test. Native disposable cluster initializes in about 60 seconds on first run.
- 2026-10-17: Expanded real-PostgreSQL suite: 11/17 pass after ledger fixes, including saved field mappings, historical archive retention, 12 concurrent order/invoice creations, six duplicate invoice requests, injected invoice-failure rollback, repeated equal balances, explicit and concurrent allocation bounds, tax/prefix snapshots and payment method switches.
- 2026-10-17: Six remaining tests reproduced known gaps: the report clamped customer credit to zero; a negative list limit became PostgreSQL 2201W / HTTP 500; DELIVERY could record payments; the January 31 statement omitted both the invoice at 21:00 UTC and a backdated payment; unauthenticated WhatsApp history returned 200; the PDF endpoint returned 500 because Puppeteer was missing.
- 2026-10-17: Settings worker independently passed 7 unit/role/crypto tests and 4 API/database tests. Native PostgreSQL repeat initialization completed in about 22 seconds.
- 2026-10-17: Final combined npm test run: 34 passed, 0 failed. Includes FIFO/advance credit, page boundaries, complete-day reports, migration readiness, inactive WhatsApp routes and real PDF response. Native DB init is slower under parallel Windows test/QA load; API operations complete normally.
- 2026-10-17: npm run typecheck, npm run typecheck:tests and npm run build all pass. Build copies migrations/fonts into dist. Compiled PDF generation succeeds outside backend cwd; short and 100-entry PDF renders were visually checked, with Hindi shaping and all 100 references verified across 8 pages.
- 2026-10-17: Disposable QA API is live at http://127.0.0.1:5100, exec session 55742. Root informed. No live business database has been opened or modified.
- 2026-10-17: Additional foreign-invoice allocation rollback and foreign-customer statement assertions passed in a targeted rerun of the same 34-test suite. Its hung teardown required forced cleanup and exited 1; this is not an exit-0 test run or additional test coverage. The earlier combined 34-test run exited 0.
- 2026-10-17: Targeted test assertions passed but a PostgreSQL I/O worker outlived its stopped test postmaster and kept the harness alive. Stopped only the tracked test Node processes and orphan worker 7268 (dead parent 12180); the test directory had already been removed. Only the QA database remains: postmaster 9664, data directory orderledger-test-Mmfa6K. QA API session 55742 remains active.
- 2026-10-17: Root supplied successful browser acceptance: 20 checks across setup, workflow, responsive and edge-case scripts. Verified an order total of 95.03 with 5% tax, delivery producing a CM-prefix invoice, a 95.03 payment settling it to zero, authenticated statement PDF download, date filters, saved settings/blueprints/modules and hidden API keys.
- 2026-10-17: Follow-up source review confirms env.ts uses `process.env.JWT_SECRET ||` the public development fallback for every environment. Existing server.ts rejects a missing production environment variable only at bootstrap, while imported application/config consumers still receive the fallback and long example placeholders pass bootstrap.
- 2026-10-17: Isolated red configuration test reproduced the gap: `production rejects missing, empty and short JWT secrets` failed because the production import exited 0 rather than 1 when JWT_SECRET was missing. Child process exited cleanly; no user dotenv file was read. Six focused configuration test groups were prepared.
- 2026-10-17: Added a production-only guard directly in env.ts. It requires an explicit JWT_SECRET of at least 32 characters, rejects whitespace, single-character repetition and normalized placeholder markers, and never interpolates the supplied value into its error. Valid values and nonproduction fallback behavior are preserved unchanged.
- 2026-10-17: Root ran node --import tsx --test src/tests/production-config.test.ts after the guard: exit 0, six passed, zero failed in 7.2 seconds. These are six focused tests in addition to the prior 34-test backend suite, not a new combined full-suite run.
- 2026-10-17: Root's final npm run typecheck:tests and both frontend/backend production builds exited 0. Secret-pattern scan and git diff --check were clean. The investigator was stopped before these final checks to prevent concurrent edits; QA API session 55742 was preserved.

report_reasoning_checkpoint:
  hypothesis: "Statements use entry-created timestamps instead of payment.date and compare endDate to midnight; Math.max(0,billed-paid) hides customer credit."
  confirming_evidence: ["An invoice at January 31, 21:00 UTC and a payment dated January 31 produced zero January 31 statement entries", "A 150 advance against a 100 invoice reported a 0 balance instead of -50 customer credit"]
  falsification_test: "Changing only effective event dates and the exclusive next-day upper bound does not include both events."
  fix_rationale: "One shared statement implementation uses payment effective dates, inclusive whole-day filters, integer-cent balances and preserves negative account credit."
  blind_spots: "Tenant-specific timezones are not configurable; report calendar boundaries use documented UTC dates for timestamped invoice/order events."

## Eliminated
- No knowledge-base file exists for this new session.

## Resolution
root_cause: Product/customer edits forwarded camelCase API keys as SQL identifiers, producing PostgreSQL 42703 / HTTP 500. Settings had the identical defect. Normal product/customer creation succeeded in isolated reproduction; the exact production creation failure remains unobserved. Independent errors included generic exceptions for invalid selected records, race-prone number allocation, separately committed status/invoice work, unchecked specific allocations, SUM(DISTINCT) monetary aggregation, created_at-based payment reporting, midnight end bounds, missing PDF runtime and unguarded deferred routes. The shared production configuration also exposed a public development fallback or accepted unsafe placeholder JWT secrets before authentication/encryption consumed them.
fix: Explicit field allowlists; typed validation/4xx errors; tenant-lock number allocation; shared transactions and idempotent delivery/invoice retries; bounded integer-cent allocations and advance credit; independent balance sums; frozen names/prices/tax/credit terms/prefix; archive/restore; effective-date statements and inclusive calendar filtering; owner-normalized JSONB settings with encrypted provider keys; module/payment-method enforcement; stable paging; readiness/migration startup failure; inactive WhatsApp endpoints; native PDF generation with bundled licensed font; production-only JWT secret validation at the shared configuration boundary.
verification: Prior combined backend suite passed 34/34 tests on isolated PostgreSQL and service/unit tests. Root's separate focused configuration run passed 6/6 with exit 0; no new combined 40-test run was performed. Source/test typechecks and final frontend/backend production builds passed. Compiled PDF output and rendered pages were checked. Parent's 20-check local browser acceptance suite passed, including settings/blueprints, editing, order-to-invoice-to-payment, responsive views and authenticated PDF download. Original user deployment remains unchanged and unverified.
files_changed: [backend repositories/routes/services/models/validators/middleware, backend/src/database/migrations/004_business_settings.sql, backend/src/database/migrations/005_ledger_snapshots.sql, backend/src/database/migrator.ts, backend/src/database/connection.ts, backend/src/app.ts, backend/src/server.ts, backend/src/config/env.ts, backend/src/assets/fonts, backend/src/tests, backend/scripts, backend/package.json, backend/package-lock.json, backend/tsconfig.tests.json]
