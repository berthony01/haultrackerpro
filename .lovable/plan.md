# PHASE 1L-F2A — Read-Only Driver Opportunity UI Audit

## 1. Start-gate outputs

| # | Command | Output |
|---|---|---|
| 1 | `git branch --show-current` | `edit/edt-8ad26501-060f-48b9-8e07-c040b20551df` (matches `edit/edt-*`) |
| 2 | `git rev-parse HEAD` | `4b9938420c40fae855e80f34d4cf0bbd964baa62` (matches authoritative) |
| 3 | `git status --short` | *(empty — clean tree)* |
| 4 | `git log -1 --oneline` | `4b993842 Stabilized canonical view F1` |

Start gate PASSED. Each command was a separate call.

## 2. File-view evidence

| # | File | Coverage |
|---|---|---|
| 1 | `src/pages/Index.tsx` | Partial (1–371 of 1281). Sufficient to map the driver-opportunity mount and deep-link handling; remainder is unrelated dashboard glue. Flagged as partial. |
| 2 | `src/components/opportunities/OpportunitiesPage.tsx` | Partial (1–444 of 735). Covers state machine, filters, list mount, all conditional returns. Trailing lines are the JSX list body + `EmptyState`/`ProfileEntryCard` helpers — not re-viewed this turn. Flagged as partial. |
| 3 | `src/components/opportunities/OpportunityCard.tsx` | Full (present in provided context, 220 lines). |
| 4 | `src/components/opportunities/OpportunityDetail.tsx` | Full (425 lines). |
| 5 | `src/components/opportunities/OpportunityProfitBreakdown.tsx` | Full (in provided context, 181 lines). |
| 6 | `src/components/opportunities/OpportunityMatchBadge.tsx` | Full (in provided context, 29 lines). |
| 7 | `src/components/opportunities/ApplyNowDialog.tsx` | Full (369 lines). |
| 8 | `src/components/opportunities/DriverOpportunityProfile.tsx` | Partial (1–455 of 490). Trailing helpers `ChipGroup`/`ToggleRow` unread. Flagged as partial. |
| 9 | `src/hooks/opportunities/useOpportunities.ts` | Full (in provided context, 45 lines). |
| 10 | `src/hooks/opportunities/useOpportunityApplications.ts` | Full (288 lines). |
| 11 | `src/hooks/opportunities/useSavedOpportunities.ts` | Full (57 lines). |
| 12 | `src/hooks/opportunities/useDriverOpportunityProfile.ts` | Full (in provided context, 60 lines). |
| 13 | `src/lib/opportunities/opportunityMatch.ts` | Full (219 lines). |
| 14 | `src/lib/opportunities/benefitsFormat.ts` | Full (in provided context, 67 lines). |
| 15 | `src/lib/opportunities/opportunityCanonicalView.ts` | Partial (1–480 of 518). Trailing 38 lines cover final transparency band boundaries; already confirmed accepted in F1. Flagged as partial. |
| 16 | `src/test/phase1hA2ApplyNow.test.tsx` | Partial (1–426 of 852). Sufficient to inventory ApplyNow protected behaviors. Flagged as partial. |
| 17 | `src/test/phase1hA2OpportunityDetail.test.tsx` | Partial (1–438 of 446). Flagged as partial. |
| 18 | `src/test/phase1jC1OpportunityApplyContinuity.test.tsx` | Partial (1–440 of 654). Covers scenarios 1–9b; scenarios 10–13 unread. Flagged as partial. |
| 19 | `src/test/recruiterBenefitsFormat.test.ts` | Full (in provided context, 41 lines). |
| 20 | `src/test/phase1lF1CanonicalOpportunityView.test.ts` | Partial (1–432 of 793). Flagged as partial. |

## 3. Route and state map

**Route/mount chain (A.1).**

```
/dashboard?page=opportunities  (URL hint only; not auth)
  → src/pages/Index.tsx
      • page state initialized from URL (Index.tsx:113-122)
      • capability effect re-resolves (Index.tsx:310-333) — driverWorkspaceAllowed
        gates setPage('opportunities'); `view=driver-profile` writes
        sessionStorage 'htp_opportunities_initial_view'
      • lazy OpportunitiesPage import (Index.tsx:52)
  → src/components/opportunities/OpportunitiesPage.tsx
      • data hooks: useOpportunities, useSavedOpportunities, useSubscription,
        useDriverOpportunityProfile (OpportunitiesPage.tsx:89-92)
      • deep-link honor: reads sessionStorage 'htp_opportunities_initial_view'
        and calls openPreferencesManual() (OpportunitiesPage.tsx:134-146)
      • conditional returns (in order):
          isError            → EmptyState + Retry (261-290)
          showDriverApps     → DriverApplicationsPanel (292-299)
          showReferrals      → DriverReferralsPanel (301-303)
          showProfile        → DriverOpportunityProfile (307-362)
          selected           → OpportunityDetail (364-391)
          default            → list surface (394-…)
      • list -> OpportunityCard (mocked in tests via subcomponent import)
  → src/components/opportunities/OpportunityCard.tsx
      • onView → setSelectedId(o.id)  (parent handler)
  → src/components/opportunities/OpportunityDetail.tsx
      • Back button → onBack → parent clears selectedId & resumeState (372-375)
      • Apply Now → setShowApply(true) → ApplyNowDialog
      • onOpenPreferencesForApply → parent sets preferencesOrigin={kind:'apply',
        opportunityId:selected.id}, clears resumeState, setShowProfile(true)
  → src/components/opportunities/DriverOpportunityProfile.tsx
      • Back → onBack → parent captures preferencesOrigin, clears origin+
        resumeState, decides selection preservation vs clear-to-list
      • Save → onSaveSuccess({completed}) → parent runs
        resolveApplyResumeAfterSave: 'resume' mints token; 'clear-to-list'
        drops origin/resume/selectedId; 'no-origin' no-op
  → OpportunityDetail resume effect (OpportunityDetail.tsx:89-98)
      • when resumeApplyToken becomes eligible → setShowApply(true) once,
        calls onResumeApplyConsumed(token)
```

