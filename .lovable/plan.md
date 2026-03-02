

## Analysis

The `text-foreground` color on the dark `bg-secondary` background still lacks contrast. The app's theme uses amber/orange as its primary accent color (`--primary: 25 95% 53%`). Using `text-primary` will make the value pop with the brand color while ensuring strong contrast against the dark secondary background.

## Plan

**File: `src/components/ProfitOverview.tsx`**

Change the Net $/Mile value color from `text-foreground` to `text-primary` (the amber/orange brand color). This matches how Gross Revenue already uses `text-primary` in the same component, creating visual consistency while ensuring the value is clearly readable.

