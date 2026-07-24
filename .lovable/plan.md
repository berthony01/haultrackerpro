
# Phase 1N-F2-A — Audit Report & Phased Plan (READ-ONLY)

## A. Start Gate — PASS
- HEAD: `3926bec94121cfca616a56e006d2a952e654a338` (matches required)
- Working tree: clean (empty `git status`)
- Diff vs required base: empty
- Branch: `edit/edt-d9045be5-52af-455a-983a-079c8b680661` (the connected Lovable branch)
- No writes, no DB mutation, no deploy, no publish this pass.

## B. Zero-Write Compliance
Only performed: repo reads, ripgrep searches, one read-only `information_schema` catalog query. No repository edits, no migration/candidate creation, no SQL writes, no edge function deploy/invoke, no Stripe call, no auth mutation, no publish. Final SHA unchanged.

## C. Surface Inventory (evidence)
- **Routes (`src/App.tsx`):** `/`, `/dashboard`, `/auth`, `/terms`, `/privacy`, `/faq`, `/features`, `/pricing`, `/recruiters`, `/about`, `/assistants-agencies`, `/how-to-use-haultrackerpro`, `/parking`, `/starter-kit(/thanks)`, `/updates`, `/recruiter/{faq,features,guide,updates,manage,applications,reports,onboarding}`, `/resources`, `/resources/:slug`, many SEO landing pages, `/professional-profile`, `/start`, `/admin/*`.
- **No routes exist for:** `/docs`, `/legal`, `/acceptable-use`, `/subscription-policy`, `/account-deletion-retention`, `/recruiting-rules`, `/cookies`, or a policy-version-history surface.
- **Signup consent (`src/pages/Auth.tsx`):** ripgrep for `Terms|Privacy|checkbox|consent|agree` in Auth.tsx returned zero matches. Email/password signup and Google OAuth (`lovable.auth.signInWithOAuth('google', …)`) both create accounts with **no Terms/Privacy acceptance checkbox and no version stamp**.
- **Terms (`src/pages/Terms.tsx`):**
  - Line 8: `Last Updated` is `new Date().toLocaleDateString(...)` — reflects the visitor's clock, not a fixed policy effective date. Same defect in `src/pages/Privacy.tsx:8`.
  - §29 Governing Law: "the laws of the United States, without regard to conflict of law provisions." — no state/venue named.
  - §25 Recruiter Account Termination: "recruiter paid billing stops at period end" — conflicts with account-deletion behavior (Stripe cancel immediately, then RPC cleanup) shipped in Phase 1N-F1-E.
- **Privacy (`src/pages/Privacy.tsx`):** §6 promises deletion "permanently removed" but the live transactional cleanup RPC (`finalize_my_account_data_deletion`) plus the retention comments in `_shared/account-deletion.ts` intentionally retain/detach billing, audit, signature, shared, and dispute records. Language is materially inaccurate.
- **FAQ (`src/pages/FAQ.tsx` id `delete-account`):** describes deletion as removing only the driver-facing list (loads, expenses, fuel, etc.) — silent on recruiter/agency ownership blocks, agency-owner transfer requirement, subscription cancellation timing, and retained records.
- **Recruiter posting-terms consent:** RPC `public.accept_recruiter_posting_terms(_version text)` exists and stamps `posting_terms_accepted_at` + `posting_terms_version` on `recruiter_profiles`. This is the only versioned acceptance ledger in the product.
- **Universal Terms/Privacy ledger:** production `information_schema` query returned only `contract_versions` (per-signed-contract). **No** `policy_versions`, `policy_acceptances`, or equivalent ledger exists.
- **Sitemap (`public/sitemap.xml`):** includes `/terms` and `/privacy` but omits `/faq`-siblings like a docs hub, and no legal-center children.
- **Robots (`public/robots.txt`):** disallows `/dashboard`, `/auth`, `/admin`, `/reset-password`, `/install`, `/parking`, `/updates`, `/driver`, `/agency`, `/a/`. Docs/legal center paths are not yet reserved.

