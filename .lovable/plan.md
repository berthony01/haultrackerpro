# Phase 3.1 — Correction Pass

Scope: no new features. Fix the 6 audit issues, then re-run build + mobile QA and deliver a corrected launch report.

## 1. Truth-table correction (docs only)
- Phase 3 report says recruiter Activity & Pipeline reports are Starter+. Code (`useRecruiterReportData.ts` + `RecruiterReportsPanel.tsx`) clearly gates to Growth/Fleet active/trialing.
- Update `.lovable/plan.md` Phase 3 truth table to read: **Recruiter Activity & Pipeline reports — Growth + Fleet only**.
- Grep all marketing/FAQ/feature copy for any "Starter ... reports" claim and correct (current Pricing/Landing/RecruiterFAQ already say Growth+, so likely no copy edits — verify and report).

## 2. Contract Protection plan gating (Option B — preferred)

Gate recruiter-side Contracts to Growth/Fleet only. Driver-side stays unchanged.

Implementation:
- **`src/components/contracts/RecruiterContractsView.tsx`** — at top of component, read `useRecruiterBilling()`. If `plan !== 'growth' && plan !== 'fleet'` or not billing-active, render a locked preview Card with:
  - Lock icon + "Contract Protection — Growth & Fleet"
  - 3-bullet what-you-get list (upload, AI risk review, driver approval gate)
  - "Upgrade to Growth" CTA → `startCheckout.mutate('growth')`
  - Skip the data fetch entirely (return before hooks that query apps/pipeline are needed — restructure so billing check happens after `useRecruiterProfile` + `useRecruiterBilling` only).
- **`src/components/BottomNav.tsx`** — keep Contracts entry visible for all recruiters (the locked card handles education). No nav change needed.
- **`src/pages/Index.tsx`** — no change; the view itself handles gating.
- **`src/components/contracts/ContractAttachment.tsx`** — no change. Driver-side review still works when a contract exists. Recruiter-side upload UI inside ContractAttachment is only reached from RecruiterContractsView, which is now gated.
- **Copy alignment** — Pricing (line 398), RecruiterLanding, RecruiterFAQ already position Contract Protection as Growth+. Verify wording is consistent ("included with Growth and Fleet"). Fix Pricing line 398 which says "Recruiter plans also include the Contract Protection workflow" — change to "Growth and Fleet plans include the Contract Protection workflow".
- **`src/lib/recruiterFeatureList.ts`** — ensure Contract Protection items are tagged as Growth+ if there's a plan badge field; otherwise add a note.

No DB / RLS change. Server-side, all recruiters can technically still hit contract RPCs — acceptable for launch since UI gates access and the surface is low-risk; note as post-launch hardening.

## 3. Signature-required wording fix
Search recruiter-facing copy + feature lists for any phrase implying signature is required for hire:
- `src/pages/recruiter/RecruiterGuide.tsx` line 16: "approve / request changes / reject / sign. You cannot mark hired until required steps complete." — rewrite.
- `src/lib/recruiterFeatureList.ts`, `src/lib/featureList.ts` Contract Protection entries.
- `src/components/landing/RecruiterLanding.tsx` lines 37, 44.
- `src/pages/FAQ.tsx` line 573, `src/pages/recruiter/RecruiterFAQ.tsx` Contract Protection answer.

Replace with the exact approved sentence:
> "Recruiters can't mark a driver hired until the driver approves the current contract. If the driver also signs, HaulTrackerPro stores an in-app signature record."

## 4. Public bucket correction
Confirmed: the only public storage bucket is `lead-magnets` (not `avatars`). Update `.lovable/plan.md` Phase 3 report:
- Change "public bucket: avatars" → "public bucket: lead-magnets, contains only the free Trucker Starter Kit download asset (intended public)".
- Note: warning is expected and safe.

## 5. Real production build
Run `bun run build` (or `vite build`) and capture:
- pass/fail
- top 10 chunk sizes (gz)
- any warnings

Report verbatim in the launch report. No code changes triggered unless build fails.

## 6. Real mobile QA at 375×812
Use browser tool: `navigate_to_sandbox` with width 375, height 812. Walk the 10 routes listed in the audit. For each, screenshot + check:
- no horizontal overflow
- bottom nav + More sheet
- key controls reachable

Report per-route pass/fail. Fix only blockers (≤30 LOC each).

## 7. Corrected launch report
Write a fresh report to `.lovable/plan.md` (append "Phase 3.1 Correction") with:
- corrected truth table
- exact files changed list
- proof Contract Protection gating matches Pricing (cite line numbers in RecruiterContractsView + Pricing.tsx)
- build output summary
- mobile QA matrix
- corrected score + final launch / no-launch call

## Files likely touched
1. `src/components/contracts/RecruiterContractsView.tsx` — add billing gate + locked preview
2. `src/pages/Pricing.tsx` — line ~398 copy tweak
3. `src/pages/recruiter/RecruiterGuide.tsx` — signature wording
4. `src/components/landing/RecruiterLanding.tsx` — signature wording
5. `src/pages/FAQ.tsx` + `src/pages/recruiter/RecruiterFAQ.tsx` — signature wording
6. `src/lib/featureList.ts` + `src/lib/recruiterFeatureList.ts` — signature wording
7. `.lovable/plan.md` — corrected report
8. (Conditional) mobile-overflow fixes if QA finds any

Approve to proceed.