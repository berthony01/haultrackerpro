
# Phase 1L-A — Opportunity Reconstruction Architecture & Data-Flow Audit (Read-Only)

## 1. Start Gate

- `git branch --show-current` = `edit/edt-4a164607-4ca1-4705-a530-6bec03f2787e` (sandbox rotates the branch name every turn; the previously issued name `edit/edt-3cbaf924-...` was for the prior turn).
- `git rev-parse HEAD` = `087473ea549e00f3d12c5cf9cbbfb60d2dfef00d` ✓ matches corrected expected sandbox HEAD.
- `git status --short` = empty ✓ clean tree.
- `git log -1 --oneline` = `087473ea Ran migration 20260721010000`.
- `git diff --stat f7bc0e270e3cba07becb41d92bafa4beac5739be HEAD` = one file, `supabase/migrations/20260721053049_42d9d3ec-aec6-4012-93e8-6a3a200abb0d.sql` (+248), which is the auto-committed Phase 1K-D repair migration.
- **Sandbox HEAD `087473e` vs GitHub main `f7bc0e2`:** the sole delta is the Phase 1K-D targeted historical-repair migration. It only updates the single row `28d75a1e-…432a93` (`admin_review_status → approved`, `published_at → now()`) with fail-closed preconditions. It touches no opportunity table structure, no trigger, no RPC, no RLS, no application/UI/calculation code, and no other opportunity row. **It does not affect the opportunity form, persistence model, calculation engine, publication logic, or driver rendering architecture** under audit.
- **PASS.**

## 2. Executive Finding

The recruiter form, the persistence model, and the driver page **do not share a single canonical data contract**. There is one shared pure calculation module (`src/lib/opportunities/opportunityProfit.ts`) that both surfaces call, so the arithmetic itself is consistent — but around it, three architectural gaps let the anomaly screenshot appear:

1. **Presence-not-relevance rendering.** The driver page renders every opportunity column with `value ?? '—'` unconditionally, with no hiring-type-aware gating. Fields that are meaningless for a Company Driver listing (`lease_payment`, `maintenance_deductions`, `other_deductions`, `escrow_*`) are shown as dashes rather than hidden. Severity: **High** (misleads drivers).
2. **`benefits` column is dual-purpose and leaks its own serialization format to drivers.** The recruiter form serialises "Typical Lanes" and "Additional Requirements" into the single `opportunities.benefits` text column with literal headers (`Typical Lanes:` / `Requirements:`). The driver page renders `o.benefits` raw inside a "Benefits" card, so drivers see internal section headers, and lanes/requirements are mis-labelled as "benefits". Severity: **High** (truthfulness / trust).
3. **Publication trust badges and calculation inputs are not validated at publish time.** `list_driver_visible_opportunities` gates on `status='active' AND admin_review_status='approved' AND recruiter_profile_can_manage_opportunities(recruiter_id)` only; it does not require internally consistent numeric inputs (e.g. `estimated_weekly_gross=3000` with `estimated_loaded_miles=0` and `estimated_weekly_miles=NULL`), and the recruiter `validate('submit')` path only requires "any one pay value present." Every anomaly value in the screenshot passes both gates. The driver page then decorates the same row with a fixed `Approved Opportunity` badge (`OpportunityDetail.tsx:167-169`) even when Profit Clarity is `Mixed`. Severity: **Medium-High** (semantic).

Additional lower-severity defects: sign-on bonus rendered in weekly Pay Breakdown without one-time labelling (Medium); "Apply Now" is enabled while a "complete preferences" warning is showing next to it (Low, intentional dialog-side gating but visually inconsistent); recruiter Pay validation accepts `percentage_pay` alone even though the calc engine explicitly cannot derive gross from percentage alone (Medium).

## 3. End-to-End Data-Flow Map

