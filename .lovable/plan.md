# Why the preview is still blank

The codebase itself is healthy:
- TypeScript compiles cleanly (`tsc --noEmit` → 0 errors).
- The Vite dev server is running normally on port 8080 with no errors in the log.
- `src/App.tsx`, `src/main.tsx`, `src/components/ui/sonner.tsx`, and `src/hooks/useAuth.tsx` all look correct. There is no missing provider and no broken import.
- The runtime-error feed and the preview console are **completely empty** — meaning the page renders, but no app JavaScript is running at all.
- The network panel for the preview shows zero requests.

That pattern (HTML loads, zero JS, zero errors, zero network) is the classic fingerprint of a **stale PWA service worker** serving a cached broken bundle and short-circuiting all real requests.

This project has `vite-plugin-pwa` configured in `vite.config.ts` with `registerType: "autoUpdate"` and no dev-mode opt-out. During the last few rounds of debugging, the SW almost certainly cached an earlier broken build. Now every reload of the preview is being answered by that cached SW instead of the live dev server, so none of the recent fixes (sonner, App.tsx, useDriverScorecard, loadMetrics, LoadForm, etc.) are actually being executed in the preview.

# Plan

## 1. Stop the PWA from registering during development
Update `vite.config.ts` so `VitePWA` is only active in production builds. In dev, do not register a service worker at all. This prevents the same problem from happening again on every future change.

Concretely:
- Keep the existing PWA manifest/icons/workbox config for production.
- Add `devOptions: { enabled: false }` (the default, made explicit) and gate `VitePWA(...)` behind `mode === "production"` in the plugin list.

## 2. Actively unregister any service worker that is already installed
Add a tiny inline script in `index.html` (runs before `main.tsx`) that, in development only, calls `navigator.serviceWorker.getRegistrations()` and unregisters every registration, then clears `caches`. This guarantees the next reload of the preview talks to the dev server directly, even for users who already have the bad SW cached.

This is a one-time cleanup that is safe to leave in place — in production builds the dev guard skips it.

## 3. Verify
After the change:
- Hard reload the preview once.
- Confirm the landing page (`/`) renders.
- Confirm `/auth`, `/dashboard` (redirects), and one SEO page load.
- Confirm console is clean and network shows real requests to `/src/...` modules.

## What I will NOT touch
- No changes to `src/App.tsx`, `src/main.tsx`, `src/components/ui/sonner.tsx`, route guards, or any pay-model / loadMetrics code. Those are working — the SW was hiding that fact.
- No changes to PWA behavior in production. Installable PWA continues to work for published builds.

## Files to modify
- `vite.config.ts` — gate `VitePWA` to production only.
- `index.html` — add a small dev-only SW-unregister + cache-clear script.

Approve and I will apply both changes and verify the preview renders.
