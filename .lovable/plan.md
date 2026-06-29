# Phase 4 Cleanup + Assistant/Agency Showcase Alignment

Two-part plan: (1) fix real product wiring gaps, (2) reposition the public-facing surface so the Driver Assistant / Agency opportunity is properly showcased — without overpromising.

## Part 1 — Product wiring fixes

1. **Driver Control Center grouping** (`src/pages/DriverAssistantControl.tsx`)
  - Split list into three sections: Active (`status==='active'`), Pending invites (`'pending'`), Past/revoked (`'revoked' | 'expired'`).
  - No pending row rendered under "Active".
2. `**driver_respond_to_work_item()` notification shape** (migration)
  - Rewrite the `create_notification` call inside the RPC to pass `user_id`, `type='agency_work_item_driver_responded'`, proper `title` ("Driver responded to a work item"), `body` ("The driver replied to: {title}"), and `payload` (`agency_id`, `work_item_id`, `driver_user_id`, `title`).
  - Keep `SECURITY DEFINER`, `search_path=public`, existing grants.
3. **Work queue deep links** (`src/components/agency/WorkQueueSection.tsx`)
  - For each work item, look up whether the current user has an **active** `driver_assistants` row for that driver (new lightweight hook `useHasDriverAccess(driverUserId)` calling a new RPC `current_user_has_active_assistant_access(driver_user_id)` — pure read, security definer).
  - If access: render buttons gated by permissions:
    - Start managing → calls `beginActingAs(driver_user_id)` then routes to `/` (dashboard).
    - Add load / Add expense / Add fuel → `beginActingAs` then route to the existing forms (`/?quick=load|expense|fuel`); reuse existing forms (no bypass of `applyFuelLogPolicy`).
    - View reports / Limited settings → route to existing pages.
  - If no access: render disabled notice "You are assigned this work item, but you do not currently have driver account access."
  - Never pass driver_user_id to grant access; RLS remains the enforcer.
4. **Agency request link wording**
  - `src/lib/featureList.ts`, `src/pages/Landing.tsx`, `src/pages/Features.tsx`, any "Public Agency Request Links" copy → "Private Agency Request Links" / "Shareable request link — drivers sign in to submit a request."

## Part 2 — Showcase Driver Assistant + Agency opportunity

5. **Homepage hero** (`src/pages/Landing.tsx`)
  - New headline: "The trucking platform for drivers, recruiters, and back-office agencies."
  - Subcopy describing four audiences and approval/audit model.
  - Secondary CTA: "Build a back-office service" → if signed out `/auth?intent=assistant`, if signed in `/agency`.
6. **Navigation**
  - Add "Assistants & Agencies" link to top nav (desktop) → `/assistants-agencies`. Keep mobile uncluttered (single link, not a dropdown).
7. **New near-top section on Landing** ("Turn trucking paperwork into a service business")
  - Three cards: Driver Assistant / Back-Office Agency / Driver Control. Approval + audit + payments-outside disclaimer.
  - Placed above the pricing strip.
8. **New dedicated page `/assistants-agencies**` (`src/pages/AssistantsAgencies.tsx`)
  - Sections: side hustle framing, for assistants, for agencies, driver approval protection, what you can help manage, what HaulTracker Pro doesn't do yet, payments handled outside, CTAs to `/agency` and `/auth`.
  - Helmet meta + canonical.
  - Add route in `src/App.tsx`. Add to `public/sitemap.xml` (or generator).
9. **Features page** (`src/pages/Features.tsx`)
  - Add intro paragraph above the Team & Agency Workflow category.
  - Update SEO description.
10. **Pricing page** (`src/pages/Pricing.tsx`)
  - Add "Assistants & Agencies" section explaining: drivers pay subscription; assistants/agencies use the platform with approved clients; payments between driver and assistant handled outside HaulTracker Pro for now.
    - No new plans created.
11. **SEO**
  - Update `index.html` description.
    - Update Landing & Features Helmet titles/descriptions.
    - Add meta for `/assistants-agencies`.
    - Add `/assistants-agencies` to sitemap.
12. **Feature list** (`src/lib/featureList.ts`)
  - Replace "Public Agency Request Links" → "Private Agency Request Links" with accurate description.
    - Tighten copy: "Driver-approved access", "Side-hustle/agency workflow"; remove anything implying guaranteed income or marketplace.
13. **FAQ entries**
  - Append the 5 Q&A items to the existing Landing FAQ (or FAQ page) using the exact answers (approval required, revocable, payments outside, no income guarantee).

## Part 3 — Tests + verification

14. **New test file** `src/test/phase4CleanupShowcase.test.tsx`
  - Landing: includes "back-office" / "assistants" / "agencies" copy; does not say "Public Agency Request" or "guaranteed income".
    - Features: contains "Private" request link wording.
    - `featureList.ts`: no "public marketplace" / "guaranteed"; contains "Driver-approved" + "Private".
    - Pricing: contains assistant/agency payment-outside disclaimer.
    - DriverAssistantControl: pending row not rendered in Active section (smoke render with mocked hook).
    - WorkQueueSection: deep-link buttons hidden when no active assistant access; visible when access present.
