
## A. Difficulty & Recommended Approach

**Difficulty: HIGH.** D2B is a security-hardening pass across ~7 recruiter surfaces, three enforcement layers (RLS, SECURITY DEFINER RPCs, edge functions), and a Stripe-webhook-driven billing source-of-truth with real race windows (downgrade, past_due, cancel). Requires strongest model + full pre-implementation planning; split into ≥4 turns (entitlement resolver → RPC gates → RLS/read gates → tests+edge-fn gates). Not safe as a single turn.

## B. Current Branch / HEAD / Clean-Tree Proof

- Branch: `edit/edt-79e1c6c4-3446-47f5-ba86-234d6a471609`
- HEAD: `3f53eb16364e3014c810670d101479f50cc51b78` ✓ matches authoritative D2A
- HEAD tree: `84d2a14d632a3fcec6c4bf5a382232ec5b735d37` = D2A tree ✓
- `git status --short`: empty (clean)

**Verdict: byte-identical to D2A. Safe to proceed with diagnosis.**

## C. Canonical Recruiter Billing Source of Truth

| Layer | Object | Notes |
|---|---|---|
| Table | `public.recruiter_billing_profiles` | `plan`, `status`, `stripe_customer_id`, `stripe_subscription_id`, `active_opportunity_limit`, `current_period_end`, `recruiter_id`, `user_id` |
| Write | `supabase/functions/stripe-webhook` (service role) | Only writer of billing fields |
| Client lock | trigger `recruiter_billing_field_guard` | Zeros all billing fields on client INSERT/UPDATE; only service_role/admin can mutate |
| Read helpers | `recruiter_has_priority_plan(recruiter_id)` (SECURITY DEFINER, STABLE) — returns true when `plan IN ('growth','fleet') AND status IN ('active','trialing')` | Only server helper that checks tier |
| Auto-set trigger | `opportunities_set_featured_from_plan` on `opportunities` | Sets `featured = recruiter_has_priority_plan(recruiter_id)` — server-authoritative for featured/priority |
| Post gate | `opportunities_billing_guard` | Only checks `current_user_can_manage_recruiter_opportunities` (profile complete, not suspended). NO tier check — this is correct for Standard-free posting |
| Driver Pro (separate) | `public.subscriptions.status` = `'active'` | Used by `check-subscription` / `check-pro-access` edge fn (driver-only, no recruiter callers) |

## D. Exact Vocabulary (proven from code, no invention)

- **Plan** (`RecruiterPlan` in `useRecruiterBilling.ts`, and `recruiter_plan_limit` SQL): `'none' | 'starter' | 'growth' | 'fleet'`
- **Status** (`RecruiterBillingStatus` in `recruiterCapabilities.ts`, `recruiter_has_priority_plan` SQL): `'inactive' | 'active' | 'past_due' | 'canceled' | 'trialing'` (open union — Stripe may surface `incomplete`, `unpaid`, `paused` which map to non-active in both client and SQL — verified by `IN ('active','trialing')` check)
- **Active-entitled**: `plan ∈ {starter,growth,fleet} AND status ∈ {active,trialing}`

## E. Capability-by-Capability Enforcement Matrix

