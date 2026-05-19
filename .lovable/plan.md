## Surgical hardening pass — 10 targeted fixes

Scope is locked to the files listed below. No UI styling, theme, routes, pricing copy, landing, recruiter, parking, or contract changes.

---

### Fix 1 — Lock down checkout legacy `priceId`

**File:** `supabase/functions/create-checkout/index.ts`

- Keep `planKey` as the preferred path (unchanged).
- For legacy `body.priceId`: build the allowlist from `STRIPE_PRO_MONTHLY_PRICE_ID` and `STRIPE_PRO_YEARLY_PRICE_ID` only. If `priceId` is not an exact match, return HTTP 400 `{ error: "Invalid price ID" }`.
- Remove the "still allow — backward compat" branch.

### Fix 2 — Unknown Stripe price must not grant Pro

**File:** `supabase/functions/stripe-webhook/index.ts`

- Change `resolvePlanKey` to return `null` for unknown price IDs (instead of fallback `"pro_monthly"`).
- In `checkout.session.completed` and `customer.subscription.created/updated`: if resolved plan is `null` AND no `session.metadata.plan_key`, log a warning and skip the Pro upsert (do not write `plan_key: "pro_monthly"` or set profiles to `pro`). Webhook still returns 200 so Stripe does not retry.
- `customer.subscription.deleted` path is unaffected (already sets `free`).

### Fix 3 — `useLoads` effective-date underfetch

**File:** `src/hooks/useLoads.ts`

- Replace the `load_date`-only server filter with an OR filter that includes `dropoff_date`:
`query.or(\`and(load_date.gte.{from},load_date.lte.{to}),and(dropoff_date.gte.{from},dropoff_date.lte.{to}))`(build the string defensively when only`from`or only`to` is provided).
- Keep the client-side effective-date refinement (drop-off ?? pickup) so the final list matches the contract.
- Note in a code comment that `totalCount` reflects the OR-prefilter, which is a superset of the client-filtered list — this is acceptable for pagination as it never underfetches.

**Acceptance:** load with `load_date=2026-05-28`, `dropoff_date=2026-06-01`, filter 2026-06-01..2026-06-07 → present.

### Fix 4 — Server-side Pro gating in `ai-insight`

**File:** `supabase/functions/ai-insight/index.ts`

- After JWT validation, define:
  - `FREE_TYPES = new Set(['parse_expense', 'parse_ratecon'])`
  - `PRO_TYPES = new Set(['lane_advice', 'weekly_report', 'tax_tips'])`
- If request `type` is in `PRO_TYPES`: query `subscriptions` for `user_id` with `status = 'active'`; if no row, also check `admin_users` for the user as an override. Otherwise return HTTP 403 `{ error: "Pro required" }`.
- Use the service-role client for this lookup (read-only). Do not touch client-side checks.

### Fix 5 — Batch fuel logs

**File:** `src/hooks/useFuelLogs.ts`

- Mirror `useExpenses` pattern: loop `range(offset, offset + FETCH_SIZE - 1)` with `FETCH_SIZE = 1000` and safety cap (e.g. 50 iterations → 50k rows).
- Preserve `dateRange` filters on each page request.
- Return shape stays `{ fuelLogs, isLoading, addFuelLog, updateFuelLog, deleteFuelLog }`.

### Fix 6 — Dashboard Projected Net warning click

**File:** `src/components/DashboardView.tsx`

- On the Projected Net `StatCard`: if `missingMiles === true`, always wire the click/tap to `onNavigate?.('settings')` regardless of whether `projectedNet` has a value.
- If `missingMiles === false`, leave existing onClick behavior untouched.

### Fix 7 — `useProfitCheck` regression coverage

**File:** `src/test/costProfileCPM.test.ts` (extend) and/or new `src/test/profitCheckSource.test.ts`

- Test A: `computeCostProfileCPM` with a fixed-only profile + missing `estimated_monthly_miles` → `warnings` includes `'fixed_missing_monthly_miles'`.
- Test B: If hook test is heavy, extract the small "cost source selection" decision from `useProfitCheck` into a pure helper (e.g. `selectCostSource({ profileCpm, profileWarnings, historyCpm })`) returning `{ source: 'profile' | 'history' | 'none', warnings }`. Update `useProfitCheck` to call that helper (no behavior change). Test that when profile has warnings AND history CPM exists, helper still returns `source: 'profile'` so the warning is not hidden.

### Fix 8 — Defensive ownership filters in `useLoads`

**File:** `src/hooks/useLoads.ts`

- `updateLoad` and `deleteLoad` mutationFns: throw if `!user`; add `.eq('user_id', user.id)` next to `.eq('id', id)` (delete) and to the `update().eq('id', id)` chain.

### Fix 9 — Report cancelled-load clarity

**Files:** `src/lib/reportAggregator.ts`, `src/lib/reportCsv.ts`, `src/lib/reportPdf.ts`

- Aggregator: expose `activeLoads` (loads excluding `status === 'cancelled'`) alongside existing fields. Keep existing cancelled-loads section data source intact.
- CSV + PDF: regular breakdown tables (load list, broker breakdown, lane breakdown, etc.) consume `activeLoads`. Cancelled Loads section remains the only place cancelled loads appear.
- PDF `settlement_dispute` issue filter: explicitly exclude `status === 'cancelled'` from disputed/unpaid issue detection.

(Exact field/function names will be confirmed by reading the three files; no schema or column changes.)

### Fix 10 — Update stale comment

**File:** `src/hooks/useCostProfile.ts`

- Update the docstring on `profileHasUsableData` to state: fixed-only profiles count as usable so the `fixed_missing_monthly_miles` warning can surface downstream instead of silently falling back to history. (The code already does this; only the comment needs refreshing if outdated.)

---

### Verification

- `bunx vitest run` (or `npm test`) — all existing + new tests pass.
- Build/typecheck via harness — clean.
- Manual: confirm a load with mismatched pickup/drop-off shows in date-filtered Loads list; confirm Dashboard Projected Net warning tile navigates to Settings; confirm `ai-insight` returns 403 for free user on `lane_advice`.

### Out of scope (will not touch)

UI redesign, theme tokens, routes, pricing copy, landing pages, recruiter UX, parking, contract UI, DB schema, RLS policies, or any file not listed above.

For the useLoads OR filter, build the condition carefully for three cases:

1. both from and to exist

2. only from exists

3. only to exists

Do not generate invalid Supabase OR syntax when one boundary is missing.

For subscription access, treat the user as Pro only if the subscription row has status = 'active' or status = 'trialing' if trialing exists in this project. Do not count canceled, incomplete, unpaid, expired, or past_due unless the current app already treats them as active elsewhere.

Cancelled loads must never appear in normal revenue, broker, lane, settlement dispute, or unpaid-load breakdowns. They should only appear in the dedicated Cancelled Loads section.