```text
Recruiter UI input
   src/components/opportunities/RecruiterOpportunityForm.tsx
     - FormState / EMPTY .......................................... L65-117
     - PasteOpportunityDialog + mergeExtractedOpportunity .......... L176-260
     - hydration from `initial` (edit) ............................. L271-317
     - live financials via calculateOpportunityFinancials .......... L335-350
     - validate('draft'|'submit') .................................. L352-376
     - buildPayload → OpportunityInsert ............................ L378-415
     - save() → createOpportunity / updateOpportunity .............. L417-431
     - Earnings Summary render ..................................... L744-763
     - transparency + Publish button ............................... L766-…

  ↓ mutation
Hook / persistence
   src/hooks/opportunities/useRecruiterOpportunities.ts
     - requireCanPost (client mirror) .............................. L41-45
     - createOpportunity.mutationFn (INSERT opportunities) ......... L52-61
     - updateOpportunity.mutationFn ................................ L63-74
     - setStatus.mutationFn ........................................ L76-87

  ↓ INSERT/UPDATE trigger
Publication / approval
   supabase/migrations/20260721000000_phase1k_admin_recruiter_opportunity_publication.sql
     - public.opportunities_guard() (SECURITY DEFINER) ............. L40-…
       * admin-other bypass ........................................ L62-64
       * admin-own explicit-moderation bypass ...................... L68-77
       * INSERT normalization (sets admin_review_status/published_at) L79-91
       * UPDATE normalization + rejected-resubmit rules ............. L93-119
   opportunities_billing_guard trigger (unchanged this phase, referenced only)

  ↓ driver query
Driver visibility
   supabase/migrations/20260717175500_...  (canonical body)
     - public.list_driver_visible_opportunities(_state,_driver_type,_route_type)
       filters: auth.uid()!=null; status='active'; admin_review_status='approved';
       recruiter_profile_can_manage_opportunities(recruiter_id);
       optional state/driver_type/route_type; order by featured DESC, published_at DESC.
   src/hooks/opportunities/useOpportunities.ts
     - React-Query call to that RPC ................................ L14-45

  ↓ driver rendering
Driver list + detail
   src/components/opportunities/OpportunitiesPage.tsx (filters, sort, apply-resume orchestration)
   src/components/opportunities/OpportunityCard.tsx
     - calls calculateOpportunityFinancials + calculateOpportunityMatch
     - renders Priority/Verified/Score/Match badges .................. L67-116
   src/components/opportunities/OpportunityDetail.tsx
     - Header + hard-coded "Approved Opportunity" badge ............. L162-179
     - Match Insights (driverProfile-gated) ......................... L181-241
     - Pay Breakdown KVs ............................................ L243-253
     - Mileage & Deadhead KVs ....................................... L255-267
     - <OpportunityProfitBreakdown> (Pro-gated) ..................... L269-270
     - Deduction Details (Pro-gated, unconditional row list) ........ L272-288
     - Home Time / Lifestyle ........................................ L290-298
     - Benefits (raw whitespace-pre-line of o.benefits) ............. L300-305
     - Description .................................................. L307-312
     - Action bar (Save / Refer / Request Info / Apply Now) ......... L317-374
   src/components/opportunities/OpportunityProfitBreakdown.tsx
     - Pro gate + upgrade card ...................................... L34-54
     - calls calculateOpportunityFinancials, profitScoreLabel ....... L56-57
     - Score card + KVs + warnings + disclaimer ..................... L78-148

  ↓ application action
   src/components/opportunities/ApplyNowDialog.tsx (dialog gates)
   src/lib/opportunities/applicationSubmission.ts (classifyFormalApply / classifyRequestInfo / submissionErrorMessage)
   src/hooks/opportunities/useOpportunityApplications.ts (RPCs)
```

Both surfaces call one calculation engine (`calculateOpportunityFinancials` — `src/lib/opportunities/opportunityProfit.ts:56-165`). Both surfaces call one match engine (`calculateOpportunityMatch` — `src/lib/opportunities/opportunityMatch.ts:95-219`).

## 4. Canonical Field Inventory

Sources: form-state key from `RecruiterOpportunityForm.tsx:65-117`; column set from `src/integrations/supabase/types.ts:2191-2238` and the migration history; render sites from `RecruiterOpportunityForm.tsx` (recruiter), `OpportunityCard.tsx`, `OpportunityDetail.tsx`, `OpportunityProfitBreakdown.tsx` (driver).

