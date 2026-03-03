

## Fix: Free Plan Content Flashing During Loading

### Root Cause
Lines 210 and 268 use `!isPro` which is truthy when `isPro` is `null` (loading state). So during loading, both the "Free Plan Includes" list and the "Upgrade to Pro" billing button render, causing the flash you see in screenshot 1.

### Fix (1 file, 2 lines)

**File: `src/components/SettingsView.tsx`**

**Line 210** — Change:
```tsx
{!isPro && (
```
To:
```tsx
{isPro === false && (
```

**Line 268** — Change the else branch condition. Currently the ternary falls through to the Free/Upgrade block when `isPro` is `null`. Wrap it:
```tsx
) : isPro === false ? (
```
instead of the current `) : (`.

This ensures Free Plan content and Upgrade button only render after loading confirms the user is genuinely on Free. During loading (`isPro === null`), neither Free nor Pro content shows — only the "Checking plan..." badge is visible.

### Files Modified
| File | Change |
|------|--------|
| `src/components/SettingsView.tsx` | Line 210: `!isPro` → `isPro === false`; Line 268: `) : (` → `) : isPro === false ? (` with a closing null fallback |

