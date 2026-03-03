

## Fix: Edge function overrides profile-based Pro status

### Root Cause

The edge function logs show every `check-subscription` call fails with **"Auth session missing!"** — meaning the Supabase session token isn't ready when the function is invoked. The edge function returns `{subscribed: false}` with HTTP 200 (not an error), so line 91 **overwrites** the correct profile-based `isPro = true` with `false`.

Flow:
1. Line 83-86: Profile query finds `subscription_status = 'pro'` → `setIsPro(true)` ✓
2. Line 90-91: Edge function fails auth silently, returns `{subscribed: false}` → `setIsPro(false)` ✗

This affects both admin users (if `isAdmin` resolves late) and regular Pro subscribers.

### Fix (1 file, lines 88-94)

**File: `src/components/SettingsView.tsx`**

Change the edge function logic to **never downgrade** a profile-confirmed Pro status. Only use the edge function result to *upgrade* from free to pro:

```typescript
// Then confirm via edge function
try {
  const { data } = await supabase.functions.invoke('check-subscription');
  if (!cancelled) {
    // Only update if edge function gives a definitive answer
    // Never downgrade a profile-confirmed Pro (edge fn may lack auth token)
    if (data?.subscribed === true) {
      setIsPro(true);
    } else if (!profileIsPro) {
      setIsPro(false);
    }
    // If profileIsPro=true but edge says false, keep profile value (trust DB)
  }
} catch {
  // keep profile value
}
```

This ensures:
- If the profile says Pro, the edge function can't override it to Free (handles auth-missing edge case)
- If the profile says Free but the edge function confirms a subscription, it upgrades to Pro
- If both agree on Free, it stays Free

### Files Modified
| File | Change |
|------|--------|
| `src/components/SettingsView.tsx` | Lines 88-94: Edge function result no longer overrides profile-confirmed Pro |

