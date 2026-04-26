## Assessment
I understand exactly what you mean.

Right now the two users showing as Pro are not a display bug anymore — they are genuinely marked in the backend as `trialing`, and the admin table intentionally treats `trialing` as Pro access.

Current subscription state found:
- 9 users on `free`
- 2 users on `trialing`
- 1 user on `active` Pro

Those 2 users are appearing as Pro because the old 14-day trial system is still live across the platform.

I think your direction is correct if the product strategy is now:
- Free Trucker Starter Kit
- Free Plan
- Pro Upgrade

In that model, the 14-day trial should be removed completely so there is no mixed messaging, no confusing admin counts, and no hidden trial-based access.

## Plan
### Phase 1 — Convert current trial users safely
- Update all existing `trialing` subscriptions to `free` in the canonical subscription table.
- Clear trial-related timestamps for those users so they no longer look like legacy trial accounts.
- Preserve real paid Pro users and admin/manual Pro overrides.
- Do not drop legacy columns in this pass.

### Phase 2 — Stop creating future trial users
- Remove the automatic signup behavior that creates a Pro trial for new users.
- Change new-account creation so users land on the Free plan by default.
- Remove any scheduled or expiry logic that only exists for trials.

### Phase 3 — Remove trial access logic from the app
- Update subscription helpers so only actual paid/admin Pro access counts as Pro.
- Remove `trialing` from Pro access checks.
- Remove trial countdown state and trial-specific UI handling from dashboard/settings flows.
- Ensure feature gating becomes strictly Free vs Pro.

### Phase 4 — Remove trial language from admin, billing, and public pages
- Remove remaining “14-day trial”, “free trial”, and “Pro trial” language from pricing, landing, FAQ, guides, settings, and any upgrade prompts.
- Update admin metrics so Pro counts only reflect real paid/manual Pro users.
- Update billing/admin displays that still rely on legacy subscription fields so they stay consistent with the canonical subscription table.

### Phase 5 — Audit related backend functions
- Remove trial-period creation in checkout.
- Update billing sync/webhook logic so trial statuses are no longer treated as a product path.
- Update recurring-expense and Pro-access backend checks so they no longer grant access based on `trialing`.
- Keep compatibility for historical fields where needed, but stop using them for live logic.

### Phase 6 — Verification
- Verify the former trial users now show as Free everywhere.
- Verify only true paid/admin Pro users appear as Pro in admin.
- Verify Free users do not receive unintended Pro access.
- Verify pricing, landing, FAQ, and settings no longer mention a 14-day trial.
- Run strict build/type checks after the cleanup.

## Technical details
Likely implementation targets:
- Database migration for subscription normalization and signup default behavior
- `src/hooks/useSubscription.ts`
- `src/components/TrialBanner.tsx`
- `src/components/SettingsView.tsx`
- `src/pages/Index.tsx`
- `src/pages/Pricing.tsx`
- `src/pages/Landing.tsx`
- `src/pages/FAQ.tsx`
- `src/pages/HowToUseHaulTrackerPro.tsx`
- `src/pages/TruckingFinanceGuides.tsx`
- `src/pages/Parking.tsx`
- `supabase/functions/admin-api/index.ts`
- `supabase/functions/check-subscription/index.ts`
- `supabase/functions/create-checkout/index.ts`
- `supabase/functions/stripe-webhook/index.ts`
- `supabase/functions/check-pro-access/index.ts`
- `supabase/functions/generate-recurring-expenses/index.ts`

Key rule after cleanup:
```text
Free = default account state
Pro = paid subscription or explicit admin/manual override
Trialing = no longer used for product positioning or access control
```

## Expected outcome
After this cleanup:
- the 2 current trial users will become Free
- new users will start on Free, not trialing
- admin counts will stop inflating Pro totals
- public messaging will align with your actual offer
- the platform will match the new Free + Starter Kit + Pro strategy cleanly