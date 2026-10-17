---
status: resolved
trigger: "Replace broken Puppeteer PDF path with real server-side statement PDF using pdfkit."
created: 2026-10-17
updated: 2026-10-17
---

## Current Focus

reasoning_checkpoint:
  hypothesis: Statement downloads fail because PdfService dynamically imports missing Puppeteer before PDF output can be generated.
  confirming_evidence:
    - The focused production-service test fails with Cannot find package 'puppeteer'.
    - The service always calls getBrowser; there is no working PDF fallback.
  falsification_test: The same baseline test produces PDF bytes without installing Puppeteer or changing the service.
  fix_rationale: Use installed PDFKit to produce bytes directly, with a locally bundled licensed font and explicit page layout; remove the unreachable HTML/browser dependency.
  blind_spots: PDFKit font shaping and visual layout require glyph and rendered-page checks after replacement; production font assets must be copied during build.
next_action: Local PDF repair and authenticated browser download verification are complete. Preserve this record in place; the original production deployment remains unverified.

## Symptoms

expected: An authenticated statement export produces a readable server-side PDF with tenant currency and Hindi names.
actual: Existing service requires an absent browser library and hardcodes INR and Page 1 of 1.
errors: Prior review reproduced a Puppeteer import error.
reproduction: Call PdfService.generateStatementPdf with valid statement data.
started: Present at baseline 8fdef60.

## Eliminated

## Evidence

- checked: All repository references to generateStatementHtml and generateStatementPdf.
  found: Only reports.routes.ts calls generateStatementPdf; HTML generator has no independent callers.
  implication: Remove unused HTML/browser code rather than retain two statement-rendering paths.
- checked: Existing PdfService and parent-authorized dependencies.
  found: Browser import is dynamic, Puppeteer is absent, PDFKit and its types are installed. Current renderer hardcodes INR and uses currentOutstanding as the period closing balance.
  implication: Direct PDFKit generation solves the runtime dependency and can correctly distinguish reporting balances.
- checked: Focused test server statement produces valid PDF bytes with an embedded font.
  found: Test failed with Puppeteer is not installed in this environment: Cannot find package 'puppeteer'.
  implication: The missing dependency is confirmed on the production method with valid input.
- checked: Unmodified Noto Sans Devanagari variable font downloaded from Google Fonts with its SIL Open Font License.
  found: Font cmap contains Hindi characters, Latin labels, digits and the INR symbol; 641944-byte font has weight 400 and width 100 defaults.
  implication: A single bundled font supports the statement content without server-installed fonts or runtime network access.
- checked: statement-pdf.test.ts after replacing the renderer.
  found: Three tests passed: PDF signature/EOF with embedded font; 100-entry pagination; Hindi/Latin/digit/INR glyph and shaping support.
  implication: The original red test is now green and the renderer works without a browser dependency.
- checked: npm run typecheck:tests and npm run build.
  found: Both passed; build copies src/assets into dist/assets.
  implication: Types, compiled output, and the font packaging path are valid.
- checked: Synthetic short/long PDFs with pypdf, PDFium rendering, and visual inspection of the short statement and final long-statement page.
  found: Short statement has one page; 100-entry statement has eight pages, all 100 references, matching page counters, and correctly distinct USD 200.00 period closing and USD 350.00 current outstanding. Hindi names and footer render without missing glyphs or overlapping columns.
  implication: Output is readable and financial labels match their data, not merely a valid byte stream.
- checked: Compiled dist/services/pdf.service.js called from C:/Users/aakaa instead of the backend working directory.
  found: Generated 8889-byte PDF with %PDF- signature using a EUR tenant and Hindi names.
  implication: Production font resolution depends on the module path, not cwd or system fonts.

- checked: Parent browser acceptance across setup, workflow, responsive and edge-case scripts.
  found: All 20 browser checks passed, including an authenticated statement PDF download following a real order, invoice and payment flow against the isolated local API.
  implication: The browser-to-API download path is verified with real local ledger records. The original production deployment remains unverified.

## Resolution

root_cause: Statement generation unconditionally imports missing Puppeteer; the previous HTML additionally hardcodes INR/page count and substitutes current outstanding for period closing.
fix: Replaced unused HTML/browser path with direct PDFKit output, embedded licensed Noto font, automatic ledger pagination and actual page counts, tenant currency codes, distinct opening/closing/current amounts and optional contact/footer text.
verification: Original failing test now passes; three PDF tests, full test typecheck and backend build pass. Text and rendered pages inspected; compiled service works from another cwd. Parent's 20-check local browser acceptance suite passed, including authenticated statement PDF download. The original production deployment remains unverified.
files_changed: [backend/src/services/pdf.service.ts, backend/src/tests/statement-pdf.test.ts, backend/src/assets/fonts/NotoSansDevanagari.ttf, backend/src/assets/fonts/OFL-NotoSansDevanagari.txt, backend/src/assets/fonts/README.md]
