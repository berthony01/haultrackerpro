

## Plan: Feature Overview Page + Downloadable Feature Sheet

### Approach

1. **Create a centralized feature data file** (`src/lib/featureList.ts`) — a single array of all platform features with category, title, and description. This becomes the single source of truth that both the page and the download use. When a new feature is added, only this file needs updating.

2. **Create `/features` page** (`src/pages/Features.tsx`) — a public, unauthenticated page (like Terms/Privacy/FAQ) using the same dark theme as the Landing page. It renders features grouped by category from the centralized data file. Includes a "Download Feature Sheet" button.

3. **Add download logic** — client-side generation of a `.txt` or `.md` file from the same feature data array. No server needed.

4. **Register the route** in `App.tsx` as a public route (`/features`).

5. **Add navigation links** — add "Features" link to the Landing page footer and navbar, and a link in the Settings Support section.

### Implementation Steps

1. **Create `src/lib/featureList.ts`** with categorized feature entries:
   - Load & Expense Management (7 items: CRUD, multi-stop, paste parser, actual vs estimated, etc.)
   - Dashboard & Analytics (5 items: profit overview, smart chips, weekly focus, performance trends, filters)
   - Tax Tools (3 items: set-aside planner, quarterly reminders, calendar export)
   - Reports & Exports (4 items: CSV, PDF, JSON, date range filtering)
   - Settings & Customization (5 items: pay types, week start, currency, company profile, onboarding)
   - Account & Security (3 items: auth, data export, delete account)

2. **Create `src/pages/Features.tsx`** — public page matching Landing dark theme, grouped feature cards, download button at top.

3. **Update `src/App.tsx`** — add `<Route path="/features" element={<Features />} />`.

4. **Update `src/pages/Landing.tsx`** — add "Features" to footer links and optionally to nav.

5. **Update `src/components/SettingsView.tsx`** — add a "View All Features" button in the Support card that navigates to `/features`.

### Technical Details

- The download generates a Markdown file client-side using `Blob` + `URL.createObjectURL`, same pattern as the existing JSON export in Settings.
- No database changes. No new dependencies. No modifications to existing calculations or logic.
- The Features page is fully static — no auth required, no data fetching.

