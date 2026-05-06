## Root cause

The cream-colored "HaulTrackerPro — Track Loads, Expenses & Net Profit / Get started free / Explore: Features · Pricing · FAQ…" page that flashes on reload is **not** the React Landing page. It's the static SEO fallback HTML hard-coded inside `<div id="root">` in `index.html` (lines 76–86):

```html
<div id="root">
  <div style="max-width:780px;margin:0 auto;padding:48px 20px;font-family:-apple-system,...;color:#0f172a">
    <h1>HaulTrackerPro — Track Loads, Expenses & Net Profit</h1>
    <p>Professional load, expense, and profit tracking…</p>
    <p><a href="/auth" style="background:#f97316;...">Get started free</a></p>
    <p>Explore: <a href="/features">Features</a> · <a href="/pricing">Pricing</a> · …</p>
  </div>
</div>
```

This block is what the browser paints **before** the JS bundle loads and React hydrates. On a logged-in reload, the sequence is:

1. Browser paints `index.html` → user sees the cream "Get started free" page.
2. React bundle loads, mounts `<App>` → `AuthProvider` is `loading: true` → `ProtectedRoute` shows `<PageFallback />` ("Loading…").
3. `getSession()` resolves → `loading=false` → user lands on `/dashboard`.

The screenshot the user shared matches step 1 exactly (matches the inline styles: cream bg, orange button, underlined links). It has nothing to do with auth state — it's a paint flash that happens to every visitor on every cold load, just more noticeable on reload because the cached dashboard URL means you "expect" to land on the dashboard.

The previous `lazyWithRetry` work in `App.tsx` only addressed chunk-load failures; it doesn't help here because the flash happens *before* React even runs.

## Fix

Replace the SEO fallback markup in `index.html` with a neutral, dark, branded splash that matches the app shell (`#070B14`) and shows a subtle loader. The SEO content stays available to non-JS crawlers via the existing `<noscript>` block (lines 87–103), which already contains H1, description, and internal links — so we lose no SEO value. (Googlebot runs JS and gets the real React-rendered Landing/Dashboard, so the in-`#root` fallback was never doing meaningful SEO work that `<noscript>` doesn't already cover.)

### Change in `index.html` (lines 76–86)

- Keep `<div id="root">` but replace its inner fallback HTML with a centered, dark splash:
  - Background `#070B14` (matches `app-shell` and dashboard).
  - Small "HaulTrackerPro" wordmark + a thin spinner.
  - Inline styles only (no CSS file dependency, since this paints before any CSS loads).
  - Full viewport height so there's no white edge.
- Leave the `<noscript>` block untouched so crawlers without JS still see H1 + links.

### Result

- Cold reload on `/dashboard` → user sees a dark branded splash (visually consistent with the dashboard) → React mounts → dashboard appears. No more cream "Get started free" flash.
- Cold load on `/` → same dark splash → React mounts → Landing page renders.
- Crawlers without JS → still see full H1, description, and link list inside `<noscript>`.
- No changes to React, routing, auth, Supabase, Stripe, or any component logic.

## Files touched

- `index.html` — replace lines 76–86 (the in-`#root` fallback) with a dark splash. ~15 lines changed, single file.

## Out of scope

- The unrelated console warnings about `forwardRef` on `PageFallback` and `ProfitIntelDemo` — cosmetic, not the cause of this flash. Can be addressed separately if you want.