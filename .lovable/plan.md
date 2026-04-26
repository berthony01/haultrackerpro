# Tier 1 — Make the Leaderboard Personal

**Goal:** Add identity, rivalry, and recognition to the existing leaderboard system without redesigning the dashboard, scorecard, or pricing. Four small, additive features.

**Guardrails (non-negotiable):**

- ❌ No public chat, comments, DMs, friends, or following
- ❌ No pricing, Stripe, or edge function changes
- ❌ No dashboard / scorecard / bottom nav redesign
- ❌ No Leaflet map, no smart parking prompts (still deferred)
- ✅ Privacy-safe by default (handle is opt-in)
- ✅ All changes are additive — existing leaderboard, points, verification flows untouched

---

## Feature 1 — Optional Driver Handle

Let users opt in to a public handle that replaces their masked "Driver #1234" on the leaderboard. Default stays masked.

**Database:**

- New migration: add to `profiles`
  - `driver_handle text` (nullable, unique when set, lowercased, 3–20 chars, alphanumeric + underscore)
  - `handle_emoji text` (nullable, single emoji, default null) — e.g. 🚛 🛻 🐺
  - `handle_public boolean not null default false`
- Add a `BEFORE INSERT/UPDATE` trigger validating handle format + reserved-word denylist (admin, support, lovable, system, null, etc.)
- Add a partial unique index: `lower(driver_handle) where handle_public = true`

**RPC update:**

- Modify `get_weekly_driver_leaderboard` to return display name as:
  - `driver_handle` + ``  + `handle_emoji` if `handle_public = true` AND handle is set
  - Otherwise fall back to current `Driver #XXXX` masked name
- Field stays named `masked_display_name` so frontend doesn't need refactor

**UI — `SettingsView.tsx`:**

- New "Public profile" section above existing settings
  - Input: handle (with live availability check via debounced query)
  - Optional emoji picker (small curated list: 🚛 🛻 🚚 🐺 🦅 ⚡ 🔥 👑 — 12 max, tap to select)
  - Toggle: "Show on leaderboard" (default off)
  - Helper text: "When off, you appear as Driver #XXXX. Anyone can see your handle on the weekly leaderboard."
- Validation feedback inline (taken / invalid format / too short)

**UI — leaderboard rows:**

- No structural change. Handles render naturally because RPC returns them in `masked_display_name`.

---

## Feature 2 — Rank Chase Line

A single sentence that creates competitive pull on every dashboard visit.

**Logic (client-side, derived from existing leaderboard query):**

- If user is rank 1: `"👑 You're #1 this week. {gap} pts ahead of #2."`
- If user has someone above them: `"You're {gap} pts behind #{rank-1} ({name}). Keep pushing."`
- If user not on board: `"Log a load or verify parking to get on the board."`
- If only one user (just them): hide the line

**Where it appears:**

- Add a one-line subtitle inside the existing `DriverIntelligenceCard` (under the current "Your weekly rank" line)
- No new card, no new layout — just one extra `<p>` element

**Files:** `src/components/DriverIntelligenceCard.tsx`

---

## Feature 3 — Tier-Up Celebration Moment

Make crossing into Silver / Gold / Platinum *feel* like something.

**Detection logic:**

- New hook `useTierUpDetector` (client-side)
  - Reads current `total_points` from `useDriverPoints`
  - Compares against last-known tier stored in `localStorage` key `htp:lastTier:{user_id}`
  - If new tier > last tier → fire celebration, then update localStorage
  - On first run for a user, just record current tier without firing

**Celebration:**

- Use existing `sonner` toast with custom JSX content:
  - Confetti burst (lightweight — install `canvas-confetti` ~5kb gzip, or build a tiny CSS-only confetti)
  - Title: `"You're now {tier}! 🎉"`
  - Subtitle: `"Top {percent}% of drivers this week"` (percent computed from leaderboard position vs total entrants in RPC; if unavailable, fall back to tier copy)
  - Duration: 6 seconds, dismissable

**Where it triggers:**

- Mount `useTierUpDetector` once in `DashboardView.tsx` (top-level, runs whenever points data changes)
- Fires only once per tier-up (localStorage prevents repeats)

**Privacy / safety:**

- No DB writes — purely client-side detection
- Reset cleanly on logout (localStorage key includes `user_id`)

**Files:**

- New: `src/hooks/useTierUpDetector.ts`
- Edit: `src/components/DashboardView.tsx` (add hook call)
- Optional: `src/components/TierUpToast.tsx` (custom toast content)

---

## Feature 4 — Personal Best Tracking

Self-competition works even when social competition doesn't. Show users their own record alongside current week.

**Database:**

- New migration: add to `driver_points`
  - `best_weekly_points integer not null default 0`
  - `best_weekly_period_start date` (when the record was set)
- Update the existing weekly-rollover function/trigger that resets `weekly_points`:
  - Before reset, if `weekly_points > best_weekly_points`, update `best_weekly_points` + `best_weekly_period_start`
- Backfill: one-time UPDATE setting `best_weekly_points = greatest(weekly_points, 0)` for existing rows

**UI — `DriverIntelligenceCard.tsx`:**

- Add a small line under weekly points:
  - `"Personal best: {best_weekly_points} pts ({date})"`
  - If current week ≥ personal best: highlight in primary color with `"🔥 New personal best!"`