## D. Findings Matrix (severity → recommendation)

| # | Surface / Source | Role(s) | Issue | Severity | Destination |
|---|---|---|---|---|---|
| 1 | `Auth.tsx` signup (email + Google) | all | No Terms/Privacy acceptance checkbox; no version stamp; parity gap between email vs OAuth | **Critical** | Signup UI + new `policy_acceptances` ledger |
| 2 | `Terms.tsx:8`, `Privacy.tsx:8` | all | `Last Updated` uses visitor clock instead of fixed effective date/version | **Critical** | Replace with constant version+effective date pulled from `src/lib/legal/policyVersions.ts` |
| 3 | `Privacy.tsx` §6 | all | Overpromises "permanently removed" — contradicts retained billing/audit/signature/shared records | **Critical** | Rewrite in `/privacy` + new `/account-deletion-retention` |
| 4 | `Terms.tsx` §29 | all | Governing law lists "United States" only; no state/venue | **Critical (blocker: operator info)** | Attorney-review; requires operator input |
| 5 | `Terms.tsx` §25 vs live deletion behavior | recruiter | Cancel-at-period-end promise conflicts with immediate-cancel-on-delete | **High** | Reconcile in Terms + `/subscription-policy` + FAQ |
| 6 | `FAQ.tsx#delete-account` | driver / recruiter / agency | Silent on agency-owner transfer requirement, subscription timing, retained records | **High** | Rewrite FAQ; link to `/account-deletion-retention` |
| 7 | `Terms.tsx` §2/§4 marketing language ("real-time" parking, "verified," "tax-ready," "handles the math") | all | Unqualified promises vs actual AI/OCR/community-report behavior | **High** | Inline qualifiers; `/acceptable-use` + AI/OCR docs |
| 8 | Recruiter posting-terms consent | recruiter | Ledger exists but checkbox copy in recruiter onboarding does not identify a fixed policy slug/version link | **Medium** | Update onboarding UI + `/recruiting-rules` route |
| 9 | Agency owner personal-account deletion | agency owner | Backend hard-blocks (409 P0001), but no page/FAQ discloses transfer/closure requirement | **High** | FAQ + `/docs/agency/leaving-transferring` + inline modal copy |
| 10 | Assistant self-leave, agency member self-leave, agency transfer/closure, recruiter-profile closure | assistant / member / owner / recruiter | Distinguish missing controls from missing docs — needs code inventory in F2-G | **High** | Product controls (F2-G) + docs |
| 11 | Contact-sharing consent when driver requests opportunity info | driver | Recorded operationally but no dedicated policy surface describes recipient scope | **Medium** | `/privacy` + `/recruiting-rules` |
| 12 | Parking/geolocation | driver | Precise-geolocation category not called out in Privacy §1 | **Medium** | `/privacy` update |
| 13 | AI/OCR/contract review | driver / recruiter | Disclaimers exist but scattered; no canonical `/docs/ai-limitations` | **Medium** | Docs article + inline link |
| 14 | Tax/reports | driver | "Tax-ready" phrasing without qualifier that it is estimation only | **Medium** | Inline copy + `/docs/tax-reports` |
| 15 | Sitemap / robots | all | Missing entries for future `/docs`, `/legal`, and children | **Low** | F2-H |
| 16 | Cookie/analytics notice | all | GA4 mentioned in memory; no cookie/analytics disclosure route | **Medium** | Optional `/cookies` in F2-D (attorney review) |
| 17 | No policy version history | all | No `/legal/history` or change-notice surface | **Medium** | F2-D route |
| 18 | Pricing/checkout consent | driver / recruiter / agency | Verify explicit consent-before-billing text at checkout button; not verified this pass | **High (unverified)** | F2-F |