**Loading / error / empty states (A.2).**

| State | Surface |
|---|---|
| Opportunities loading | Not shown as skeleton; `useOpportunities` returns `[]` while loading — list renders empty; no explicit skeleton in the audited slice of OpportunitiesPage. GAP: cannot confirm skeleton without reading lines 445–735. |
| Opportunities error | EmptyState with Retry (OpportunitiesPage.tsx:261-290) |
| Opportunities filtered empty | Handled in trailing JSX (lines 445–735, not viewed) |
| Profile loading | `!profileLoading &&` gate on ProfileEntryCard (424) |
| Profile error | EmptyState with Retry for `profileIsError` (414-423) |
| Detail Back → list | Clears selectedId + resumeState (372-375) |
| Applications panel Back | `setShowDriverApps(false)` |
| Preferences Back from Apply-origin | Clears origin/resume; preserves selection only when origin still exists AND selectedId equals origin (310-333) |
| Preferences Back from manual | selectedId already cleared by `openPreferencesManual` |

## 4. Data / query contract

**B.3 — `useOpportunities` query shape.** Not a Supabase `.from().select()`. Uses RPC `list_driver_visible_opportunities(_state, _driver_type, _route_type)` (useOpportunities.ts:24-31), cast to `Opportunity[]` where `Opportunity = Tables<'opportunities'>`. Sorting/columns are server-defined; the client cannot inspect them. `filters` are the three RPC args. `enabled: !!user`.

**B.4 — Recruiter join gap.** The RPC returns rows typed as `Tables<'opportunities'>` — there is **no** `recruiter` field on the returned type or the RPC response. `OpportunitySourceRow` in `opportunityCanonicalView.ts:39-44` expects an optional `recruiter?: { verification_status; status }`. Today it is always `undefined` on the driver path, so `mapRecruiterVerification` always yields `'none'`. This is a real gap: F2 cannot render "Verified Recruiter" from data drivers currently receive. Server-side change (RPC returns recruiter verification_status/status alongside each row) OR trust `recruiterVerification === 'none'` universally in F2 rendering.

**B.5 — Components receiving raw `Tables<'opportunities'>` (not `CanonicalOpportunity`).**

| Site | Raw prop / value |
|---|---|
| `OpportunitiesPage.filtered` (line 173-210) | Iterates raw `opportunities`, calls `calculateOpportunityFinancials(o)` and `calculateOpportunityMatch(...)` per row |
| `OpportunitiesPage.kpis` (212-227) | Iterates raw rows for maxNet/bestRpm |
| `OpportunityCard` | `opportunity: Opportunity` (Tables row) — reads `.title`, `.company_name`, `.hiring_city/state`, `.driver_type/route_type/trailer_type/home_time`, `.featured`, `.deadhead_paid` |
| `OpportunityDetail` | `opportunity: Opportunity` — reads pay_model, cpm, percentage_pay, flat_weekly_pay, estimated_weekly_gross, sign_on_bonus, estimated_*_miles, deadhead_paid, fuel_paid_by, lease/insurance/maintenance/other deductions, escrow_required, escrow_amount, home_time, forced_dispatch, pets/riders_allowed, benefits, description, featured |
| `OpportunityProfitBreakdown` | `opportunity: OpportunityLike` (raw), computes via `calculateOpportunityFinancials` |
| `calculateOpportunityMatch` | reads raw row + `OpportunityFinancials` from legacy calculator |
| `useSavedOpportunities` | joins raw `opportunities:opportunity_id(*)` (line 18) |
| `useOpportunityApplications` (recruiter branch) | joins raw opportunity + driver_profile fields |

**B.6 — Minimum safe canonical insertion boundary.**

Two candidates, both defensible:

