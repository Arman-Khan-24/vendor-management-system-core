# OrderLedger — Phase 1 Core Ledger Handoff Document

**Project:** OrderLedger — Multi-Tenant B2B Vendor Management SaaS  
**Milestone:** Phase 1 (Core Ledger Engine & Cashew Design System)  
**Status:** Complete & Verified on Native PostgreSQL 18  

---

## 1. Architecture Summary

OrderLedger is architected as a **single-codebase, single-database, multi-tenant** B2B wholesale vendor operations platform. Every tenant record is scoped by `business_id`, verified at the database, repository, service, and middleware layers.

```
┌────────────────────────────────────────────────────────┐
│               Frontend (React 19 + Vite)              │
│  - Tailwind CSS Cashew-inspired Design System         │
│  - Dual-layout App Shell (Desktop Rail + Mobile Nav)   │
│  - Optimistic UI, Status Pills, Modals, Ledgers       │
└──────────────────────────┬─────────────────────────────┘
                           │ REST (JWT Bearer Auth)
┌──────────────────────────▼─────────────────────────────┐
│             Backend (Node.js + Express + TS)          │
│  - authenticateUser Middleware (Scopes business_id)    │
│  - Services: Auth, Order, Dashboard                    │
│  - Repositories: Strict businessId isolation queries   │
│  - Transactional FIFO Payment Allocation Engine        │
└──────────────────────────┬─────────────────────────────┘
                           │ node-postgres (pg.Pool)
┌──────────────────────────▼─────────────────────────────┐
│          Database: Native PostgreSQL 18.4              │
│  - 001_initial_schema.sql applied directly             │
│  - Composite Foreign Keys enforcing same-tenant refs   │
│  - Row Locking (`FOR UPDATE`) on concurrent allocations│
│  - Generated columns, snapshots, unique tenant numbers │
└────────────────────────────────────────────────────────┘
```

---

## 2. Database Schema & Multi-Tenant Isolation

Database migrations run directly via `DATABASE_URL` targeting native PostgreSQL. No SQLite, PGlite, or dual-database fallbacks exist in production paths.

### Key Schema Tables & Tenant Guarantees
1. **`businesses`**:
   - `id UUID PRIMARY KEY`, `name`, `slug UNIQUE`, `category_template`, `invoice_sequence INT DEFAULT 0`, `order_sequence INT DEFAULT 0`.
2. **`users`**:
   - `(business_id, email)` composite unique key (`uq_users_business_email`).
   - Role-based authorization: `owner`, `staff`, `delivery`.
3. **`customers`**:
   - `(business_id, id)` composite uniqueness (`uq_customers_business_id`).
   - `credit_terms_days`, `phone`, `business_id`.
4. **`products`**:
   - `(business_id, id)` composite uniqueness (`uq_products_business_id`).
   - `name`, `unit`, `current_price`, `business_id`.
5. **`orders` & `order_items`**:
   - `fk_orders_customer_same_business`: Foreign key from `orders(business_id, customer_id)` $\rightarrow$ `customers(business_id, id)`. Prevents cross-tenant customer references at the database constraint level.
   - `fk_order_items_product_same_business`: Foreign key from `order_items(business_id, product_id)` $\rightarrow$ `products(business_id, id)`.
   - `order_items.unit_price_at_order`: Frozen price snapshot at order creation.
   - State machine: `Received` $\rightarrow$ `Packed` $\rightarrow$ `Delivered`.
6. **`invoices`**:
   - Sequential tenant-scoped numbers (`INV-0001`, `INV-0002`).
   - Generated dynamically on configured trigger (default: on `Delivered`).
   - Statuses: `Pending`, `Partial`, `Paid`.
7. **`payments` & `payment_allocations`**:
   - `payment_allocations (id, business_id, payment_id, invoice_id, amount)`.
   - `fk_allocations_payment_same_business` & `fk_allocations_invoice_same_business`: Guarantee allocations strictly reference the same tenant's payments and invoices.
   - Transactional FIFO engine with row-locking (`SELECT ... FOR UPDATE`) prevents concurrent over-allocation.

---

## 3. Implemented Features (Phase 1)

| Area | Feature | Description |
|---|---|---|
| **Auth** | Multi-tenant Registration & JWT | Automatic business creation, owner setup, and category template product seeding (`fruits_veg`, `dairy`, `grocery`). |
| **Catalog** | Configurable Products | Dynamic units (kg, bunch, crate, litre), current prices, and categories without hardcoded logic. |
| **Customers** | Wholesale Profiles | Contact info, credit limits, credit terms, and real-time ledger debit/credit balances. |
| **Orders** | Core Lifecycle Engine | `Received` $\rightarrow$ `Packed` $\rightarrow$ `Delivered` state machine; price freezing; order timeline events. |
| **Invoicing** | Trigger-based Invoicing | Sequential zero-padded tenant invoice numbers generated upon order fulfillment. |
| **Payments** | FIFO Allocation Engine | Row-locked PostgreSQL transactions automatically allocating payments across oldest pending invoices. |
| **Ledger** | Running Balance Statement | Chronological debit/credit statement calculation showing exact running balance per customer. |
| **Dashboard** | Real-time Metrics | Today's sales, active orders, today's collections, total outstanding balance, and pending invoice alert lists. |
| **UX / UI** | Cashew Design System | Rounded 24px/32px containers, subtle shadows, status badges, desktop sidebar rail, and mobile bottom navigation. |

