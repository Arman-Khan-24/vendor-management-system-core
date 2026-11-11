# OrderLedger

A configurable order, invoice, and customer ledger for small wholesale businesses. React 19 + TypeScript + Vite on the frontend; Express + PostgreSQL on the backend. Each business has its own records and owner-managed settings.

The interface uses a cream workspace, dark sidebar, pastel billing summaries, and light/dark/system themes. Invoices have a landscape header, a clear item table, and a responsive action dock. Desktop page search and mobile navigation connect the same business workflows.

## Set up a business for a client

1. Create a separate business account for that client.
2. Open **Settings → Blueprints**. Choose Fresh produce, Grocery, Dairy, or Custom, or import a blueprint exported from another business. Review the preview, apply it, then save changes.
3. Set the business name, contact details, address, tax ID, logo URL, app name, and appearance.
4. Customize catalog/customer labels, categories, units, payment terms, payment methods, invoice prefix/footer, tax rate, and when an invoice is generated. Reports and new payment recording can be enabled or disabled.
5. Add products and customers, then complete a sample order, invoice, and payment before handover.

Blueprints copy configuration only. They exclude business identity/contact details, account IDs, products, customers, transactions, provider keys, and the device's backend connection. Importing a blueprint does not delete business records. Branding and workflow defaults can be reused; industry-specific features still require implementation.

### Everyday workflows

- **Catalog:** add/edit products, prices, units and categories; search/filter/sort; export CSV; archive and restore products.
- **Customers:** edit contact details and credit terms (including payment due immediately), archive/restore, collect payments, and open statements.
- **Orders and invoices:** enter explicit quantities in the product's unit; move orders through packing and delivery; inspect invoices and print/save them as PDF.
- **Payments:** record date, method, reference, and notes. Excess payment remains customer credit and can settle future invoices.
- **Statements and reports:** opening/closing balances, date filters, statement PDFs, CSV exports, dues aging, sales, collections, and rankings.

Archived products/customers remain in historical records. Orders and invoices preserve product names, prices, units, credit terms, tax, and invoice settings so subsequent catalog/settings edits do not rewrite them. Currency changes are blocked once financial activity exists.

Catalog, customer, order, payment, and invoice lists render 24 records per page. Searches and CSV exports cover all matching loaded records, and changing a filter resets pagination. The browser still fetches all records in API batches; this limits rendering work, not network transfer or total data held in memory. Currency formatters are reused, fonts are served locally, and short page transitions respect reduced-motion preferences.

### Connections

