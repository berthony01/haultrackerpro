# Strict Recruiter Flow Audit — Plan

## Objective

Produce a single, evidence-based audit report of the entire Recruiter surface (auth → onboarding → billing/checkout → posting eligibility → opportunities → applications inbox → offers/pipeline → webhooks/entitlements → admin oversight). Read-only. No source, migration, DB, or config changes. Deliverable is a written report, not code.

## Ground rules

- Plan mode + audit mode: no file edits, no migrations, no `bunx`/`bun run`, no dependency changes, no live DB writes.
- Every finding must cite: exact file path + line range OR exact DB object (function/policy/grant/table) OR exact test file + test name.
- Every current-state claim is backed by a read performed during the audit. Nothing assumed from prior phase memory.
- Treat prior "PASS" claims (1C, 1D, 1E, 1F-A/A.2/A.2.1/A.2.2, 1G-R1A1..R1A7, 1H-A1, 1H-A2) as claims to re-verify against HEAD, not as facts.
- Severity taxonomy: **P0** production data/authz/billing defect · **P1** blocking correctness · **P2** UX/observability gap · **P3** hygiene.
- Each finding: ID, severity, title, evidence (file:line or DB object), observed behavior, expected behavior per canonical product rule, minimal proposed remediation scope, whether it is in a candidate migration vs. live.

## Canonical product rules being audited against

1. Recruiter completes profile → standard posting unlocked (verification adds trust badge, not access).
2. Suspension removes access.
3. Recruiter checkout: no duplicate active subscriptions; intent/lease table gates concurrent starts; canonical `stripe_customer_id` on `recruiter_billing_profiles` is authority, not webhook metadata.
4. Stripe webhook idempotency is state-machine based (`claim/complete/fail`), retry-safe.
5. Applications: server-authoritative snapshot, split RPCs (`submit_opportunity_application` / `submit_request_info`), `result_code` contract, caller-required idempotency keys on formal paths, self-application blocked, DELETE revoked from `authenticated`, withdrawal driver-bound only.
6. Offers: RPC-only mutation, post-draft expiry invariant, RESTRICT on FK delete.
7. Recruiter UI cannot select `onboarding` or `hired` directly (offer workflow owns those transitions).

## Audit scope (what will be read)

### A. Codebase surfaces
- `src/pages/Recruiter*` and any `Recruiter*` routes wired in `src/App.tsx`
- `src/components/opportunities/Recruiter*`, `RecruiterApplicationsDashboard.tsx`, `RecruiterBillingPanel.tsx`, `RecruiterAccessPage.tsx`, `RecruiterOnboarding.tsx`, opportunity form components
- `src/hooks/opportunities/useRecruiter*.ts` (profile, billing, opportunities, referrals, contact requests, analytics, settings)
- `src/lib/opportunities/recruiter*` (eligibility, billing state, checkout messages, benefits format), `src/lib/recruiterCapabilities.ts`, `src/lib/recruiterFeatureList.ts`, `src/lib/recruiterReports/*`
- `src/hooks/admin/useAdminRecruiter*.ts`, `useRecruiterOutreachStatus.ts`, admin recruiter oversight surfaces
- Auth/role wiring for recruiter role: `useUserRole.ts`, `useActingContext.tsx`, `useViewMode.ts`, `useRoleIntentReconciler.ts`, `authNavigation.ts`

### B. Edge functions
- `create-recruiter-checkout`, `recruiter-billing-portal`, `stripe-webhook`, `_shared/stripe-webhook-identity.ts`, `_shared/recruiter-checkout*`, `_shared/driver-billing.ts` (shared config path), `_shared/account-deletion.ts`
- CORS, JWT verification, safe logging, session validation, canonical identity resolution, 409 duplicate guard

### C. Database (READ-ONLY via `supabase--read_query` / `supabase--linter`)
- Tables: `recruiter_billing_profiles`, `recruiter_checkout_intents`, `stripe_webhook_events`, `opportunity_applications`, `opportunity_offers`, `marketplace_user_restrictions`, `opportunities`, `user_roles`
- For each: RLS enabled? policies (name, cmd, roles, USING/WITH CHECK), GRANTs (per role), triggers, constraints
- RPCs: `recruiter_can_post`, `driver_can_access_opportunity`, `accept_recruiter_posting_terms`, `submit_opportunity_application`, `submit_request_info`, `build_application_submission_snapshot`, `claim_stripe_webhook_event`, `complete_stripe_webhook_event`, `fail_stripe_webhook_event`, checkout-intent RPCs, `has_role` — signature, `SECURITY DEFINER`, `search_path`, EXECUTE grants
- Compare candidate migrations under `supabase/migration-candidates/*` against what is actually live (drift check)

### D. Tests
- `phase1c*`, `phase1d*` (if present), `phase1e*`, `phase1f*`, `phase1gR1A*`, `phase1hA1*`, `phase1hA2*`, `recruiter*`, `securityViewsShape.test.ts`
- Report file count, passing count, and whether they exercise the real RPC path vs. mocks
- Note any Postgres/PGlite runtime harnesses under `tests/postgres/`

### E. Config / CI
- `.github/workflows/recruiter-*.yml`, `playwright.recruiter-billing.config.ts`, `vitest.recruiter-checkout-postgres.config.ts`, `vitest.postgres.config.ts`
- `supabase/config.toml` recruiter-related function `verify_jwt` and secret presence (names only; never values)

## Report structure (deliverable)

```
Recruiter Flow Audit — HEAD <sha>

1. Executive summary
   - PASS / OPEN-BLOCKING / OPEN-NONBLOCKING counts by severity
   - Candidate-vs-live drift summary

2. Canonical product rules — pass/fail matrix (one row per rule above)

3. Findings (grouped)
   3.1 Auth / role / view-mode
   3.2 Onboarding & profile completion
   3.3 Posting eligibility & terms consent
   3.4 Checkout (create-recruiter-checkout + intents)
   3.5 Billing portal + subscription state
   3.6 Stripe webhook identity + idempotency
   3.7 Opportunities CRUD + RLS
   3.8 Applications inbox + status transitions
   3.9 Offers workflow
   3.10 Admin oversight + suspension
   3.11 Tests & CI evidence
   3.12 Candidate-migration drift vs. live DB

4. Confirmed-open defects (P0/P1) with minimal remediation scope per item

5. Non-issues verified (explicit “checked, PASS” list — so we don’t re-audit next round)

6. Cannot-confirm items (with the exact blocker: e.g. sandbox branch, missing secret, DB permission)
```

## What the audit will NOT do

- No edits to any file, migration, workflow, or config
- No `bun`/`bunx`/`npm` execution, no builds, no test runs (test presence and structure only)
- No DB writes, no migration application, no publish, no deploy
- No A3 (Ask Recruiter) design work, no scope expansion
- No Stripe API calls, no live webhook replays

## Stop conditions

- If a read requires branch-isolated sandbox access we don’t have → report as **Cannot-confirm** with the exact blocker, do not guess.
- If a finding requires a product decision (e.g., should suspension revoke posting immediately vs. next login) → surface as a decision item, do not choose.
- If the audit uncovers a P0 mid-run → report it immediately at the top of the deliverable; do not begin remediation in this task.

## Estimated size

Report only. ~1 long assistant message with the structure above. No file writes.