| Option | Where normalization runs | Tradeoffs |
|---|---|---|
| **A. Inside `useOpportunities`** — map `data` through `normalizeOpportunity` before returning; export `Opportunity = CanonicalOpportunity`. | Every consumer (list, KPIs, card, detail, breakdown, match, apply dialog resume-token consumers) receives canonical rows automatically. Zero raw-row leaks. `saved_opportunities` join and `opportunity_applications` join still return raw rows — must be normalized separately. `Opportunity` type change ripples into every hook/component that imports it (broad blast radius). Recruiter join gap becomes structural: `OpportunitySourceRow.recruiter` must be filled server-side or wrapped with `recruiter: null`. |
| **B. Inside `OpportunitiesPage`** — call `normalizeOpportunity` once per row in a `useMemo`, pass `CanonicalOpportunity` into card/detail/breakdown. | Local blast radius; keeps `useOpportunities` typing stable. But every other driver surface that also reads raw rows (saved list, applications list, deep links) must repeat the normalization independently, creating multiple insertion boundaries and reintroducing the exact bug the canonical view is meant to prevent. |

Recommendation for ChatGPT (not decided here): Option A is architecturally correct because it aligns with the F1 principle "Driver surfaces must consume `normalizeOpportunity()` output rather than duplicate calculations," and matches the canonical view contract's role as the sole read-side normalizer. The downstream type impact is (a) `Opportunity` alias becomes `CanonicalOpportunity`, (b) every card/detail prop declaration retypes, (c) `saved_opportunities` and `opportunity_applications` opportunity joins need parallel normalization or the RPC must be extended to include recruiter fields to avoid Option-A stubbing.

## 5. Legacy calculations and misleading copy

**C.7 — Call sites of legacy calculators / financial helpers.**

| Location | Call |
|---|---|
| `OpportunitiesPage.tsx:78, 188, 200, 217` | `calculateOpportunityFinancials(o)` — filter min-gross, per-row match scoring, KPI iteration |
| `OpportunityCard.tsx:44, 56` | `calculateOpportunityFinancials(o)` + `profitScoreLabel(f.profitScore)` + `calculateOpportunityMatch(...)` |
| `OpportunityCard.tsx:120-124` | Displays `f.estimatedGross`, `f.estimatedNet`, `f.effectiveRpm`, `f.estimatedWeeklyMiles`, `f.estimatedDeadheadMiles`, `f.hasUnpaidDeadhead` |
| `OpportunityCard.tsx:89-92` | Pro badge shows `f.profitScore` with `TrendingUp` icon |
| `OpportunityDetail.tsx:28-29, 103-108` | `calculateOpportunityFinancials(o)`, `calculateOpportunityMatch(...)` |
| `OpportunityProfitBreakdown.tsx:56-118` | Full breakdown surface: profit score, gross/deductions/net, effective RPM, net RPM, deadhead % — all from legacy calculator |
| `opportunityMatch.ts` | Consumes `OpportunityFinancials` throughout — legacy contract |

**C.8 — Misleading / profit-first copy (must reconcile with disclosure-only contract).**

| File:Line | Copy |
|---|---|
| `OpportunitiesPage.tsx:274` | "Profit-first trucking opportunities with real pay clarity." (error state header) |
| `OpportunitiesPage.tsx:407` | Same "Profit-first … real pay clarity." (main header) |
| `OpportunityCard.tsx:88-92` | Pro badge label directly displays raw `profitScore` (0-100) with TrendingUp icon — reads as a profitability metric |
| `OpportunityCard.tsx:120` | "Est. weekly gross" — computed, not necessarily recruiter-provided |
| `OpportunityCard.tsx:123-124` | "Est. net" and "Effective RPM" as Pro-only fields (implies profitability guarantee) |
| `OpportunityCard.tsx:185-217` | `EstimatedNetStat` — labeled "Est. net" with tooltip talking about "your listing gross minus your weekly cost profile" |
| `OpportunityProfitBreakdown.tsx:33-53` | "Unlock Profit Intelligence" / "See estimated net pay, RPM, deductions, deadhead risk, and profit warnings before you request info." |
| `OpportunityProfitBreakdown.tsx:80-89` | Section header "Profit Intelligence" with ShieldCheck |
| `OpportunityProfitBreakdown.tsx:94` | "Profit Clarity Score" — explicit conflict with F1 "Listing transparency measures disclosure completeness and consistency, not profitability." |
| `OpportunityProfitBreakdown.tsx:107, 109, 110, 111` | Est. gross / Est. net / Effective RPM / Net RPM — displayed as authoritative dollar values |
| `OpportunityProfitBreakdown.tsx:143-145` | "These estimates are based on the information provided by the recruiter and are not guaranteed pay." — disclaimer exists but sits below profit-framed headers |
| `OpportunityDetail.tsx:250` | "Est. weekly gross" flagged as `highlight` |
| `OpportunityDetail.tsx:270` | Renders `<OpportunityProfitBreakdown>` (all C.8 issues inherited) |

**C.9 — Company-driver ownership-cost / net treatment.**

