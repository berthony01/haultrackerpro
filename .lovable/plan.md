# Deep audit: why the preview is blank after the GitHub push

## What I confirmed (this is NOT a code problem)

I went all the way down to the dev server itself and verified it is healthy:

- The Vite dev server is running on port 8080 with no errors after its last restart.
- `curl http://localhost:8080/` returns HTTP 200 and a valid `index.html` that references `/src/main.tsx`.
- `curl http://localhost:8080/src/pages/Index.tsx` returns HTTP 200 and 98 KB of correctly transformed JSX. So the lazy chunk that the runtime error blames (`Failed to fetch dynamically imported module: .../src/pages/Index.tsx`) loads perfectly when requested directly from the server.
- TypeScript compiles cleanly. There are no broken imports.
- There are NO hosting-platform files in the repo (no `_redirects`, `netlify.toml`, `vercel.json`, `_headers`, etc.). The GitHub push did not introduce a hosting-config file that broke routing.
- There is NO service worker file on disk in `public/`. None has been generated.

So the local server is fine and serves everything. The error is happening **only inside the user's browser**.

## What is actually wrong

This is a classic **service-worker lockout**. Here is the timeline:

1. Earlier in this project, `vite-plugin-pwa` was registered with `registerType: "autoUpdate"` and no dev opt-out. While the user was using the preview, the browser installed a real service worker scoped to the preview hostname.
2. The GitHub push triggered a sandbox restart and a new build hash. From that moment on, every chunk that the cached SW remembers (`Index.tsx`, `Landing`, etc.) has a different content hash on the server.
3. The cached SW now intercepts every navigation to the preview iframe and serves its old cached `index.html`. That old HTML asks the browser to dynamically import the OLD chunk URLs, which no longer exist on the dev server. The browser raises `TypeError: Failed to fetch dynamically imported module`.
4. Since the served HTML is the OLD one, the unregister script I added in the previous round NEVER runs — the browser never sees the new HTML to begin with. That is why "the preview still doesn't show" even after the fix.

The runtime error you saw confirms this exactly: a dynamic import to a path on the preview origin that no longer matches anything the server has.

The reason it specifically started "after pushing to GitHub" is that the GitHub push triggered the rebuild that invalidated those chunk URLs. Before the push, the cached SW still happened to point at chunks that existed.

## Why my previous fix wasn't enough

My previous round added an unregister script to `index.html`, but I placed it inside `<body>` and gated it behind dev/preview hostnames. Both are fine in principle, but they only run if the browser ever fetches the new `index.html` — and the cached SW is what's preventing that fetch from happening in the first place.

I need a fix that breaks the lockout from the server side, so the next time the cached SW phones home for an update it kills itself.

## Plan — three hardening changes

### 1. Move the SW-killer to the very top of `<head>`
In `index.html`, put the unregister-and-clear-caches script as the FIRST thing in `<head>`, before the manifest link, before GA, before everything. This way, the moment any browser does eventually load fresh HTML, the SW is gone before it can do any further damage. Also broaden the trigger from "dev/preview hosts" to "every host EXCEPT `haultrackerpro.com` and `www.haultrackerpro.com`" — there is no scenario where the preview, lovable.app subdomains, or localhost should ever have a SW installed.

### 2. Ship a self-destroying `public/sw.js`
This is the key fix. Browsers with a cached PWA service worker will, on their own schedule, try to fetch the SW file at its registered scope to check for updates. By placing a tiny `sw.js` in `public/` that, on `activate`, calls `caches.keys() → caches.delete(...)` for every cache, then calls `self.registration.unregister()`, then asks every open client to re-navigate, we guarantee that any browser still locked out will repair itself the moment the SW update check runs. After that, the page reload pulls the new HTML, the inline killer in step 1 belt-and-suspenders the cleanup, and the dev server's modules load normally.

This file is safe to leave in place forever. It does not register itself and does not cache anything.

### 3. Confirm `vite.config.ts` keeps PWA out of dev
Already done in the previous round (`mode === "production" && VitePWA(...)`). I will verify it is still in place after these edits.

## What the user needs to do (one-time)
After I apply the changes, the cached SW in the browser will repair itself on its next update check, but that check only happens once per ~24 hours by default. To unblock you immediately, do ONE of these:
- Open the preview, then DevTools → Application → Service Workers → Unregister, then reload. (Fastest.)
- Or in DevTools → Application → Storage → "Clear site data", then reload.
- Or simply open the preview in an incognito/private window once. That window has no cached SW, will load the new HTML, and will run the killer script.

You only have to do this one time. After today, the new `sw.js` + the inline killer make this category of failure self-healing.

## Files I will modify
- `index.html` — move the SW-unregister script to the top of `<head>`, broaden host gate to "everything except production".
- `public/sw.js` — new file, self-destroying service worker.

## Files I will NOT touch
- `src/App.tsx`, `src/main.tsx`, `src/components/ui/sonner.tsx`, route guards, `loadMetrics`, `LoadForm`, or anything in the pay-model / scoring stack. Those are healthy. They were only invisible because the SW was hiding them.

Approve and I will apply both changes immediately.
