# Fix: "What's New" modal reappears on every page load

## Root cause

The dismissal is tracked **only in `localStorage`** (`src/hooks/useReleaseNotesSeen.ts`, key `htp:release-seen:<userId>`). This breaks in several real-world scenarios:

- The Lovable preview runs in a cross-site iframe — many browsers (Safari ITP, Brave, Firefox strict, Chrome with third-party storage partitioning) clear or partition `localStorage` between sessions, so the dismissal is lost on reload.
- Different origins (preview URL vs `haultrackerpro.lovable.app` vs custom domain) each have their own `localStorage`, so dismissing on one does not silence it on another.
- Private/Incognito tabs and "Clear on close" settings wipe it.
- Switching devices/browsers re-shows the modal.

Result: the modal pops up on (almost) every load, exactly as the user describes.

## Fix

Move the "last seen release" marker to the user's profile in the database, with `localStorage` kept only as a fast cache to avoid a flash on first paint.

### What changes

1. **Database**
   - Add a nullable `last_seen_release_id text` column to `profiles` (already user-owned with RLS).
   - No backfill needed — `null` simply means "hasn't seen the latest release yet", which matches today's behavior for everyone.

2. **`src/hooks/useReleaseNotesSeen.ts`**
   - On mount (when `user.id` is ready):
     - Hydrate `lastSeenId` from `localStorage` first (instant, prevents flash).
     - Then fetch `profiles.last_seen_release_id` and reconcile (DB wins).
   - `markSeen(releaseId)`:
     - Write `localStorage` immediately (optimistic, snappy UX).
     - `update profiles set last_seen_release_id = releaseId where id = user.id`.
     - On error, keep the localStorage value so the user still doesn't get spammed in the same session.
   - Keep the existing return shape (`ready`, `hasSeenLatest`, `lastSeenId`, `markSeen`) so `src/pages/Index.tsx` does not need changes.

3. **No UI changes.** `WhatsNewModal`, `WhatsNewCard`, and the auto-open effect in `Index.tsx` stay as-is.

### Why this works

- DB persistence survives reloads, new devices, cleared browser storage, and origin changes.
- `localStorage` cache prevents a one-frame flash of the modal while the profile query resolves.
- Existing RLS on `profiles` already restricts each user to their own row — no new policies needed.

## Out of scope

- No changes to release notes content, the dashboard "What's New" card, or the modal layout.
- No retroactive dismissal for users who have already seen it via localStorage — they will see it at most one more time, then it's silenced permanently via the DB.

## Files touched

- `supabase` migration: add `profiles.last_seen_release_id text`.
- `src/hooks/useReleaseNotesSeen.ts`: read/write through Supabase with localStorage cache.
