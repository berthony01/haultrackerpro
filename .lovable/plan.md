## Problem

`/assistant` (AssistantDashboard) is the only standalone authenticated page that has no way to navigate back. Every other peer page (`/agency`, `/assistant-control`, `/work-items`, `/delegation-approvals`, `/assistant-settings`, `/parking`, `/updates`, `/install`, `/admin`) already has a Back / Dashboard button.

## Fix

Add a single back control to `src/pages/AssistantDashboard.tsx`, matching the existing pattern used in `AgencyDashboard.tsx` and `DriverAssistantControl.tsx`:

- A `Button variant="ghost" size="sm"` with `ArrowLeft` icon labeled **Back**.
- `onClick={() => navigate(-1)}` so it returns to wherever the user came from (capability launcher, dashboard, notifications, etc.).
- Placed at the very top of the page above the `Assistant operations` header, inside the existing `AppShell` container, so it stays consistent with the dark navy theme.

No other pages need changes — the full audit of standalone authenticated pages confirms AssistantDashboard is the only gap.

## Out of scope

- No changes to routing, layout shell, or other pages.
- No new shared component; the pattern is a 4-line snippet already repeated across sibling pages and not worth abstracting yet.
