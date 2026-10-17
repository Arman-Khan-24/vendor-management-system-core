---
status: resolved
trigger: "see what i want is an blueprint type settings and customization such that i will just just edit just internal setting and customize 1-2 features at max accoridng to diff user and sell software to any peron"
created: 2026-10-17
updated: 2026-10-17
---

## Current Focus

reasoning_checkpoint:
  hypothesis: The business PATCH route forwards camelCase invoiceTrigger into dynamic SQL, naming a nonexistent invoiceTrigger column rather than invoice_trigger.
  confirming_evidence:
    - Capturing the real update method emitted UPDATE businesses SET invoiceTrigger = $1 for a valid request.
    - Migration 001 defines invoice_trigger; validateBody emits invoiceTrigger and route does not map it.
  falsification_test: The same valid request succeeds against the baseline migrated PostgreSQL schema without an invoiceTrigger column.
  fix_rationale: Explicitly map the bounded request schema to known SQL columns; keep all persisted settings in validated JSONB.
  blind_spots: This confirms the settings defect, not every product/customer/order/payment save failure reported by the user.
next_action: Local repair and browser acceptance are complete. Preserve this record in place; the original production deployment remains unverified.

## Symptoms

expected: Owner can save business configuration and reuse a secret-free blueprint across businesses.
actual: Existing settings UI is read-only; current repository accepts unbounded SQL field names and cannot map invoiceTrigger.
errors: Internal server error reported during saves; specific business endpoint is a confirmed source-level candidate.
reproduction: PATCH /api/business with invoiceTrigger set to Packed.
started: Present at baseline 8fdef60; user-reported original failure environment not yet observed.

## Eliminated

## Evidence

- checked: .planning/IMPLEMENTATION.md
  found: Authorized contract separates tenant settings from device endpoint and provider credentials; edits are OWNER only.
  implication: Reuse existing business repository and validate a bounded settings object.
- checked: business.routes.ts and business.repo.ts
  found: req.body goes to update; update interpolates every input object key as a SQL column. Validator emits invoiceTrigger, but migration defines invoice_trigger.
  implication: Valid settings requests generate invalid SQL; schema and repository need an explicit mapping.
- checked: Real BusinessRepository.update invoked with instrumented pool.query and no database write.
  found: UPDATE businesses SET invoiceTrigger = $1, updated_at = NOW() WHERE id = $2 RETURNING *; values [Packed, probe-business].
  implication: The data-shape/SQL-column mismatch is reproducible and sufficient to cause a PostgreSQL undefined-column error.
- checked: Backend tsc --noEmit after implementation.
  found: Passed.
  implication: New settings/service/repository/routes integrate with existing backend types.
- checked: business-settings.test.ts.
  found: All seven tests passed: defaults, partial merges, invalid configuration, URL validation, credential omission, tenant-bound encryption, owner route guards.
  implication: Unit and authorization paths are verified; durable writes need the real database integration suite.
- checked: First disposable PostgreSQL integration run.
  found: Cluster initialized successfully, but importing createApp failed because concurrent shared validators/schemas.ts re-exported updateBusinessSchema instead of updateBusinessSettingsSchema; all tests stopped in before hook.
  implication: This is a shared module-name mismatch, not a settings persistence failure. Investigator notified of exact alias correction. Disposable cluster was stopped.
- checked: Rerun business-settings.test.ts after plural catalog defaults and unavailable-option assertions.
  found: Seven tests passed; owner PATCH rejects unsupported WhatsApp module and unknown provider with field-specific 400 Validation error responses.
  implication: Deferred integration cannot be enabled by a blueprint, and unsupported options are not silently saved.
- checked: business-settings.integration.test.ts using isolated PostgreSQL and production migrations/routes/repositories.
  found: All four integration tests passed, including camelCase invoice trigger/profile/settings persistence; partial merge; tenant separation; encrypted key storage, preservation and clearing; currency lock after order and after advance payment. Migrations 001 through 005 applied.
  implication: Real database writes and responses meet the shared API contract; the disposable database was stopped after the run. User's deployed environment remains to be checked.

- checked: Parent browser acceptance across setup, workflow, responsive and edge-case scripts.
  found: All 20 browser checks passed, including local blueprint/settings flows, persisted configuration, feature switches and hidden provider secrets.
  implication: The local UI-to-API setup workflow is verified. No production deployment or live provider was tested.

## Resolution

root_cause: Request camelCase keys are interpolated directly as database column names.
fix: Explicit camelCase field mapping; validated tenant settings JSONB; transactional currency guard; owner-only configuration writes; separate encrypted provider credentials.
verification: Backend typecheck passed; seven unit/route/crypto tests and four real PostgreSQL integration tests passed. Parent's 20-check browser acceptance suite passed, including local blueprint/settings persistence, feature switches and secret masking. No user database or live provider was used. The original production deployment remains unverified.
files_changed: [business.repo.ts, business.routes.ts, business-settings.schemas.ts, business-settings.service.ts, 004_business_settings.sql, business-settings.test.ts, business-settings.integration.test.ts]
