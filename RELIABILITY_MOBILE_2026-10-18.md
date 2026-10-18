# Mobile UI and error recovery

This change keeps the existing cream, dark and pastel design and the local Manrope font. It refines the sign-in hero, phone navigation, dashboard activity, form targets and recovery states. The app remains a responsive web application.

## Failure handling

- A React error boundary replaces a failed render with an accessible recovery screen. Reload preserves authentication and saved server records; it does not restore unsaved form state.
- Every API response has a server-generated `X-Request-ID`, exposed through CORS. Central error responses include the reference. Unexpected errors log the reference, method, route, error code and stack frames, without logging request bodies, credentials, raw SQL details or error messages. Server error notices show the reference.
- Signup hashes the password before a single database transaction creates the business, starter catalog and owner. Concurrent account creation serializes normalized email checks, including the team creation service.
- Order and payment writes accept `Idempotency-Key`. The existing business lock serializes simultaneous retries. A receipt and the financial write commit together; failure rolls both back. Reusing a key with changed input returns 409. Receipts remain scoped to the business and operation and do not expire automatically.
- The official frontend verifies the API's `idempotentWrites` capability before financial submissions. An unconfirmed submission retains its key for an identical retry in the same browser tab, including reload, using session storage and an in-memory fallback. Only a hash and UUID are stored. A confirmed successful submission releases its key so a deliberate second order is allowed. No mutation is automatically retried.
- Failed order/payment forms retain entered values and focus the error notice. Reduced browser heights can scroll to form actions. This is not a full offline draft or cross-device recovery system.

## Responsive behavior

The sign-in composition has a `100dvh` minimum with a `100vh` fallback and can grow with its content. Width stays at `100%` to avoid viewport scrollbar overflow. Phone layouts account for display safe areas, keep form text at 16px, and use 44px or larger action targets. Recent activity becomes a card list on phones. Dark themes, reduced motion and the existing A4 print layout remain supported.

## Deployment

Apply migration `006_write_receipts.sql` through normal backend startup. Deploy the backend before relying on the new frontend's order/payment forms. Health must report API version 2, `status: "ok"`, and `capabilities.idempotentWrites: true`. Older servers are explicitly blocked from financial submissions rather than silently ignoring retry keys.

The previously observed Render deployment incident is separate from these local repairs. A successful GitHub push or Vercel deployment does not prove the Render API has updated. Record live verification before declaring it resolved.

## Verification

- All **47 backend tests passed**, including real concurrent writes, mismatched retry payloads, tenant isolation, receipt rollback, signup rollback, concurrent signup and request references. Backend test typechecking and the production build passed.
- The frontend production build passed: approximately 371 KB JavaScript (108 KB gzip), with no additional runtime dependencies.
- **44 browser check groups passed**: 15 workflow acceptance, 8 settings, 3 edge-case, 8 prior redesign and 10 mobile/reliability groups. These are groups of assertions, not individual test counts.
- The new suite covers eight workspace pages at seven viewport sizes, 320–1440px wide, including short landscape and keyboard-sized layouts; mobile dark mode; lost order responses with reload; lost payment responses; fresh keys after confirmed saves; request references; outdated API and temporary downtime handling; and actual render-crash recovery.
- Existing checks cover all palettes, settings persistence, blueprint imports, invoice printing (including 80 lines across seven A4 pages), and 5,000 loaded synthetic records. Browser measurements used Chromium viewport simulation, not physical iOS/Android devices.
- All browser tests use disposable loopback servers and synthetic accounts. Screenshots, PDFs and credentials stay in OS temporary storage. The local proxy was bypassed for test runs only. No real financial records were changed.

The public Render health endpoint was rechecked on 2026-10-18 and still returned the old contract without an API version or retry capability. The Render plugin remains unconnected; a live backend rollout has not been performed or verified.

## Remaining essentials

See `CRM_AUDIT_2026-10-18.md` for the broader backlog. Financial corrections/reversals, password recovery and revocable sessions, backup restore verification, staff management, customer follow-ups and accounting localization remain separate work. External error monitoring and readiness alerts are not configured by this change. WhatsApp and live AI ingestion remain deferred.