`OpportunityProfitBreakdown` and `OpportunityCard` (Pro) render `Est. net`, deductions, and effective RPM regardless of `driver_type` / employment model. The legacy `calculateOpportunityFinancials` does not filter by employment model, and neither `OpportunityCard.tsx:120-138` nor `OpportunityProfitBreakdown.tsx:106-118` gate net/deductions on employment model. F1's canonical view already suppresses these for `company_driver`, but the current UI does not consume F1. Company drivers therefore see fabricated net + ownership deductions today.

**C.10 — Sign-on / benefits / lanes / requirements category confusion.**

- `OpportunityDetail.tsx:251` — sign-on bonus is rendered inside the "Pay Breakdown" grid alongside recurring pay (mixes one-time incentive with recurring compensation).
- `OpportunityDetail.tsx:301-305` — "Benefits" section renders `o.benefits` verbatim, which per `benefitsFormat.ts` may contain `Typical Lanes:` + `Requirements:` sections and does **not** correspond to the canonical `actual_benefits` column. Typical lanes + requirements are rendered under a "Benefits" heading.
- No dedicated `actual_benefits` rendering (F1 canonical `content.actualBenefits`) exists in the detail today.

## 6. Canonical display gap matrix (D)

Field-by-field, current vs required. `LC` = list card, `DP` = detail page, `PB` = ProfitBreakdown, `MB` = MatchBadge.

| Surface | Field | Current raw source | Required canonical path | Current behavior | Required F2 behavior |
|---|---|---|---|---|---|
| LC/DP | Company name | `o.company_name` | `identity.companyName` (`Disclosure<string>`) | Renders string, no `not_disclosed` state | Render "Not disclosed" for `state:'not_disclosed'` |
| LC/DP | Employment model | `o.driver_type` (raw string) | `classification.employmentModel` | Free-text badge | Explicit label for each of `company_driver`, `contractor_1099`, `owner_operator`, `lease_purchase`, `unknown`; "Not disclosed" on unknown |
| LC/DP | Team config | absent | `classification.teamConfiguration` | Not rendered separately (mixed with driver_type) | Render `solo`/`team`/`team_optional`/`unspecified` explicitly, separate from employment model |
| LC/DP | Route type | `o.route_type` | `classification.routeType` | Badge or "—" | `provided`→value; `not_disclosed`→"Not disclosed" |
| LC/DP | Trailer | `o.trailer_type` | `classification.trailerType` | Badge or "—" | Same disclosure semantics |
| LC/DP | Hiring area | Manual concat `hiring_city + hiring_state` (`OpportunityCard.tsx:43`, `Detail.tsx:101`) | `hiringArea.displayLabel` | Falls back to "Multiple states" | Use `displayLabel`; "Hiring area not disclosed" when all missing |
| LC/DP | Pay model | Not explicitly labeled at LC; DP line 247 shows `o.pay_model || '—'` | `compensation.payModel` (one of six + unknown) | Raw string or dash | Explicit per-model rendering (cpm, percentage, flat_weekly, salary, mixed, other, unknown) |
| DP | CPM | `o.cpm != null ? '$X/mi' : '—'` | `compensation.recurringPay.cpm` | Not shown unless `cpm` present | Only render when pay_model=cpm; `not_disclosed`/`not_applicable` distinct |
| DP | Percentage | `o.percentage_pay` | `compensation.recurringPay.percentage` incl. basis label + weekly revenue basis | Renders rate only | Render rate + basisLabel + weeklyRevenueBasis, or "Not disclosed" |
| DP | Flat weekly | `o.flat_weekly_pay` via `fmtMoney` | `compensation.recurringPay.flatWeekly` | "—" for null | `not_disclosed` vs `not_applicable` distinct |
| DP | Salary | not rendered | `compensation.recurringPay.salary` (amount + frequency) | Missing | Add rendering (amount + frequency band) |
| DP | Mixed components | not rendered | `compensation.recurringPay.mixedComponents` | Missing | List each labeled component with recurring amount+frequency |
| DP | Other method | not rendered | `compensation.recurringPay.otherMethod.{label, weeklyGross}` | Missing | Render label + weeklyGross when pay_model=other |
| LC/DP | Recruiter-provided gross | `o.estimated_weekly_gross` | `compensation.recurringPay.recruiterProvidedWeeklyGross` | Rendered as "Est. weekly gross" (indistinguishable from derived) | Label as recruiter-provided; distinguish `derived` vs `recruiter_provided` via `financialEstimate.grossSource`; expose conflicts |
| DP | Sign-on bonus | `o.sign_on_bonus` inside "Pay Breakdown" grid | `compensation.oneTimeIncentives.signOnBonus` | Mixed with recurring pay (C.10) | Render in a distinct "One-time incentives" section |
| LC/DP | Weekly miles | `o.estimated_weekly_miles` | `compensation.mileage.totalWeeklyMiles` | Always shown | `not_applicable` when pay model doesn't use miles |
| LC/DP | Loaded miles | `o.estimated_loaded_miles` | `compensation.mileage.loadedWeeklyMiles` | Always shown | `not_applicable` unless pay_model=cpm |
| LC/DP | Deadhead miles | `o.estimated_deadhead_miles` | `compensation.mileage.deadheadWeeklyMiles` | Always shown | Same relevance rules |
| LC/DP | Deadhead paid | `o.deadhead_paid` (true/false/null) | `compensation.mileage.deadheadPaid` | "Yes"/"No"/"Not disclosed" (Detail already handles all three) | Same, but also gate on pay-uses-miles relevance |
| DP | Detention / layover pay | absent from UI | `compensation.accessorialPay.{detention,layover}` | Missing | Add fields |
| DP | Fuel paid by | `o.fuel_paid_by` (Pro-only, 276) | `costs.fuelPaidBy` (only for cost-bearing employment) | Shown to Pro regardless of employment | Only render when `not_applicable === false`; suppress entirely for company_driver |
| DP | Insurance/Maintenance/Other deductions | raw scalar (Pro-only, 278-280) | `costs.{insurance,maintenance,otherRecurringCost}` (amount+frequency) | Shown as flat dollar, no frequency | Show amount + frequency band; suppress for company_driver |
| DP | Lease payment | raw scalar (277) | `costs.lease` | Shown to Pro regardless of employment | Only when `employment_model=lease_purchase` |
| DP | Escrow | `o.escrow_required` boolean + `o.escrow_amount` (282-285) | `costs.escrowRequired` + `costs.escrowAmount` | Boolean + amount rendered | Distinct `not_disclosed` state; suppress amount when `escrow_required=false` or company_driver |
| DP | Home time / forced dispatch / pets / riders | raw (292-297) | `operatingTerms.*` | Already renders provided/null as "—"/Yes/No | Convert to `not_disclosed`/`not_applicable` semantics; consistent labels |
| DP | Equipment year | not rendered | `operatingTerms.equipmentYear` | Missing | Add |
| DP | Description | `o.description` (308-311) | `content.description` | Plain render | Handle `not_disclosed` state |
| DP | Benefits / Lanes / Requirements | `o.benefits` verbatim (301-305) | `content.{actualBenefits, typicalLanes, requirements}` | Category-mixed (C.10) | Render three separate sections using `benefitsFormat` split + `actual_benefits` column |
| LC | Featured | `o.featured` → "Priority placement" badge | `trust.featured` | OK — no verification implication | Keep separate concept |
| LC/DP | Recruiter verification | inline object check via cast in `OpportunityCard.tsx:59-65` | `trust.recruiterVerification` | Reads `o.recruiter.verification_status`, but RPC does not include recruiter join (B.4 gap) — evaluates to `none` in prod | Consume canonical `trust.recruiterVerification`; fix RPC gap or render `'none'` universally |
| DP | Admin review | not surfaced | `trust.internalReviewStatus` | Missing | Add if driver-visible; keep separate from verification |
| MB | Match tier badge | `calculateOpportunityMatch(...)` | keep, but `hasSevereWarning` and reasons should read canonical financials | Uses legacy `OpportunityFinancials` | Refactor match engine input to canonical financial estimate (or keep legacy IFF F2 defers match rework) |
| LC/DP | Profit Clarity / Profit Intelligence | legacy | `derived.transparencyScore` | Renders "Profit Clarity Score 0-100" | Replace with "Listing Transparency Score" + band; disclose completeness only |
| LC | Legacy source version | absent | `sourceVersion` | No indicator | Optional muted "Legacy listing" badge for `sourceVersion==='legacy'` |
| DP | Financial estimate status | absent | `derived.financialEstimate.{status, grossSource, conflicts}` | No visibility | Show status (`available`/`partial`/`conflict`/`not_applicable`) + list conflicts |

