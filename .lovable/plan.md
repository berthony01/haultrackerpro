## Phase F1 — Bug Fixes Only (No New Features)

Two surgical fixes. No new features, no UI redesign, no scope creep.

---

### Fix #1 — Save button bug in `PublicProfileSection.tsx`

**Problem:** When a user changes only the emoji or the "Show on leaderboard" toggle (without touching the handle), the Save button stays disabled. Root cause: `canSave` requires `availability === 'ok'`, but for an unchanged handle the availability state can sit at `'idle'` or never re-validate.

**File:** `src/components/PublicProfileSection.tsx`

**Change — `canSave` logic (around line 75):**

Replace:
```ts
const canSave =
  dirty &&
  !updateMut.isPending &&
  (handle.trim() === '' ? !isPublic : availability === 'ok');
```

With:
```ts
const normalizedHandle = handle.trim().toLowerCase();
const handleUnchanged = normalizedHandle === (profile?.driver_handle ?? '');

const canSave =
  dirty &&
  !updateMut.isPending &&
  (
    // Case A: handle empty -> only allowed if not trying to be public
    normalizedHandle === ''
      ? !isPublic
      // Case B: handle unchanged -> no availability check needed
      : handleUnchanged
        ? true
        // Case C: handle changed -> must be available
        : availability === 'ok'
  );
```

**Also tighten the availability effect** so an unchanged handle deterministically resolves to `'ok'` (it already does, but we'll keep that branch explicit — no change needed there).

**Acceptance:**
- Toggling emoji only → Save enables.
- Toggling `handle_public` only → Save enables.
- Changing handle to a taken one → Save stays disabled.
- Clearing handle while `isPublic=true` → Save stays disabled (correct, since trigger forces public off without a handle anyway).

---

### Fix #2 — Replace UUID-based masked driver ID

**Problem:** `get_weekly_driver_leaderboard` currently exposes the last 4 chars of the user's UUID:
```sql
'Driver #' || substr(d.user_id::text, length(d.user_id::text) - 3)
```
This leaks a stable identifier fragment that's globally unique and reversible against any other place a UUID appears.

**Fix:** Replace with a deterministic, non-reversible 4-digit hash bucket.

**Migration (new file):** `supabase/migrations/<timestamp>_fix_masked_driver_id.sql`

```sql
CREATE OR REPLACE FUNCTION public.get_weekly_driver_leaderboard(_limit integer DEFAULT 10)
RETURNS TABLE(
  user_id uuid,
  weekly_points integer,
  total_points integer,
  parking_points integer,
  load_points integer,
  streak_days integer,
  tier text,
  rank integer,
  masked_display_name text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH ranked AS (
    SELECT
      d.user_id,
      d.weekly_points,
      d.total_points,
      d.parking_points,
      d.load_points,
      d.streak_days,
      d.last_activity_date,
      CASE
        WHEN d.total_points >= 400 THEN 'Platinum'
        WHEN d.total_points >= 150 THEN 'Gold'
        WHEN d.total_points >= 50 THEN 'Silver'
        ELSE 'Bronze'
      END AS tier,
      ROW_NUMBER() OVER (
        ORDER BY d.weekly_points DESC,
                 d.total_points DESC,
                 d.last_activity_date ASC NULLS LAST
      )::int AS rank,
      CASE
        WHEN p.handle_public = true AND p.driver_handle IS NOT NULL THEN
          p.driver_handle ||
          CASE WHEN p.handle_emoji IS NOT NULL THEN ' ' || p.handle_emoji ELSE '' END
        ELSE
          'Driver #' || lpad((abs(hashtext(d.user_id::text)) % 10000)::text, 4, '0')
      END AS masked_display_name
    FROM public.driver_points d
    LEFT JOIN public.profiles p ON p.user_id = d.user_id
  )
  SELECT user_id, weekly_points, total_points, parking_points, load_points,
         streak_days, tier, rank, masked_display_name
  FROM ranked
  WHERE weekly_points > 0 OR user_id = auth.uid()
  ORDER BY rank
  LIMIT GREATEST(1, LEAST(_limit, 100));
$$;

GRANT EXECUTE ON FUNCTION public.get_weekly_driver_leaderboard(integer) TO authenticated;
```

**Properties:**
- Deterministic: same user → same `Driver #XXXX` every time.
- Non-reversible: `hashtext` is a one-way hash; the 4-digit bucket discards entropy.
- No UUID fragment is exposed.
- ~0.01% collision probability across small leaderboards — acceptable since handles are the personalization path for users who care about identity.

---

### Verification (post-fix)

1. **Save button:** open Settings → Public Profile, change only the emoji, confirm Save enables and persists.
2. **Save button:** toggle "Show on leaderboard" with unchanged handle, confirm Save enables.
3. **Masked ID:** query the RPC and confirm output matches `^Driver #\d{4}$` for users without public handles, and is stable across calls.
4. **Public handle path:** confirm users with `handle_public=true` still render `handle 🚛` (unchanged behavior).
5. **TypeScript:** no signature changes → no type regen needed; build should pass clean.
6. **Leaderboard UI:** `DriverLeaderboardCard` and `DriverIntelligenceCard` chase line render unchanged (they consume `masked_display_name` as opaque text).

### Files touched
- `src/components/PublicProfileSection.tsx` (≈8-line logic change)
- `supabase/migrations/<new>.sql` (RPC replacement only)

### Out of scope (explicitly NOT doing)
- Reserved-word list expansion (Bug #4 from audit)
- Free vs Pro gating of public handles
- Any UI redesign
- Any change to confetti, tier-up, personal-best logic