| UI label (form) | form-state key | DB column | Type | Required | Applicable hiring types | Applicable pay models | Default / null behavior | Recruiter use | Driver use | Stored/derived | Confirmed inconsistency |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Opportunity Title | title | title | text | Required (draft+submit) | all | all | trimmed non-empty required | Essentials | header | stored | none |
| Company Name | company_name | company_name | text | Required | all | all | trimmed non-empty required | Essentials | subhead | stored | none |
| Hiring Type | driver_type | driver_type | text\|null | submit-only | all | all | `null` if blank | Essentials chip | Badge on card & detail | stored | not enum-constrained in DB; free-text acceptable |
| Route Type | route_type | route_type | text\|null | submit-only | all | all | `null` | Essentials | Badge / match input | stored | free-text |
| Trailer Type | trailer_type | trailer_type | text\|null | submit-only | all | all | `null` | Essentials | Badge / match input | stored | free-text |
| Hiring City / State | hiring_city, hiring_state | hiring_city, hiring_state | text\|null | optional | all | all | `null` | Essentials | header location line | stored | none |
| Hiring States (multi) | hiring_states | hiring_states | text[] (not null, default `{}`) | optional | all | all | `[]` | Optional | not rendered on driver detail | stored | not surfaced to driver |
| Description | description | description | text\|null | optional | all | all | `null` | Essentials | "About this Opportunity" | stored | none |
| Pay Model | pay_model | pay_model | text\|null | submit-only | all | all | `null` | Essentials | Pay Breakdown KV | stored | free-text (no enum) |
| CPM | cpm | cpm | numeric\|null | ≥0 if present | all | cpm, mixed (form conditional) | `null` | Essentials Pay | Pay Breakdown KV | stored | driver page shows CPM KV regardless of pay_model |
| Percentage Pay | percentage_pay | percentage_pay | numeric\|null | ≥0 | all | percentage, mixed | `null` | Essentials Pay | Pay Breakdown KV | stored | calc engine **cannot** derive gross from percentage alone (missingPayData) |
| Flat Weekly Pay | flat_weekly_pay | flat_weekly_pay | numeric\|null | ≥0 | all | flat_weekly, salary, mixed | `null` | Essentials Pay | Pay Breakdown KV | stored | none |
| Est. Weekly Gross | estimated_weekly_gross | estimated_weekly_gross | numeric\|null | ≥0 | all | all | `null` | Essentials Pay + Summary | Pay Breakdown & Profit KV | stored, also drives derived | takes precedence over CPM×loaded when both present |
| Est. Weekly Miles | estimated_weekly_miles | estimated_weekly_miles | numeric\|null | ≥0 | all | all | `null` | Essentials Pay | Card stat (non-Pro) | stored | drives Effective/Net RPM |
| Loaded Miles | estimated_loaded_miles | estimated_loaded_miles | numeric\|null | ≥0 | all | cpm meaningful | `null` | Optional | Mileage & Deadhead KV | stored | zero treated as legitimate value → RPM & CPM×loaded both collapse |
| Deadhead Miles | estimated_deadhead_miles | estimated_deadhead_miles | numeric\|null | ≥0 | all | all | `null` | Optional | Mileage & Deadhead KV, deadhead % | stored | zero vs null semantics undefined |
| Deadhead Paid? | deadhead_paid | deadhead_paid | boolean\|null | optional tri-state | all | all | `null`=Not disclosed | Optional | Mileage & Deadhead KV | stored | none |
| Detention Pay | detention_pay | detention_pay | text\|null | optional | all | all | `null` | Optional | not surfaced on driver detail | stored | not surfaced |
| Layover Pay | layover_pay | layover_pay | text\|null | optional | all | all | `null` | Optional | not surfaced on driver detail | stored | not surfaced |
| Sign-On Bonus | sign_on_bonus | sign_on_bonus | numeric\|null | ≥0 | all | all | `null` | Optional | Pay Breakdown KV | stored | **one-time value rendered inside Weekly Pay Breakdown grid without labelling** |
| Fuel Paid By | fuel_paid_by | fuel_paid_by | text\|null | optional | all | all | `null` | Optional | Deduction Details (Pro) | stored | none |
| Insurance Deduction | insurance_deductions | insurance_deductions | numeric\|null | ≥0 | all | all | `null` | Optional | Profit KV + Deduction Details | stored | company-driver relevance not gated |
| Escrow Required | escrow_required | escrow_required | boolean (default false) | optional | owner_operator/lease_purchase mainly | all | `false` | Optional | Deduction Details (Pro) | stored | shown on company listings |
| Escrow Amount | escrow_amount | escrow_amount | numeric\|null | ≥0 | O/O, LP | all | `null` | Optional | Profit KV + Deduction Details | stored | shown on company listings |
| Lease Payment | lease_payment | lease_payment | numeric\|null | ≥0 | lease_purchase, O/O | all | `null` | Optional | Profit KV + Deduction Details + match warning | stored | **shown on company listings** |
| Maintenance Deductions | maintenance_deductions | maintenance_deductions | numeric\|null | ≥0 | O/O, LP | all | `null` | Optional | Profit + Deduction Details | stored | **shown on company listings** |
| Other Deductions | other_deductions | other_deductions | numeric\|null | ≥0 | all | all | `null` | Optional | Profit + Deduction Details | stored | shown on company listings |
| Home Time | home_time | home_time | text\|null | optional | all | all | `null` | Optional | Badge + Lifestyle KV | stored | none |
| Forced Dispatch | forced_dispatch | forced_dispatch | boolean\|null | tri-state | all | all | `null` | Optional | Lifestyle KV | stored | none |
| Pets Allowed | pets_allowed | pets_allowed | boolean\|null | tri-state | all | all | `null` | Optional | Lifestyle KV | stored | none |
| Riders Allowed | riders_allowed | riders_allowed | boolean\|null | tri-state | all | all | `null` | Optional | Lifestyle KV | stored | none |
| Equipment Year / Truck Info | equipment_year | equipment_year | text\|null | optional | all | all | `null` | Optional | not surfaced on driver detail | stored | not surfaced |
| Additional Requirements | benefits (form key, sub-part) | benefits (shared column) | text\|null | optional | all | all | `null`; **serialised with `Requirements:` header** | Optional | rendered raw inside Benefits card | stored | **dual-purpose column + header leakage** |
| Typical Lanes | typical_lanes (form key, sub-part) | benefits (shared column) | text\|null | optional | all | all | serialised with `Typical Lanes:` header | Optional | rendered raw inside Benefits card | stored | **mislabelled as "Benefits" to drivers** |
| Accuracy confirmation | transparency_confirmed | transparency_confirmed | boolean (default false) | submit-only | all | all | `false` | Confirmation | not surfaced to driver | stored | none |
| — | (n/a) | status | text (default `draft`) | derived from Save/Publish button | all | all | `draft`/`active`/`paused`/`closed` | Manage list badge | filters visibility | stored | none |
| — | (n/a) | admin_review_status | text (default `pending`, guard sets `approved`) | derived by trigger | all | all | `pending`/`approved`/`rejected` | Publication badge | filters visibility | stored | not directly editable by recruiter |
| — | (n/a) | published_at | timestamptz\|null | derived by trigger | all | all | `null` until eligible active | Publication badge | ORDER BY | stored | none |
| — | (n/a) | featured | boolean (default false) | trigger-locked in guard | all | all | `false` | rendered as "Priority placement" on card | ORDER BY | stored | one row (28d75a1e) has `featured=true` from historical state |
| — | (n/a) | view_count | integer (default 0) | trigger-locked | all | all | `0` | analytics only | not surfaced | stored | none |

## 5. Calculation Ledger

Source of truth: `src/lib/opportunities/opportunityProfit.ts`.