## E. Critical Contradictions
1. Privacy §6 vs live retention (blocking).
2. Terms §25 (period-end billing) vs live delete-account (immediate cancel).
3. Marketing "verified" / "real-time" / "guaranteed" / "tax-ready" vs actual product behavior.
4. Signup creates account without recording Terms/Privacy acceptance — the platform cannot later prove consent.

## F. Role & Responsibility Matrix (summary)

| Role | Can do | Responsible for | Not verified by HTP | Exit path | Personal deletion constraint | Retained after exit |
|---|---|---|---|---|---|---|
| Driver / owner-op / lease / 1099 | Log loads, opportunities, contracts, referrals | Data accuracy, tax filing, contract review | Employment status, earnings, safety, licensing | Cancel Pro → Delete Account | None unless owns agency | Billing, audit, signatures, shared referrals/opportunities |
| Recruiter | Publish opportunities, receive apps, upload contracts | Truthful postings, lawful hiring, anti-bait-and-switch | DOT/MC validity beyond stamp, actual hiring | Cancel plan / close profile / delete account | Blocked if agency owner | Billing, applications tied to hired drivers, audit |
| Assistant | Limited driver-workspace actions per grant | Actions taken under delegation | N/A employment | Revoke self (needs F2-G verification) | None | Audit trail |
| Agency owner | Manage agency, members, clients, work items, billing | Client authorization, billing, member conduct | N/A employment | Must transfer or close agency first | **Hard-blocked (P0001)** until agency closed/transferred | Billing, audit |
| Agency admin/member | Assigned work | Actions performed | N/A | Self-leave (needs F2-G verification) | None | Audit |
| Referred/unregistered contact | None | N/A | N/A | N/A | N/A | Referral record retained |
| Admin/moderator | Moderation, suspension, access to contracts/audit | Lawful moderation | N/A | Internal | N/A | Full audit |

## G. Proposed Docs + Legal Architecture
**Public Docs Hub:** `/docs` (index+search) with collections:
- `/docs/drivers/*`, `/docs/recruiters/*`, `/docs/assistants/*`, `/docs/agencies/*`
- `/docs/billing/*` (cancellation, refunds, payment failure)
- `/docs/account/leaving-and-deletion`
- `/docs/ai-limitations`, `/docs/tax-reports`
- `/docs/opportunities/safety`, `/docs/contracts/signature`, `/docs/parking/community-reports`
- `/docs/privacy/data-requests`

**Legal Center:** `/legal` (index) →
- `/terms`, `/privacy`, `/acceptable-use`, `/subscription-policy`,
- `/account-deletion-retention`, `/recruiting-rules`,
- `/legal/history` (version log), optional `/cookies`.

**Migration/redirect:** keep `/faq` and `/how-to-use-haultrackerpro` for SEO; convert to indexes that link into `/docs/*`; redirect thin duplicates; do not duplicate legal rules across articles — legal center is canonical, docs link back.

## H. Owner Protection — Attorney-Review Blockers
Cannot finalize without operator-supplied values: legal entity name, business address, governing state & venue, minimum age, refund policy, liability cap, arbitration & class-waiver election, privacy request/appeal channels, list of subprocessors (Stripe, Lovable Cloud/Supabase, AI provider(s), email), and retention schedule. **Do not invent these.**

## I. Consent / Versioning / Evidence Design (recommended, not now)
New `public.policy_versions` (slug, version, effective_at, checksum, body_ref) + `public.policy_acceptances` (user_id, policy_slug, version, accepted_at server-time, source_surface, role_context, optional ip/ua). Reacceptance required when checksum changes. Reuse pattern for: Terms, Privacy, Acceptable Use, Subscription Policy, Recruiting Rules; keep separate `recruiter_profiles.posting_terms_*` and contact-sharing/subscription consent ledgers. No browser-authoritative timestamps. Export + admin read paths.

