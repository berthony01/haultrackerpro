# Phase F2 — Discoverability Polish (Plan Only)

Surgical visibility improvements for Tier 1 leaderboard personalization. No dashboard, scorecard, leaderboard, pricing, parking, Stripe, or navigation redesign. No new routes.

---

## 1. Fix ref warning in DriverScorecard / DriverLeaderboardCard

### Investigation
- Neither card is wrapped in a `Tooltip`/`asChild` at its consumer site (`DashboardView.tsx:147`, `Index.tsx:526`).
- Internally, both use `Badge` (a plain `div`) and small inner function components (`RankBadge`, `LeaderRow`) — no refs forwarded directly.
- Most likely cause: a parent animation/Tooltip wrapper higher in the tree (e.g., a future wrapper) **or** Radix `Badge` being passed `asChild` indirectly. Need to confirm at runtime which component the React warning names.

### Recommended smallest safe fix
- **Step 1 (diagnostic):** Read the exact warning text from console at runtime to identify which component is missing `forwardRef`.
- **Step 2 (fix):** Apply the minimum fix:
  - If warning names `LeaderRow` / `RankBadge` / `DriverScorecard` / `DriverLeaderboardCard` directly → wrap that exported function in `React.forwardRef<HTMLDivElement, Props>` and spread `ref` onto the root element.
  - If warning is caused by a `Tooltip` ancestor passing a ref through `asChild` → wrap the offending child in a plain `<span>` or `<div>` at the consumer site only.
- No visual or behavioral change.

### Files likely changed
- `src/components/DriverScorecard.tsx` (forwardRef on default export, if needed)
- `src/components/DriverLeaderboardCard.tsx` (forwardRef on `DriverLeaderboardCard` and/or `LeaderRow`, if needed)

---

## 2. "Customize handle" discoverability link

### Behavior
- Append a single-line subtle link **below** `DriverLeaderboardCard`'s help footer (inside the same card, so it doesn't add layout height elsewhere).
- Copy: `Customize your leaderboard handle →`
- Style: `text-[11px] text-primary hover:underline`, button styled as link (no new button variant).
- On click: `navigate('/settings', { state: { focusSection: 'public-profile' } })`.
- In `SettingsView.tsx`, read `location.state.focusSection` in a `useEffect`; if `'public-profile'`, call `scrollIntoView({ behavior: 'smooth', block: 'start' })` on a ref attached to `PublicProfileSection`'s wrapper. Best-effort — silently no-op if ref not yet mounted.
- No new route. No nav change.

### Files likely changed
- `src/components/DriverLeaderboardCard.tsx` (add link, accept optional `onCustomize` prop OR import `useNavigate` directly — prefer direct `useNavigate` to keep API stable)
- `src/components/SettingsView.tsx` (read `location.state`, attach ref, scroll on mount)
- `src/components/PublicProfileSection.tsx` (forward a `ref` prop OR wrap consumer side with a `<div ref={...}>` — prefer the wrapper at the consumer to avoid touching this file)

---

## 3. Next-tier hint in DriverIntelligenceCard

### Behavior
- Compute next tier from existing `tierFor` thresholds in `useDriverPoints.ts`:
  - Bronze (<50) → `Silver at 50 pts — N to go`
  - Silver (50–149) → `Gold at 150 pts — N to go`
  - Gold (150–399) → `Platinum at 400 pts — N to go`
  - Platinum (≥400) → render nothing (graceful hide)
- Place as a single `text-[11px] text-muted-foreground` line directly under the existing tier badge row (above the weekly stats row), so it reads naturally with the tier label.
- Pure derived value from `total_points`. No new data, no new query.

### Files likely changed
- `src/components/DriverIntelligenceCard.tsx`
- (Optional) `src/hooks/useDriverPoints.ts` — export a small `nextTierProgress(total)` helper to keep card clean. Non-breaking.

---

## 4. First-time personal best teaser

### Behavior
- In `DriverIntelligenceCard.tsx`, current code only renders the personal best line when `best > 0`.
- Add an `else` branch: when `best === 0`, render:
  `No personal best yet — log a load or verify parking to start.`
  with the same `text-[11px] text-muted-foreground` styling, in the same slot.
- Once `best > 0`, the existing personal-best / new-best display takes over unchanged.
- Hidden entirely if data is still loading (use existing `points` undefined check) to avoid flash.

### Files likely changed
- `src/components/DriverIntelligenceCard.tsx`

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Scroll-to-section runs before `PublicProfileSection` mounts | Med | Use `requestAnimationFrame` + ref guard; no-op if missing |
| `forwardRef` change breaks existing imports | Low | Keep named export; only wrap function, signature unchanged |
| Next-tier text crowds card on small screens | Low | Single short line, `text-[11px]`, matches existing tip line density |
| Empty-best teaser duplicates onboarding messaging | Low | Copy is distinct + only shown in Driver Intelligence card |
| Settings `location.state` persists on back-nav and re-scrolls | Low | Clear `location.state` after first effect run via `navigate(pathname, { replace: true })` |

---

## Testing checklist

**Ref warning**
- [ ] Open `/dashboard` with console open — no "Function components cannot be given refs" warning.
- [ ] Open `/scorecard` — same check.
- [ ] Visual diff: cards render identically.

**Customize handle link**
- [ ] Link visible under leaderboard footer text.
- [ ] Click navigates to `/settings`.
- [ ] Public Profile section scrolls into view smoothly.
- [ ] Direct `/settings` navigation (no state) does NOT auto-scroll.
- [ ] Back button from settings returns to dashboard cleanly.

**Next-tier hint**
- [ ] Bronze user (0–49 pts) sees `Silver at 50 pts — N to go`.
- [ ] Silver user (50–149) sees Gold target.
- [ ] Gold user (150–399) sees Platinum target.
- [ ] Platinum user (≥400) sees no line (no empty space).
- [ ] Math correct at boundary (e.g., 49 pts → 1 to go; 50 pts → Gold target shown).

**Personal best teaser**
- [ ] New account (best = 0) sees teaser line.
- [ ] After first weekly rollover with points, teaser disappears and personal-best line shows.
- [ ] Loading state shows neither (no flash).

**Regression**
- [ ] DriverIntelligenceCard rank chase line still works.
- [ ] DriverLeaderboardCard rows render identically.
- [ ] Settings view all other sections unchanged.
- [ ] No TypeScript errors.
- [ ] No console warnings.

---

## Out of scope (explicitly NOT touched)
- Dashboard layout, Scorecard layout, Leaderboard layout
- Pricing, Stripe, Parking, Navigation, BottomNav
- New routes
- Tier thresholds or point award logic
- RPC / migrations
