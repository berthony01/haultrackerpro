# Strict Audit — Recruiter Opportunity Posting Flow

Analysis only. No code changes. Goal: identify why the flow feels heavy and why a recruiter had trouble entering CPM, and propose a tightly scoped simplification plan.

## 1. End-to-end flow as it exists today

```text
Index.tsx
  └─ <RecruiterAccessRoute>                       (lazy)
       ├─ view='hub' → <RecruiterAccessPage>     ← lands here
       │      "Post Opportunity" / "Manage"
       ├─ view='manager' → <RecruiterOpportunityManager>
       │      list + "+ New" button
       └─ view='manager' + edit → <RecruiterOpportunityForm>
              5-step wizard, ~30 fields, 1134 lines
```

Clicks from "I want to post a job" to a usable form: **3** (Hub → Manage → +New). Recruiters never see the form on first arrival; they see a dashboard.

Verification gating chain (`RecruiterOpportunityManager.tsx:57-68`): no profile → suspended → rejected → pending → approved. Each state returns a different `Gate` card. Correct but adds perceived friction because the same page renders many distinct states.

## 2. Why the recruiter could not enter CPM (root cause)

In `RecruiterOpportunityForm.tsx`:

```ts
// line 742-744
const showCpm  = form.pay_model === 'cpm' || form.pay_model === 'mixed';
const showPct  = form.pay_model === 'percentage' || form.pay_model === 'mixed';
const showFlat = form.pay_model === 'flat_weekly' || form.pay_model === 'salary' || form.pay_model === 'mixed';

// line 771
{showCpm && <NumField label="CPM Rate ($/mi)" value={form.cpm} ... />}
```

The CPM input is **hidden until the recruiter clicks the "CPM" pay-model chip**, which lives on Step 3 of a 5-step wizard. A recruiter who lands on the form intending to "pay drivers 65 cents per mile" must:

1. Fill Step 1 (title, company, hiring type, route, location, summary).
2. Click "Save & Continue".
3. Fill Step 2 (trailer, lanes, miles).
4. Click "Save & Continue".
5. Reach Step 3, scroll to "Pay Model", click "CPM".
6. *Now* the CPM field finally appears.

There is no shortcut, no label on Step 1 mentioning CPM, and the chip-style pay-model selector does not auto-focus the revealed field. Label `CPM Rate ($/mi)` is also ambiguous — does the recruiter enter `0.65` or `65`? `NumField` is a bare `type="number"` with no `$` adornment, no helper text, no min/max sanity check, and no preview of "you entered $0.65/mi · about $X/week at Y miles".

This single field is the reason the test recruiter got stuck.

## 3. Real defects found in the form

These are correctness bugs, not opinions.


| #   | File:line                                                                                                                                                                                                                        | Issue                                                                                                                                                                                                                                                                         | Impact                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| D1  | `RecruiterOpportunityForm.tsx:696, 843`                                                                                                                                                                                          | Step 2 "Typical Lanes" textarea and Step 4 "Additional Requirements" textarea both bind to `form.benefits`. Whichever step is edited last wins — the other is silently overwritten.                                                                                           | Data loss; users lose lanes or requirements without warning.                                                                |
| D2  | `RecruiterOpportunityForm.tsx:319`                                                                                                                                                                                               | `transparency_confirmed: mode === 'submit'` — the persisted flag is set purely from the submit action, ignoring the three checkboxes. The two extra checkboxes (`confirm_drivers_see_intel`, `confirm_misleading_removed`) are validated client-side but **never persisted**. | Transparency state is misleading; admin moderation reads a value that may not reflect the recruiter's actual confirmations. |
| D3  | `RecruiterOpportunityForm.tsx:65-122`                                                                                                                                                                                            | `hiring_states` is a raw CSV string in form state, parsed with `splitList`. No chips, no multi-select, no validation that entries are valid 2-letter codes.                                                                                                                   | Garbage data; admin search/filter by state silently fails.                                                                  |
| D4  | `StepProgress` (488-541) clicks jump steps freely, and "Save & Continue" only advances `step` (343) — it does **not** persist anything. Combined with no autosave, a closed tab or accidental navigation loses 5 steps of input. | High abandonment risk.                                                                                                                                                                                                                                                        | &nbsp;                                                                                                                      |
| D5  | `numericFields` validation (260-264) returns "cpm cannot be negative" with raw underscore key. Error toasts read `"cpm cannot be negative"` instead of "CPM rate must be 0 or higher".                                           | Poor UX for the exact field giving recruiters trouble.                                                                                                                                                                                                                        | &nbsp;                                                                                                                      |
| D6  | `RecruiterAccessPage.tsx:25` imports `Sparkles` from lucide as identity decoration. Chat-agent contract aside, this surface uses it as part of recruiter branding — acceptable but worth noting if we standardize iconography.   | Cosmetic.                                                                                                                                                                                                                                                                     | &nbsp;                                                                                                                      |
| D7  | `RecruiterOpportunityManager.tsx:123-126` "+ New" button label is just "New". Hub button is "Manage Opportunities". Neither says "Post a Job".                                                                                   | Discoverability.                                                                                                                                                                                                                                                              | &nbsp;                                                                                                                      |


