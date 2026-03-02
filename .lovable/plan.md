

## Plan: Bottom Navigation Redesign (2 + FAB + 2)

### Changes Required

**1. `src/components/BottomNav.tsx`** — Refactor nav items from 6 (with Reports) to 5 (4 tabs + center FAB):
- Left: Dashboard, Loads
- Center: Add (FAB)
- Right: Expenses, Settings
- Remove Reports tab entirely
- Add `aria-label` attributes to all buttons
- Keep existing FAB styling (elevated, orange, pulse-glow)
- Ensure consistent `min-w-[64px]` touch targets and no label wrapping

**2. `src/components/DashboardView.tsx`** — Add a "View Reports" button/card:
- Insert a "View Reports" button alongside the existing "Finalize Weekly Summary" and "View Driver Scorecard" buttons (same styling pattern)
- Uses `FileText` icon, calls `onNavigate('reports')`

**3. `src/pages/Index.tsx`** — No routing changes needed. The `page` state and `handleNavigate` already support all routes. The `BottomNav` active state is driven by the `page` string, which remains unchanged. Reports navigation will now come from Dashboard instead of BottomNav.

### Technical Details

**BottomNav tab array change:**
```
Before: [Dashboard, Loads, Add, Expenses, Reports, Settings] (6 items → 2+FAB+3)
After:  [Dashboard, Loads, Add, Expenses, Settings] (5 items → 2+FAB+2)
```

**Dashboard Reports button** — inserted between the existing "Finalize Weekly Summary" and "View Driver Scorecard" buttons using the same `variant="outline"` full-width button pattern already in use.

**No changes to:** routing, state management, permissions, theme colors, AddActionModal, or any other components.

