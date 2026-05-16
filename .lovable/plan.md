## Problem

In the recruiter sidebar, the three Recruiter Console items share the same base page (`recruiter-access`) but use different ids:

- `recruiter-access` → Recruiter Dashboard (hub)
- `recruiter-access:manager` → Manage Opportunities
- `recruiter-access:applications` → Applications

In `src/pages/Index.tsx` the highlight key is computed as:

```
const navKey = page === 'recruiter-access' ? 'recruiter-access' : ...
```

So no matter which recruiter sub-tab the user clicks, `navKey` is always `recruiter-access`, and only the first item lights up. Contracts and Settings highlight correctly because they are real distinct pages.

Clicking the tabs does navigate (the `recruiterView` state changes — hub / manager / applications), it is purely a visual highlight bug in the sidebar.

## Fix

Derive `navKey` from both `page` and the current `recruiterView` so the sub-tab id matches the sidebar item id.

In `src/pages/Index.tsx`, replace the recruiter branch of the `navKey` computation:

```
page === 'recruiter-access'
  ? (recruiterView === 'manager'
      ? 'recruiter-access:manager'
      : recruiterView === 'applications'
        ? 'recruiter-access:applications'
        : 'recruiter-access')
  : ...
```

`recruiterView === 'onboarding'` (and `'hub'`) both keep `recruiter-access` highlighted as the dashboard entry, which matches today's sidebar (no onboarding item exists).

Also adjust `navLabel` / `navSubtitle` so the header reflects the active sub-tab:

- `recruiter-access:manager` → "Manage Opportunities"
- `recruiter-access:applications` → "Applications"
- `recruiter-access` → existing "Recruiter Access"

## Files

- Edited: `src/pages/Index.tsx` (only the `navKey` / `navLabel` / `navSubtitle` derivation block around lines 515–535)

No other files change. No new components, no routing changes, no behavior changes — purely a presentational fix to the sidebar active state and header label.

## Out of scope

- BottomNav highlight (mobile) — recruiter sub-tabs live in the "More" sheet, not the strip; no change needed.
- Driver sidebar — unaffected; each driver item already maps 1:1 to a `page` value.
- Contracts / Settings — already working.
