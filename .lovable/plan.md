
# In-App "What's New" System

Replace the email-blast idea with an in-app announcement system that notifies active users of the recent updates (trial removal, new pricing, parking, driver points, etc.) without spamming inboxes or risking transactional email reputation.

## Goals
- One clear, friendly explanation that the 14-day trial was retired (so prior users aren't surprised).
- A reusable Release Notes screen for current and future updates.
- A dismissible dashboard card + auto-popup modal on first visit only.
- Zero risk to auth, Stripe, Supabase RLS, or Pro gating.

---

## Phase 1 — Release Notes Data Source

Create a single source of truth for updates.

**New file: `src/lib/releaseNotes.ts`**
- Export `RELEASE_NOTES`: typed array `{ id, version, date, title, summary, highlights[], links?: {label, to}[] }`.
- Export `LATEST_RELEASE_ID` = the newest entry's id (used as the dismiss key).
- Seed first entry (`v1.0-trial-retired`, dated today) covering:
  - "We retired the 14-day Pro preview." Plain-English explanation: everyone now starts on the **Free plan** with the **Free Starter Kit**, and Pro is available anytime via upgrade.
  - Other recent improvements: Parking Finder, Driver Points & Streaks, smarter Pro insights, Weekly Pulse.
  - Links to `/pricing`, `/features`, `/starter-kit`.

Why a typed array? Adding future updates is a one-line change — no new components needed.

---

## Phase 2 — "Seen" Persistence (Per-User, Local)

Avoid a DB migration for a purely UX preference. Use `localStorage` keyed by user id.

**New file: `src/hooks/useReleaseNotesSeen.ts`**
- Key: `htp:release-seen:<user_id>` → stores latest seen release id.
- Returns `{ hasSeenLatest, markSeen, lastSeenId }`.
- Falls back gracefully if `user` is null (no popup shown until auth resolved).

Rationale: a single dismiss flag per device/user is sufficient for an announcement card. No schema change, no RLS surface area, no risk to subscriptions table.

---

## Phase 3 — Reusable UI Components

**New file: `src/components/WhatsNewModal.tsx`**
- Built on existing `Dialog` (`src/components/ui/dialog.tsx`).
- Renders the latest release entry: title, friendly summary about the trial change, bullet highlights, and CTA buttons that route to `/pricing`, `/features`, `/settings` (no behavior changes — just `navigate()` calls).
- "Got it" button calls `markSeen(LATEST_RELEASE_ID)` and closes.
- Accessible: `DialogTitle`, `DialogDescription`, focus-trapped by Radix.

**New file: `src/components/WhatsNewCard.tsx`**
- Compact dashboard card (matches existing dark-navy + amber theme; uses `Card` primitives).
- Headline: "What's new in HaulTrackerPro" + 1-line summary + "See updates" button (opens modal) + small "×" dismiss (calls `markSeen`).
- Pure presentational; takes `onOpen` and `onDismiss` props.

**New file: `src/pages/Updates.tsx`**
- Public-feeling, auth-protected page rendering the **full** `RELEASE_NOTES` list (newest first) — current + any future entries.
- Uses `SEOHead` for title, `BottomNav`, and standard layout (mirror `Parking.tsx` shell for consistency).
- Each entry: date pill, title, summary, highlight list, optional links.

---

## Phase 4 — Wiring (Surgical)

**`src/App.tsx`**
- Add one route: `<Route path="/updates" element={<ProtectedRoute><Updates /></ProtectedRoute>} />`. No other routing changes.

**`src/pages/Index.tsx`** (dashboard host)
- Import `useReleaseNotesSeen`, `WhatsNewModal`, `WhatsNewCard`.
- On mount, if `!hasSeenLatest && !loading && user`, open the modal once. Modal close = `markSeen`.
- Pass `WhatsNewCard` into `DashboardView` via a new optional prop `whatsNewSlot?: ReactNode` (rendered at top of dashboard above existing cards). Card hides itself once dismissed.

**`src/components/SettingsView.tsx`**
- Add a single row link: **"What's New"** → navigates to `/updates`. Sits in the existing settings list near "Help / FAQ". No styling overhaul.

No changes to: `useSubscription`, `useAuth`, `check-pro-access`, Stripe functions, RLS policies, billing plans, or any Pro-gating logic.

---

## Phase 5 — Guard Test Compatibility

The existing `noTrialLanguage.test.ts` will scan the new files. The release notes copy must explain the change **without** triggering the regex (no "free trial", "14-day", "trialing", etc.).

Approved phrasing (verified clean against all 8 patterns):
> "We've simplified our plans. Every account now starts on the **Free plan**, and you can upgrade to **Pro** whenever you're ready. The previous Pro preview window has been retired — your data and account are unchanged."

If a phrase ever needs a forbidden token (e.g., quoting a legacy term), append `// trial-allowlist` per the test's existing escape hatch.

---

## Phase 6 — Verification

1. `bunx tsc --noEmit` — zero errors.
2. `bunx vitest run` — all tests pass, **including** `noTrialLanguage.test.ts`.
3. Manual flows:
   - New login → modal appears once → dismiss → reload → modal does not reappear, card hidden.
   - `/updates` accessible, lists release; unauthenticated users redirected by `ProtectedRoute`.
   - Settings → "What's New" → navigates to `/updates`.
4. Mobile viewports 375px and 715px — modal and card render without overflow.

---

## Out of Scope (Per User's Constraints)
- ❌ No emails sent.
- ❌ No admin UI for trial users.
- ❌ No DB migrations.
- ❌ No changes to Pro gating, Stripe, or auth.
- ❌ No reintroduction of trial logic or copy.

---

## Files Summary
**New (5):** `src/lib/releaseNotes.ts`, `src/hooks/useReleaseNotesSeen.ts`, `src/components/WhatsNewModal.tsx`, `src/components/WhatsNewCard.tsx`, `src/pages/Updates.tsx`
**Edited (3):** `src/App.tsx` (1 route), `src/pages/Index.tsx` (modal + card slot wiring), `src/components/SettingsView.tsx` (one nav link)

Low blast radius, fully reversible, and reusable for every future release.