## 4. Complexity audit — fields vs. what is actually required

Form collects **~30 fields across 5 steps**. Server-side required to publish (`validate`, lines 257-282):

- title
- company_name
- driver_type (hiring type)
- route_type
- trailer_type
- pay_model
- one of {estimated_weekly_gross, cpm, flat_weekly_pay, percentage_pay}
- 3 transparency checkboxes

That's **9 fields**. Everything else (hiring_city/state/states, description, lanes, miles, deadhead, deductions, escrow, home_time, equipment_year, benefits, detention, layover, sign-on, fuel) is optional but is presented with the same visual weight as required fields.

Visible cost: a 1,134-line component with 5 sub-step components, a sticky preview panel, a strength meter, and a collapsed-section list. Reasonable as an "advanced" mode, excessive as the default first-post experience.

## 5. Strict findings summary

- **Friction: real.** 3 clicks to reach the form, 5 steps to reach CPM, and the CPM input is gated behind a chip the recruiter has not yet learned matters.
- **Bugs: real.** D1 (benefits field collision) and D2 (transparency flag mismatch) are data correctness issues, not polish.
- **Required fields: small.** A guided "Quick Post" can cover 9 required fields in one screen.
- **The wizard should not be removed** — it serves recruiters posting complex lease-purchase opportunities. But it should not be the first-time experience.

## 6. Recommended fix plan (build-mode work, not done now)

Phased so it can ship surgically without touching the wizard's existing structure or backend schema.

### Phase R1 — Stop the bleeding (small, no schema change)

1. Fix D1: split `benefits` storage into two distinct form-state keys (`typical_lanes`, `requirements_text`). Persist `typical_lanes` into `description` or a new optional column later; for now concatenate into `benefits` with clear delimiter so no data is lost.
2. Fix D2: persist `transparency_confirmed = a && b && c` based on the three checkboxes, regardless of submit/draft.
3. Fix D5: friendlier validation labels via a `FIELD_LABELS` map.
4. Rename "+ New" to "+ Post Opportunity" and add the same button to the empty state of `RecruiterAccessPage` so it works from the hub without going through Manage.
5. Add an inline "$/mile — example: 0.65" helper directly under the CPM field and a live "≈ $X/week at Y miles" hint using the existing financials calculator.

### Phase R2 — One-screen "Quick Post" mode (default for first-time recruiters)

A single screen capturing the 9 required fields, with one collapsible "Add more detail" section that opens the existing wizard's optional fields. Submits through the **same** `createOpportunity` mutation — no new edge function, no schema change.

Routing:

- "+ Post Opportunity" from hub → Quick Post screen.
- Existing wizard still available via a "Switch to Detailed Editor" link.
- Edit existing → keep wizard (it is better for review).

Pay-model UX in Quick Post:

- Pay-model chips at top.
- The matching pay input (CPM / %/ flat) renders immediately and is auto-focused.
- Add `$` prefix adornment, `step="0.01"`, `min="0"`, `max="2"` for CPM with toast warning if user enters > 2 ("did you mean 0.65?").

### Phase R3 — Reliability

- Local autosave (`useEffect` → localStorage keyed by recruiter id + draft id) so a refresh never loses input.
- "Save & Continue" actually persists a draft on each step transition.
- Replace `hiring_states` CSV with a chip multi-select using the existing `US_STATES` array.

### Phase R4 — Polish (optional)

- Move 3 transparency checkboxes into one "I confirm this listing is accurate" with the long disclaimer collapsed below.
- Inline preview cards on Quick Post mirror what drivers will see.

## 7. What this audit explicitly does **not** recommend

- Do **not** change Phase 23 pay logic, Phase 29 stops, or any driver-side calculation.
- Do **not** alter the `opportunities` table schema or RLS in R1/R2 (the bug fixes and Quick Post work with existing columns).
- Do **not** touch recruiter billing, contracts, application pipeline, or referral logic.
- Do **not** remove the 5-step wizard. Keep it as the "Detailed Editor".
- Do **not** add a new edge function — `createOpportunity` mutation already does the right thing.

## 8. Suggested order of operations

1. R1 ships first (1 PR, ~150 LOC). Immediately fixes the data bug and surfaces the CPM helper that solves the reported user issue.
2. R2 ships next as a new component `RecruiterQuickPostForm.tsx` reusing the existing `useRecruiterOpportunities` hook, `calculateOpportunityFinancials`, and `Field`/`NumField` primitives.
3. R3 and R4 are independent.

If you approve, the next planning step will be a build plan for **Phase R1 only** so we can confirm the bug fixes and the CPM helper land before introducing the Quick Post screen. can you also make it so a recruiter can paste an opportunity which would auto fill the form.