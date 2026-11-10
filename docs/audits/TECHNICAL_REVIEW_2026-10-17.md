# OrderLedger technical review

## Remediation update — 17 October 2026

The audit below records the **original checkout at `8fdef60`**. Its line numbers and failing results describe that baseline, not the repaired application.

The subsequent implementation fixes save-field mapping, concurrent numbering, atomic delivery/invoicing, payment allocation/credit, balance aggregation, role enforcement, report dates, database startup/readiness, statement PDFs, and historical invoice loading. It replaces silent frontend failures with actionable errors and adds a complete Cashew-inspired interface, catalog/customer editing and archiving, owner settings, safe reusable blueprints, and stored provider configuration.

WhatsApp, mock-message access, and AI ingestion are **disabled**, not completed integrations. Provider authentication, durable queues, confirmation concurrency, and AI unit conversion still need implementation before those routes can be enabled. The original live `.mjs` diagnostics are not part of the supported test suite.

See [current verification](VERIFICATION_2026-10-17.md) for passing regression/browser checks and [setup and product boundaries](README.md). No live customer database or production deployment was used for acceptance.

## Original audit

Reviewed 17 October 2026, against commit `8fdef60` and the original local working tree. Scope: architecture, correctness, tenant isolation, integrations, and test coverage. Application source was not changed during this initial audit.

**Verdict:** The project has a useful ledger foundation, but the current code is not ready for production. Type checking passes; authentication gaps, quantity handling, transaction boundaries, and incomplete integrations remain. The handoff documents' completion claims are not supported by the current checkout.

## Architecture

| Layer | Implementation | Assessment |
| --- | --- | --- |
| Frontend | React 19, TypeScript, Vite, Tailwind; central `ApiClient`; feature views composed by `App.tsx` | Straightforward structure. Most operational state and refresh logic live in one component. |
| HTTP API | Express 4, JWT authentication, Zod body validation | Most business routes derive tenant identity from the token. Role enforcement and WhatsApp authentication are incomplete. |
| Business logic | Services coordinate repositories; raw parameterized PostgreSQL queries | Repository boundaries are understandable, but multi-step operations often span separate transactions. |
| Data | PostgreSQL, NUMERIC money columns, composite tenant foreign keys, order price snapshots | Stronger than application-only tenant filtering. Invoice/order numbering and payment bounds still need correction. |
| WhatsApp and AI | Provider adapter, Gemini/Groq extraction, deterministic catalog matching, pending confirmations | The confirmation gate is useful. Provider delivery, unit validation, concurrency, and durable processing are incomplete. |
| Background execution | Optional BullMQ enqueueing; otherwise `setImmediate` | No worker is instantiated in the checked-in application. The direct path is not durable. |
| Deployment | Render API service; startup migrations; precompiled backend output also present locally | Startup tolerates migration failure, and optional runtime dependencies are missing from the manifest. |

The manual path is: frontend request, JWT tenant identification, validation, service/repository, PostgreSQL. The WhatsApp path is: webhook, inbound event record, extraction, catalog matching, pending confirmation, customer YES, order repository. There was no existing Graphify graph; findings below come from direct source inspection and local checks.

## High-priority findings

### 1. WhatsApp authentication can be bypassed

**Evidence:** `backend/src/services/whatsapp/whatsapp.provider.ts:26` accepts every request in mock mode. At line 127, the generic provider accepts any nonempty signature or Authorization header and accepts all requests when no webhook secret is configured. The factory defaults to mock mode at line 176. The public route invokes this check in `backend/src/routes/webhook.routes.ts:25`.

**Impact:** A sender who knows a tenant ID and a registered customer's phone can submit forged customer messages and confirmations. The deployed configuration does not require a real provider or secret. The media path also fetches caller-supplied URLs without destination restrictions (`backend/src/services/order.processor.ts:79`), creating an additional server-side request risk.

**Verification:** Instantiated the real generic provider with a synthetic secret. Both an arbitrary Authorization header and an arbitrary BSP signature returned `true`. No external webhook was attacked.

**Fix:** Implement the actual provider's signature validation over the raw request bytes; require the appropriate production configuration; restrict mock mode to an explicit local/test setting. Resolve provider media identifiers through the provider API and constrain downloads.

### 2. Public mock-message endpoints expose data across tenants

**Evidence:** `backend/src/routes/whatsapp.routes.ts:11` returns the singleton provider's complete message array without authentication or tenant filtering. Line 22 allows unauthenticated clearing. `backend/src/app.ts:45` mounts these routes unconditionally.

**Impact:** Under the default mock provider, anyone with API access can read customer phone numbers and order messages from every tenant represented in that process, or erase the in-memory message log.