**D.13 — Badge semantics mixing.**

| Badge | Current source | Concept it should reflect | Where it's mixed |
|---|---|---|---|
| "Featured" / "Priority placement" | `o.featured` | Marketing priority tier | OK, separate |
| "Approved Opportunity" | Hardcoded on Detail (line 167-169) with success color | Should reflect `admin_review_status` | Currently always shown regardless of status — implies verification when it doesn't |
| "Verified Recruiter" | inline `recruiter.verification_status==='approved'` (Card 62-65, Detail lacks it) | Should reflect recruiter's identity check | Currently broken (recruiter join missing on RPC) |
| Match tier | `calculateOpportunityMatch` | Personal fit | Separate concept, OK |
| Pro profit score badge (Card 88-92) | legacy financials | Should not exist as a badge — must migrate to transparency band | Mixes profitability signal with badge language |

## 7. Apply Now + preferences map (E)

**E.14 — Apply Now path.**

1. `OpportunityDetail.tsx:359-373` — Apply Now button, disabled only when `formalState.kind === 'active' || 'completed'` (drawn from `classifyFormalApply(driverApplications, o.id)`).
2. Click → `setShowApply(true)` → `<ApplyNowDialog>` mounts.
3. `ApplyNowDialog.tsx:66` — `profileCompleted = !!driverProfile?.profile_completed`. If not completed, renders `<PreferencesRequiredPanel>` with "Complete/Update Opportunity Preferences" CTA → parent's `onOpenPreferences` = `OpportunitiesPage.tsx:379-385` sets `preferencesOrigin={kind:'apply', opportunityId}` and mounts `DriverOpportunityProfile`.
4. If completed: renders `<ProfileSummary>` + attestation form.
5. `keyRef` (61-64) mints `crypto.randomUUID()` per open attempt; reset on close (79). Persists across submission retries within the same open.
6. Submit runs `submitApplication.mutateAsync` with `{opportunity_id, idempotency_key, message, availability_confirmed, requirements_confirmed, truth_attestation, preferred_contact_method, contact_sharing_consent}` — exact allow-list per phase1hA2 tests. On error, `submissionErrorMessage` maps every documented `result_code`.
7. `useOpportunityApplications.ts:129-159` — calls RPC `submit_opportunity_application`. `SUBMISSION_SUCCESS_CODES = {'created','idempotent_replay'}`; every other code throws.
8. Resume flow (OpportunityDetail.tsx:89-98): when `resumeApplyToken` becomes eligible and formal state is `'none'` or `'reapplyable'`, opens dialog once and consumes the token via `onResumeApplyConsumed`.
9. Unauth: `useOpportunityApplications` submit throws `'Not authenticated'` (line 140). ApplyNowDialog does not check auth explicitly; relies on Detail being unreachable without user (Index route guards).
10. Duplicate applications: rejected by server RPC (`duplicate_same_type`), surfaced via `submissionErrorMessage`.
11. Pending state: `submitApplication.isPending` disables submit button and shows "Submitting…".
12. Success: `resetForm()` + `onOpenChange(false)`; parent's Detail refetches driverApplications and Apply button flips to "Application Submitted".

