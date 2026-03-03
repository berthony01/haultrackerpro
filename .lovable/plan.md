

## Fix: Free Plan Flash on Settings (Ordering Bug)

### Root Cause
Line 76-78 in the subscription `useEffect`:
```typescript
if (!user) { setIsPro(false); return; }        // ← runs first, sets false
if (isAdminLoading) return;                      // ← too late, damage done
if (isAdmin) { setIsPro(true); return; }
```

When the component mounts, `user` is initially `null` (auth still loading), so line 76 fires and sets `isPro = false`. This renders the "Free Plan" content. By the time `isAdminLoading` resolves and `isAdmin` is confirmed, the flash has already occurred.

### Fix (1 file, lines 76-78)

**File: `src/components/SettingsView.tsx`**

Reorder the guards so `isAdminLoading` is checked first, and `!user` only sets `isPro(false)` when we're sure auth has finished loading:

```typescript
// Line 76-78, replace with:
if (isAdminLoading) return;                      // wait for admin+auth to resolve first
if (isAdmin) { setIsPro(true); return; }         // admin → Pro immediately
if (!user) { setIsPro(false); return; }           // no user after auth loaded → Free
```

This ensures:
- While auth/admin is loading: `isPro` stays `null` → "Checking plan…" badge
- Admin confirmed: `isPro = true` immediately → "Pro Plan"
- Not admin, user present: existing async check runs
- Not admin, no user: `isPro = false` → "Free Plan"

No other changes needed. The `isPro === false` guards at lines 210 and 268 (from the previous fix) remain correct.