**Verification:** Mounted the real router on a temporary loopback server with two synthetic messages. An unauthenticated GET returned HTTP 200 and both messages. An unauthenticated clear returned HTTP 200 and emptied the array.

**Fix:** Exclude these test endpoints from production. If operational message history is needed, expose authenticated, tenant-filtered persisted records.

### 3. Unit mismatches can change the quantity ordered

**Evidence:** `backend/src/services/ai/catalog.matcher.ts:53` and line 110 accept a single matching product while retaining the extracted unit without conversion or compatibility checks. `backend/src/services/order.processor.ts:270` forwards only product ID and quantity. `backend/src/repositories/order.repo.ts:210` stores that quantity with the catalog unit.

**Example:** A catalog sells Banana by the dozen. Extraction returns 12 pieces. The matcher accepts 12 pieces, but confirmation creates an order for 12 dozen. A grams-versus-kilograms mismatch has the same problem.

**Verification:** The actual matcher accepted a synthetic 12-piece order against a dozen-based catalog, returning `isValid: true`, quantity 12, unit `piece`, and a total calculated as 12 times the dozen price. The downstream loss of the extracted unit was verified in source.

**Fix:** Reject incompatible units for clarification, or convert supported units into the catalog unit before confirmation and persistence. Preserve the normalized quantity and unit through the whole flow.

### 4. Concurrent order and invoice creation can collide

**Evidence:** `backend/src/repositories/order.repo.ts:173` and `backend/src/repositories/invoice.repo.ts:185` allocate tenant numbers using `MAX(...) + 1`. There is no shared tenant counter lock. Locking an individual order does not serialize invoices for different orders.

**Impact:** Concurrent requests can select the same number. Unique constraints prevent duplicate numbers, but one request fails. The invoice idempotency lookup also occurs before the order lock, so concurrent generation of the same invoice can return an error instead of the existing result.

**Verification:** Source-level concurrency analysis; not a live PostgreSQL load test.

**Fix:** Allocate numbers atomically per tenant, for example with a locked counter row or a tenant row lock. Recheck invoice existence after acquiring the relevant lock.

### 5. Delivery and invoicing are not atomic

**Evidence:** `backend/src/services/order.service.ts:54` completes the status update before starting invoice generation at line 68. The status repository commits at `backend/src/repositories/order.repo.ts:282`.

**Impact:** If invoice creation fails, the API returns an error while the order remains Delivered or Packed. Repeating the same status transition is rejected by the state machine, so an ordinary retry does not repair the missing invoice.

**Fix:** Coordinate the transition, audit history, and required invoice through one database transaction, or persist a retryable invoice-generation obligation atomically with the transition.

### 6. YES confirmation is not safe under concurrency or partial failure

**Evidence:** `backend/src/services/order.processor.ts:228` reads the pending confirmation without a lock. It creates and commits an order at line 265, then marks the confirmation at line 277 using a separate operation.

**Impact:** Two confirmations can read the same pending record and create separate orders. A failure between order commit and confirmation update also leaves a pending record that can create another order on retry. Sequential duplicate checks do not protect these interleavings.

**Fix:** Atomically claim the pending confirmation and create its order; enforce a unique link between the confirmation and the resulting order. Treat repeat confirmation as retrieval of the existing result.

### 7. Background processing can stall or permanently lose messages

**Evidence:** `backend/src/services/order.processor.ts:306` creates a BullMQ queue and line 322 adds jobs, but no application file instantiates a Worker. Without Redis, line 329 schedules only in-process work. `backend/src/routes/webhook.routes.ts:56` persists the inbound event before enqueueing, while line 75 treats every existing event as already processed.

**Impact:** Enabling Redis queues work that this repository never consumes. Without Redis, a process restart loses pending work. If enqueueing fails after the inbound insert, the provider's retry is marked duplicate and never enqueued again.

**Fix:** Add an actual worker and deploy it, or use the stored inbound events as a durable database-backed work queue. Distinguish received, queued, processing, failed, and completed states; duplicate delivery must resume incomplete work.

### 8. Explicit payment allocation can exceed an invoice balance

**Evidence:** `backend/src/repositories/payment.repo.ts:119` caps a requested allocation only against the remaining payment. The invoice lookup retrieves its total but does not subtract existing allocations or enforce the unpaid balance before insertion. The FIFO branch does perform that calculation.

**Impact:** An invoice can receive more than its total, display a negative remaining amount, and consume credit that should remain unallocated or settle another invoice.

**Verification:** Executed the real `PaymentRepository.recordPayment` with a stubbed database client and a synthetic invoice total of 100. An explicit allocation of 150 was accepted and returned. This verifies application logic, not PostgreSQL behavior under load.

**Fix:** Use the locked invoice's unpaid balance for both allocation paths, and reject invalid overrides or retain excess as customer credit.

