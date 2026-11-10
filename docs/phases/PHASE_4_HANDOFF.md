# OrderLedger — Phase 4 Multimodal Vision Order Ingestion & Robustness Handoff

**Project:** OrderLedger — Multi-Tenant B2B Vendor Management SaaS  
**Milestone:** Phase 4 (WhatsApp Vision Order Extraction, Devanagari Hindi Script, Ambiguity Guardrails, Verified Groq Fallback & Native UTF-8 Database)  
**Status:** 100% Complete & Verified on Native PostgreSQL 18 (UTF-8)

---

## 1. Architecture Summary

Phase 4 extends the OrderLedger automated order ingestion pipeline from text-only messages to handwritten notebook photos, whiteboard chits, printed order slips, and mixed-language orders.

```
┌────────────────────────────────────────────────────────┐
│     Customer (Photo of Order Pad / Devanagari Note)    │
│     "टमाटर 10 किलो, प्याज़ 5 किलो, आलू 15 किलो"       │
└──────────────────────────┬─────────────────────────────┘
                           │ POST /webhooks/whatsapp/:businessId (image payload)
┌──────────────────────────▼─────────────────────────────┐
│             WhatsApp Webhook Receiver                  │
│  - Verifies webhook & normalizes media attachment      │
│  - Resolves customer phone to tenant record            │
│  - Enqueues background image extraction job (< 5s)     │
└──────────────────────────┬─────────────────────────────┘
                           │ Async Worker
┌──────────────────────────▼─────────────────────────────┐
│           Dual-Engine Multimodal Vision Pipeline       │
│  Primary:  Gemini (gemini-3.1-flash-lite / 2.5-flash)  │
│  Fallback: Groq (qwen/qwen3.8-27b Multimodal Vision)   │
│  Rule: NEVER guess generic items (e.g. "tomato")       │
└──────────────────────────┬─────────────────────────────┘
                           │ Raw JSON extraction
┌──────────────────────────▼─────────────────────────────┐
│          Deterministic CatalogMatcher Backstop         │
│  - Resolves Devanagari & Roman terms (टमाटर, aalu)     │
│  - If candidates > 1 -> status: 'AMBIGUOUS'            │
│  - isValid: false (HARD DB BLOCK: Cannot insert order) │
│  - Clarification sent: "Tomato Hybrid vs Naati?"       │
└──────────────────────────┬─────────────────────────────┘
                           │ Customer Clarifies & Replies YES
┌──────────────────────────▼─────────────────────────────┐
│             Native UTF-8 PostgreSQL Storage            │
│  - Database recreated with ENCODING 'UTF8' LC_COLLATE C│
│  - Orders, items, invoices, and audits store pristine   │
│    Devanagari text ("टमाटर") with ZERO string mangling │
└────────────────────────────────────────────────────────┘
```

---

## 2. Key Components Built in Phase 4

### A. Dual-Engine Multimodal AI Pipeline ([ai.service.ts](file:///d:/Atkind%20work/orderledger/backend/src/services/ai/ai.service.ts))
- **Primary Vision Engine:** Google Gemini (`gemini-3.1-flash-lite` / `gemini-2.5-flash`). Configured with exponential retry backoff on transient HTTP 429/503 errors.
- **Fallback Vision Engine:** Groq Cloud running `qwen/qwen3.8-27b` (Multimodal Vision 27B parameter model, 131K context window, 200 OK live verified).
- **Automated Failover:** Any 400/403/404/429/503 from Gemini automatically triggers Groq takeover in < 1.2s.
- **Audit Logging:** Every inference logs `primary_provider`, `primary_model`, `used_provider`, `used_model`, `was_fallback`, `duration_ms`, `raw_response`, and `structured_output` into `ai_extraction_audits`.

### B. Ambiguity Guardrails & CatalogMatcher Hard Backstop ([catalog.matcher.ts](file:///d:/Atkind%20work/orderledger/backend/src/services/ai/catalog.matcher.ts))
- **The Problem:** Earlier vision prompts "helpfully" guessed catalog sub-varieties (e.g., mapping generic `"tomato"` to `"Tomato (Country/Naati)"`) and buried the ambiguity in warnings.
- **The Fix:**
  1. **Prompt Level:** Both Gemini and Groq prompts strictly forbid picking varieties for generic items (`"tomato"`, `"टमाटर"`, `"banana"`).
  2. **Deterministic CatalogMatcher Level:** If a query matches multiple catalog entries (`candidates.length > 1`), `CatalogMatcher` sets `isValid: false` and places the item in `ambiguousItems`.
  3. **OrderProcessor Hard Gate:** When `isValid === false`, the order is strictly prevented from committing to `orders`. Outbound WhatsApp message requests variety clarification instead.

