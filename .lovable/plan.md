# /parking Page Polish & Pagination Plan

## What's wrong today (verified in code + console)

1. **Looks flat / generic** — `Parking.tsx` is just a small heading + filter row + stacked card list. No hero, no stats, no visual hierarchy. With 30 seeded truck stops all showing identical "Low confidence" + "No recent reports", the page is one long monotone scroll.
2. **Long scroll, no pagination** — `ParkingFinder.tsx` slices `.slice(0, 100)` with no paging. User asked for ~20–50 per page.
3. **Button issues**:
   - The 9 filter chips wrap into 2–3 ragged rows on desktop and look like loose pills.
   - "Near me" button has inconsistent icon-only/text-with-icon behavior.
   - Bottom "Add a parking spot" button is plain and the inline `<Lock />` + `<span>` kerning is off.
   - Ghost back button uses `-ml-2` and looks unfinished next to the heading.
4. **React `forwardRef` warning still in console** (verified in console logs lines 3–46). Source: `ParkingFinder` renders `<AddParkingModal />` and `<ProUpgradeModal />` as siblings, and one of their internal trees (likely a `<Button>` wrapping a `lucide-react` icon as the only child, or a `Switch`/Dialog child) is being passed a ref by Radix. The fix: ensure `AddParkingModal` and `ProUpgradeModal` are not the components being warned about — wrap their root in `forwardRef` if needed, OR (more likely the real cause) wrap any plain function-component icon children inside Radix `Dialog`/`Sheet` triggers properly. I'll inspect Switch + Select usages in `AddParkingModal` and convert any custom plain components.
5. **Pre-existing**: `ParkingDetailSheet`, `ParkingFinder`, `AddParkingModal` all use `Badge`, `Button`, etc. — those are fine since we already converted Badge to `forwardRef`. Will verify no other custom function components are receiving refs.

## Scope (surgical, no redesign of routes or business logic)

### A. Visual polish — `src/pages/Parking.tsx`
- Add a compact **hero header** styled to match the existing dashboard cards (dark navy, amber accent):
  - Icon + "Parking Finder" title + tagline
  - Three small stat tiles in a row (mobile: scrolls horizontally, desktop: 3 cols):
    - **Locations** (total count from `useParkingLocations`)
    - **Reports today** (count from `useRecentParkingReports`)
    - **Your points** (from `useDriverPoints`, Pro/trial only — show "—" otherwise)
- Remove the loose ghost back button; replace with a tighter pill-style back chip.
- Subtle gradient or `bg-card/40` band behind the header to add depth (consistent with `DashboardView`).

### B. Filter row polish — `src/components/parking/ParkingFinder.tsx`
- Group chips into **labeled segments** so they don't look like a random pile:
  - Segment 1: `Cost` → All / Free / Paid (segmented control style)
  - Segment 2: Toggles → Overnight, Truck-friendly
  - Segment 3: `Confidence` → Any / High / Medium / Low (segmented)
- Add a single "Reset filters" link when any filter is active.
- Search input gets a slightly taller (`h-10`) treatment + leading icon + clear (×) button when text is present.
- "Near me" button: always show icon + label on `sm:` and up; icon-only on mobile (current behavior — keep but tidy).

### C. Pagination — `src/components/parking/ParkingFinder.tsx`
- Add `pageSize = 24` and `page` state.
- Reset `page` to 1 whenever search/filters/`geo.coords` change (use `useEffect`, per project React patterns memory).
- Render `filtered.slice((page-1)*pageSize, page*pageSize)`.
- Footer pager using existing `src/components/ui/pagination.tsx`:
  - Prev / 1 … current ± 1 … last / Next, with ellipses
  - Mobile: simplified "Page X of Y" + Prev/Next only (sm:hidden)
- Result count line: "Showing 1–24 of 137 spots".

### D. Card polish — `src/components/parking/ParkingCard.tsx`
- Bump padding to `p-4`, add subtle left border whose color matches confidence (`border-l-2 border-l-success/40` etc.) so the long list has visual rhythm even when most cards say "Low".
- Tighten the meta row spacing; promote distance to a small badge on the right side instead of inline.
- Show a discreet "📍 Verified just now" pulse-dot only when `level === 'high'`.
- No layout/route changes.

### E. Bottom CTA — `src/components/parking/ParkingFinder.tsx`
- Replace plain full-width outline button with a **two-tone CTA card**: short copy on the left ("Spotted parking we don't have yet?"), button on the right.
- Free users see a `Lock` icon + "(Pro)" tag and clicking opens `ProUpgradeModal` (already wired).

### F. React `forwardRef` warning fix
- Inspect `AddParkingModal` for any custom plain function components receiving refs. Most likely culprits:
  - The `<Button onClick={useMyLocation}>` is fine (Button is forwardRef).
  - `Switch` and `Select` items are Radix → already forwardRef.
  - Suspect: `ProUpgradeModal` itself may be rendered inside a Radix portal that wants a ref when it's an immediate child. Wrap `ProUpgradeModal` and `AddParkingModal` exports in `React.forwardRef<HTMLDivElement, Props>((props, _ref) => ...)` so Radix's invisible ref-passing stops warning.
- After fix, verify console is clean on `/parking`.

### G. Empty/loading states
- Loading: replace the single "Loading parking…" line with 4 skeleton cards (using existing `Skeleton`).
- Empty (filters return 0): keep current message but add a **"Clear filters"** action in addition to "Add a location".

## Files to touch
- `src/pages/Parking.tsx` — hero + stats header, tighter back nav
- `src/components/parking/ParkingFinder.tsx` — pagination, segmented filters, polished CTA, skeleton loading, page-reset effect
- `src/components/parking/ParkingCard.tsx` — visual rhythm (left-border by confidence, distance badge, padding)
- `src/components/parking/AddParkingModal.tsx` — wrap export in `forwardRef` to silence warning
- `src/components/ProUpgradeModal.tsx` — wrap export in `forwardRef` to silence warning (one-line change, no behavior change)
- (Reuse existing) `src/components/ui/pagination.tsx`, `src/components/ui/skeleton.tsx`, `src/hooks/useDriverPoints.ts`, `src/hooks/useParkingLocations.ts`

## Explicitly NOT in scope
- ❌ Leaflet map view (deferred Phase C)
- ❌ Leaderboard
- ❌ Smart prompts / auto-detect parking
- ❌ Load Parking Outlook
- ❌ Favorites UI
- ❌ Pricing/tier changes
- ❌ Renaming `/parking` route
- ❌ Touching dashboard, loads, expenses, scorecard, recurring expenses
- ❌ Edge functions

## Verification after implementation
1. `/parking` renders without console warnings (free + Pro).
2. Hero shows correct counts for locations, today's reports, your points.
3. Pagination: 24/page, controls work, filters reset to page 1.
4. Filters still produce identical results to today's logic.
5. Confidence badge color matches new left-border color.
6. Bottom CTA: free user → ProUpgradeModal; Pro/trial → AddParkingModal.
7. Mobile (375px) layout: hero stats wrap cleanly, filters stack, pagination collapses to "Page X of Y + Prev/Next".
8. No regressions to dashboard, loads, expenses, scorecard.