- Compact, single line, no new card

**Files:**

- Migration only — no new components
- Edit: `src/components/DriverIntelligenceCard.tsx` (one extra row)
- Edit: `src/hooks/useDriverPoints.ts` (expose new fields)

---

## Migration Summary (single SQL file)

```sql
-- Profiles: opt-in handle
alter table public.profiles
  add column if not exists driver_handle text,
  add column if not exists handle_emoji text,
  add column if not exists handle_public boolean not null default false;

create unique index if not exists profiles_handle_public_unique
  on public.profiles (lower(driver_handle))
  where handle_public = true and driver_handle is not null;

-- Validation trigger (format, length, denylist)
-- ... CREATE FUNCTION + TRIGGER ...

-- Driver points: personal best
alter table public.driver_points
  add column if not exists best_weekly_points integer not null default 0,
  add column if not exists best_weekly_period_start date;

update public.driver_points
  set best_weekly_points = greatest(weekly_points, 0)
  where best_weekly_points = 0;

-- Update weekly reset function to capture personal best before zeroing weekly_points
-- ... CREATE OR REPLACE FUNCTION ...

-- Update RPC get_weekly_driver_leaderboard to use handle when public
-- ... CREATE OR REPLACE FUNCTION ...
```

---

## File Change Summary

**New files (3):**

- `src/hooks/useTierUpDetector.ts`
- `src/components/TierUpToast.tsx` (optional — could inline in hook)
- One Supabase migration

**Edited files (4):**

- `src/components/SettingsView.tsx` — public profile section
- `src/components/DriverIntelligenceCard.tsx` — chase line + personal best line
- `src/components/DashboardView.tsx` — mount tier-up detector
- `src/hooks/useDriverPoints.ts` — expose `best_weekly_points`, `best_weekly_period_start`

**Untouched (do-not-modify list):**

- `BottomNav.tsx`, `Pricing.tsx`, all Stripe/edge functions
- `DriverScorecard.tsx` layout (the bottom leaderboard section auto-benefits from RPC change)
- `DriverLeaderboardCard.tsx` rows (auto-benefit from RPC change)
- All parking files, expense files, load files
- Existing `award_points` RPC and points-earning flows

---

## Testing Checklist (post-implementation)

**Handle:**

- Free + Pro users can set/clear handle
- Handle defaults to private (Driver #XXXX still shows)
- Duplicate handle (case-insensitive) is rejected
- Reserved words rejected (admin, support, etc.)
- Toggling public → private hides handle on leaderboard immediately
- Emoji renders correctly on iOS, Android, desktop

**Chase line:**

- User at #1 sees "👑 You're #1" with gap to #2
- User at #5 sees gap to #4 with name
- User not on board sees prompt copy
- Single-user case: line hidden

**Tier-up:**

- Crossing Bronze→Silver fires once, not twice
- Logout/login as different user does not fire stale celebration
- No fire on first-ever load (just records baseline)
- Toast dismissable, not blocking

**Personal best:**

- New user: shows 0 / no record gracefully
- Beating record mid-week: "🔥 New personal best" appears
- After weekly reset, best persists
- Backfill correctly set existing users' bests

**Regression:**

- Existing leaderboard top 5 / top 10 still renders
- Free users still blocked from verification
- Load creation still awards +5 once
- Parking report / verify still award correct points
- No new console warnings
- TypeScript clean

---

## What this unlocks (and what it deliberately doesn't)

**Unlocks:**

- Drivers can build identity ("RoadDog_TX 🚛")
- Every dashboard visit has a competitive pull (chase line)
- Tier progression has a memorable moment (celebration)
- Long-tail engagement via self-competition (personal best)

**Deliberately deferred to Tier 2 (next phase, not now):**

- Regional/state leaderboards
- Weekly winner crown badge persistence
- Reactions (🔥 🤝) between drivers
- Streak visibility on others
- Crews / fleet groups
- Achievement badges

If Tier 1 measurably moves engagement (return visits, points-earning actions per user), we ship Tier 2. If not, we revisit assumptions before adding more.  I approve the Tier 1 leaderboard personalization plan with these required adjustments:

1. Public leaderboard handles:

- All authenticated users may set a driver_handle privately.

- Only Pro/trial users may turn handle_public on.

- Free users who try to enable public handle should see ProUpgradeModal.

- Free users still appear as Driver #XXXX on the leaderboard.

2. Personal best tracking:

- Prefer updating best_weekly_points inside award_points() whenever weekly_points exceeds best_weekly_points.

- Do not rely only on weekly reset.

- Preserve weekly reset behavior.

3. Tier-up celebration:

- Use CSS-only or existing UI animation first.

- Do not add a new package unless absolutely necessary.

- Toast must fire only once per tier-up per user.

4. Handle safety:

- Strict format: 3–20 characters, lowercase stored, letters/numbers/underscore only.

- No spaces, emails, phone numbers, slurs, impersonation terms, admin/support/system/lovable/haultracker/haultrackerpro.

- Add admin/owner ability later to clear handles if needed, but do not build full moderation UI now.

5. Scope control:

- Do not build Tier 2 features yet.

- Do not change pricing, Stripe, parking reports, verification, load points, bottom nav, or dashboard layout.

- Keep all changes additive and minimal.

Now create the final implementation plan, then wait for approval before building.