---

## 4. API Endpoints

### Auth
- `POST /api/auth/register` — Register business & owner account.
- `POST /api/auth/login` — Login with business slug/email/password.
- `GET /api/auth/me` — Authenticated session check.

### Products
- `GET /api/products` — List catalog products for tenant.
- `POST /api/products` — Create new product with price and unit.
- `PATCH /api/products/:id` — Update product details / price.

### Customers
- `GET /api/customers` — List customers with ledger balances.
- `POST /api/customers` — Create customer profile.
- `GET /api/customers/:id` — Get single customer.
- `GET /api/customers/:id/statement` — Generate running balance statement.

### Orders
- `GET /api/orders` — List orders (filterable by status/date).
- `POST /api/orders` — Create manual order with line items (prices snapshot).
- `GET /api/orders/:id` — Get order detail, items, and timeline events.
- `PATCH /api/orders/:id/status` — Advance status (`Packed`, `Delivered`).

### Invoices
- `GET /api/invoices` — List invoices with payment allocation status.
- `GET /api/invoices/:id` — Get invoice details and line items.

### Payments
- `GET /api/payments` — List payments for tenant.
- `POST /api/payments` — Record payment with transactional FIFO allocation.

### Dashboard
- `GET /api/dashboard/summary` — Aggregate revenue, order counts, and receivables.

---

## 5. Automated Verification Results

All tests executed directly against native PostgreSQL 18.4 (`localhost:5433`) and live backend API:

```
> orderledger-backend@1.0.0 typecheck (0 errors)
> orderledger-backend@1.0.0 build     (tsc success)
> orderledger-frontend@1.0.0 typecheck (0 errors)
> orderledger-frontend@1.0.0 build    (vite built in 39s)
```

### Full 13-Step Acceptance Journey & Cross-Tenant Test
| Step | Verification Action | Result | Notes |
|---|---|---|---|
| **1** | Register Business 1 | `PASS` | Unique business slug, owner, and JWT created. |
| **2** | Catalog Seed Verification | `PASS` | 4 default items verified (e.g. Tomato ₹40/kg). |
| **3** | Create Customer Profile | `PASS` | Taj Gateway Restaurant created with 7-day credit terms. |
| **4** | Create Order & Price Freeze | `PASS` | Order #1 created, ₹1000 total, status `Received`, prices frozen. |
| **5** | Status $\rightarrow$ Packed | `PASS` | State updated, timeline event recorded. |
| **6** | Status $\rightarrow$ Delivered | `PASS` | State updated to final delivery milestone. |
| **7** | Invoice Auto-Generation | `PASS` | `INV-0001` generated, status `Pending`, total ₹1000. |
| **8** | Partial Payment (₹400) | `PASS` | Allocated ₹400 via FIFO; invoice status $\rightarrow$ `Partial` (Due: ₹600). |
| **9** | Remaining Payment (₹600) | `PASS` | Allocated ₹600 via FIFO; invoice status $\rightarrow$ `Paid` (Due: ₹0). |
| **10** | Balance Reconciliation | `PASS` | Customer ledger shows Billed=₹1000, Paid=₹1000, Outstanding=₹0. |
| **11** | Customer Running Statement | `PASS` | 3 ledger entries verified with matching running balance drops. |
| **12** | Dashboard Summary | `PASS` | Sales=₹1000, Orders=1, Collected=₹1000, Outstanding=₹0. |
| **13** | Strict Tenant Isolation | `PASS` | Business 2 cannot view Business 1 customers (0 returned) and receives 404 on direct order/invoice IDs. |

---

## 6. Known Scope Boundaries & Deferred Items

In accordance with explicit instructions, the following capabilities are **intentionally excluded** from Phase 1:
1. **AI Extraction Engines**: Multimodal Gemini API, Groq fallback, prompt extraction, confidence scoring, and review staging queue.
2. **WhatsApp Integrations**: Gupshup/Interakt/Wati BSP webhooks and outbound messaging adapters.
3. **Async BullMQ Workers**: Redis queue workers for asynchronous background processing.
4. **Automated Reminders**: Cron-scheduled payment reminder triggers.
5. **PDF Statement / Invoice Downloads**: Puppeteer-based server-side PDF generator (deferred to Phase 2).

---

## 7. Exact Next Step for Phase 2

Proceed to **Phase 2: Advanced Reporting & PDF Statement Generation**:
1. Implement the server-side PDF invoice and statement rendering engine using Puppeteer and clean HTML/CSS templates.
2. Add PDF download / share links in the customer statement modal and invoice view.
3. Add date-range filtering, customer aging reports (0-7 days, 8-15 days, 30+ days), and ledger reconciliation exports.