| Capability | Canonical Tier | UI Entry | Backend Gate Today | Bypass? |
|---|---|---|---|---|
| Standard opportunity post | free-verified | `RecruiterOpportunityManager` → insert `opportunities` | `opportunities_billing_guard` (profile-only) | ✅ correctly free |
| Edit/pause/close own opp | free-verified | Manager | RLS `current_user_can_manage_recruiter_opportunities` | ✅ correct |
| Basic applicant inbox | free-verified | `RecruiterApplicationsDashboard` via `list_recruiter_applications_safe` RPC | RPC checks ownership | ✅ correct |
| Enhanced applicant tracking | starter | Applications dashboard filters | **client-only** (`canUseApplicantStatusHistory`) | ⚠️ direct RLS reads still work |
| Applicant status history | starter | Application detail | **client-only** | ⚠️ same |
| Basic referral view | starter | `useRecruiterReferrals` → `driver_referrals` RLS SELECT | RLS only checks ownership, not tier | ⚠️ direct query works |
| Priority placement | growth | Auto-applied server-side | `opportunities_set_featured_from_plan` trigger | ✅ server-authoritative |
| Featured listing eligibility | growth | Same trigger | ✅ | ✅ |
| Recruiter reports PDF/CSV | growth | `RecruiterReportsPanel` → `useRecruiterReportData` | **client-only** guard; underlying reads via RLS | ⚠️ direct data reads succeed regardless of plan |
| Contract mgmt dashboard | growth | `useContractsPipeline`, contract upload via `upload-contract` edge fn + `contracts` RLS INSERT | RLS INSERT policy checks ownership only, **not tier**. `upload-contract` / `analyze-contract` / `review-contract` / `sign-contract` / `confirm-contract-upload` edge fns do **not** verify recruiter plan | ⚠️ direct edge-fn call or direct INSERT works |
| AI contract risk review | growth | `review-contract` / `analyze-contract` edge fn | **no tier check** in edge fn | ⚠️ bypassable |
| Full referral tracking | growth | UI toggle | **client-only** | ⚠️ same as basic — data reads open |
| Pipeline analytics | growth | `useRecruiterReportData` derived views | **client-only** | ⚠️ |
| Opp performance insights | growth | Same | **client-only** | ⚠️ |
| Top-placement (Fleet) | fleet | (not yet implemented — no trigger differentiates growth vs fleet) | none | 🟡 no divergent behavior exists |
| Priority support | fleet | manual (ops) | n/a | n/a |
| Team seats / bulk / custom profile / company dashboard | Fleet-future | not built | n/a — copy explicitly says "coming soon" | ✅ D2A copy correct |
| Driver contract review (approve/changes/reject/signature) | universal | Driver-side | RLS `Driver updates review status on own contracts`; hire-gate `opportunity_applications_require_contract_for_hire` | ✅ correct |

## F. Confirmed Bypasses & Severity

1. **HIGH — Contracts INSERT/UPDATE unbounded by plan.** RLS `Recruiter inserts contracts on own applications` and `Recruiter updates own contracts` do not consult tier. A `free_verified` recruiter can insert/update contract rows via direct PostgREST. Also bypasses `upload-contract`, `analyze-contract`, `review-contract`, `sign-contract` edge functions (no plan gate).
2. **HIGH — Referral progress reads unbounded by plan.** `driver_referrals` SELECT policy is ownership-only; `basic` vs `full` referral tracking is client-decorated.
3. **MED — Recruiter reports/analytics data reads unbounded.** Applications, referrals, opportunities data all readable via RLS with ownership only; PDF/CSV is a client concern. Attacker with a `starter` account can reconstruct Growth analytics from raw rows.
4. **MED — Applicant status history / notes** governed only by client flag; underlying columns readable.
5. **LOW — `check-pro-access` unused (dead code)** for driver features; not a recruiter risk but noise.
6. **LOW — Stripe-webhook lag / JWT staleness** — no mitigation today for a recruiter whose sub cancelled mid-session; capability recomputed only on `useRecruiterBilling` refetch (30s focus refresh).

## G. Existing Reusable Building Blocks

- `recruiter_has_priority_plan(recruiter_id)` — SECURITY DEFINER, STABLE, matches `growth|fleet AND active|trialing`. Reusable pattern for tier helpers.
- `is_recruiter_owner`, `current_user_can_manage_recruiter_opportunities` — proven ownership helpers.
- `recruiter_billing_field_guard` — proven service-role/admin bypass pattern.
- `getRecruiterPlanCapabilities` (pure) — mirror the enum tiering here in SQL.
- `stripe-webhook` — canonical writer, no change needed.