### C. Devanagari Hindi Script & Mixed Script Support
- Full vocabulary support for Hindi product names in both Devanagari and Roman transliteration:
  - `टमाटर` / `tamatar` $\rightarrow$ Tomato
  - `प्याज़` / `प्याज` / `कांदा` / `pyaz` $\rightarrow$ Onion
  - `आलू` / `बटाटा` / `aalu` $\rightarrow$ Potato
  - `केला` $\rightarrow$ Banana
  - `भिंडी` $\rightarrow$ Ladyfinger
  - Units: `किलो`, `किग्रा`, `दर्जन`
- Tested and verified on mixed-language notes (e.g., `"10 किलो Tomato (Hybrid) और 15 किलो आलू"`).

### D. Native UTF-8 Database Cluster Migration
- **Root Cause Fixed:** The local PostgreSQL cluster was initialized with `WIN1252` encoding, which caused PostgreSQL error `22P05: Unicode escape value could not be translated to the server's encoding WIN1252`.
- **Proper Fix:** Recreated database cluster with:
  ```sql
  CREATE DATABASE orderledger WITH ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;
  ```
- **Zero Data Loss:** All core records across `businesses` (47), `users` (42), `customers` (47), `products` (186), and `category_templates` (4) were backed up and restored.
- **Zero String Mangling:** Completely eliminated `[U+XXXX]` / `sanitizeForDb`. PostgreSQL natively stores and returns authentic Devanagari strings (`टमाटर`, `आलू`) across `orders.notes`, `whatsapp_messages`, and `ai_extraction_audits`.

---

## 3. Real Live Test Suites Executed

| Test Suite | File | What It Proves | Result |
|---|---|---|:---:|
| **Vision 5-Condition Suite** | [`phase4_live_vision_suite.mjs`](file:///d:/Atkind%20work/orderledger/backend/src/tests/phase4_live_vision_suite.mjs) | Benchmark against 5 physical challenges: (1) handwritten note, (2) angled camera, (3) blurry smudge, (4) crossed-out items, (5) clustered text. | **5/5 PASS** |
| **Devanagari Live Suite** | [`devanagari_live_suite.mjs`](file:///d:/Atkind%20work/orderledger/backend/src/tests/devanagari_live_suite.mjs) | Handwritten Devanagari, WhatsApp Devanagari text, and mixed script notes. | **3/3 PASS** |
| **Ambiguity Stress Suite** | [`ambiguity_stress_suite.mjs`](file:///d:/Atkind%20work/orderledger/backend/src/tests/ambiguity_stress_suite.mjs) | 5 live test cases (Devanagari text, English text, banana varieties, watermelon units, handwritten image). Confirms `isValid: false` holds in all cases. | **5/5 PASS** |
| **Forced Fallback Suite** | [`test_forced_fallback.mjs`](file:///d:/Atkind%20work/orderledger/backend/src/tests/test_forced_fallback.mjs) | Intentionally kill Gemini key $\rightarrow$ Groq `qwen/qwen3.8-27b` takes over in 999ms (text) and 1091ms (vision). Confirms `was_fallback: true` in Postgres audit row and `isValid: false`. | **PASS** |
| **Real Hindi Order UTF-8 Suite** | [`test_real_hindi_order_utf8.mjs`](file:///d:/Atkind%20work/orderledger/backend/src/tests/test_real_hindi_order_utf8.mjs) | Real Hindi message $\rightarrow$ held for clarification $\rightarrow$ clarified $\rightarrow$ confirmed $\rightarrow$ invoice generated $\rightarrow$ direct DB read-back returns unescaped `टमाटर`. | **PASS** |

---

## 4. Current State of WhatsApp BSP Integration

- **Testing Mode:** Currently using `MockWhatsAppProvider` for deterministic, offline-capable verification.
- **Target BSP Format:** `GenericBspWhatsAppProvider` is structured for **Meta Cloud API (v21.0)** (`entry[0].changes[0].value.messages[0]`).
- **Path to Live BSP:** Adapter completion required (~1-2 hours) to wire outbound HTTP POST (`/messages`), Meta two-step media URL download (`/{media_id}`), and GET webhook verification challenge (`hub.challenge`).

---

## 5. Verification Commands

Run the complete test suite against local native PostgreSQL:
```bash
# 1. Typecheck & Build
npm run typecheck --prefix backend
npm run build --prefix backend

# 2. Live Ambiguity Suite (Gemini)
node backend/src/tests/ambiguity_stress_suite.mjs

# 3. Live Forced Fallback Suite (Groq qwen/qwen3.8-27b)
node backend/src/tests/test_forced_fallback.mjs

# 4. Live UTF-8 Real Hindi Order & Database Read-Back
node backend/src/tests/test_real_hindi_order_utf8.mjs
```
