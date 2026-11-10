# OrderLedger — Phase 3 WhatsApp Text Order Ingestion & AI Handoff

**Project:** OrderLedger — Multi-Tenant B2B Vendor Management SaaS  
**Milestone:** Phase 3 (WhatsApp Text Order Ingestion + Multimodal AI Abstraction & Confirmation Flow)  
**Status:** 100% Complete & Verified on Native PostgreSQL 18  

---

## 1. Architecture Summary

Phase 3 introduces an automated text ingestion and entity extraction pipeline that allows wholesale customers to send free-form WhatsApp orders while keeping order creation strictly vendor-safe and confirmation-gated.

```
┌────────────────────────────────────────────────────────┐
│             Customer (Normal WhatsApp Text)            │
│  "tom 20kg \n pot 10kg \n banana 5 doz"                │
└──────────────────────────┬─────────────────────────────┘
                           │ POST webhook (< 5s response)
┌──────────────────────────▼─────────────────────────────┐
│      POST /webhooks/whatsapp/:businessId               │
│  - Verify provider authenticity                        │
│  - Match sender phone to customers table               │
│  - Idempotent deduplication in whatsapp_messages       │
│  - Enqueue extraction job immediately (< 5s)           │
└──────────────────────────┬─────────────────────────────┘
                           │ BullMQ Queue / Async Engine
┌──────────────────────────▼─────────────────────────────┐
│          OrderExtractionJob Worker Pipeline            │
│  1. Retrieve tenant-scoped catalog items               │
│  2. Multimodal AI Extraction (Gemini → Groq Fallback)  │
│  3. Deterministic Catalog Matching (Shorthands/Units)  │
│  4. Validation & Ambiguity Detection                   │
│  5. Store in pending_order_confirmations               │
│  6. Outbound WhatsApp: "Reply YES to confirm"          │
└──────────────────────────┬─────────────────────────────┘
                           │ Customer Replies YES
┌──────────────────────────▼─────────────────────────────┐
│           Core Ledger Sequential Execution             │
│  - Idempotent YES verification                         │
│  - Order created: status = 'Received',                 │
│    source = 'whatsapp_text', confirmed_at = NOW()      │
│  - Frozen price snapshot stored                        │
│  - Plugs into existing Core Ledger lifecycle:          │
│    Received → Packed → Delivered → Invoice → Payment   │
└────────────────────────────────────────────────────────┘
```

---

## 2. WhatsApp Provider Abstraction

