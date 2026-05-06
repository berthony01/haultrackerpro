## Fix: Radix portals render in light theme inside the app shell

### Bug

`LoadDetailSheet` (and any Radix Sheet/Dialog/Popover/Tooltip) opens with the **light marketing palette** instead of the premium dark theme. Confirmed visually in the live preview — Load Details sheet shows light grey background, dark text, while the `.app-shell` page behind it is dark.

### Root cause

The dark tokens are defined under `.app-shell { ... }` in `src/index.css`. Radix `<Portal>` mounts overlay content as a child of `document.body`, outside the `.app-shell` subtree, so none of those tokens cascade into the portal.

### Fix (small, safe)

1. `**src/index.css**` — extend the selector so the same tokens also apply when the `<body>` carries an activation class:
  ```css
   .app-shell,
   body.app-shell-active { /* identical token block */ }
  ```
   Same change for `.app-shell .premium-card` → `.app-shell .premium-card, body.app-shell-active .premium-card` (and `.btn-orange-glow`, `.sidebar-link`).
2. `**src/pages/Index.tsx**` — add an effect that toggles `app-shell-active` on `document.body` while the authenticated app is mounted, and removes it on unmount:
  ```ts
   useEffect(() => {
     document.body.classList.add('app-shell-active');
     return () => document.body.classList.remove('app-shell-active');
   }, []);
  ```

### Why this is safe

- Marketing/public pages (`/`, `/pricing`, etc.) never mount `Index.tsx`, so they never get the class. No bleed.
- Tokens stay HSL, no new colors, no new shadows.
- Zero changes to LoadDetailSheet, LoadForm, or any logic.

### Verification

- Reopen Loads → tap a load → confirm the sheet now uses the dark premium palette (card surface `#0D1422`, orange accent, mono values).
- Open Add Load and any Dialog/Popover/Tooltip → confirm they also render dark.
- Marketing routes unchanged.

### Files touched

- `src/index.css` (selector extension only)
- `src/pages/Index.tsx` (one `useEffect`).  Approved. Apply the Radix portal theme fix exactly as proposed.
  Requirements:
  - Extend the existing .app-shell token selectors to also support [body.app](http://body.app)-shell-active.
  - Add the body class toggle only inside src/pages/Index.tsx.
  - Remove the class on unmount.
  - Do not modify LoadDetailSheet, LoadForm, Dialog, Sheet, Popover, Tooltip logic.
  - Do not change marketing/public page styles.
  - Do not introduce new colors, gradients, shadows, or tokens.
  After implementation, verify:
  1. LoadDetailSheet opens in the premium dark theme.
  2. Add Load modal/sheet opens in the premium dark theme.
  3. DateRangeFilter popover opens in the premium dark theme.
  4. Tooltips render readable in dark mode.
  5. Marketing/public pages remain unchanged.
  6. Type-check passes.
  7. Production build passes.
  8. No console errors.