| Metric | Formula (code) | Required operands | Precedence / fallback | Missing / zero handling | One-time bonus treatment | Recruiter source | Driver source | Can they diverge? |
|---|---|---|---|---|---|---|---|---|
| `estimatedGross` | first non-null of `estimated_weekly_gross` → `flat_weekly_pay` → `cpm*loaded_miles` (L88-92) | at least one of the three | precedence order above; `percentage_pay` alone yields `null` | `null` when none present (sets `missingPayData`); **`0` treated as valid** | ignored; sign-on bonus **not** added | `RecruiterOpportunityForm.tsx:335-350` | `OpportunityCard`, `OpportunityDetail`, `OpportunityProfitBreakdown` all via same fn | No — same fn |
| `totalKnownDeductions` | `insurance + escrow_amount + lease_payment + maintenance + other` (numOr0) (L98-103) | none | missing coerce to `0` via `numOr0` | **null and 0 collapse to 0**; escrow counted whether `escrow_required` true or false | n/a | same | same | No |
| `estimatedNet` | `estimatedGross - totalKnownDeductions` (L105) | requires `estimatedGross` | `null` if gross null | preserves negative net | ignored | same | same | No |
| `totalMiles` | `weeklyMiles ?? (loaded + deadhead)` — but expression `((loaded ?? 0) + (deadhead ?? 0)) || null` — **`0` collapses to null via `||`** (L108) | either | falsy `0` → `null` (misleading when both truly `0`) | zero collapses | n/a | — | — | No |
| `grossPerMile` | `gross / loaded_miles` when `loaded_miles>0` (L110-113) | gross + loaded | `null` otherwise | division skipped | ignored | — | not directly rendered | No |
| `effectiveRpm` | `gross / totalMiles` when `totalMiles>0` (L115-118) | gross + totalMiles | `null` otherwise | zero-miles → `null` (shown "unavailable") | ignored | — | Card + Profit KV | No |
| `netRpm` | `net / totalMiles` when `totalMiles>0` (L120-123) | net + totalMiles | `null` otherwise | zero collapses | ignored | — | Card + Profit KV | No |
| `deadheadPercentage` | `(deadhead / totalMiles) * 100` when `totalMiles>0` (L125-128) | deadhead + totalMiles | `null` otherwise | when deadhead null → `null` | n/a | — | Profit KV + card | No |
| `hasUnpaidDeadhead` | `deadhead_paid===false && deadhead_miles>0` (L130) | — | — | requires positive deadhead miles | n/a | Summary warning | Profit warning + match | No |
| `hasUnknownDeadheadPay` | `deadhead_paid==null && deadhead_miles>0` (L131) | — | — | — | n/a | same | same | No |
| `hasLeaseRisk` | `lease_payment>0` (L132) | — | — | — | n/a | Summary warning | Profit warning + match | No |
| `hasHighDeductionRisk` | `totalKnownDeductions>500` (L133) | — | — | — | n/a | Summary warning | Profit warning + match | No |
| `missingPayData` | `estimatedGross==null && (percentage!=null OR (cpm!=null && loaded==null))`  OR  `no pay at all` (L94-96, 162) | — | — | — | n/a | drives "Pay data is incomplete" | drives same warning | No |
| `profitScore` (0-100) | base 70; `+10` if net>1500; `+5` if netRpm≥1.75; `+5` if deadhead_paid===true; `-10` if unpaid deadhead; `-10` if deductions>500; `-10` if lease>0; `-10` if missingPayData/noPayAtAll; `-5` if unknown deadhead pay; clamp [0,100] (L135-145) | — | — | — | n/a | not rendered on recruiter form | driver Profit Intelligence + card badge | No |
| Match score | `calculateOpportunityMatch` (`opportunityMatch.ts:95-219`) — base 50; +/- adjustments per pay/route/driver/trailer/deadhead/lease/experience | driver profile + opportunity + financials | fail-open (no profile → no match card) | — | n/a | not rendered on recruiter form | Match Insights card + card badge | No — same fn |

**Divergence risk:** low for arithmetic (single implementation), but the recruiter Earnings Summary omits Net RPM and Profit Clarity Score, so the recruiter cannot see the exact score the driver will see. Recruiter validation also **does not enforce** internally consistent operands (a submission with gross+deductions but no loaded/weekly miles is fully permitted).

## 6. Screenshot Anomaly Root-Cause Matrix

Baseline: opportunity 28d75a1e-…432a93 (`Looking for OTR company drivers`) — visible on driver page since Phase 1K-D repair. Values below are inferred deterministically from the code paths against the screenshot. Marked **Cannot confirm** where the individual DB row's cell value cannot be proven from repository alone.