## H. Proposed D2B Architecture (narrow)

Introduce a **single server-authoritative tier resolver** and gate every currently-bypassable capability at the layer closest to data (RLS + edge-fn preambles), keeping copy/config unchanged.

```text
                 recruiter_billing_profiles (canonical)
                            │
        ┌───────────────────┴────────────────────┐
        ▼                                        ▼
recruiter_effective_tier(recruiter_id)   recruiter_has_capability(
  → 'free_verified'|'starter'             recruiter_id, capability_key)
    |'growth'|'fleet'                        → boolean
   STABLE  SECURITY DEFINER                STABLE SECURITY DEFINER
        │                                        │
        └──────────┬─────────────────────────────┘
                   ▼
   used by:  contracts RLS (INSERT/UPDATE),
             driver_referrals SELECT (tier-scoped columns/rows),
             edge functions (upload/analyze/review/sign contract),
             reports RPC (new: list_recruiter_report_data)
```

Rationale: keep `opportunities` posting free (unchanged); add tier check to the specific capabilities that map to paid tiers, at the data boundary — not on the client.

## I. Authorized Implementation File List (proposed for D2B)

**New:**
- `supabase/migration-candidates/20260721000000_phase1j_d2b_recruiter_entitlement_enforcement.sql`
- `supabase/functions/_shared/recruiterEntitlement.ts` (edge-fn helper calling `recruiter_has_capability`)
- `src/test/phase1jD2BRecruiterEntitlementResolver.test.ts` (pure)
- `src/test/phase1jD2BRecruiterCapabilityGates.test.tsx` (rendered UI regression)
- `tests/postgres/phase1jD2BRecruiterEntitlementPostgres.test.ts`
- `.github/workflows/phase1j-d2b-entitlement-postgres.yml`
- `vitest.phase1j-d2b-entitlement-postgres.config.ts`

**Modified (surgical):**
- `supabase/functions/upload-contract/index.ts`
- `supabase/functions/analyze-contract/index.ts`
- `supabase/functions/review-contract/index.ts`
- `supabase/functions/sign-contract/index.ts`
- `supabase/functions/confirm-contract-upload/index.ts`
- `supabase/functions/contract-admin/index.ts` (verify admin bypass preserved)

**Explicitly out of scope:** copy files, pricing pages, recruiter UI components (D2A owns copy; UI already fails-closed via existing hooks — server gate is the fix), Stripe checkout/webhook, driver features, agency tables.

## J. Migration / RPC / Function Changes

1. `recruiter_effective_tier(_recruiter_id uuid) RETURNS text` — SECURITY DEFINER, STABLE, `SET search_path=public`. Reads `recruiter_billing_profiles` and returns `'free_verified'|'starter'|'growth'|'fleet'` using the exact vocabulary in §D. `EXECUTE` to `authenticated`, `service_role`.
2. `recruiter_has_capability(_recruiter_id uuid, _capability text) RETURNS boolean` — SECURITY DEFINER, STABLE. Central switch mapping capability key → minimum tier. Whitelists exactly the tier→feature matrix from §E.
3. **RLS additions (no removals):**
   - `contracts` INSERT `WITH CHECK`: add `recruiter_has_capability(recruiter_id, 'contract_workflow')`
   - `contracts` UPDATE `USING/WITH CHECK`: same
   - `driver_referrals` SELECT `USING`: keep ownership; add tier-scoping via new SECURITY DEFINER read RPCs OR split into `basic` view (columns for starter+) and `full` (columns for growth+); prefer new RPCs `list_recruiter_referrals_basic` / `list_recruiter_referrals_full` to avoid RLS column-level complexity.
