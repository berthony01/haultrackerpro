
# Phase 1G-R1A7-R1 — Execution Plan (Honest Split)

## Difficulty assessment

Extreme. The contract requires, in one turn:
- Full rewrite of `RecruiterBillingPanel` around an explicit state-machine model with ~15 states.
- Rewrite of `useRecruiterBilling` popup/redirect flow with sync-open + post-validate navigation, portal parity, dual strict validators.
- Restructure `recruiterCheckoutMessages.ts` into per-state accurate copy + two dedicated validators.
- 46 focused RTL/vitest cases against real production components (currently 23).
- 25 real Chromium Playwright scenarios covering 15 subscription states, popup blocking, retry cooldowns, keyboard nav, network failure retry, remount rehydration, and standard-posting-copy independence.
- Axe scans with pass thresholds on the real preview build.
- Responsive proof at 6 viewports with `scrollWidth <= clientWidth` and bounding-box assertions.
- A brand-new dedicated Playwright config for the built-preview run.
- New CI workflow (or extension of existing one) with 20 enforced steps including Playwright install, built-preview serving, Axe artifact upload, screenshot upload, PostgreSQL suite, orchestrator suite, DEF-04/DEF-23 suites, full vitest, TS, and build with `HTP_BUILD_SHA=${{ github.sha }}`.
- Lockfile-provenance investigation and controlled restore of `noTrialLanguage.test.ts` + `bun.lock`.
- Exactly one pinned dependency addition: `@axe-core/playwright`.
- Authoritative local build only after all commits land, with SHA equality proof across `git rev-parse HEAD`, `dist/version.json`, and the single `htp-build-sha` meta tag.

Attempting all of this in a single turn will produce either a shallow/unverifiable pass or scope drift into prohibited files. Neither is acceptable under this contract.

## Proposed split

Each sub-phase ends with its own PASS/FAIL gate and its own commit. I do not proceed to the next until you accept the prior.

### R1a — Production source correction (no new test infra)
Scope:
- Restore `src/test/noTrialLanguage.test.ts` to A4 baseline (`938294906571bb5780c1c89db4a67cde2dfcc15b`).
- Investigate lockfile provenance vs A4; if the current `bun.lock` is drift-only, restore it. Only permitted mutation to `bun.lock` in R1a is that restore.
- Rewrite `src/lib/opportunities/recruiterCheckoutMessages.ts`:
  - split into `isSafeStripeCheckoutUrl` (exact `checkout.stripe.com`) and `isSafeStripeBillingPortalUrl` (exact `billing.stripe.com`).
  - per-state accurate public copy for all 15+ subscription/checkout states.
  - remove misleading "already have an active recruiter subscription" for past_due/unpaid/incomplete/paused.
- Rewrite `src/hooks/opportunities/useRecruiterBilling.ts`:
  - explicit discriminated-union client billing state model (idle | loading | ineligible | starting{plan} | checkout_ready | popup_blocked{url} | in_progress | processing | active | trialing | past_due | unpaid | incomplete | paused | canceled | unknown | portal_opening | portal_blocked{url} | retryable_error | support_required).
  - sync-open blank popup pattern on click; validate returned URL; on failure close popup; on popup-block return validated fallback URL.
  - portal flow gets the same treatment with `isSafeStripeBillingPortalUrl`.
  - refetch billing queries on `in_progress`/`subscription_exists`/`checkout_processing` responses.
  - cooldown-gated Check-Status/Retry action.
- Rewrite `src/components/opportunities/RecruiterBillingPanel.tsx` to consume the new state model, disable all plan buttons during pending, show "Preparing" only on the selected plan, render fallback "Continue to secure checkout" button when popup blocked (using validated URL), aria-live status region, state-accurate copy per subscription status, no raw errors.
- Optional: one new helper at `src/lib/opportunities/recruiterCheckoutNavigation.ts` for sync-open+post-validate.

Deliverable: TS passes; existing focused A7 tests updated minimally to compile (behavioral test overhaul is R1b). Commit: `A7-R1a`.

### R1b — Focused RTL suite (46 cases)
Scope:
- Full rewrite of `src/test/phase1gR1A7RecruiterBillingFlow.test.tsx` to the 46-case matrix (states 1–46 in your contract).
- No changes outside the test file.

Deliverable: focused suite passes with 46/46, full vitest suite still green. Commit: `A7-R1b`.

### R1c — Real Chromium browser suite + Axe + dedicated config
Scope:
- Add exactly `@axe-core/playwright` pinned to a resolved version, single lockfile update.
- New `playwright.recruiter-billing.config.ts` targeting the built preview (`vite preview`) on a dedicated port.
- New `tests/e2e/recruiter-billing.spec.ts` covering all 25 Chromium scenarios, with network-boundary mocking of `supabase.functions.invoke('create-recruiter-checkout')` and `supabase.functions.invoke('recruiter-billing-portal')`, plus REST mocks for `recruiter_profiles`, `recruiter_billing_profiles`, `opportunities` count. Auth session restore via `LOVABLE_BROWSER_*` if injected, else fully mocked. Screenshots at 320/375/390/768/1280/1440. Axe scan on eligible+active+past_due+popup_blocked states. Overflow assertions per viewport.

Deliverable: browser suite runs green locally against built preview. Commit: `A7-R1c`.

### R1d — CI workflow + authoritative build + release-gate proof
Scope:
- New workflow `.github/workflows/recruiter-billing-browser.yml` (or narrow extension of `recruiter-checkout-postgres.yml`) implementing all 20 required steps with genuine failure propagation (no unguarded `| tail`, no unenforced `continue-on-error`), triggered on the exact path filter listed in the contract.
- Local authoritative build with `HTP_BUILD_SHA=$(git rev-parse HEAD)` executed only after R1d commit lands, then SHA-equality proof (`git rev-parse HEAD` == `dist/version.json.sha` == meta tag).
- Final PASS/FAIL report with exact test counts and artifact references.

Deliverable: workflow committed, local authoritative build proof captured. Commit: `A7-R1d`.

## Technical notes
- Prohibited-file list is respected across all sub-phases: no SQL/migrations/edge/webhook/orchestrator/RLS/type-gen/opportunity-form/driver/agency/assistant/dispatcher changes.
- The Recruiter checkout edge function's response shape (`code` + `url`) is treated as the authoritative contract; the client never invents success.
- All URL validation is destination-specific with exact hostname allow-lists; no `endsWith('.stripe.com')` anywhere.
- Popup pattern: `const w = window.open('about:blank', 'recruiter-checkout')` sync on click → call edge fn → on success `w.opener = null; w.location = validatedUrl` → on failure `w.close()` → if `w === null` (blocked) surface accessible fallback with validated URL only.
- No live DB, no live Stripe, no deploy, no publish, no production env change.

## Ask
Please confirm:
1. Approval to execute R1a → R1b → R1c → R1d sequentially, each committed and reported before the next begins.
2. Whether the CI job may run on GitHub Actions (I can only prepare and commit the workflow; I cannot execute Actions from the sandbox — CI evidence is proof-of-workflow-syntax + a local `act`-free rehearsal of each script step).
3. Whether Playwright browser install (~150MB Chromium) inside this sandbox for R1c local proof is acceptable; if not, R1c local evidence will be limited to config+spec syntax + a subset headless run.
