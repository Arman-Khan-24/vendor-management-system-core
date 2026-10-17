# OrderLedger reusable business setup

## Authorized scope
Fix save errors and operational ledger defects. Replace the UI with a coherent Cashew-inspired pastel Material You interface across auth, dashboard, catalog, customers, orders, invoices, payments, reports, and settings. Persist owner-managed configuration so new businesses start from a preset or a safe exported blueprint. WhatsApp remains unavailable until its later integration.

The user explicitly authorized committing and pushing the completed work to the existing GitHub repository. No additional push approval is required.

## Ownership
Root: frontend, browser acceptance checks, documentation.
Backend debug session manager: backend and its tests/migrations. Do not change frontend files.

## Shared API contract
Preserve existing camelCase request fields and snake_case entity response fields.
- PATCH /api/products/:id maps currentPrice; support category (optional string), active for archive/restore.
- PATCH /api/customers/:id maps creditTermsDays; active archives/restores. GET both lists with ?all=true.
- GET /api/business returns business with normalized settings; PATCH /api/business (OWNER only) accepts name, phone, currency, logoUrl, invoiceTrigger, categoryTemplate, settings.
- settings shape, always normalized on return:
  - branding: { appName: string, tagline: string, accent: 'sage'|'lavender'|'peach'|'sky', theme: 'light'|'dark'|'system' }
  - profile: { address: string, email: string, taxId: string }
  - catalog: { productLabel: string, customerLabel: string, defaultUnit: string, units: string[], categories: string[] }
  - billing: { invoicePrefix: string, defaultCreditTermsDays: number, paymentMethods: ('cash'|'upi'|'bank_transfer'|'cheque')[], taxRate: number, footer: string }
  - modules: { reports: boolean, payments: boolean }
- GET /api/business/connections (OWNER only): { primary: { provider: 'openai'|'gemini'|'groq'|'custom', endpoint: string, model: string, hasApiKey: boolean }, fallback: same }. PATCH accepts primary/fallback with endpoint, model, provider, apiKey? (absent preserves; empty explicitly clears). Saved keys never returned; endpoints must not include credentials/query secrets. Provider configuration is prepared for deferred AI ingestion, not presented as active integration.
- GET /api/invoices for full list; GET /api/invoices/:id for detail (existing routes). Include invoice_prefix when feasible to preserve numbering after settings change.
- Blueprint export/import is performed in frontend using the validated PATCH business contract, excludes secrets, financial data, IDs, and device backend connection. Presets change settings only, never delete existing records.
- Currency changes on a business with financial history must be rejected to avoid relabeling balances.
- Browser backend endpoint is a device setting; a change clears auth before any request to the new origin.

## Done criteria
1. API integration tests use production routes/repositories on an isolated database; no historical destructive scripts.
2. Successful and failed saves, repeat equal-value invoices/payments, allocation limits, tenant boundaries and owner permissions verified.
3. Desktop/mobile browser flow: configure business, edit/archive/restore catalog/customer, order to invoice to payment, statement and blueprint round-trip.
4. Builds and typechecks pass, clear load/retry states, keyboard-accessible dialogs, coherent light/dark themes, no inactive button claiming success.
5. Document setup, blueprint reuse, supported verification, and remaining product boundaries; commit and push the verified result to the existing remote.

## Implementation outcome

The manual ledger, editable business configuration, safe blueprint import/export, provider configuration storage, and complete responsive UI are implemented. See [verification results](../VERIFICATION_2026-10-17.md) for the final checks and [README](../README.md) for setup and current product boundaries. Live WhatsApp/AI processing remains deferred.