| Observed value / anomaly | Verdict | Upstream source | Downstream render path | Risk |
|---|---|---|---|---|
| Hiring type = "company" | Confirmed | `opportunities.driver_type` stored via form `driver_type` (`RecruiterOpportunityForm.tsx:513-519`). | Badge in `OpportunityDetail.tsx:174`. | none |
| Pay model = CPM | Confirmed | `opportunities.pay_model` = `'cpm'`. | `OpportunityDetail.tsx:246`. | none |
| CPM $0.75/mi | Confirmed | `opportunities.cpm=0.75`. | `OpportunityDetail.tsx:247`. | none |
| Est weekly gross $3,000 | Confirmed | `opportunities.estimated_weekly_gross=3000` (takes precedence over CPM×loaded because of `weeklyGross!=null` at `opportunityProfit.ts:89`). | `OpportunityDetail.tsx:250` + `OpportunityProfitBreakdown.tsx:107`. | none |
| Est deductions $2,500 | Confirmed | `totalKnownDeductions = insurance + escrow + lease + maintenance + other` (`opportunityProfit.ts:98-103`). Because only insurance+escrow appear plausibly filled (rest render `—`) the $2,500 sum is stored in those two. **Cannot confirm** exact split without a `SELECT`. | `OpportunityProfitBreakdown.tsx:108`. | Medium — recruiter can enter O/O-only fields on a Company listing and they still count. |
| Est net $500 | Confirmed | `estimatedGross - totalKnownDeductions` (`opportunityProfit.ts:105`). | `OpportunityProfitBreakdown.tsx:109`. | none |
| Sign-on bonus $3,000 | Confirmed **(mis-presentation)** | `opportunities.sign_on_bonus=3000`. | `OpportunityDetail.tsx:251` — inside the "Pay Breakdown" grid alongside weekly figures with no one-time label. The calc engine correctly excludes it from `estimatedGross`, but the UI does not signal that. | **Medium** — driver may interpret it as recurring. |
| Loaded miles = 0 mi | Confirmed | `opportunities.estimated_loaded_miles=0`. `fmtMiles` renders `0 mi` for numeric zero (`OpportunityDetail.tsx:52`). | `OpportunityDetail.tsx:259`. | Medium — `0` is stored as legitimate; distinct from "unknown". |
| Weekly miles = unavailable | Confirmed | `opportunities.estimated_weekly_miles IS NULL`. `fmtMiles(null) => '—'` rendered as "—" (screenshot's "unavailable" wording matches the Profit KV `fmtMiles`/`fmtRpm` `—`; the "unavailable" text specifically corresponds to `fmtRpm/fmtPct` returning `—` — reader-visible). | `OpportunityDetail.tsx:258` + Profit KVs. | Low. |
| Effective RPM = unavailable | Confirmed | `totalMiles = weeklyMiles ?? ((loaded ?? 0)+(deadhead ?? 0) || null)` → `null ?? (0+0 || null)` → `null` (`opportunityProfit.ts:108`). Effective RPM `null` (`L115-118`). Rendered `—` via `fmtRpm` (`OpportunityProfitBreakdown.tsx:29`). | Profit KV. | Low. |
| Net RPM = unavailable | Confirmed | Same `totalMiles=null` path (`opportunityProfit.ts:120-123`). | Profit KV. | Low. |
| Deadhead % = unavailable | Confirmed | `deadhead_miles IS NULL` → `deadheadPercentage=null` (`opportunityProfit.ts:125-128`). | Profit KV. | Low. |
| Fuel paid by company | Confirmed | `opportunities.fuel_paid_by='Company'`. | `OpportunityDetail.tsx:276` (Pro-gated). Screenshot shows this row → viewer is Pro. | none |
| Lease / maintenance / other = blank/dash | Confirmed | Respective columns `NULL`. `fmtMoney(null)='—'` (`OpportunityDetail.tsx:50-51`). | `OpportunityDetail.tsx:277-280`. | **High** — irrelevant fields for a Company Driver listing are shown regardless of hiring type. |
| Profit Clarity Score 60/100 "Mixed" | Confirmed | Base 70 → −10 for `totalKnownDeductions>500` (`opportunityProfit.ts:141`). No other adjustments fire (net=500 not >1500; netRpm null; deadhead unknown pay w/ null miles → not counted; lease=0; not missingPayData because gross non-null). Score = 60. `profitScoreLabel(60)` → `Mixed` (`opportunityProfit.ts:169`). | `OpportunityProfitBreakdown.tsx:99-102`. | none (arithmetic correct); Medium (score labelled `Mixed` while badge above says `Approved Opportunity`). |
| Benefits section containing lanes + requirements | Confirmed | `opportunities.benefits` stores serialised text with `Typical Lanes:` and `Requirements:` headers via `joinBenefits` (`benefitsFormat.ts:60-66`). | `OpportunityDetail.tsx:300-305` renders `o.benefits` raw with `whitespace-pre-line`, with no split. | **High** — mislabels lanes as benefits and leaks internal delimiter format to drivers. |
| Application-preference warning while Apply Now button visually available | Confirmed | Warning card only when `profileIncomplete && formalState.kind==='none'` (`OpportunityDetail.tsx:319`). Apply Now button remains enabled (`L359-372`), then `ApplyNowDialog` performs the gating (opens preferences via `onOpenPreferences`). | `OpportunityDetail.tsx:317-374`. | Low — intentional dialog-side gating; visually contradicts the warning next to it. |
| "Approved Opportunity" badge shown | Confirmed | Hard-coded badge in `OpportunityDetail.tsx:167-169`, rendered for every row returned by `list_driver_visible_opportunities` (which requires `admin_review_status='approved'`). | Same file. | Medium — driver-facing "Approved" wording overlaps admin moderation semantics; there is no separate "recruiter verified" badge on detail (that exists only on the card via `isVerifiedRecruiter`, `OpportunityCard.tsx:83-87`). |
| "Featured" / "Priority placement" | Confirmed | `featured=true` on this row (per preflight snapshot in prior turn). | `OpportunityCard.tsx:73-82` (label "Priority placement"), `OpportunityDetail.tsx:166` (label "Featured"). | Low — inconsistent labelling between list and detail for the same flag. |

## 7. Hiring-Type and Pay-Model Matrix

The form and DB apply **no** conditional gating by hiring type. The only conditional logic in the form is by pay model (`RecruiterOpportunityForm.tsx:442-444`): CPM/mixed shows CPM; percentage/mixed shows Percentage; flat_weekly/salary/mixed shows Flat. All other fields (deductions, lease, escrow, forced dispatch, etc.) are always available regardless of hiring type and always rendered on the driver detail (Pro-gated as noted). Cross-type leakage:

| Field | Company | O/O | Lease Purchase | 1099 | Team | Comment |
|---|---|---|---|---|---|---|
| lease_payment | shown | shown | shown | shown | shown | should be O/O / LP only |
| maintenance_deductions | shown | shown | shown | shown | shown | O/O / LP only |
| escrow_required / escrow_amount | shown | shown | shown | shown | shown | O/O / LP only |
| other_deductions | shown | shown | shown | shown | shown | acceptable for all |
| percentage_pay | selectable, but calc **cannot** derive gross from it alone | same | same | same | same | validate('submit') accepts percentage_pay alone → user can publish with `missingPayData=true` |
| sign_on_bonus | rendered in weekly Pay Breakdown | same | same | same | same | one-time value in a weekly section |
| min_years_experience | Not present in DB or form | — | — | — | — | Match engine reads a `min_years_experience` field with `?? null` (`opportunityMatch.ts:28`); column does not exist per generated types — always null in practice. |

## 8. Publication & Approval Rules

Rules encoded in `public.opportunities_guard()` (per current Phase 1K-A canonical body):

- **Non-admin recruiter INSERT:** `admin_review_status = 'approved' if current_user_can_manage_recruiter_opportunities(recruiter_id) else 'pending'`; `published_at = now() if approved AND status='active' else NULL`; `featured=false`, `view_count=0` forced.
- **Non-admin recruiter UPDATE:** `admin_review_status` locked to `OLD` unless `OLD.admin_review_status='rejected'` (then reset to `pending`, `published_at=NULL`). `featured` locked to `OLD` unless `app.allow_featured_sync=true` (server-only escape hatch). `view_count` locked. `published_at` stamped to `now()` on the transition into approved+active, otherwise locked.
- **Admin acting on another recruiter's row:** unconditional `RETURN NEW` (moderation authority preserved).
- **Admin acting on their own recruiter row:** ordinary INSERT / non-moderation UPDATE → normalized like a recruiter; explicit UPDATE that changes `admin_review_status`, `featured`, `view_count`, or `published_at` → `RETURN NEW` (self-moderation preserved).
- **`recruiter_profile_can_manage_opportunities` eligibility** (`20260717185620`): non-suspended profile, non-empty recruiter_name / company_name / recruiter_email (regex-valid), at least one of DOT/MC, terms accepted (posting_terms_accepted_at OR legacy grandfather timestamp).
- **`list_driver_visible_opportunities`** (`20260717175500`): requires `auth.uid()`, `status='active'`, `admin_review_status='approved'`, `recruiter_profile_can_manage_opportunities(recruiter_id)`, optional filter args, ORDER BY `featured DESC NULLS LAST, published_at DESC NULLS LAST`. Does **not** check `published_at IS NOT NULL`.
- **`driver_can_access_opportunity`** (`20260717185620`): identical filter set for direct opportunity SELECT via RLS.

Internal publication status (`admin_review_status`) is distinct from any "verified recruiter" claim shown on the card (`recruiter.verification_status='approved' && status!='suspended'` — `OpportunityCard.tsx:60-66`). The Detail page's `Approved Opportunity` badge is unconditional and does **not** reflect recruiter verification.

## 9. Blank / Null / Zero / Not-Disclosed Semantics

| State | Storage | Normalization | Calc engine treatment | Rendering |
|---|---|---|---|---|
| Blank string in form | `numOrNull('') → null` (`RecruiterOpportunityForm.tsx:135-139`); `.trim() || null` for text | `null` written to DB | `num(v)` returns `null`; excluded from sums via `numOr0` = 0 | `fmtMoney(null)='—'`, `fmtMiles(null)='—'`, `fmtRpm(null)='—'`. |
| Literal `0` in form | Written as numeric `0` | `0` in DB | `num(v)=0`; `numOr0(v)=0`; but `((loaded ?? 0)+(deadhead ?? 0)) \|\| null` **coerces `0` to `null`** for `totalMiles` | `fmtMoney(0)='$0'`, `fmtMiles(0)='0 mi'`. |
| Deadhead paid "Not disclosed" | `deadhead_paid=null` | — | `hasUnknownDeadheadPay = null && deadhead>0` | KV shows `Not disclosed` (`OpportunityDetail.tsx:263`). |
| Tri-state "unspecified" | `forced_dispatch/pets/riders = null` | — | not scored | KV shows `—` (`OpportunityDetail.tsx:294-296`). |
| Escrow required=false | boolean false (default) | — | `escrow_amount` **still summed into totalKnownDeductions** regardless of `escrow_required` (`opportunityProfit.ts:99`) | Deduction Details KV shows "Not required". |
| Legacy `benefits` free text | text | `splitBenefits` treats no-marker text as requirements only (`benefitsFormat.ts:34-36`) | not touched | On driver detail: raw text preserved (safe). On new posts: headers appear (unsafe). |

**Unsafe coercions confirmed:**

1. `((loaded ?? 0) + (deadhead ?? 0)) || null` (opportunityProfit.ts:108) — silently converts a legitimate `0` combined miles into "unknown". Screenshot's `loaded=0, weekly=null` triggers this and cascades into "unavailable" RPM/deadhead %.
2. `escrow_amount` counted in deductions even when `escrow_required=false`.
3. `f.totalKnownDeductions || null` in `<KV label="Est. deductions"/>` (OpportunityProfitBreakdown.tsx:108) — a truly zero total renders as `—` rather than `$0`.

## 10. Test Coverage Matrix

Inspected test files (`src/test/*` and `tests/postgres/*`) that assert opportunity behavior:

| Test | What it actually proves | Not covered |
|---|---|---|
| `src/test/phase1kBRecruiterPublicationStatus.test.tsx` | Full state matrix of `getOpportunityPublicationStatus`; RecruiterOpportunityManager renders dual Lifecycle+Publication badges & descriptions; header sentence appended. | Driver-side publication/approval representation. |
| `src/test/recruiterOpportunityFormConsolidation.test.tsx` | Form structure (Essentials + collapsed Optional), pay-model conditional fields, negative-value rejection, draft-vs-submit validation, edit round-trip of advanced fields, paste-to-autofill merge, absence of legacy wizard/QuickPost. | Does NOT assert internal-consistency validation (e.g. gross without miles). Does NOT test hiring-type-conditional field visibility (there is none). Does NOT test sign-on-bonus separation from weekly gross. |
| `src/test/phase1hA2OpportunityDetail.test.tsx` | Apply Now vs Request Info button state matrix by `formalState`/`requestInfoState`; resume-token matrix. | Does NOT assert Benefits rendering, Deduction Details Pro gating, or profit-score rendering. Does NOT cover the "approved opportunity" badge. |
| `src/test/recruiterBenefitsFormat.test.ts` | Round-trip of `joinBenefits`/`splitBenefits` and legacy no-marker parsing. | Does NOT assert driver-side rendering of the serialised form (which is the source of the "Benefits shows lanes" bug). |
| `src/test/phase1jC1OpportunityApplyContinuity.test.tsx` | Preferences → Apply resume flow. | Not relevant to this audit. |
| `src/test/phase1jD2A*` / `phase1jD2B1*` / `phase1jD2B2*` | Recruiter paid-entitlement copy/RLS/rank. | Not relevant to opportunity form/render. |
| `tests/postgres/phase1kAdminRecruiterOpportunityPublicationPostgres.test.ts` | Real-PG proof of owner-aware `opportunities_guard` (admin-own vs admin-other vs recruiter INSERT/UPDATE, protected fields, featured lock). | Does NOT prove `list_driver_visible_opportunities` end-to-end from a real driver JWT. |
| `tests/postgres/phase1kHistoricalOpportunityRepairPostgres.test.ts` | Fail-closed 1K-D repair against target row. | Row-specific; not architectural. |

**Untested critical paths:**

- Recruiter validate('submit') accepting `percentage_pay` alone.
- Driver rendering of `benefits` with `Typical Lanes:` / `Requirements:` headers.
- Company-Driver hiring type rendering irrelevant deduction fields as `—`.
- Sign-on bonus classification as one-time vs weekly.
- `((loaded ?? 0)+(deadhead ?? 0)) || null` zero-collapse in `opportunityProfit.ts`.
- Match engine reading `min_years_experience` field that does not exist in the schema.
- Driver-facing `Approved Opportunity` badge vs `recruiter.verification_status` distinction.

## 11. Data & Migration Risk

Any reconstruction that changes semantics for the following will hit legacy rows:

- **`benefits` column dual-purpose payload.** Repository already has a serialisation format used by both new and legacy rows. Splitting into `typical_lanes` (text[]) and `requirements` (text) would require a backfill parser using `splitBenefits`. Legacy rows without markers must map to `requirements`, `typical_lanes=[]`.
- **`estimated_loaded_miles=0` semantics.** Distinguishing `0`, `null`, and "not applicable for pay model" cannot be done without either (a) altering `null` semantics in code only, or (b) a real column-level enum/marker. Any change without a controlled migration silently reclassifies existing rows.
- **`escrow_amount` counted regardless of `escrow_required`.** Legacy rows already exist with amounts stored while `escrow_required=false`. Changing the sum rule shifts historical deductions/net/score numbers.
- **`min_years_experience` field.** Match engine reads it but no such column exists in generated types or migrations — adding it requires a real migration; today it is effectively dead code.
- **`admin_review_status` / `published_at` / `featured` / `view_count`.** Trigger-locked. Any recruiter-facing UI reconstruction must NOT try to write them; only the guard's admin-own-explicit-moderation branch permits it.
- **`opportunities_guard` and `list_driver_visible_opportunities` are stable canonical.** Do not modify without a paired PG16 gate.
- **1K-D historical repair migration** (`20260721053049_…`) is a **row-specific data patch**. It has no effect on architecture; do not merge it into any structural migration nor rewrite it.

## 12. Recommended Controlled Phase Decomposition

Proposed sequencing only; no implementation and no scope binding is created here.

| Phase | Objective | Likely file scope (indicative) | Dependencies | Stop gate |
|---|---|---|---|---|
| 1L-B | Architecture contract & type-level spec for a canonical Opportunity view-model shared by recruiter preview + driver render (fields, presence semantics, hiring-type-relevance matrix, pay-model-relevance matrix, one-time vs recurring semantics). No code. | `docs/` (new spec doc only) | None | Written contract reviewed and approved. |
| 1L-C | Freeze the calculation engine's public surface: name every metric, define zero-vs-null rule for `totalMiles`, define whether `escrow_amount` is deduction-only when `escrow_required=true`, define one-time bonus API. Pure vitest expansion only. | `src/lib/opportunities/opportunityProfit.ts`, `src/test/opportunityProfit*.test.ts` | 1L-B | New failing tests describe correct behavior; existing pass matrix unchanged. |
| 1L-D | Recruiter form reconstruction — hiring-type-conditional field visibility, pay-model-consistent validation (e.g. reject percentage-only publish, require operands for advertised metrics), explicit one-time-bonus section. UI-only, no DB. | `src/components/opportunities/RecruiterOpportunityForm.tsx`, `src/test/recruiterOpportunityFormConsolidation.test.tsx` (+ new) | 1L-B, 1L-C | Rendered contract tests green; no DB or edge changes. |
| 1L-E | Publication validation server layer — extend `opportunities_guard` (or a new pre-publish CHECK/trigger) to enforce internal-consistency at the moment publication would stamp `admin_review_status='approved'`. Real-PG regression gate. | new candidate migration + `tests/postgres/…` | 1L-B, 1L-D | New PG16 workflow green; existing 1K workflow still green. |
| 1L-F | Driver page reconstruction — hiring-type-aware conditional sections, `benefits` split into two labelled cards ("Typical Lanes" / "Requirements"), one-time-bonus visually separated from weekly, "Approved Opportunity" badge reconciled with `recruiter.verification_status` semantics, RPM/miles zero-vs-null wording corrected. | `src/components/opportunities/OpportunityDetail.tsx`, `OpportunityCard.tsx`, `OpportunityProfitBreakdown.tsx` | 1L-B, 1L-D, 1L-E | Rendered UI tests green; screenshot anomaly cases covered as regression tests. |
| 1L-G | Legacy row handling — one-shot backfill / view for `benefits` split (either via `splitBenefits`-derived generated columns or a migration), `min_years_experience` column decision (add and enforce, or remove dead read from match engine). | migration + typed backfill; `opportunityMatch.ts` | 1L-B, 1L-E | Real-PG data-safety gate green; no in-place mutation of unrelated rows. |
| 1L-H | Regression test consolidation — pure and PG16 suites for every anomaly cell in Section 6, plus hiring-type matrix and validation matrix. | `src/test/`, `tests/postgres/`, new vitest configs & workflows if needed | all prior | All prior workflows still green; new workflow green. |
| 1L-I | Production acceptance — read-only preflight against live DB for schema/trigger/RPC drift, then controlled promotion of any migrations from 1L-E / 1L-G. | none besides authorized migration promotion | all prior | ChatGPT-issued go signal per each promotion. |

## 13. Unresolved Questions / Minimum Follow-Up Evidence

The following cannot be answered from the repository alone and would need one narrowly scoped **read-only SELECT** each, if authorized in a later phase (not executed here):

1. Exact per-column values on row `28d75a1e-…432a93` for `insurance_deductions`, `escrow_required`, `escrow_amount`, `lease_payment`, `maintenance_deductions`, `other_deductions`, `sign_on_bonus`, `estimated_loaded_miles`, `estimated_deadhead_miles`, `estimated_weekly_miles`, `benefits`. Minimum: `SELECT` these columns from `public.opportunities WHERE id='28d75a1e-…432a93'`.
2. Whether any other rows already store `benefits` in the serialised header format vs legacy free text. Minimum: `SELECT count(*) FILTER (WHERE benefits ILIKE 'Typical Lanes:%'), count(*) FILTER (WHERE benefits ILIKE '%Requirements:%'), count(*) FROM public.opportunities WHERE benefits IS NOT NULL`.
3. Distribution of `driver_type` values in the wild (to confirm the free-text column has no unexpected values). Minimum: `SELECT driver_type, count(*) FROM public.opportunities GROUP BY 1 ORDER BY 2 DESC`.
4. Whether the column `opportunities.min_years_experience` truly does not exist in the live DB. Minimum: `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='opportunities' AND column_name='min_years_experience'`.

## 14. Final Integrity Statement

- Files changed: **NONE**.
- Commands executed (all read-only): `git branch --show-current`, `git rev-parse HEAD`, `git status --short`, `git log -1 --oneline`, `git diff --stat …`, `git ls-files`, `ls`, `sed`, `grep`, `rg`, `awk`, `head`, `wc` (via `code--exec`); plus `code--view` on repository files. No test runner, build, typecheck, formatter, linter, migration tool, browser automation, DB, deployment, or publish command was run.
- Database queried: **NO**.
- Tests / build / typecheck run: **NO**.
- Commit created: **NO** (the only working-copy difference from GitHub main baseline is the pre-existing 1K-D migration auto-commit `087473e`, which this phase did not touch).
- Final `git status --short` = empty.
- Final `git rev-parse HEAD` = `087473ea549e00f3d12c5cf9cbbfb60d2dfef00d`.

**STOP.** No Phase 1L-B action taken.