4. **New SECURITY DEFINER read RPCs** (for reports/analytics):
   - `get_recruiter_report_dataset(_recruiter_id uuid, _range daterange)` — enforces `recruiter_has_capability(recruiter_id, 'reports_export')`
   - `get_recruiter_pipeline_analytics(_recruiter_id uuid)` — enforces `pipeline_analytics`
   Rewire `useRecruiterReportData` to call these instead of composed RLS reads.
5. **Edge-fn preambles:** every contract-related edge fn resolves caller → recruiter_id via existing helpers, then requires `recruiter_has_capability(recruiter_id, 'contract_workflow')` before any Stripe/OpenAI/DB mutation. Admin bypass via `is_admin(auth.uid())`.
6. No changes to `opportunities_billing_guard`, `opportunities_set_featured_from_plan`, or `stripe-webhook`.
7. **Risks addressed:** no recursion (helpers never SELECT from tables that have policies referencing them); explicit `search_path`; `STABLE` volatility; JWT staleness mitigated because helpers read live DB row not JWT.

## K. Test Plan

| File | Scenarios |
|---|---|
| `phase1jD2BRecruiterEntitlementResolver.test.ts` (pure PGlite) | ~30 — full plan×status matrix → tier; capability-key mapping; unknown plan/status defaults |
| `phase1jD2BRecruiterCapabilityGates.test.tsx` | ~15 — reports/contracts/referrals UI renders locked when server helper returns false; unlocks when true; no client-only bypass path |
| `tests/postgres/phase1jD2BRecruiterEntitlementPostgres.test.ts` | ~45 — direct PostgREST attempts as `free_verified` recruiter against contracts INSERT/UPDATE, `driver_referrals` full-tier reads, report RPCs, contract edge-fn preambles; must all deny. `starter/growth/fleet` allow according to matrix. Stripe-cancel race: flip status to `canceled` and prove subsequent write denied. Admin bypass proven. Service-role bypass proven. GUC-spoof (`SET request.jwt.claim.role`) proven ineffective. Downgrade preserves rows, blocks new writes. |
| CI workflow | Real Postgres 16 gate for the postgres suite |

Also updated (assertion-only, no logic churn): `recruiterCapabilities.test.ts` to lock the SQL/TS mapping parity.

## L. Risks & Rollback

- **Risk:** adding tier check to `contracts` RLS could block legacy free-verified recruiters mid-workflow. **Mitigation:** analyze `contracts` rows keyed by `recruiter_id` whose owner is currently non-growth; migration must include a data audit report (read-only) and, if any exist, either grandfather via `is_legacy` column or make new RLS INSERT-only (existing rows still updatable by owner). Decide with ChatGPT in D2B-1 pre-implementation.
- **Risk:** Stripe webhook lag → false negative for freshly-upgraded recruiter. **Mitigation:** `recruiter_has_capability` is real-time on billing table which the webhook updates before Stripe redirects; acceptable window is <5s.
- **Rollback:** migration is additive — new helpers + tighter RLS `WITH CHECK`. Rollback = single migration reversing the RLS/CHECK additions and dropping the two helpers. No data destruction.

## M. Explicit Exclusions (deferred)

- **D2C**: recruiter cancellation/past_due UX (banners, grace period, retention flow).
- **D2D**: recruiter self-serve plan downgrade UI and data-preserved-but-locked "read-only" surfaces.
- **Out of D2*:** driver-side Pro gating audit, agency entitlement audit, Stripe test/live parity, invoice/receipt storage.

## N. Verdict

**PASS — implementation can proceed safely**, provided:

1. D2B is split into ≥4 authorized turns (resolver+helpers → contract RLS+edge-fn preambles → reports/analytics RPCs → tests + CI gate).
2. ChatGPT authors the migration SQL literally; Lovable executes without scope drift.
3. Legacy-contracts audit is run **before** the RLS tightening turn, and grandfather decision is captured in the authorization.
4. No copy, pricing, or D2A files touched.

Awaiting ChatGPT's per-turn authorization to begin D2B-1 (helpers + legacy audit).