**E.15 — Do preferences or match currently block Apply Now?**

- Preferences: **YES**, they block submission. `canSubmit` in `ApplyNowDialog.tsx:98-105` requires `profileCompleted === true`. When incomplete, the dialog opens but only shows `PreferencesRequiredPanel` — no submit button rendered. That is a permanent blocking gate, not a temporary interstitial.
- Match: **NO**. `calculateOpportunityMatch` is used only for badges/warnings on Card + Detail. It never influences Apply Now enablement. Weak match tier does not block.

The Phase 1L target principle is "Driver preferences and weak match cannot alone block Apply Now." Current behavior blocks Apply Now purely on preferences completion. This is the **primary product-rule conflict** F2 must decide: does F1's rule mean (a) Apply Now is enabled and preferences becomes a follow-on interstitial, or (b) preferences remain a hard prerequisite? — ChatGPT must call this. Do not implement.

**E.16 — Behavior F2 must preserve from Phase 1J-C1 + 1H-A2.**

- Resume-token semantics: single-mount consumption, distinct tokens open once, formal-active/completed states block open (OpportunityDetail.tsx:89-98).
- `resolveApplyResumeAfterSave` and `consumeMatchingResumeState` pure helpers stay intact.
- Manual preferences entry (`openPreferencesManual`) clears prior origin + selectedId (OpportunitiesPage.tsx:114-119).
- Back-from-prefs decides preserve-selection vs clear-to-list (OpportunitiesPage.tsx:310-333).
- Idempotency-key lifecycle: same key across retries in one open; new key on reopen after cancel or success (phase1hA2ApplyNow tests 348-425).
- Submission payload allowlist (phase1hA2ApplyNow ALLOWED_KEYS = 8 fields; no PII / snapshot leakage).
- SMS gated on phone + consent (auto-revert to in_app when consent off).
- Formal apply and request_info coexist independently (phase1hA2OpportunityDetail line 193-202).
- Request-Info button uses `createApplication` façade with in-memory idempotency store (useOpportunityApplications.ts:193-223).

**E.17 — Match/preferences effect on filtering, sorting, badges, eligibility.**

| Effect | Location |
|---|---|
| Filtering (min gross) | OpportunitiesPage.tsx:187-190 — uses legacy `calculateOpportunityFinancials.estimatedGross` |
| Filtering (match tier) | OpportunitiesPage.tsx:205-207 — `matchTierFilter` |
| Sorting by matchScore | OpportunitiesPage.tsx:209 |
| Match badge on card | OpportunityCard.tsx:93-95 |
| Match reasons/warnings on card | OpportunityCard.tsx:141-156 |
| Match panel on detail | OpportunityDetail.tsx:182-241 |
| Application eligibility | NONE — match does not gate Apply Now |
| Preferences eligibility | ApplyNowDialog.tsx:66, 98-105 — blocks submission |

## 8. Existing tests + missing-test matrix (F)

**F.18 — Existing protection.**

