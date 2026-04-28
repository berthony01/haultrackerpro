## Launch-Stabilization Plan: Restore Preview Reliability

### Problem confirmed
The preview is not failing because the app is crashing.
It is loading a non-existent route: `/index`.

Evidence from the audit:
- The dev server is healthy and serving the app normally.
- The app loads correctly at `/`.
- The blank/failed preview screenshot is actually the app’s own 404 page for `/index`.
- There are no remaining code references that navigate to `/index`.
- A separate preview-only warning exists because `manifest.webmanifest` returns `401`, but that is not the main cause of the missing preview.

### Most likely cause
A legacy/remembered preview path (`/index`) is being reopened after the GitHub sync, while the app now only defines `/` and `/dashboard`.
So the preview appears “broken,” but the real issue is route mismatch.

## Implementation

### 1) Add a safe legacy route alias
Add explicit route support for:
- `/index`
- `/index.html`

Both should redirect to `/`.
That keeps behavior minimal and safe:
- signed-out users land on the public landing page
- signed-in users still get redirected from `/` to `/dashboard` by existing logic
- no UI redesign and no business logic changes

### 2) Remove preview-only manifest noise
Harden the HTML head so the web app manifest is not requested in preview/dev contexts where it currently returns `401`.

This is not the main blocker, but it matters because:
- it creates misleading console noise during debugging
- it makes preview behavior look more broken than it is
- it is unnecessary in the editor preview

### 3) Keep the service-worker cleanup, but stop treating it as the primary fix
The current service-worker cleanup can remain if it is harmless, but the real functional fix is route normalization for `/index`.
No further PWA redesign unless the code audit shows one more concrete issue.

## Validation
After implementation, verify:
- `/` loads the landing page in preview
- `/index` redirects cleanly instead of showing 404
- `/index.html` redirects cleanly
- authenticated flow still lands on `/dashboard`
- unauthenticated protected routes still redirect correctly
- no regression to dashboard, auth, reports, parser, scanner, or existing navigation
- preview console no longer shows the manifest `401` warning

## Technical details

Planned code changes:
- `src/App.tsx`
  - add redirect routes for `/index` and `/index.html`
- `index.html`
  - conditionally omit or guard the manifest link in preview/dev hosts
  - keep head logic minimal and preview-safe

Expected result:
```text
Preview opens /index
   -> app redirects to /
   -> existing auth routing decides destination
      signed out -> landing page
      signed in  -> /dashboard
```

## Why this is the safest fix
- It matches the observed failure exactly.
- It avoids broad refactors.
- It does not change working load, dashboard, report, parser, or scanner logic.
- It protects both preview and any old deep links that may still point to `/index`.

Once approved, I’ll implement this surgically and then report back with:
- root cause confirmed
- exact files changed
- validation results
- remaining risks, if any