## Other confirmed gaps

| Priority | Finding | Evidence and consequence |
| --- | --- | --- |
| High | Real WhatsApp sending is a stub | `backend/src/services/whatsapp/whatsapp.provider.ts:165` logs and returns success without an HTTP request. Native Meta image payloads provide media IDs, while the adapter expects a URL/link. The current integration cannot provide the advertised end-to-end delivery. |
| Medium | PDF export fails on the current dependency set | `backend/src/services/pdf.service.ts:42` dynamically imports Puppeteer, which is absent from `backend/package.json` and local dependencies. A direct synthetic statement-generation call failed for that reason. |
| Medium | Image orders are labelled as text | The pending-confirmation SELECT at `backend/src/services/order.processor.ts:229` omits `source_type`, but line 264 tests it. The expression therefore selects `whatsapp_text` even for an image confirmation. |
| Medium | Declared roles are not enforced | `requireRoles` is defined in `backend/src/middleware/auth.middleware.ts:42` and is not used by any route. Existing STAFF or DELIVERY identities receive the same authenticated operational API access as owners. |
| Medium | Historical invoices disappear from the frontend list | `frontend/src/App.tsx:237` renders invoices from the loaded orders rather than the invoice endpoint. Orders default to the newest 50 (`backend/src/routes/order.routes.ts:17`), with no pagination requested by the client. Older invoices can therefore disappear from this screen. |
| Medium | API failures become misleading empty states | `frontend/src/App.tsx:57` catches collection-fetch failures and substitutes empty arrays. An expired token or server failure can appear to the operator as no orders/customers/payments. |
| Medium | Report dates do not match the payment's chosen date | `backend/src/services/reports.service.ts:87` and line 387 use payment `created_at`; the payment form/API supports a separate effective `date`. Backdated collections are reported in the entry period. Date-only end filters also use an inclusive midnight timestamp at line 64, excluding most of the selected end day. |
| Medium | Startup can report healthy after database failure | `backend/src/server.ts:8` catches migration failures and starts serving. `/health` in `backend/src/app.ts:27` checks neither database connectivity nor migration readiness. |

## Test results and coverage

| Check run | Result |
| --- | --- |
| Backend TypeScript, `tsc --noEmit` | Passed |
| Frontend TypeScript, `tsc --noEmit` | Passed |
| Backend `npm test` | Failed before tests executed: missing `pg-mem` |
| Backend `npm run test:ts` | Failed before tests executed: missing `pg-mem` |
| Syntax checks of all 22 test `.mjs` files | 18 passed, 4 failed |
| Generic webhook verification with invalid synthetic headers | Invalid headers accepted |
| Unauthenticated mock-message read and clear on loopback | Both returned 200 |
| Catalog matching with incompatible units | Incorrectly accepted |
| Explicit payment allocation with a stubbed database | Accepted 150 against an invoice total of 100 |
| Synthetic statement PDF generation | Failed: missing Puppeteer |

The four syntax failures are `ambiguity_stress_suite.mjs:9`, `devanagari_live_suite.mjs:42`, `run_test1_clarification.mjs:9`, and `test_live_groq_vision.mjs:14`, each reporting `SyntaxError: Unexpected string`.

Restoring the missing test dependency is necessary but insufficient. `backend/src/tests/core_ledger.test.ts` creates a simplified schema and directly inserts the expected allocations/statuses. It does not call the production repositories, authentication middleware, or state machine. For example, its FIFO test writes allocations and marks invoices Paid/Partial itself at lines 202–212. Those assertions cannot catch errors in the actual payment allocator. The normal TypeScript build also excludes `src/tests`.

The next useful tests should execute production code against an isolated PostgreSQL database: cross-tenant and role access, concurrent numbering, delivery rollback on invoice failure, repeated/concurrent confirmation, queue recovery, unit conversion, and allocation bounds. Frontend coverage should include API failures, token expiry, invoice pagination, and successful exports.

No live customer database, external AI provider, or real WhatsApp delivery was exercised. Existing live scripts were not used as evidence of passing behavior. No deployment or application code changes were made.

## Recommended repair order

1. Close the webhook and mock-message access gaps.
2. Correct quantity/unit handling and explicit payment allocation.
3. Make numbering, confirmation, and delivery/invoicing safe under concurrency and retries.
4. Complete durable processing, real WhatsApp delivery, and PDF runtime dependencies.
5. Repair the test entry points and replace copied SQL assertions with tests of production behavior.

Keep the existing service/repository structure. These issues require completion and consolidation of current paths, not a framework rewrite. In particular, the two customer-statement implementations in `PaymentRepository` and `ReportsService` should share the ledger calculation so date and balance rules do not diverge.
