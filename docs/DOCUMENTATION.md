# OrderLedger — Complete Technical Reference & Documentation

This document consolidates all historical phase milestones, security reviews, essential CRM roadmaps, and setup instructions into a single unified reference.

---

## Table of Contents
1. [System Setup & Running Locally](#1-system-setup--running-locally)
   - [Localhost Demo with Gemini](#localhost-demo-with-gemini)
   - [AI Provider Configuration (Gemini & Groq)](#ai-provider-configuration)
   - [Meta WhatsApp Cloud API Integration](#meta-whatsapp-cloud-api-integration)
   - [Public Webhook & Tunnel Setup](#public-webhook--tunnel-setup)
2. [Essential Backlog & CRM Roadmap](#2-essential-backlog--crm-roadmap)
   - [Live Incident & Deployment Checks](#live-incident--deployment-checks)
   - [P0: Deployment Recovery & Financial Corrections](#p0-deployment-recovery--financial-corrections)
   - [P0: Account Reliability & Security](#p0-account-reliability--security)
   - [P1: CRM Features & Staff Management](#p1-crm-features--staff-management)
   - [P1: Inventory & Local Accounting (GST / Timezone)](#p1-inventory--local-accounting)
3. [Technical Audit & Security Findings](#3-technical-audit--security-findings)
   - [Remediation Overview](#remediation-overview)
   - [WhatsApp Authentication & Webhook Verification](#whatsapp-authentication--webhook-verification)
   - [Unit Conversions & Ambiguity Safety](#unit-conversions--ambiguity-safety)
   - [Concurrency, Locks & Numbering](#concurrency-locks--numbering)
   - [Payment Allocations & Credit Ledger](#payment-allocations--credit-ledger)
4. [Architecture Milestones (Phases 1–4)](#4-architecture-milestones-phases-14)
   - [Phase 1: Multi-Tenant Core Ledger & FIFO Engine](#phase-1-multi-tenant-core-ledger--fifo-engine)
   - [Phase 2: Reporting, Statements & Server-Side PDF](#phase-2-reporting-statements--server-side-pdf)
   - [Phase 3: AI Order Extraction Pipeline](#phase-3-ai-order-extraction-pipeline)
   - [Phase 4: Multimodal Vision, Devanagari Hindi & UTF-8 Database](#phase-4-multimodal-vision-devanagari-hindi--utf-8-database)
5. [Verification & Acceptance History](#5-verification--acceptance-history)
   - [WhatsApp & Localhost Acceptance (10 Nov 2026)](#whatsapp--localhost-acceptance-10-nov-2026)
   - [Ledger & Mobile Reliability Acceptance (17–18 Oct 2026)](#ledger--mobile-reliability-acceptance-1718-oct-2026)

---

## 1. System Setup & Running Locally

### Localhost Demo with Gemini
Requires Node.js 22 or newer. The launcher installs missing dependencies, starts a temporary PostgreSQL database, and opens the frontend and API on loopback addresses. No PostgreSQL account or hosting service is needed.

From the project root:
```bash
node start-local.mjs
```
Open **http://127.0.0.1:5174**, click **Open localhost demo**, then open **WhatsApp inbox**. The API runs on **http://127.0.0.1:5100**. Ctrl+C stops both servers and removes the temporary database.

#### Credentials
The project's Gemini key is verified with real requests and configured privately in `backend/.env.local`. Text and photo extraction use `gemini-2.5-flash`. The saved Groq key returned HTTP 401 (`invalid_api_key`), so Groq fallback is disabled in local test configuration until a replacement key is configured.

The launcher imports AI keys and model settings from `backend/.env` when a local value is missing. It generates a separate signing secret and preserves that local secret on subsequent runs. To import AI settings from a different file on first run:
```bash
node start-local.mjs --env-source "/path/to/private.env"
```

#### Local Order Flow
The disposable **OrderLedger Local Test** business includes **Demo Restaurant** and sample catalog:
- Tomato (kg, ₹40)
- Onion (kg, ₹30)
- Rice (kg, ₹60)
- Milk (litre, ₹55)
- Eggs (dozen, ₹72)

1. Send `Tomato 500 g` via the local test form. Wait for the captured `Tomato — 0.5 kg`, `₹20` quote. Zero orders are created before confirmation.
2. Send `YES`. One `Received` order is created with source `whatsapp_text`. Sending `YES` again triggers the idempotency duplicate guard.
3. Upload an order photo (e.g., `Tomato 500 g` and `Onion 1 kg`). Gemini extracts the items, produces a quote, and creates a `whatsapp_image` order upon customer `YES`.
4. Ambiguous products (e.g. generic "tomato" when multiple varieties exist) prompt for customer clarification before confirmation.

---

### AI Provider Configuration
In **Settings → Connections → AI provider connections**:
* **Primary Provider**: Gemini (`https://generativelanguage.googleapis.com/v1beta`, model `gemini-2.5-flash`).
* **Fallback Provider**: Groq (`https://api.groq.com/openai/v1`, model supporting multimodal vision like `qwen/qwen3.8-27b`).

Saved business configurations override global environment defaults. Saved keys are encrypted with AES-256-GCM and never returned by the API.

---

### Meta WhatsApp Cloud API Integration
For real WhatsApp delivery:
1. Log into [Meta's WhatsApp developer hub](https://whatsappbusiness.com/developers/developer-hub/) and create a developer app with WhatsApp access.
2. Add your phone number as a verified test recipient in development mode.
3. Obtain:
   - **Phone Number ID** (distinct from telephone number)
   - **WhatsApp Business Account ID (WABA ID)**
   - **System User Access Token** (Bearer token for Graph API)
   - **App Secret** (for HMAC-SHA256 signature verification)
   - **Webhook Verify Token** (a random 32-byte secret generated by you)

Generate a secure verify token:
```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

---

### Public Webhook & Tunnel Setup
Meta cannot call `localhost`. Expose the backend via HTTPS tunnel (e.g., ngrok):
```bash
ngrok http 5100
```
Configure the webhook in Meta App Dashboard:
* **Callback URL**: `https://YOUR-PUBLIC-URL/webhooks/whatsapp/YOUR-BUSINESS-UUID`
* **Verify Token**: Must match the token entered in OrderLedger settings.
* **Webhook Subscription**: Subscribe to the `messages` event.

---

## 2. Essential Backlog & CRM Roadmap

### Live Incident & Deployment Checks
The deployed frontend (Vercel) and backend (Render) previously drifted out of sync when settings migrations 004–006 were pending on the production API.

Required checks before declaring production ready:
1. `GET /health` returns `status: "ok"`, `apiVersion: 2`, and `capabilities.idempotentWrites: true`.
2. Authenticated `GET /api/business` returns normalized settings.
3. `GET /api/business/connections` returns provider slots with `hasApiKey: boolean` (never raw keys).
4. Settings saves survive tab reloads and browser restarts.

---

### Priority Backlog

| Priority | Area | Required Implementation |
|---|---|---|
| **P0** | **Disaster Recovery** | Scheduled PostgreSQL backups; verified restore rehearsal to a separate database; readiness alerting on `/health`. |
| **P0** | **Financial Corrections** | Compensating records for Order Cancellations, Item Returns, Credit Notes, and Payment Reversals/Refunds. Reconcile customer balances and reports without deleting issued financial history. |
| **P0** | **Authentication Security** | Password recovery / forgot-password email flow, login rate-limiting / brute-force throttling, and session revocation / token blacklisting. |
| **P1** | **CRM Capabilities** | Customer delivery & billing addresses, contact persons, sales notes, promised payment dates, and overdue follow-up task lists. |
| **P1** | **Staff Management** | Owner UI to invite team members, assign roles (`OWNER`, `STAFF`, `DELIVERY`), view activity logs, and revoke access instantly. |
| **P1** | **Receipts & Collection** | Shareable PDF/WhatsApp payment receipts, collection reminders, and payment commitment dates. |
| **P1** | **Local Accounting (GST)** | Indian business timezone (`Asia/Kolkata`) for date/midnight boundaries; full GST compliance (CGST, SGST, IGST, HSN/SAC codes, GSTIN validation). |
| **P1** | **Inventory Tracking** | Stock receipts, deduction on delivery, returns/adjustments, low-stock warnings, and purchase orders. |
| **P2** | **Scalability** | Server-side pagination, search, and filtering for ledgers with > 1,000 active records. |

---

## 3. Technical Audit & Security Findings

### Remediation Overview
An audit conducted in October 2026 remediated critical data integrity issues:
* **Save field mapping**: Prevents independent settings tabs from overwriting concurrent changes.
* **Sequential numbering**: Row-level locking on business tenant rows prevents invoice and order number collisions.
* **Atomic transitions**: Order status change and required invoice creation are coordinated in a single PostgreSQL transaction.
* **FIFO allocation bounds**: Payment allocations are capped against the locked invoice balance; remainder is safely retained as customer credit.
* **PDF rendering**: Migrated to server-side PDFKit with bundled Noto Sans Devanagari fonts, eliminating external runtime Puppeteer crashes.

### WhatsApp Webhook Security
* Raw-body cryptographic HMAC-SHA256 verification prevents forged webhooks.
* Public mock-message endpoints were removed from production paths.
* Inbound payloads are verified against the registered business WABA ID and Phone Number ID.

### Unit Conversions & Ambiguity Safety
* If a customer orders in `grams` and the catalog is in `kg`, explicit conversion converts quantities to catalog base units.
* If a customer mentions a generic name (e.g. "tomato") where multiple catalog varieties exist (e.g. "Tomato Hybrid" vs "Tomato Naati"), the system **never guesses**. The order is held in `pending_order_confirmations` and a clarification message is sent via WhatsApp.
* Concurrency guard: Confirming an order via `YES` uses transactional locks (`SELECT ... FOR UPDATE`) to prevent race conditions from duplicate webhook deliveries.

---

## 4. Architecture Milestones (Phases 1–4)

### Phase 1: Multi-Tenant Core Ledger & FIFO Engine
* **Multi-tenant scoping**: Every database query filters by `business_id = $authenticatedBusinessId`. Composite foreign keys enforce tenant boundaries at the database constraint level.
* **Order Lifecycle**: `Received` $\rightarrow$ `Packed` $\rightarrow$ `Delivered`.
* **Price Snapshots**: `order_items` stores frozen `unit_price_at_order` to preserve historical integrity against future catalog price edits.
* **FIFO Payment Engine**: Automatically distributes payments across the oldest open invoices using row-level locking.

### Phase 2: Reporting, Statements & Server-Side PDF
* **Dues & Aging**: Aging distribution brackets (`Current`, `1–7d`, `8–15d`, `16–30d`, `30+d`).
* **Sales & Collections**: Time-series sales aggregation by day, week, or month; collection breakdown by mode (cash, UPI, bank transfer, cheque).
* **Customer Statements**: Chronological ledger calculation tracking debits (invoices), credits (payments), and running balance.
* **Statement PDF**: Generates pixel-perfect PDFs with business branding, credit terms, and item tables.

### Phase 3: AI Order Extraction Pipeline
* **Confirmation-Gated Workflow**: AI extraction **never** directly creates orders. Parsed items are placed in `pending_order_confirmations`. The customer must reply `YES` before an actual order is created.
* **Correction Loop**: Customers can reply with changes (e.g., `"make tomato 10kg"`), updating the quote without duplicate order creation.
* **Dual AI Providers**: Gemini as primary; Groq as automated fallback upon 429/503 errors.

### Phase 4: Multimodal Vision, Devanagari Hindi & UTF-8 Database
* **Multimodal Vision**: Inspects photos of handwritten order pads, whiteboard chits, printed receipts, and kitchen slips.
* **Devanagari & Romanized Hindi**: Supports terms such as `टमाटर` / `tamatar`, `प्याज़` / `pyaz`, `आलू` / `aalu`, `भिंडी`, `केला` and units like `किलो`, `दर्जन`.
* **Native UTF-8 PostgreSQL**: Clean database collation preserving Devanagari text in orders, invoices, and audit logs without unicode escape mangling.

---

## 5. Verification & Acceptance History

### WhatsApp & Localhost Acceptance (10 Nov 2026)
* **Backend Test Suite**: 84 passing test results across 9 suites (Ledger API, Business Settings, WhatsApp DB, WhatsApp HTTP, Unit conversions, Local demo).
* **Live Gemini Browser Acceptance**: Verified in Chromium against local API:
  - Text order `"Tomato 500 g"` $\rightarrow$ Quote `Tomato — 0.5 kg, ₹20` $\rightarrow$ `YES` $\rightarrow$ Created Order #1 (`source: whatsapp_text`).
  - Repeat `YES` $\rightarrow$ Deduplicated without extra order.
  - Photo order containing Tomato & Onion $\rightarrow$ Quote ₹50 $\rightarrow$ `YES` $\rightarrow$ Created Order #2 (`source: whatsapp_image`).
* **Builds**: Backend TypeScript build and Frontend Vite build passed with zero errors.

### Ledger & Mobile Reliability Acceptance (17–18 Oct 2026)
* **Settings & Blueprints**: 26 check groups passed verifying theme switching, blueprint imports (Produce, Grocery, Dairy), partial updates, and legacy API detection.
* **Ledger Concurrency**: Verified simultaneous order and invoice number allocation, credit balance rollover, and backdated payment reporting.
* **Responsive Layouts**: Verified 8 screen widths from 320px (mobile) to 1440px (desktop) across light and dark modes with zero horizontal overflow.