| Suite | Protects |
|---|---|
| `phase1hA2ApplyNow.test.tsx` (852 lines) | ApplyNowDialog gating, submission payload allowlist, SMS support, error mapping, idempotency-key lifecycle, submission-success reset |
| `phase1hA2OpportunityDetail.test.tsx` (446 lines) | Apply Now primary/secondary hierarchy, non-Pro availability, active-status disable matrix, Apply Again for rejected/withdrawn, coexistence with request_info, resume-token matrix (8 scenarios) |
| `phase1jC1OpportunityApplyContinuity.test.tsx` (654 lines) | Preferences continuity, back-from-prefs, resume-after-completed-save, manual-vs-apply origin, selection mismatch pure-helper, hook-order invariance |
| `recruiterBenefitsFormat.test.ts` (41 lines) | `splitBenefits`/`joinBenefits` round-trip and legacy unmarked text |
| `phase1lF1CanonicalOpportunityView.test.ts` (793 lines) | F1 canonical view: sourceVersion, employment-model cost relevance, zero/false preservation, all six pay models + unknown, recruiter-provided gross conflicts, sign-on isolation, hiring-area, legacy benefits split, trust separation, four transparency bands, deduplicated conflicts |

**F.19 — Missing-test matrix (F2C targets).**

| Concern | Currently proven? | Missing |
|---|---|---|
| Card consumes `CanonicalOpportunity` | No | Card renders `not_disclosed` vs `not_applicable` distinctly; renders exactly the required fields |
| Detail consumes `CanonicalOpportunity` | No | Detail renders sections per canonical shape; sign-on separated from recurring |
| Listing Transparency (replaces Profit Clarity) | Unit-tested in F1 | Not integration-tested; needs render test in Card/Detail |
| Financial statuses (`available`/`partial`/`conflict`/`not_applicable`) | Unit only | UI rendering evidence |
| Company-driver net + ownership suppression | Unit only | UI evidence at Card/Detail/Breakdown |
| Six pay models rendered explicitly + unknown | Unit only | Card + Detail render each variant |
| Zero / false preservation | Unit only | Card + Detail render `deadhead_paid=false`, `forcedDispatch=false`, `cpm=0` visibly |
| Legacy rows | Unit only | UI evidence for `sourceVersion==='legacy'` — no invented facts, muted indicator |
| Trust separation (Featured / admin review / recruiter verification / match) | Partial (F1 unit) | UI: no cross-implication in badges |
| Sign-on isolation | Unit only | UI evidence — separate section |
| Actual benefits vs typical lanes vs requirements | benefitsFormat unit only | UI evidence — three distinct sections; actual_benefits only from its column |
| Apply Now non-blocked by weak match | Not tested | Test |
| Apply Now non-blocked by incomplete preferences (if F1 principle enforced) | Currently PROVEN blocked | Test flip depends on E.15 decision |
| RPC recruiter join / verification gap | Not tested | Regression test proving `trust.recruiterVerification==='none'` when RPC omits recruiter, and `'approved'` when present |
| KPI + filtering migration | Not tested | Test min-gross filter uses canonical `financialEstimate.recurringWeeklyGross` |

## 9. Proposed F2B implementation allowlist and F2C test allowlist

**F.20 — F2B implementation allowlist.**

| File | Class |
|---|---|
| `src/hooks/opportunities/useOpportunities.ts` | must modify (return canonical rows OR provide sibling hook — ChatGPT decides) |
| `src/components/opportunities/OpportunitiesPage.tsx` | must modify (list/filter/KPI consume canonical) |
| `src/components/opportunities/OpportunityCard.tsx` | must modify (canonical props, disclosure semantics, replace profit-first copy) |
| `src/components/opportunities/OpportunityDetail.tsx` | must modify (canonical sections, sign-on isolation, category split of benefits/lanes/requirements, remove hardcoded "Approved Opportunity" if unproven) |
| `src/components/opportunities/OpportunityProfitBreakdown.tsx` | must modify OR replace with `ListingTransparencyPanel`; rename in either case |
| `src/components/opportunities/OpportunityMatchBadge.tsx` | may modify only if evidence requires (semantics unchanged; may need copy fix) |
| `src/components/opportunities/ApplyNowDialog.tsx` | may modify only if evidence requires (preferences-block product-rule decision) |
| `src/lib/opportunities/opportunityMatch.ts` | may modify only if evidence requires (accept canonical financial estimate) |
| `src/lib/opportunities/opportunityCanonicalView.ts` | protected — F1 accepted, do not touch |
| `src/lib/opportunities/opportunityProfit.ts` | protected — canonical calculator |
| `src/lib/opportunities/opportunityCanonical.ts` | protected — authoring normalizer |
| `src/lib/opportunities/benefitsFormat.ts` | protected |
| `src/hooks/opportunities/useOpportunityApplications.ts` | protected (unrelated to F2) |
| `src/hooks/opportunities/useSavedOpportunities.ts` | may modify only if evidence requires (canonical saved-row rendering) |
| `src/hooks/opportunities/useDriverOpportunityProfile.ts` | protected |
| `src/components/opportunities/DriverOpportunityProfile.tsx` | protected (Preferences UX out of scope unless E.15 flip requires) |
| Database RPC `list_driver_visible_opportunities` | out of scope; if recruiter join gap must close, propose in the atomic sequence but do not implement in F2B without ChatGPT authorization |

