
## Make Pause / Home Time Mode actually findable

You're right — the controls exist but they're buried 3 taps deep inside Expenses → Recurring. A driver about to start home time shouldn't have to dig for this. Here's the surgical fix.

### What's already built (no rework needed)

- ✅ Per-template **Pause** / **Resume** buttons with confirmation modals
- ✅ **Pause All** / **Resume All** bulk buttons in the Recurring Expenses header
- ✅ **Home Time Mode** card with Start / Back on the Road buttons (Pro-gated)
- ✅ Database fields, sync trigger, generation function all correct
- ✅ "Paused since [date]" badges, expired-end-date warnings, RLS scoping

The logic is solid. It's purely a **discoverability** problem.

### The fix — 3 small additions

**1. Add a compact "Home Time Mode" card to the Dashboard**

Place it just below the Quick Action row (Add Load / Expense / Fuel) on `DashboardView.tsx`. Same Pro gating as today.

- **When OFF**: shows a small card — *"Heading home? Pause your recurring expenses while you're off the road."* with a **Start Home Time** button
- **When ON**: shows an amber-tinted card — *"Home Time Active — Recurring expenses paused since Apr 25"* with a **Back on the Road** button
- Card collapses to a single-line summary if user has no recurring templates yet (so it's not noisy for new users)
- Reuses the existing handlers from `RecurringExpensesView` — extracted into a tiny shared hook `useHomeTimeMode()` so both the dashboard card and the recurring expenses page stay in sync without duplicate code

**2. Add the same Home Time toggle to Settings**

In `SettingsView.tsx`, add a row under the existing user-preferences section — same control, just text-list style to match Settings' visual language. This matches what your prompt originally suggested ("Settings page or Dashboard quick action card") — we ship both because some users live in Settings, others on the Dashboard.

**3. Add a small "Recurring" shortcut chip on the Dashboard**

Tiny pill button next to the Quick Actions: **"Recurring (3 active)"** or **"Recurring (2 paused)"** — shows current state at a glance and one-taps into the existing Recurring Expenses page. If user has zero templates, hide it.

### Files touched

- `src/components/DashboardView.tsx` — add Home Time card + Recurring shortcut chip
- `src/components/SettingsView.tsx` — add Home Time row in preferences
- `src/hooks/useHomeTimeMode.ts` (new, ~40 lines) — extract the start/end logic from `RecurringExpensesView` so all three surfaces share one source of truth
- `src/components/RecurringExpensesView.tsx` — refactor to use the new hook (no UI change, no behavior change)

### What I won't touch

- The Recurring Expenses page UI (already correct — keeps everything you have today)
- Database, generation cron, RLS, Pro gating logic (all working)
- Bottom nav (no new tab — Home Time isn't frequent enough to deserve nav real estate)
- Mobile layout patterns (cards reuse existing card primitives)

### Verification after build

1. From `/dashboard` — Home Time card visible, Start button works, all recurring templates pause, card flips to "Active" state ✅
2. From `/settings` — same toggle, same behavior, stays in sync with dashboard ✅
3. From Recurring Expenses page — existing controls still work, status reflects what was set from dashboard ✅
4. Free user — Home Time card shows Pro lock, opens upgrade modal on tap ✅
5. User with no templates — card shows but explains "Add a recurring expense first" instead of doing nothing ✅

That's it. ~1 small new hook, 2 surfaces get the control, no regressions to the work we just shipped.
