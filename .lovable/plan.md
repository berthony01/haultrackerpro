# Why your publishes "don't show" — and why Google can't load the app

## What's actually broken (verified, not guessed)

I just fetched your live site three different ways:

- `https://haultrackerpro.com`
- `https://www.haultrackerpro.com`
- `https://haultrackerpro.lovable.app` (the Lovable staging URL)

**All three serve the new HTML and the new build.** Cache is not the problem. The service-worker fix from last round did work — `/sw.js` is the self-destroying one, the manifest loads, headers are `cache-control: no-cache`, and Cloudflare is returning the latest deployment ID.

But every visitor sees only the static "HaulTrackerPro — Track Loads, Expenses & Net Profit" headline + "Get started free" link with no app underneath. That's because the React app is **crashing the instant it boots**. The browser console on `haultrackerpro.com` shows:

```
Uncaught Error: supabaseUrl is required.
  at ZR (/assets/index-qGFqFCoT.js)
```

`src/integrations/supabase/client.ts` reads `import.meta.env.VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` at build time. In your **production** build those two values are empty, so `createClient("", "")` throws, the ErrorBoundary catches it, and React renders the "Something went wrong / Reload App" screen. The static SEO `<div id="root">` fallback is what stays visible to anyone with JS disabled or to Googlebot's first pass.

This explains both symptoms perfectly:

1. **"My publishes don't show in the browser."** They are showing — but the app immediately error-boundaries out, so the page looks identical no matter what you change.
2. **"The app is not loading on Google at all."** Google indexes the static fallback because the React app crashes before mounting any real content (Landing page, schema, internal links, etc.). It's not a robots/sitemap problem — it's "the page has no app on it."

The local `.env` in the workspace has all three values set, which is why it works in the Lovable editor preview but breaks in production: the Lovable production build pipeline isn't injecting the Supabase env vars into the deployed bundle. Likely cause: pushing to GitHub and rebuilding on the production runner without those vars present in that build context.

## The fix (3 small, surgical changes)

### 1. Make the Supabase client fail loudly with a real message instead of silently exploding
File: `src/integrations/supabase/client.ts`. Add an explicit guard that throws a clear, user-visible error and logs the missing var names to the console. This way, if env injection ever fails again, you'll see "Backend not configured" instead of a cryptic minified error, and the ErrorBoundary screen will tell you exactly what's wrong.

### 2. Hard-code the publishable Supabase URL + anon key as a fallback
The Supabase URL and anon (publishable) key are **public** — they're already shipped in every published build of every Supabase app. Per Lovable's own guidance, publishable keys are safe to include in source. We add them as constants used **only** when the env vars come back empty:

```ts
const FALLBACK_URL = "https://pngptztxwbtozwxrtbwo.supabase.co";
const FALLBACK_KEY = "<the existing anon key already in your context>";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || FALLBACK_KEY;
```

This makes the production build resilient: even if the env-var injection on the build runner fails (which is what just happened), the app still boots and connects to the right backend. RLS protects the data — the anon key has no special privileges. This single change unblocks every future publish.

Same pattern applies to `src/pages/Admin.tsx` (lines 199, 203, 213, 218), which also uses `import.meta.env.VITE_SUPABASE_URL` directly — switch it to import the URL constant from the client file so there's one source of truth.

### 3. Trigger a fresh production build with a new bundle hash
Once the file is changed, the next publish produces a new `/assets/index-<NEWHASH>.js` bundle that boots successfully. The self-destroying service worker we shipped last round will clear out any leftover precache on devices that previously visited.

## What I am NOT changing

- No PWA changes — the self-destroying SW from last round is correct, leave it.
- No router/route changes — `BrowserRouter`, the SPA fallback, robots.txt and sitemap.xml are all fine.
- No SEO file edits — the `<noscript>` block, sitemap, GA4, and Search Console placeholder all stay as-is.
- No Cloudflare/DNS work — domain serves correctly with `x-deployment-id` updating per publish, so Lovable hosting is doing its job.

## After the fix — what to verify

1. Click **Update** in the publish dialog.
2. Hard-reload `https://haultrackerpro.com` once. You should land on the full dark-themed Landing page (nav, hero, "Stop Driving Blind. Know Your Real Profit." headline, dashboard mockup, etc.) — not the plain white headline.
3. Open DevTools Console. The `supabaseUrl is required` error should be gone.
4. Open `/auth` and `/pricing` in private windows on phone + desktop — both should now render the real React pages.
5. In Google Search Console, request indexing for `https://haultrackerpro.com/` and `/features`, `/pricing`, `/faq`. Now that Googlebot can execute JS and reach a working app, indexing will start in 1–7 days.

## Technical summary (for the record)

- Files to edit: `src/integrations/supabase/client.ts`, `src/pages/Admin.tsx`.
- No DB migrations, no edge function changes, no dependency changes.
- Tests: re-run `vitest`. The existing 72 tests don't depend on env vars — they should stay green.
- Memory note to add after fix: "Supabase client always falls back to hard-coded publishable URL+anon key so prod builds boot even if env injection fails. Why: lost a launch day to silent crash when GitHub-triggered build shipped empty `VITE_SUPABASE_*`."
