# OrderLedger verification — 17 October 2026

Scope: manual ledger repairs, owner-editable configuration and reusable blueprints, and the Cashew-inspired interface. All API and browser acceptance used disposable local PostgreSQL and synthetic business data. No live customer database or external AI/WhatsApp provider was used.

## Automated checks

| Check | Result |
| --- | --- |
| Backend full suite before the final production-config addition | 34 passed, 0 failed; process exited successfully |
| Final production-secret checks (`node --import tsx --test src/tests/production-config.test.ts`) | 6 passed, 0 failed; separate focused run exited successfully |
| Backend source and test typechecks | Passed |
| Backend final production build (`tsc` and migration/font packaging) | Passed |
| Frontend final production build (`tsc` and Vite) | Passed |
| Browser setup stage | 8 checks passed |
| Browser order/payment/report workflow stage | 6 checks passed |
| Browser responsive/theme/accessibility stage | 3 checks passed |
| Browser blueprint/save-failure/connection edge cases | 3 checks passed |
| Git whitespace check and scan for common secret/key patterns | Clean |

The original 34-test backend suite covers 20 ledger/API regressions, 4 settings/database integrations, 7 settings/role/crypto checks, and 3 PDF checks. The six final configuration tests separately verify missing/short/placeholder/repeated/whitespace secrets, generated secrets, isolated dotenv loading, and preserved development behavior. The final test typecheck also passed after this addition. Browser totals are the checks reported by the three acceptance stages plus the edge-case script; the stages each check for uncaught browser exceptions.

## Confirmed behavior

- Product/customer/business PATCH fields persist through the public camelCase API without PostgreSQL undefined-column failures. Invalid inputs return useful client errors.
- Concurrent orders/invoices receive unique business numbers. Repeated invoice generation is idempotent; delivery and invoicing roll back together when invoice creation fails.
- Equal-value invoices/payments all contribute to balances. Explicit and concurrent allocations cannot overpay an invoice; advance payments remain credit and settle future invoices.
- Tenant boundaries, owner-only settings, operational role permissions, payment-method choices, and module switches are enforced through the real routes/repositories.
- Settings and provider metadata survive reloads. Stored keys are encrypted and omitted from responses. Blueprint export excludes identity, records, secrets, and the device server connection; preview/import changes configuration while retaining products and invoices.
- The browser workflow entered two kilograms at 45.25 per kilogram: subtotal 90.50, tax 4.53 at 5%, total 95.03. Delivery produced the configured invoice prefix; payment of 95.03 settled the invoice to zero.
- Product creation/edit/archive/restore, customer editing with zero-day terms, invoice details, statement filters/download, reports, unsaved-settings protection, and failed-save draft retention worked in the browser.
- A downloaded statement contains real PDF bytes. PDF service checks also cover a 100-entry, eight-page statement with all references, page counts, distinct closing/current balances, Hindi shaping, and a bundled licensed font. Compiled PDF generation works outside the backend working directory.
- Mobile navigation exposes all modules. Dialog focus and Escape work. Desktop, portrait, and landscape layouts at 1440×1000, 390×844, and 740×390 have no horizontal page overflow; light/dark palettes were visually inspected.
- A connection test does not forward login credentials. Saving a new backend address clears authentication before connecting to the new server.
- Missing migrations or database failures prevent a ready health response. WhatsApp ingestion and mock-message endpoints return 503.
- Production configuration rejects unsafe JWT secrets before authentication or provider-key encryption can consume them; rejection messages do not echo the supplied secret. Generated Render-compatible values are accepted.

## Evidence and limits

Reproduction details are retained in [.planning/debug/save-and-settings.md](.planning/debug/save-and-settings.md), [business settings](.planning/debug/business-settings.md), and [statement PDF](.planning/debug/statement-pdf.md). Supported commands are in [README](README.md).

Local browser artifacts, PDFs, test credentials, and browser storage were kept under the OS temporary directory (`orderledger-ui-qa`) and excluded from the repository. A separate targeted tenant-assertion rerun reached passing assertions but needed forced process cleanup after a PostgreSQL worker outlived the test harness; that run is not counted as an additional successful test run.

The exact request that failed on the user's original deployment was not captured. The product/customer/settings edit failure was reproduced against the baseline with real PostgreSQL and then repaired. Local successful saves do not establish that the deployed server has received these changes.

The original audit's WhatsApp/AI findings remain deferred behind disabled routes. Existing database snapshots can only backfill values present at migration time. Industry-specific workflows and the remaining product boundaries are documented in README; this verification is not a claim that every industry or production environment is covered.