All WhatsApp operations are decoupled through the `IWhatsAppProvider` interface ([whatsapp.provider.ts](file:///d:/Atkind%20work/orderledger/backend/src/services/whatsapp/whatsapp.provider.ts)):
- `verifyWebhook(req)`: Authenticates provider signatures/headers.
- `parseInbound(req)`: Normalizes provider-specific payloads into standard phone and text structures.
- `sendTextMessage(toPhone, text)`: Sends conversational confirmation and notification messages.

### Supported Providers
- **`MockWhatsAppProvider`**: In-memory inspection provider for testing and offline environments.
- **`GenericBspWhatsAppProvider`**: Production adapter configurable for Gupshup, Interakt, Wati, or Meta Cloud API via environment variables.

---

## 3. Multimodal AI Abstraction & Economical Inference

The AI pipeline is implemented in [ai.service.ts](file:///d:/Atkind%20work/orderledger/backend/src/services/ai/ai.service.ts) and conforms to `IOrderExtractionProvider`:
- **Primary Provider**: Gemini API (`gemini-1.5-flash` or configurable model).
- **Fallback Provider**: Groq (`llama-3.3-70b-versatile` or configurable model).
- **Structured JSON Contract**: Model is supplied with tenant catalog names and units; outputs strict JSON `{ items: [{ product, quantity, unit }], warnings: [] }`.
- **Inference Economy**: Exactly **1 AI inference** is used per order text. Price calculations, totals, customer lookup, and status transitions remain deterministic backend operations.
- **Double-Failure Handling**: If Gemini and Groq fail, orders are never created in an invalid state. The customer is politely notified and the raw message is preserved for vendor review.

---

## 4. Deterministic Catalog Matching & Confirmation State Machine

Implemented in [catalog.matcher.ts](file:///d:/Atkind%20work/orderledger/backend/src/services/ai/catalog.matcher.ts):
- **Shorthand & Typo Resolution**: Resolves `tom` $\rightarrow$ `Tomato (Hybrid)`, `pot` $\rightarrow$ `Potato (Jyoti)`.
- **Ambiguous Product Detection**: If multiple products match (e.g. `Tomato (Hybrid)` vs `Tomato (Country/Naati)`), the system **does not guess**. It flags the item as ambiguous and asks the customer for clarification.
- **Mandatory Confirmation**: Parsed orders are saved in `pending_order_confirmations`. Actual `orders` records are created **only after customer responds YES**.
- **Correction Loop**: Customers can reply with adjustments (e.g., `"make tomato 25kg"`). The system updates the pending confirmation and re-sends the updated list without infinite loops.
- **Idempotency**: Duplicate webhook payloads with the same `provider_message_id` and repeated `YES` replies are deduplicated without creating duplicate orders.

---

## 5. Environment Variables

```env
# WhatsApp Provider Configuration
WHATSAPP_PROVIDER=mock            # 'mock' | 'gupshup' | 'interakt' | 'wati'
WHATSAPP_API_KEY=your_bsp_key
WHATSAPP_WEBHOOK_SECRET=your_webhook_secret

# AI Providers Configuration
AI_PRIMARY_PROVIDER=gemini        # 'gemini' | 'groq'
AI_PRIMARY_MODEL=gemini-1.5-flash
AI_PRIMARY_API_KEY=your_gemini_api_key

AI_FALLBACK_PROVIDER=groq
AI_FALLBACK_MODEL=llama-3.3-70b-versatile
AI_FALLBACK_API_KEY=your_groq_api_key

# Redis BullMQ Queue (Optional - falls back to async direct engine)
REDIS_URL=redis://localhost:6379
```

---

## 6. Endpoints (Phase 3 Additions)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/webhooks/whatsapp/:businessId` | Public provider webhook. Ingests incoming text, matches customer by sender phone, deduplicates message ID, and enqueues background extraction job (< 5s response). |
| `GET` | `/api/whatsapp/messages` | Inspection endpoint retrieving outbound WhatsApp messages sent by the provider. |
| `POST` | `/api/whatsapp/messages/clear` | Clears outbound message audit buffer for test isolation. |

---

## 7. Automated Test Verification Results

All suites executed directly against native PostgreSQL 18.4 (`localhost:5433`):

```
> orderledger-backend: npm run typecheck  -> 0 errors
> orderledger-backend: npm run build      -> tsc exit 0
> orderledger-frontend: npm run typecheck -> 0 errors
> orderledger-frontend: npm run build     -> vite build exit 0 (dist/assets: 316kB)
```

### 1. Phase 3 Test Suite (`phase3_acceptance.mjs`)
1. **Tenant & Catalog Setup**: Verified (`Taj Gateway Restaurant`, `Tomato`, `Potato`, `Banana`).
2. **Unknown Sender Phone**: Verified; unknown numbers are rejected safely without creating orders.
3. **Incoming WhatsApp Scenario (`tom 20kg, pot 10kg, banana 5 doz`)**: Verified.
4. **Outbound Confirmation Sent**: Verified (`Reply YES to confirm`).
5. **No Order Before YES**: Verified; 0 orders in database prior to confirmation.
6. **Customer Correction Flow (`make tomato 25kg`)**: Verified; updated confirmation sent.
7. **Customer YES Flow**: Verified; Order #1 created with `source = 'whatsapp_text'`.
8. **Idempotency Protection**: Verified; duplicate webhooks and repeat `YES` messages do not create duplicate orders.
9. **Ambiguous Product Handling**: Verified; asks customer for clarification instead of guessing.
10. **Gemini $\rightarrow$ Groq Fallback Engine**: Verified.
11. **Both Providers Fail Handling**: Verified safe handling without state corruption.
12. **Core Ledger Full Lifecycle**: Verified; order advances `Received` $\rightarrow$ `Packed` $\rightarrow$ `Delivered` $\rightarrow$ Invoice $\rightarrow$ ₹0 Balance.
13. **Strict Multi-Tenant Isolation**: Verified; customer phones from Tenant A are treated as unmatched under Tenant B.

### 2. Regression Suites
- **Phase 1 Acceptance Suite (`e2e_acceptance.mjs`)**: **13/13 steps passed**.
- **Phase 2 Acceptance Suite (`phase2_acceptance.mjs`)**: **12/12 steps passed**.

---

## 8. Known Scope Boundaries & Phase 4 Roadmap

### Excluded from Phase 3 (As Instructed)
- WhatsApp image and photo order ingestion.
- Multimodal OCR and handwritten notebook extraction.
- Automatic payment reminders via WhatsApp.
- Daily price broadcast lists.

### Exact Next Steps for Phase 4 (Image / Vision Ingestion & OCR)
1. Add `downloadMedia()` support to the WhatsApp adapter.
2. Extend `OrderExtractionProvider` to accept image buffers/MIME types for Gemini Vision API.
3. Support photo orders (handwritten order pads, notebook photos, printed slips).
4. Add staged image preview and side-by-side parsing verification in the vendor dashboard.