15. **Notification regression test** (`src/test/phase4WorkItemNotification.test.ts`)
  - Static SQL assertion: the migration file contains the correct `create_notification` arg names (title/body/payload keys).
16. **Run + report exact results**: `bunx tsgo --noEmit`, `bunx vitest run`, `bun run build`.

## Out of scope (explicit)

- No Stripe Connect, no marketplace, no ratings, no new pricing tiers, no unauthenticated request submission.
- No changes to RLS enforcement model; deep links rely on existing `driver_assistants` + `useActingContext`.

## Files touched (summary)

- Migration: rewrite `driver_respond_to_work_item`; add `current_user_has_active_assistant_access`.
- `src/pages/DriverAssistantControl.tsx`
- `src/components/agency/WorkQueueSection.tsx` (+ small new hook file)
- `src/pages/Landing.tsx`, `src/pages/Features.tsx`, `src/pages/Pricing.tsx`
- `src/pages/AssistantsAgencies.tsx` (new) + `src/App.tsx` route
- `src/lib/featureList.ts`
- `index.html`, `public/sitemap.xml` (or generator)
- New tests under `src/test/`

Once approved, I'll implement, run tsgo + vitest + build, and report exact results.

Approved to proceed with Phase 4 Cleanup + Assistant/Agency Showcase Alignment, but apply these clarifications before implementation.

This must be built end to end. Do not build fake CTAs, fake routes, fake query parameters, or surface-level marketing copy that is not connected to real product workflows.

1. Auth intent clarification

Do not use `/auth?intent=assistant` unless the existing auth/role-intent system already supports an assistant intent cleanly.

If assistant intent does not exist, use a safe route such as:

- `/auth`
- `/assistants-agencies`
- or existing signup flow with clear next-step copy

Do not create a broken signup path.

2. Deep-link route clarification

Do not invent `/?quick=load|expense|fuel` unless the app already supports those query params or you fully wire them end-to-end.

Use the existing navigation/action pattern for opening:

- Add Load
- Add Expense
- Add Fuel
- View Reports
- Limited Settings

Every deep link must work in the existing assistant acting context and still rely on RLS/assistant permissions.

3. Work queue access check clarification

For work queue deep links, checking whether the current user has access is not enough. The UI also needs the assistant’s permissions.

Use the existing `useActingContext` / `get_my_managed_drivers` permission source if possible.

If adding a new RPC such as `current_user_has_active_assistant_access(driver_user_id)`, it must return:

- has_access
- permissions
- safe driver display info if needed

Avoid one RPC call per work item if possible. Prefer a batched lookup or existing managed-driver context so the work queue does not become slow for agencies with many work items.

4. Fuel clarification

Keep Add Fuel only if it routes to the existing fuel log workflow.

Fuel logs are intentionally separate from expenses because they support gallons, price per gallon, odometer, MPG, fuel-stop analytics, and IFTA-style reporting.

Do not create duplicate Fuel expense rows from the work queue. Any Add Fuel action must continue relying on the existing fuel log flow and `applyFuelLogPolicy`.

5. Showcase positioning

The public-facing site must clearly show that HaulTracker Pro now serves four audiences:

- Drivers
- Recruiters
- Driver Assistants
- Back-Office Agencies

The assistant/agency opportunity should be visible on the landing page, features page, pricing page, SEO copy, FAQ, and the new `/assistants-agencies` page.

Use strong but accurate language:

- “Start a trucking back-office side hustle.”
- “Offer bookkeeping-style support to drivers.”
- “Create a back-office agency for truckers.”
- “Manage approved driver clients.”
- “Drivers stay in control and approve access.”
- “Payments are handled outside HaulTracker Pro for now.”

Do not say or imply:

- guaranteed income
- guaranteed clients
- public marketplace
- automatic access
- HaulTracker Pro pays assistants
- in-app assistant payments
- no-login request submission

6. Driver Control Center grouping

Fix active/pending/past assistant grouping.

Active assistants must only show `status === 'active'`.

Pending invites must be separate.

Revoked/expired assistants must be separate.

Do not label pending assistants as active.

7. Notification bug

Fix `driver_respond_to_work_item()` so `create_notification()` receives the correct argument shape:

- user_id
- type
- title
- body
- payload

Add tests so this cannot regress.

8. Tests and verification

Add the planned tests, plus tests for:

- no fake assistant auth intent if unsupported
- no fake quick-action query params unless wired
- work queue deep links require both active delegation and correct permissions
- assistant/agency copy does not promise guaranteed income
- “Private Agency Request Links” wording replaces “Public Agency Request Links”

Run and report exact results:

- `bunx tsgo --noEmit`
- `bunx vitest run`
- `bun run build`

Do not mark complete unless every command passes and the product wiring plus public showcase are both correct.