## J. Billing / Account-Exit Consistency Map (issues to fix)
- Driver Pro cancel: cancel-at-period-end (Stripe) — must be documented in `/subscription-policy` and `/docs/billing/cancellation`.
- Recruiter cancel: same; but delete-account currently forces immediate cancel → **conflict with Terms §25**.
- Agency cancel: only agency owner; delete-account of owner is hard-blocked.
- Multi-capability account with >1 owned subscription: current behavior needs an explicit consent screen listing every subscription that will be canceled.
- Assistant / agency-member self-leave: verify UI exists (F2-G).
- Recruiter-profile closure (without deleting account): verify UI exists (F2-G).
- Confirmation receipts + support fallback (`support@haultrackerpro.com`) already present in Privacy §21; centralize.

## K. Exact Phased Plan

| Phase | Objective | File allowlist (likely) | DB migration? | Tests | Prod action | Stop point | Blockers |
|---|---|---|---|---|---|---|---|
| **F2-B** | Canonical policy/doc constants + route scaffolding, no content, no DB | `src/lib/legal/policyVersions.ts` (new), `src/lib/docs/routes.ts` (new), `src/App.tsx` (add empty `/docs`, `/legal`, `/acceptable-use`, `/subscription-policy`, `/account-deletion-retention`, `/recruiting-rules`, `/legal/history` routes → stub pages), unit test | No | 1 unit test (versions unique, monotonic) | None | After merge | None |
| **F2-C** | Docs Center pages + role articles (content-only) | new `src/pages/docs/*` | No | Snapshot/link tests | None | After merge | Need product owner sign-off on wording |
| **F2-D** | Legal rewrite w/ fixed version + canonical disclaimers; fix `Last Updated`, Privacy §6, Terms §25, §29 placeholders | `src/pages/Terms.tsx`, `src/pages/Privacy.tsx`, new `/acceptable-use`, `/subscription-policy`, `/account-deletion-retention`, `/recruiting-rules`, `/legal/history` | No | Tests asserting version constants render, no visitor-clock dates | None | After merge | **Operator info blockers** (entity, state, refund, cap, arbitration) |
| **F2-E** | Consent/version DB contract | `supabase/migration-candidates/…_policy_versions_and_acceptances.sql`, PG16 test + workflow | Candidate only | Real PG16 gate | None | After candidate frozen | None |
| **F2-F** | Signup/OAuth/recruiter/checkout consent UI wired to F2-E | `src/pages/Auth.tsx`, recruiter onboarding, checkout components | No new DB | Vitest + RTL | None | After merge | F2-E promoted |
| **F2-G** | Role-exit UI parity: assistant self-leave, agency-member self-leave, recruiter-profile close, agency owner transfer/closure; align FAQ/docs | assistant/agency components + docs | Small RPCs if missing (candidate) | Vitest + PG16 for any new RPC | None | After merge | Audit which controls already exist |
| **F2-H** | Sitemap / robots / footer / header / SEO / a11y alignment | `public/sitemap.xml`, `public/robots.txt`, footer, `SEOHead` usage | No | Sitemap audit script | None | After merge | Depends on F2-B routes |
| **F2-I** | Controlled prod migration + deploy for F2-E | migration promotion + deploy | Yes | Prior gates | Prod migration | After successful acceptance | Supervisor go-ahead |
| **F2-J** | Attorney-review closeout: package findings + operator-info questionnaire | `docs/legal/attorney-review.md` | No | N/A | None | Delivery | Operator sign-off |

## Recommended next atomic pass
**F2-B** — Canonical policy/doc constants + empty route scaffolding + one unit test. It is the smallest, zero-content, zero-DB, zero-risk foundation that unblocks F2-C, F2-D, F2-F, and F2-H without waiting on operator legal input.

## L. Final Proof
- `git rev-parse HEAD` = `3926bec94121cfca616a56e006d2a952e654a338` (unchanged).
- `git status --short --untracked-files=all` = empty.
- `git diff --name-only 3926bec9…HEAD` = empty.
- Zero files edited, zero DB writes, zero Stripe calls, zero edge-function deploys/invocations, zero publish.

Stopping for supervisor audit. Awaiting authorization to begin F2-B.
