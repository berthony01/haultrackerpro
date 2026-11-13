# HAULTRACKER PRO | Launch-candidate acceptance ledger
Date: 2026-11-12. Status: **RELEASE HOLD**. This document is a checkpoint, not a statement of production readiness.

## Candidate
- Base: Main commit `d7761b4ec0c9294a9056eb4784874e2902c2c285`.
- Pricing, recruiter, role, assistant, agency, dispatch, and beta-billing copy from draft PR #59.
- Completed-load financial alert eligibility, date-scoped payment copy and zero-baseline trend tests from draft PR #60.
- Owner QA client-side pending-auth/role redirect fix and five focused regression tests from draft PR #62; original draft remains unmerged.
- Original drafts remain unmerged and published application stays unchanged pending approval.
- No new subscription tiers, Stripe prices, secret values, Supabase migrations, production authentication settings/account/role changes, Telegram bot deploys or production data writes.

## Evidence already obtained
- Pricing/role isolated tests, mobile public checks at 320 px and 375 px, and native PostgreSQL recruiter gates passed in PR #59.
- Driver financial and zero-baseline tests (35 tests across five test files) and frontend build passed in PR #60.
- Owner QA source draft historically reported 51/51 focused and neighboring tests passing; integrated PR #61 CI and actual authenticated Owner QA browser access must be checked independently.
- Source contract tests verify eight Stripe *environment-variable names* match across checkout and webhook code. **They do not prove deployed LIVE price-ID values or purchase flows.**
- Published, signed-in, nonadmin account baseline screenshots show driver/recruiter/agency switch, Free driver gating, incomplete recruiter onboarding, grandfathered Agency Starter and live dashboard discrepancies.
- Production read-only schema inspection: 103 public tables with RLS enabled and 2 security-invoker public views. Policy correctness still requires role-scoped testing.

## Release-blocking acceptance gates
1. Run integrated candidate CI; all pricing/role, driver finance, Owner QA pending-auth, public mobile and PostgreSQL jobs must pass on this branch's **same head SHA**.
2. Confirm staged and published build identities at release time. The earlier published -100% dashboard screenshot is explained by one completed dispatch load with a November 1 actual-delivery event in the previous week and no completed loads this week. The displayed week-over-week declines are valid. Retain zero-denominator trend tests as protection against future misleading calculations; do not misclassify this account's real previous-week decline.
3. Authenticated positive and **negative** permission tests on this combined candidate for owner, Free/Pro Driver, Recruiter, Recruiter Staff, Driver Assistant, Agency owner/member and authorized Company Dispatcher, including 320/375 px, refresh/back, and unauthorized access. Verify `/owner-qa` waits for auth/role restoration, retains real super_admin access and denies non-admin users.
4. Lovable's enabled Stripe integration: verify deployed LIVE environment Price IDs against actual Stripe Product/Price catalog, billing intervals, currency and entitlement effects. Test-mode payment workflow only if the owner authorizes. Never perform an unapproved real charge.
5. Telegram and dispatch production acceptance: group binding and permissions, intake/posting, review, Cancel/Delivered, driver-ledger propagation, Mini App reliability, response time and idempotence. Historical update receipts alone are not a fresh E2E acceptance test.
6. Assistant launch policy: verify intended Driver/Recruiter/Agency personas, topic continuity, rate limits and AI-disabled failure states. Do not represent unfinished AI as launched.
7. Release owner sign-off, backups/version rollback confirmed, then controlled merge/publish followed by signed-in live smoke. Any gate failure remains NO-GO.

## Known corrected staging issues
- Paid recruiter tier and business copy reconciled; existing tier count kept.
- 320 px Add Recruiter Workspace overflow fixed.
- Grandfathered manual-beta agency billing selector now defaults to its current plan with optional-checkout copy.
- Unfinished loads no longer trigger completed-load payment/profit alerts.
- Driver dashboard Actual Earnings empty state explicitly refers to selected date period.
- The prior live -100% dashboard trend is **correct**, not a defect: read-only dispatch event history gives one completed load in Nov 1–7 ($27.50 actual pay recorded), zero in Nov 8–14. This corrects an earlier audit error. Zero-baseline unit/render tests remain preventive regressions only.

## Safety / no surprises
- NO owner password or role reset, customer account creation, subscription, checkout session, plan change, posting terms acceptance, real load edit, database mutation, or automatic rollout.
- Lovable draft-preview `Invalid login credentials` remains a separate **unproven** issue. Client-side `/owner-qa` redirect repair is not proof that draft sign-in credentials are fixed. Do not reset accounts to address it without a verified cause.
- Do not accept Lovable drafts or merge this candidate before required verified evidence. Keep source PRs for traceability; only one integrated release should eventually be published.