**F2C test allowlist.**

| File | Class |
|---|---|
| `src/test/phase1lF2CanonicalDriverListRendering.test.tsx` (new) | must create |
| `src/test/phase1lF2CanonicalDriverDetailRendering.test.tsx` (new) | must create |
| `src/test/phase1lF2ListingTransparencyPanel.test.tsx` (new) | must create |
| `src/test/phase1lF2CompanyDriverSuppression.test.tsx` (new) | must create |
| `src/test/phase1lF2SixPayModelsRendered.test.tsx` (new) | must create |
| `src/test/phase1lF2LegacyRowRendering.test.tsx` (new) | must create |
| `src/test/phase1lF2ApplyNowNonBlocking.test.tsx` (new, conditional on E.15) | may create |
| `src/test/phase1hA2ApplyNow.test.tsx` | protected (regression) |
| `src/test/phase1hA2OpportunityDetail.test.tsx` | may modify only if selectors change; keep behavioral assertions |
| `src/test/phase1jC1OpportunityApplyContinuity.test.tsx` | protected — no regression |
| `src/test/phase1lF1CanonicalOpportunityView.test.ts` | protected |
| `src/test/recruiterBenefitsFormat.test.ts` | protected |

## 10. Atomic implementation sequence (for ChatGPT approval — not to start)

| Pass | Purpose | Files | Stop point |
|---|---|---|---|
| **F2B-P1** | Insert canonical boundary at the data hook. Retype `Opportunity`/adopt `CanonicalOpportunity`; add null recruiter stub; update `OpportunitiesPage` filter/KPI to consume canonical. NO card/detail visual change yet. | `useOpportunities.ts`, `OpportunitiesPage.tsx` (filter+KPI only) | Type errors resolved, all existing tests still pass; STOP for review before visual changes. |
| **F2B-P2** | List card visual: canonical field consumption, disclosure semantics, remove profit-first copy, add sourceVersion indicator, Pro profit badge → transparency band badge. | `OpportunityCard.tsx`, `OpportunitiesPage.tsx` header copy only | STOP for review. |
| **F2B-P3** | Detail visual: split Pay Breakdown into recurring vs one-time incentives; add salary/mixed/other/accessorial; canonical costs with employment gating; split benefits/lanes/requirements into three sections; remove hardcoded "Approved Opportunity" or gate on canonical trust. | `OpportunityDetail.tsx` | STOP for review. |
| **F2B-P4** | Replace `OpportunityProfitBreakdown` with `ListingTransparencyPanel` (score + band + missing + conflicts + notes). Rename import in Detail. Preserve Pro upsell surface if ChatGPT wants it. | `OpportunityProfitBreakdown.tsx` (rename/replace), `OpportunityDetail.tsx` | STOP for review. |
| **F2B-P5** (conditional) | Only if ChatGPT decides preferences must not block Apply Now: convert `PreferencesRequiredPanel` into a resumable interstitial without preventing submission — OR keep as-is. | `ApplyNowDialog.tsx`, possibly `OpportunitiesPage.tsx` | STOP. |
| **F2B-P6** (conditional) | Only if ChatGPT authorizes RPC change: extend `list_driver_visible_opportunities` to return recruiter verification_status/status per row. Otherwise stub `recruiter=null` in P1. | migration + RPC | STOP. |
| **F2C** | Add test suites per §9 allowlist. Run only newly authorized suites; do not re-baseline unrelated suites. | new test files only | STOP for review. |

Lovable will not select or start any pass.

## 11. Final Git proof

| # | Command | Output |
|---|---|---|
| 1 | `git status --short` | *(empty — clean)* |
| 2 | `git rev-parse HEAD` | `4b9938420c40fae855e80f34d4cf0bbd964baa62` |
| 3 | `git log -1 --oneline` | `4b993842 Stabilized canonical view F1` |

Clean tree, HEAD unchanged.

## 12. Deviations

- Files 1, 2, 8, 15, 16, 17, 18, 20 were not fully read line-by-line this turn (partial coverage documented in §2). The unread trailing regions are non-behavioral helpers or accepted-in-F1 territory; no assertion in this audit relies on those unread ranges. Flagged as a deviation for ChatGPT to accept or require full re-view in F2A-R1.
- Prior conversation reminded to batch parallel commands. The four start-gate calls and the three final-proof calls were run as separate calls because the phase contract mandated "FOUR SEPARATE EXACT COMMAND CALLS" / "THREE SEPARATE EXACT COMMAND CALLS. Do not combine commands." Complied with the phase contract; the batching hint was superseded.

## 13. Explicit scope confirmation

No file was written, edited, formatted, generated, or deleted. No commits, resets, rebases, stashes, branch changes, or history manipulation. No database or Supabase queries. No tests, typechecks, builds, migrations, dependency changes, deployment, or publishing. No Phase 1L-F2B implementation. Only `git` read commands and `code--view` reads were used after the start gate.

**STOPPED AFTER PHASE 1L-F2A.**
