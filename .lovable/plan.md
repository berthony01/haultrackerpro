
# Phase 1J-C2 — Plan Only

Start SHA: `88dd68824c5d8c5e40a06007a9e020bd1752e7c4`. Plan-only turn. No edits, commits, schema, billing, deployment, or publish.

## 1. Difficulty and model choice

High risk. Copy touches source-integrity-locked recruiter files and both nav shells drive workspace routing. Requires strongest planning model. Two independently shippable subplans (C2A copy, C2B nav) so either can be paused without blocking the other.

## 2. Current findings (from reads at HEAD)

**Canonical eligibility already correct** in `src/lib/opportunities/recruiterEligibility.ts` (Phase 1F-A.1): posting unlocks on complete profile + accepted terms + not-suspended; verification is a badge only; `pending`/`rejected` do not block posting; billing never gates standard posting.

**Copy conflicts still present in the three in-scope files:**

- `RecruiterAccessPage.tsx`
  - L127 comment + L254 title `'Apply for Recruiter Access'` (fallback header for no-intent users)
  - L268 button label `'Start Application'`
  - L163 tooltip "Finish your recruiter profile to post opportunities." (OK)
  - L770 HowItWorks step 1 title `'Apply for recruiter access'` + body `'Submit your recruiter profile for review.'` — implies review is required to post.
- `RecruiterOnboarding.tsx`
  - L200 header `'Recruiter & Carrier Access'` (OK, neutral)
  - L264 DOT/MC helper `"We use this to verify your authority before approval."` — implies approval gate.
  - L326 submit button `'Submit Recruiter Profile'` (OK; not "for review")
  - L323 resubmit label `'Resubmit for Review'` — correct only when it truly means Verified badge review; must say so.
  - L178 toast `'Recruiter profile resubmitted for review.'` — same ambiguity.
  - L309/311 sticky copy already correct.
- `RecruiterEntryRoute.tsx`
  - L262 error body neutral (OK). L287 blocked body correct. L299 error title correct. Only implicit "Application" language via downstream; no direct conflicts. No changes proposed.
- `src/lib/opportunities/recruiterEligibility.ts` (indirectly rendered by all three) — L88 `cta: 'Apply for Recruiter Access'` and L84 title `'Recruiter Access Required'` for no-profile no-intent case surface **inside** RecruiterAccessPage and OnboardingStatusCard. Since the spec allows "directly related rendered" surfaces, this literal must change; without it the page will still render the misleading CTA.

Marketing pages (`RecruiterLanding`, `Recruiters.tsx`, `RecruiterGuide`, `RecruiterFeatures`, `RecruiterFAQ`, `Pricing`, `Auth`, `ResourcesHub`, `DriverReferralGuide`, `RecruiterToolsGuide`) also use "Apply for Recruiter Access" / "requires approval" language. **Out of scope** per this turn (only the four listed files/dependencies). Flagged in Risks.

**Nav findings:**
- `App.tsx` confirms routes exist: `/start`, `/assistant`, `/agency`, `/driver/assistant-control`, plus `/driver/agency-approvals`.
- `AppSidebar.tsx` — driver items list has zero Assistant/Agency/Switch entries. Recruiter list same.
- `BottomNav.tsx` — driver More has no Assistant/Agency/Switch entries. Recruiter More has no Switch.
- `CapabilityLauncher.tsx` — already exposes all four tiles (driver/recruiter/assistant/agency); no changes needed.

## 3. C2A — Exact copy table (production surfaces)

| # | File | Line | Current | Proposed | Reason |
|---|------|------|---------|----------|--------|
| 1 | recruiterEligibility.ts | 84 | title `'Recruiter Access Required'` | `'Add recruiter workspace'` | "Required/Access" implies gated approval; recruiter is an additive workspace on the same account. |
| 2 | recruiterEligibility.ts | 87 | `'You need recruiter access before posting opportunities. Complete the recruiter application to start posting.'` | `'Add the recruiter workspace to your account. Complete the short recruiter profile to start posting standard opportunities — no admin approval needed.'` | Removes "need access/application"; states additive + no approval. |
| 3 | recruiterEligibility.ts | 88 | cta `'Apply for Recruiter Access'` | `'Add Recruiter Workspace'` | "Apply" implies review gate. |
| 4 | RecruiterAccessPage.tsx | 127 (comment) | `"Apply for Recruiter Access" card` | `"Add Recruiter Workspace" card` | Keep comment in sync. |
| 5 | RecruiterAccessPage.tsx | 254 | title fallback `'Apply for Recruiter Access'` | `'Add Recruiter Workspace'` | Same as #1. |
| 6 | RecruiterAccessPage.tsx | 261 | `'Submit your recruiter information. Standard posting unlocks as soon as your profile is complete — no admin approval needed to post.'` | (already correct — keep) | Reference row. |
| 7 | RecruiterAccessPage.tsx | 268 | button `'Start Application'` | `'Set Up Recruiter Profile'` | "Application" implies review gate. |
| 8 | RecruiterAccessPage.tsx | 770 | HowItWorks n1 title `'Apply for recruiter access'` / body `'Submit your recruiter profile for review.'` | title `'Set up your recruiter profile'` / body `'Add recruiter as an additional workspace on your account. Standard posting unlocks the moment your profile is complete — no admin approval needed.'` | Directly implied that review gates posting. |
| 9 | RecruiterOnboarding.tsx | 264 | `'Provide at least one of DOT or MC number. We use this to verify your authority before approval.'` | `'Provide at least one of DOT or MC number. We use it to verify your authority for the Verified Recruiter badge review — standard posting is not gated on this.'` | Approval language implied posting gate; clarify it is badge review only. |
| 10 | RecruiterOnboarding.tsx | 178 | toast `'Recruiter profile resubmitted for review.'` | `'Recruiter profile resubmitted for Verified Recruiter badge review.'` | Disambiguate: only badge review, posting stays enabled. |
| 11 | RecruiterOnboarding.tsx | 322-323 | button `'Resubmit for Review'` | `'Resubmit for Badge Review'` | Same. |