**Settings → Connections** lets the owner save and test Gemini/Groq extraction and Meta WhatsApp credentials. Keys are encrypted and never returned by the API. Leaving a key blank preserves it; the explicit clear option removes it. WhatsApp starts disabled for each business. Follow [WhatsApp setup in Documentation](docs/DOCUMENTATION.md#meta-whatsapp-cloud-api-integration) before enabling it. The old unauthenticated mock routes are absent.

The **WhatsApp inbox** shows incoming text/photo orders, extraction warnings, confirmation drafts and delivery states. Valid orders receive a summary; customers must reply YES before a ledger order is created. Owners can review unclear items and send a fresh summary. Jobs persist in PostgreSQL, including retries and processing leases; Redis is not required.

The backend API address is a browser/device setting, also available on the sign-in screen. A final `/api` is optional; blank uses the website's `/api` address. Use HTTPS for a remote server. Test the connection before signing in; changing servers clears the current login.

Database credentials, JWT secrets, and hosting settings belong in the server environment. Keep `JWT_SECRET` stable: it also protects stored provider keys. If it is rotated, users must sign in again and provider keys must be re-entered before future integration use.

## Run locally

For a ready-to-use WhatsApp order demo with real Gemini extraction and replies captured in the app, run this from the repository root:

```bash
node start-local.mjs
```

Open **http://127.0.0.1:5174**, click **Open localhost demo**, then **WhatsApp inbox**. This uses a temporary PostgreSQL database and the private AI configuration in `backend/.env.local`. The existing Gemini key was verified; the invalid Groq fallback is disabled. No Meta account or hosting is required. See [localhost demo setup in Documentation](docs/DOCUMENTATION.md#localhost-demo-with-gemini) for credentials, photo testing, and restarting.

### Persistent business database

Requires Node.js 22+ and PostgreSQL. Commands below use PowerShell from the repository root.

Backend, in one terminal:

```powershell
cd backend
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
# Edit .env: set DATABASE_URL and your own JWT_SECRET.
npm run dev
```

Create the database referenced by `DATABASE_URL` first. Startup applies the SQL migrations and stops if the database or migrations fail. The default API address is `http://localhost:5000`; `/health` verifies database migration readiness.

Frontend, in another terminal:

```powershell
cd frontend
npm ci
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` and `/health` to the default backend. To use a different backend, set `VITE_API_URL` before starting/building, or open **Settings → Server & API settings** in the interface. The connection test checks database readiness and API compatibility.

If you previously ran the local demo, `frontend/.env.local` points to port 5100. For the persistent backend on port 5000, set `$env:VITE_API_URL = 'http://localhost:5000'` before `npm run dev`, or select that server in the interface.

### Disposable demo and browser testing

The isolated server uses an embedded PostgreSQL database under the OS temporary directory. It does not use the application's `DATABASE_URL`. Its data is temporary; use normal PostgreSQL for a persistent business.

```powershell
# Terminal 1, from backend/ after npm ci
npm run dev:isolated

# Terminal 2, from frontend/ after npm ci
$env:VITE_API_URL = 'http://127.0.0.1:5100'
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

Open `http://127.0.0.1:5174`. Register a test account. Stop the isolated server with Ctrl+C when finished.

## Build and deploy

The repository uses only `main`. Both Vercel and Render must deploy that branch. For an existing Render service, set **Settings → Build & Deploy → Branch** to `main`; the blueprint's branch setting does not change a separately configured service automatically.

Backend: `npm ci`, `npm run build`, then `npm start` from `backend/`. The build copies SQL migrations and the licensed PDF font into `dist`. Generated `dist` files are ignored by Git and must be built on the host.

Frontend: run `npm ci` and `npm run build` from `frontend/`, with `VITE_API_URL` set to the HTTPS API address if the API is on another origin. Deploy `frontend/dist` to a static host; alternatively, route the site's `/api` and `/health` requests to the backend.

Deploy the backend before the matching frontend. `/health` must report `apiVersion: 2`, and authenticated `/api/business` must include `settings`. A successful health response from an older API does not prove it supports the current interface. The 18 October live incident and essential CRM backlog are documented in [CRM roadmap in Documentation](docs/DOCUMENTATION.md#2-essential-backlog--crm-roadmap).

`render.yaml` provisions the API service. Supply `DATABASE_URL`; Render generates `JWT_SECRET`. Production startup requires an explicit database URL and a secret of at least 32 characters without whitespace or known placeholder values. Generate a secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and store it securely. Keep the generated secret across redeployments.

Before updating an existing database, take a backup. Migrations `004_business_settings.sql` and `005_ledger_snapshots.sql` add settings and historical snapshots without deleting records. Old records are backfilled from the values available at migration time; names or terms changed before that migration cannot be reconstructed.

## Verification

From `backend/`:

```powershell
npm run test:compiled
npm run test:whatsapp
npm run typecheck:tests
npm run build
```

The supported tests exercise production routes/repositories against disposable PostgreSQL, plus settings/crypto/configuration and PDF checks. They never reuse the business database. The historical standalone `.mjs` diagnostics are not the supported suite; some contain destructive database operations or live provider calls.

From `frontend/`, while the disposable API and frontend above are running:

```powershell
npm run build
py -3 -m pip install playwright pypdf
py -3 -m playwright install chromium
py -3 scripts/ui_acceptance.py --stage all
py -3 scripts/ui_edge_cases.py
```

Use `python3` instead of `py -3` where appropriate. The edge-case script uses the account/state created by acceptance and the default loopback ports. Screenshots, PDFs, and synthetic account state stay in the OS temporary directory under `orderledger-ui-qa`, not in Git. Separate `setup`, `workflow`, and `responsive` stages are available for slower machines.

For the redesign checks and production-build measurements, keep the disposable API running. After the acceptance script above, build the frontend with `VITE_API_URL=http://127.0.0.1:5100` and start a preview in another terminal:

```powershell
npm run preview -- --host 127.0.0.1 --port 5175 --strictPort
```

Then run `py -3 scripts/ui_redesign.py` from `frontend/`. It checks dashboard actions, page search, eight screens at widths from 320px to 1440px in both themes, invoice focus/printing, and pagination/search/export with 1,000 fixture records per list. It records click-to-frame navigation measurements across five lists. The long invoice and large lists use intercepted GET responses; normal workflow checks use the disposable API. Artifacts stay under the OS temporary directory in `orderledger-redesign-qa`.

Run `py -3 scripts/ui_settings.py` against the same preview and disposable API for settings regressions. It creates a separate synthetic account and covers persistence, every theme/palette, concurrent independent changes, validation messages, connection drafts, database readiness, legacy APIs and failed saves. Its artifacts stay in the OS temporary directory under `orderledger-settings-qa`.

See the [technical audit and verification records in Documentation](docs/DOCUMENTATION.md#3-technical-audit--security-findings).

## Current boundaries

This is a configurable manual ledger foundation. It is not a complete solution for every industry. Tax is one order-wide percentage, not a complete GST filing/compliance system. Money and quantities support up to two decimal places; reporting calendar boundaries currently use UTC.

Inventory procurement/stock tracking, returns, credit notes, order cancellation, refunds, scheduled subscriptions, staff invitation, and password-reset flows are not implemented. WhatsApp supports customer-initiated text and JPEG/PNG orders; voice notes, documents and proactive template notifications are not implemented. Free-form replies require an open 24-hour customer service window. Quantities must convert exactly to two decimal places; unclear units, packaging and varieties require clarification.

See [WhatsApp verification details in Documentation](docs/DOCUMENTATION.md#5-verification--acceptance-history) for the completed database, build, and live Gemini localhost checks, and the actual Meta delivery checks still required.

Local acceptance does not verify a production deployment, external provider delivery, or migration of a particular customer's live database.
