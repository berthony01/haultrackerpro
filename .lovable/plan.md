## Loads Premium Reskin — Plan

Additional Loads page requirements:

1. Preserve operational clarity over visual effects.

The Loads page must prioritize:

- fast scanning

- readability

- quick profitability recognition

- low cognitive load

Do not overuse:

- glow effects

- gradients

- animations

- large decorative UI

2. Profit visibility hierarchy:

Net profit and profit-per-mile should visually stand out more than gross revenue.

The app’s identity is “real profit intelligence,” not gross-load tracking.

3. Route readability:

Pickup → dropoff hierarchy must remain extremely readable on mobile.

Avoid:

- cramped typography

- overly stylized separators

- excessive icon clutter

4. Table performance:

Desktop LoadsTable must remain smooth with large datasets.

Avoid:

- unnecessary nested motion wrappers

- unnecessary row animations

- expensive derived calculations inside render

5. Mobile-first behavior:

Mobile card scanning speed is more important than desktop visual complexity.

Optimize for:

- one-hand usage

- quick thumb scanning

- rapid route/profit recognition

6. Maintain visual restraint:

The dashboard is premium because it is clean and controlled.

Do not turn the Loads page into a “gaming UI.”

Keep the experience professional, operational, and trucking-focused.

&nbsp;

Apply the locked premium dashboard system (`.premium-card`, orange-only accent, mono values, `.text-label`, `useReducedMotion`) verbatim to the Loads experience. Strictly visual — no changes to data, hooks, calculations, parsing, OCR, Telegram import, scoring, or rate logic.

### Scope (files touched, visual-only)

- `src/components/LoadsListView.tsx` — page header, summary KPI strip, filter bar, empty state, pagination styling, responsive desktop table.
- `src/components/LoadCard.tsx` — mobile card surface (premium-card), typography, action chips, route hierarchy, profit emphasis.
- `src/components/LoadDetailSheet.tsx` — sheet styled to match dashboard cards (no new sections, same data).
- `src/components/LoadForm.tsx` — input/spacing/header pass only; field structure, validation, submit flow untouched.
- `src/components/DateRangeFilter.tsx` — visual alignment with dashboard filter row (preset chips + popover).
- New visual-only helpers (no logic): `src/components/loads/LoadStatusBadge.tsx`, `src/components/loads/LoadProfitBadge.tsx`, `src/components/loads/LoadsKpiStrip.tsx`, `src/components/loads/LoadsTable.tsx` (desktop ≥ md table view; mobile keeps card list).

### What stays identical (do not touch)

- `useLoads`, `useLoadStops`, `useExpenses` hooks and queries.
- `loadMetrics.ts`, `computeLoadPay.ts`, `loadUtils.ts`, `parseLoadText.ts`, `profitDefenseAlerts.ts`.
- LoadForm field set, validation, OCR/scan/paste/voice modal triggers, Telegram ingestion path.
- `ProfitCheckCard` integration in LoadForm.
- All Supabase reads/writes, RLS, realtime.
- All routes and props on parent pages (`Index.tsx`).

### Design system applied (from dashboard)

- Surface: `.premium-card` (radius `1rem`, gradient + inset highlight). Replace generic `Card` chrome on Loads surfaces. Inputs/buttons inherit `.app-shell` tokens.
- Typography: page H1 `text-2xl font-bold tracking-tight`, subtitle `text-sm text-muted-foreground`. Money: `font-mono font-black`. Labels: `.text-label`.
- Spacing: `space-y-6` between sections, `gap-3` inside cards, `p-5` card padding (compact `p-4` for table rows).
- Accent: only `text-primary` (orange). Status uses existing semantic tokens (success/warning/destructive) — no new hues.
- Motion: framer-motion entrance with `useReducedMotion` guard; stagger `0.05s`, no new keyframes.

### 1. Loads list (`LoadsListView.tsx`)

