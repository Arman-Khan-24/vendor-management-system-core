# WhatsApp integration verification

Recorded 10 November 2026. Verified checkout: `/home/aakaa/work/orderledger`. Source snapshot: `0420439`; initial integration commit: `1a7a2fb`.

The localhost implementation is complete and tested with real Gemini text and photo requests. Source changes are delivered to `/media/d/Atkind work/orderledger`, preserving its pre-existing edits and original `.env`. Runtime on this Linux host uses the working checkout's Linux dependencies. Actual Meta account connection and WhatsApp delivery remain pending. Hosting is excluded from the current task.

## Five stages

| Stage | Delivered and checked | Remaining limitation |
|---|---|---|
| 1. Safe processing | Explicit unit conversion, strict AI validation, expiring price/tax quotes, locked/idempotent confirmation, transactional inbox/outbox, leases and retries; PostgreSQL rollback/concurrency tests pass | Unknown external delivery still needs owner review before retry |
| 2. AI credentials | Tenant-bound encrypted settings, precedence over environment defaults, real provider requests and fallback; existing Gemini key verified and configured for `gemini-2.5-flash` | Existing Groq key returned 401 `invalid_api_key`; local fallback is disabled |
| 3. Meta adapter | GET verification, exact raw-body HMAC, batched events scoped to WABA/number, real authenticated send/media requests, delivery receipts; HTTP/provider/database tests pass | No Meta credentials or live WhatsApp delivery test |
| 4. Text orders | Real Gemini extraction → converted quote → YES → one Received ledger order; repeated YES verified in browser and PostgreSQL | Browser input and captured replies are local |
| 5. Photo orders and localhost | Real PNG bytes → Gemini → validated catalog quantities → quote → YES → `whatsapp_image` order; one-command launcher, disposable business and local test form | Clear synthetic printed photo tested; handwriting/Hindi accuracy and real Meta media delivery need separate acceptance |

## Backend verification

`npm run test:compiled` completed with exit code 0. **84 passing test results, zero failures**, across these suites:

| Suite | Passing tests | Coverage |
|---|---:|---|
| Ledger API regression | 27 | Actual PostgreSQL routes/repositories, tenant/role boundaries, snapshots, FIFO/credit, concurrent order/invoice numbers, idempotency and rollback |
| Business settings integration | 4 | Persisted partial settings, encrypted tenant keys, currency lock after trading/payment |
| Business settings unit | 7 | Validation, defaults, safe endpoints, secret-free summaries, tenant/purpose encryption |
| Local demo | 4 | AI-only credential import, stable separate signing secret, cleared keys, no-network reply transport, loopback/origin protection and owner/tenant restrictions |
| Production configuration | 6 | Required database/secret configuration and placeholder rejection |
| Statement PDFs | 3 | Actual PDF bytes, pagination, bundled Hindi/Latin/currency font |
| WhatsApp PostgreSQL | 14 | Duplicate webhook, simultaneous/repeated YES, atomic rollback, quote expiry/prices, review, photo source, leases, delivery receipts, uncertain sending, service window, changed connection, cleared keys, and local transport flow |
| WhatsApp HTTP | 4 | Real Express challenge/signature parsing, persist-before-ack, tenant identity, owner permission and disabled/absent routes |
| WhatsApp/AI unit | 15 | Units/precision/ambiguity, bounded output, fallback, image bytes/context, HMAC, event scoping, send payloads, authenticated media restrictions and retry policy |

Database suites create their own temporary PostgreSQL instances and apply all seven migrations. They never use the application's business database. Provider responses in automated tests are mocked; real AI checks are recorded separately below.

Backend production build and frontend production build both passed. The frontend build includes its TypeScript check. JavaScript syntax and `git diff --check` passed. Linux dependencies were installed in the working checkout; original Windows dependency installations were preserved.

## Live Gemini browser acceptance

Chromium drove the actual React interface at `http://127.0.0.1:5174` against the local API at `http://127.0.0.1:5100`. The seeded disposable business uses encrypted, saved Gemini settings.

| Input/action | Observed result |
|---|---|
| Open localhost demo → WhatsApp inbox | Signed into the temporary business without entering a password; local form loaded |
| `Tomato 500 g` | Captured summary `Tomato — 0.5 kg`, total ₹20; zero orders before YES |
| YES | Order #1, Received, total ₹20, source `whatsapp_text` |
| Repeated YES | Already-confirmed reply; order count remained one |
| PNG with `Tomato 500 g` and `Onion 1 kg`, no caption | Captured summary 0.5 kg Tomato + 1 kg Onion, total ₹50; no additional order before YES |
| YES after photo summary | Order #2, Received, total ₹50, source `whatsapp_image`; both item quantities verified through the normal order API |
| Normal Orders page and Connections | Both Received orders visible at ₹20/₹50; primary key saved, fallback empty, and local-mode instructions visible |
| Desktop 1365px and mobile 360px | No horizontal document overflow; screenshots inspected |

No browser JavaScript errors occurred in these checks. A real direct Gemini request also returned HTTP 200. The saved Groq key returned HTTP 401 (`invalid_api_key`), and no alternative valid fallback key was found. Original source credentials remain intact; the private local configuration disables the invalid fallback.

Acceptance artifacts are under `/tmp/orderledger-local-*`; they are not committed. Browser session state is private. Captured outbound IDs use the local transport; **no actual WhatsApp message was sent**.

## Delivery and use

Run `node start-local.mjs` from the project root. Open **http://127.0.0.1:5174**, choose **Open localhost demo**, then **WhatsApp inbox**. [Localhost setup](LOCALHOST_SETUP.md) documents the credentials, sample catalog, temporary data and stopping/restarting.

The complete source patch is `/home/aakaa/work/orderledger-whatsapp.patch`, generated against snapshot `0420439`. It excludes credentials, dependency folders and build outputs. The patch was checked before applying to the D-drive project; pre-existing source/demo files and the original `.env` were checked for preservation. Do not reapply an already merged patch.

For real WhatsApp, [Meta setup](WHATSAPP_SETUP.md) lists the account credentials and HTTPS callback steps. The dedicated localhost launcher captures replies; use the standard or isolated server for Meta delivery. Remote deployment, CI execution on GitHub, real Meta media/download/delivery, recipient verification and a live business database migration were not performed.

## Earlier verification record

The initial `1a7a2fb` record established 35 unit/in-process/PDF checks. At that point socket restrictions prevented PostgreSQL/browser execution, dependencies were from Windows, and network access was unavailable. Those environment blockers were subsequently resolved with native Linux dependencies and unrestricted local execution. The 84 database-inclusive checks, production builds and real Gemini acceptance above supersede that earlier incomplete verification.