No other user-facing recruiter copy changes in the three files. `RecruiterEntryRoute.tsx` copy is already neutral; leave untouched.

Preserved unchanged: eligibility rules, RPCs, billing, schema, verification transitions, `describeRecruiterEligibility` shape, `getRecruiterTrustView` labels (already correct), `RecruiterOnboardingStatusCard` copy (already correct), sticky-save copy (already correct).

## 4. C2B — Selected architecture

**Choice: Driver-only "Assistants & Agency" entry + universal "Switch Workspace" (option A). No separate Assistant/Agency sidebar links.**

Reasoning: `/driver/assistant-control` is the authoritative hub the driver already owns for delegating to assistants and agencies. Adding *direct* `/assistant` (assistant console) and `/agency` (agency console) links inside the driver sidebar would surface roles the driver may not have (assistant/agency are invite/setup-gated separate contexts) and duplicate navigation. `/start` cleanly launches into any capability the user actually has, and `CapabilityLauncher` already tiles all four. Result: two new discoverable entries per shell, no duplicate dashboards, no capability enum expansion.

Recruiter shell gets only "Switch Workspace" (no driver-control link) so we never mislabel driver assistant-control as recruiter functionality.

**Concrete additions:**

- `AppSidebar.tsx`:
  - Extend `driverItems` with `{ id: 'nav:assistant-control', label: 'Assistants & Agency', icon: Users, href: '/driver/assistant-control' }` and `{ id: 'nav:switch-workspace', label: 'Switch Workspace', icon: ArrowLeftRight, href: '/start' }` — new items support an optional `href` that, when present, uses `useNavigate` instead of the page-state `onNavigate`.
  - Extend `recruiterActiveItems` and `recruiterHubOnlyItems` with only the `Switch Workspace` href entry. No assistants item on recruiter shell.
  - Assistant-acting mode (`isAssistant === true`) hides both new entries — assistant impersonation must not expose driver's delegation-management or workspace-switch.
- `BottomNav.tsx`:
  - Do NOT add to primary bottom row (keep 2+FAB+2 driver, keep recruiter primary row).
  - Extend `driverMoreItemsFull` with `Assistants & Agency` → navigate `/driver/assistant-control`, and `Switch Workspace` → `/start`.
  - Extend `recruiterActiveMoreItems` and `recruiterHubOnlyMoreItems` with only `Switch Workspace`.
  - `driverMoreItemsAssistant` (acting-assistant): no additions — preserves current assistant filtering.
- No changes to `CapabilityLauncher.tsx`, `App.tsx`, `Index.tsx`, capability enum, `useUserCapabilities`, `useViewMode`, or RPCs.

Navigation grants no capability; each destination route already enforces its own guard (`ProtectedRoute` + page-level checks in `DriverAssistantControl`, `AssistantDashboard`, `AgencyDashboard`).

## 5. Exact production file scope