- Header block: title + result count + right-aligned primary "Add Load" CTA (`.btn-orange-glow`) on desktop; mobile keeps existing FAB (untouched).
- Sticky filter bar (search + status + pay): premium-card container, `gap-2`, rounded `0.75rem`, focus ring `--ring`.
- Replace inline summary card with `LoadsKpiStrip` — 4 `PremiumKpiCard`-styled tiles (Loads / Revenue / Miles / Avg $/mi). Reuses existing math from `sumExpectedPay`, `sumOperatingMiles`, `fleetEffectiveRPM`.
- Responsive split:
  - `< md`: existing card list (restyled `LoadCard`).
  - `≥ md`: new `LoadsTable` (visual layer over the same `paginatedLoads` array). Columns: Date · Route · Miles · RPM · Estimated · Actual · Δ · Status · Actions. Header uses `.text-label`, rows hover `hsl(220 30% 13%)`, numerics `font-mono` right-aligned. No virtualization needed (50/page).
- Empty state: premium-card dashed border, muted icon chip, copy unchanged.
- Pagination: shadcn pagination restyled with primary active state.

### 2. Load detail sheet (`LoadDetailSheet.tsx`)

- Sheet body wrapped in dashboard rhythm: header (route + status badges), then KPI strip (Estimated / Actual / Δ / RPM), then sections (Stops, Pay timeline, Linked expenses, Notes) each as `.premium-card`. Same data, same edit/delete/duplicate handlers.

### 3. Add/Edit Load form (`LoadForm.tsx`)

- Wrap each field group as `.premium-card` (Route, Miles & Rate, Pay, Dates, Notes). No field added or removed.
- Section headers use `.section-header` pattern.
- Submit/cancel buttons: primary `.btn-orange-glow`, secondary outlined.
- ProfitCheckCard placement preserved.
- All `useState`, validation, parsing, OCR triggers untouched.

### 4. Filters / search / date-range

- `DateRangeFilter` preset chips restyled as ghost pills with active = orange-tinted; popover styled like dashboard cards.
- Status / pay selects: dashboard select styling already inherited from `.app-shell`; only padding + radius normalized (`rounded-xl` → `rounded-lg` to match dashboard). Sentinel values unchanged.

### 5. Mobile load card (`LoadCard.tsx`)

- Surface → `.premium-card`.
- Hierarchy reorder for scan speed:
  1. Top row: date · status · payment · stops badge.
  2. Route block (origin → destination, dot connector).
  3. Profit row (large): Estimated `text-value-lg`, Actual + Δ chip with success/destructive token, RPM mono.
  4. Stats row: miles · DH · $/mi (muted small).
  5. Inline "Add Actual Pay" CTA preserved.
- Tap target unchanged; chevron + "Tap for details" preserved.

### 6. Desktop analytics/table (`LoadsTable.tsx`)

- Same array as cards; renders only at `≥ md` via Tailwind `hidden md:block` / `md:hidden`.
- Sticky header row, dashed grid border (`hsl(220 30% 18%)`), hover row, click → opens existing `LoadDetailSheet`.
- Action cell reuses existing edit/delete handlers.

### Performance

- Memoize filtered array + paginated slice with `useMemo`.
- Memoize `LoadCard` and `LoadsTable` rows with `React.memo`; props are stable refs.
- No new heavy libs. No charts introduced on Loads (kept dashboard-only). If a future trend mini-chart is requested, lazy-load via `React.lazy`.
- `useReducedMotion()` guards every motion.

### A11y

- Table: `<table>` semantics, `scope="col"` headers, row `aria-label` summarizing route + pay.
- Card: button-role wrapper with `aria-label`.
- Status badges include `aria-label` text.

### Post-implementation audit

1. `tsc --noEmit` clean.
2. Production build clean (no new warnings).
3. Manual checks:
  - Add Load (manual + paste + scan + voice) → still works.
  - Edit / delete / duplicate / record actual pay.
  - Filters: status, pay, search, date range.
  - Pagination across 50+ loads.
  - Telegram-imported loads render identically.
  - Mobile (≤ 414px) card scan + scroll smoothness.
  - Desktop (≥ md) table renders, sheet opens, no layout shift.
4. Visual diff vs dashboard: card radius, shadow, border opacity, label/value typography, button glow, spacing rhythm — confirm parity.
5. Console: no new warnings/errors; no Tooltip ref warnings.

### Out of scope (explicit)

- No schema changes, no new endpoints, no new feature flags.
- No changes to Expenses, Fuel, Reports, Settings, Parking — those follow in later passes using the same locked system.
- No new accent colors, gradients, or shadow tokens.  