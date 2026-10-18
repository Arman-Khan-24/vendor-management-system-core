# Reference-based interface redesign verification

Scope: complete the invoice/dashboard redesign requested after commit `fdd60db`, carry its visual style across the application, and keep large lists responsive. The work uses the existing React frontend and backend contracts. No backend production code or database migrations changed in this revision.

## Changes

- Cream workspace, inset dark navigation, pastel billing summaries, payment ring, pending invoices, latest collections, and actionable recent activity.
- Landscape invoice header, sender/customer/date columns, item table, totals, payment notes, and an action dock. A4 printing removes the dialog backdrop and browser dialog width limit, repeats table headers, and preserves invoice rows.
- Desktop workspace page search with keyboard submission and Escape; existing mobile navigation retains every module.
- Shared 24-record pagination in catalog, customers, orders, payments, and invoices. Search and CSV export still cover all matching records; changing filters resets the page.
- Cached currency formatters, memoized business context, locally served Manrope fonts, a 16 KB WebP banner, and short transitions that respect reduced motion.
- Responsive dashboard/invoice layouts, readable mobile inputs, and a contained activity table that does not expand the page.

## Checks performed

| Check | Result |
| --- | --- |
| Frontend TypeScript and final Vite production build | Passed |
| Existing browser acceptance (`ui_acceptance.py --stage all`) | 15 checks passed |
| Existing edge cases (`ui_edge_cases.py`) | 3 checks passed |
| Production-preview redesign suite (`ui_redesign.py`) | 8 checks passed |
| Invoice PDF text checks | Single-page normal invoice; all 80 lines and totals present in the seven-page fixture |
| Printed invoice visual inspection | Normal invoice and long-invoice pages rendered with Poppler and inspected |
| Git whitespace check | Passed |

The 26 browser checks are the scripts' reported check groups, not a claim that every assertion is a separate test. All suites exited successfully. The final redesign suite ran against the production preview after the last application changes. No uncaught browser exceptions were reported.

The existing acceptance covers registration, saved business configuration, safe blueprints, hidden provider keys, product/customer editing and archive/restore, order-to-invoice-to-payment, statements/PDF, reports, feature switches, unsaved settings, themes, and mobile navigation. The edge cases cover applied blueprints, failed-save draft retention, and changing backend connections.

The redesign suite additionally verifies:

- Dashboard invoice and statement shortcuts and payment entry preselected for the clicked invoice's customer.
- Workspace search, including typing another query after Enter, missing results, and Escape.
- Eight screens at 1440, 900, 768, 740, 560, 390, 375, and 320 CSS pixels in both light and dark themes, without horizontal page overflow.
- Reduced motion, invoice keyboard focus, invoice dialog bounds, mobile invoice content, and A4 output with the backdrop hidden.
- Five lists with 1,000 records each: only 24 rows/cards render, records beyond the first page remain searchable, page changes work, filters reset pagination, and exports contain all 1,000 matching records.

## Performance observations

Production assets from the final build:

- JavaScript: 362.64 KB, 105.60 KB gzip.
- CSS: 51.84 KB, 11.19 KB gzip.
- Locally served font subsets: approximately 40 KB combined.
- Invoice banner: 16,030 bytes, loaded with the invoice view.

With 5,000 fixture records loaded across the five lists, 15 page-navigation measurements yielded **45.9 ms median** and **70.9 ms maximum** from a programmatic click to the second animation frame. The final invoice-list screen contained 634 DOM elements. These are local headless Chromium measurements on the development machine, not production Web Vitals or a controlled before/after speed comparison.

Pagination limits DOM rendering. The existing API client still loads complete lists in 500-record batches; network transfer and total in-memory data still scale with record count. Server pagination/search is a separate improvement if much larger ledgers require it.

## Evidence and limits

Tests used a disposable loopback PostgreSQL/API instance and synthetic business accounts. The 1,000-record lists and 80-line invoice use intercepted GET fixtures; they are not bulk data written into a customer database. Normal financial operations use the real local API.

Screenshots, PDF renders, JSON results, and browser state are under OS temporary folders `orderledger-ui-qa` and `orderledger-redesign-qa`. Credentials and generated output are excluded from Git. Reproduction commands and dependencies are in [README](README.md).

The earlier backend/security results remain documented in [17 October verification](VERIFICATION_2026-10-17.md); that backend suite was not rerun for this frontend-only revision. WhatsApp/live AI ingestion remains deferred. Production hosting, real customer data, and other browser engines were not exercised.
