

## Full Audit: Issues Found and Fixes

### Issue 1: Index.tsx `isPro` — Same Bug as SettingsView (Critical)

**Problem**: `src/pages/Index.tsx` lines 54-72 has the same vulnerability that was fixed in SettingsView. The edge function `check-subscription` returns `{subscribed: false}` when the auth header is missing (race condition), which overwrites a valid profile-based Pro status. Admin users also get no special handling here.

**Fix**: Apply the same pattern used in SettingsView:
- Import and use `useAdmin`
- Check admin status first (admin = Pro immediately)
- Read profile first for instant Pro detection
- Only let edge function *upgrade* to Pro, never downgrade a profile-confirmed Pro

**File**: `src/pages/Index.tsx` (lines 54-72)

---

### Issue 2: Landing Page Missing Features Link in Nav

**Problem**: `src/pages/Landing.tsx` nav bar (line 46) has Pricing and Sign In but no Features link, even though `/features` exists and is linked in the footer.

**Fix**: Add a "Features" nav button alongside Pricing.

**File**: `src/pages/Landing.tsx` (line 46)

---

### Issue 3: FAQ Page — Missing Pro-Related Questions

**Problem**: The FAQ page (`src/pages/FAQ.tsx`) doesn't cover common questions about Pro subscriptions, free trials, or how upgrades work, which are important for user conversion and support.

**Fix**: Add FAQ entries for:
- "What's included in the free trial?"
- "How do I upgrade to Pro?"
- "Can I cancel my subscription?"

**File**: `src/pages/FAQ.tsx`

---

### Issue 4: Pricing Page — "Start Free Trial" Opens in New Tab

**Problem**: `src/pages/Pricing.tsx` line 81 uses `window.open(data.url, '_blank')` for checkout, which can be blocked by popup blockers and is inconsistent with the SettingsView billing portal which uses `window.location.href`.

**Fix**: Change to `window.location.href = data.url` for consistent behavior.

**File**: `src/pages/Pricing.tsx` (line 81)

---

### No Other Breaking Issues Found

- **`completedLoads` reference**: Fully removed — no remaining references in codebase
- **Feature pages**: Landing, Features, and Pricing feature lists are consistent with each other and with the actual feature set in `featureList.ts`
- **Edge function `check-subscription`**: Already handles manual Pro overrides (profile check) and trialing status correctly on the backend side
- **Database schema**: Load default status is `'completed'`, which aligns with the dashboard "Total Loads" fix
- **Routing**: All routes exist and are properly guarded (auth, admin, public)
- **RLS policies**: All tables have appropriate policies
- **Pro gating in components**: All Pro-gated components (PerformanceCharts, WeeklyCloseout, DriverScorecard, TaxPlannerSettings) receive `isPro` prop correctly from Index.tsx — but they depend on Issue 1 being fixed

### Summary of Changes

| File | Change | Priority |
|------|--------|----------|
| `src/pages/Index.tsx` | Fix `isPro` logic (admin + profile-first + no downgrade) | Critical |
| `src/pages/Landing.tsx` | Add Features link to nav | Low |
| `src/pages/FAQ.tsx` | Add Pro/subscription FAQ entries | Low |
| `src/pages/Pricing.tsx` | Fix checkout redirect (same-tab) | Medium |