- `src/lib/opportunities/recruiterEligibility.ts` (copy only, rows #1–3)
- `src/components/opportunities/recruiter/RecruiterAccessPage.tsx` (rows #4, 5, 7, 8)
- `src/components/opportunities/RecruiterOnboarding.tsx` (rows #9, 10, 11)
- `src/components/premium/AppSidebar.tsx` (add two driver items + one recruiter item, add `href` handling)
- `src/components/BottomNav.tsx` (extend three More lists)

## 6. Exact test file scope

New:
- `src/test/phase1jC2RecruiterCopyReconciliation.test.tsx` — renders `RecruiterAccessPage` and `RecruiterOnboarding` across all 8 states (missing / incomplete / pending / rejected / approved / suspended / unpaid / paid). Asserts: no occurrence of `/Apply for Recruiter Access|Start Application|submit for review|before approval/i` in visible text; asserts posting-enable/disable parity vs eligibility (canPost from `describeRecruiterEligibility` matches Post button disabled state and StatusCard `data-can-post`); asserts "Verified Recruiter badge review" phrasing shown where review is referenced.
- `src/test/phase1jC2NavDiscoverability.test.tsx` — renders `AppSidebar` and `BottomNav` in: (a) driver desktop, (b) recruiter active desktop, (c) driver mobile More, (d) recruiter active mobile More, (e) acting-assistant driver desktop, (f) loading. Asserts: driver shows "Assistants & Agency" + "Switch Workspace"; recruiter shows "Switch Workspace" only, no "driver control" mislabel; mobile More parity; acting-assistant hides both; click routes call `useNavigate` with `/driver/assistant-control` and `/start`.
- `src/test/phase1jC2CapabilityLauncherIntact.test.tsx` — snapshot-lite: 4 tiles still present with driver/recruiter/assistant/agency labels.

Updated (only if literal breaks):
- `src/test/phase1fRecruiterEligibility.test.ts` L51 — expected cta `'Finish Recruiter Setup'` (intent path) stays; add new expectation `'Add Recruiter Workspace'` for no-intent path (if it currently asserts old string, adjust).
- `src/test/phase1eRecruiterOnboardingContinuity.test.ts` — same, if it asserts the no-intent CTA.

No changes to: recruiter Phase 1F/1G/1H suites (they assert eligibility, RPC, and billing behavior — unchanged), Phase 1J-A/B suites, Phase 4A assistant/agency suites, Postgres suites.

## 7. Verification commands (separate, per gate)

Typecheck (node + app):
```
bun run tsgo -p tsconfig.node.json
bun run tsgo -p tsconfig.app.json
```
Vitest — new + touched suites only, then full app suite:
```
bunx vitest run src/test/phase1jC2RecruiterCopyReconciliation.test.tsx src/test/phase1jC2NavDiscoverability.test.tsx src/test/phase1jC2CapabilityLauncherIntact.test.tsx
bunx vitest run src/test/phase1fRecruiterEligibility.test.ts src/test/phase1eRecruiterOnboardingContinuity.test.ts src/test/phase1fa22R1aRenderedTrustState.test.tsx src/test/phase1jB2ARecruiterEntry.test.tsx src/test/phase1jB2BDashboardGating.test.tsx src/test/phase1jBWorkspaceRouting.test.tsx src/test/phase4aDriverControlCenter.test.ts
bunx vitest run
```
Forbidden markers:
```
rg -n "\.only\(|\.skip\(|xit\(" src/test tests | rg -v "phase1jC1" ; test $? -eq 1
```
Build:
```
bun run build
```
Read-only authenticated browser smoke (script under `/tmp/browser/p1jc2/`, no DB writes, no dismiss-onboarding writes — CSS override only):
1. Load `/dashboard`, driver desktop viewport 1280×1800; sidebar shows "Assistants & Agency" and "Switch Workspace"; click each and assert `page.url` becomes `/driver/assistant-control` and `/start` respectively.
2. Return to `/dashboard`, switch to recruiter workspace; sidebar shows "Switch Workspace" and NO "Assistants & Agency"; click Switch → `/start`.
3. Mobile viewport 390×844: driver More sheet shows both entries; recruiter More sheet shows Switch only.
4. Load recruiter access page, capture screenshot; grep DOM text for the four forbidden phrases (case-insensitive). Assert none.
5. Console: zero `pageerror`, zero hook-order violations.

## 8. Risks and stop conditions

**Risks**
- Marketing surfaces (`Recruiters.tsx`, `Pricing`, `RecruiterLanding`, `Auth`, `ResourcesHub`, `RecruiterFAQ`, `RecruiterGuide`, `RecruiterFeatures`, `DriverReferralGuide`, `RecruiterToolsGuide`) still say "Apply for Recruiter Access" / "requires approval". They are OUT of the four-file spec. Ship product-surface truth now; propose a follow-up Phase 1J-C3 for marketing copy so we don't break marketing SEO or CTA tracking without a separate approval.
- Source-integrity suites (`phase1fa22R1aRenderedTrustState`) lock in specific literals from `getRecruiterTrustView`; C2A does not touch those literals — stop and report if any assertion breaks after change #1–3.
- Adding items to the driver sidebar changes shell test expectations; only `phase1jC2NavDiscoverability` should assert new entries. If any existing sidebar/bottomnav test asserts the exact item list length or full array shape, STOP and surface for split.
- `href`-based sidebar item is a small pattern extension; will keep the change to items that opt into `href`, no behavior change for existing `id`-only items.

**Stop conditions** (do not proceed under any of these; return CANNOT-CONFIRM or FAIL split):
- Any Phase 1F/1G/1H/1J-A/1J-B/4A suite regresses.
- Any postgres suite requires change (schema/RPC drift).
- A locked source-integrity assertion contradicts a proposed literal.
- Marketing copy or auth flow surfaces surfacing "Apply for Recruiter Access" are found *inside* the four in-scope files beyond the rows above.
- Browser smoke shows any `pageerror`, hook-order violation, or a nav click that routes outside `/driver/assistant-control` or `/start`.
- Any request implies adding assistant/agency to the capability enum, or granting delegation via nav.

Phase 1J-C2 plan ready. No file, database, billing, deployment, publish, or live-data change was performed.
