## Problem

On desktop, the Save / Refer / Request Info action bar at the bottom of the Opportunity Detail page scrolls away with the page instead of staying pinned to the bottom of the viewport.

The element currently uses `fixed lg:sticky ... lg:bottom-4`. `position: sticky` only pins to the viewport when its nearest scrolling ancestor is the viewport AND the sticky element is a direct child of a tall flow container. In this layout the action bar is the last child of a `space-y-5` wrapper inside `<main>`, so once that wrapper scrolls past, the sticky element scrolls with it — exactly what the user is seeing.

## Fix

Keep mobile behavior identical (fixed above BottomNav). On desktop, switch from `lg:sticky` to `lg:fixed` pinned to the bottom of the viewport, constrained to the main content column so it doesn't overlap the sidebar.

### Change in `src/components/opportunities/OpportunityDetail.tsx`

Update the action-bar wrapper (around line 264) so that on `lg` and up:
- Use `lg:fixed` with `lg:bottom-4`
- Position it within the main content area (account for the 240px sidebar: `lg:left-[calc(15rem+1.5rem)] lg:right-6`)
- Remove `lg:sticky` and the `lg:left-auto lg:right-auto` resets
- Keep z-index and safe-area handling intact

Also keep the existing mobile spacer (`h-32 lg:hidden`) and add a matching desktop spacer (`hidden lg:block lg:h-28`) so the last content card isn't hidden behind the now-pinned bar.

No other files, no business logic, no styling redesign — only the positioning classes on that one wrapper and the spacer.

## Verification

- Desktop ≥1024px: scroll the opportunity detail page; the action bar stays pinned at the bottom of the viewport, aligned with the main content column, not overlapping the sidebar.
- Mobile <1024px: unchanged — bar sits above the BottomNav with safe-area inset.
- No content is hidden behind the bar at the end of the page in either mode.
