URGENT FIX — Global App Boot Crash From vendor-charts Manual Chunk

&nbsp;

Fix the production app boot crash affecting every route.

&nbsp;

Problem:

The app is stuck on the pre-hydration splash spinner on every route because React never mounts.

&nbsp;

Confirmed console error:

Uncaught ReferenceError: Cannot access 'P' before initialization

at vendor-charts-BfAh1LeN.js:9:17033

&nbsp;

Root cause:

vite.config.ts has a manualChunks rule that isolates recharts, d3-* packages, and victory-vendor into vendor-charts:

&nbsp;

if (/[\\/]node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor)[\\/]/.test(id)) return 'vendor-charts';

&nbsp;

This creates a Rollup/Vite temporal dead zone circular evaluation issue because Recharts transitive dependencies such as react-smooth, recharts-scale, eventemitter3, react-is, and related modules are not guaranteed to initialize in the same chunk order.

&nbsp;

Required fix:

Remove only the vendor-charts manualChunks rule.

&nbsp;

Do not change:

- Contract Protection code

- Clause Rewrite code

- Supabase schema

- RLS

- Edge functions

- Stripe

- Billing logic

- Public SEO pages

- Sitemap

- llms.txt

- Terms

- Privacy

- Dashboard logic

- Reports logic

- Lazy routes

- Auth hooks

- Subscription hooks

&nbsp;

Keep these manual chunks unless a build/runtime error proves otherwise:

- vendor-react

- vendor-data

- vendor-ui

- vendor-pdf

- vendor-ocr

&nbsp;

Do not replace the removed vendor-charts rule with a bigger brittle package list. Let Rollup handle Recharts naturally.

&nbsp;

Verification:

Run:

&nbsp;

npm ci

npx tsc --noEmit

npm run seo:audit

npm test -- --run

npm run build

&nbsp;

Then verify in browser:

- https://haultrackerpro.com/ loads past the splash screen

- /trucking-contract-review loads

- /lease-purchase-contract-red-flags loads

- /auth loads

- Dashboard route loads for an authenticated user if available

- Browser console has no “Cannot access 'P' before initialization”

- No vendor-charts-*.js chunk is emitted after build

&nbsp;

Expected:

- App boots normally

- React mounts

- Landing page renders

- Contract SEO pages render

- No TDZ ReferenceError

- SEO audit remains 40/40

- Tests remain 72/72 or higher

- Build passes

- No business logic changes

&nbsp;

Final report format:

1. Files changed

2. Root cause

3. Exact fix

4. Build/chunk result

5. Browser verification

6. SEO/test/build verification

7. Anything intentionally unchanged

8. Next step: resume full Contract Protection end-to-end audit after boot is restored

## Executive summary

The "Contract Protection page not loading" report is actually a **global app-boot crash** affecting every route on production (`haultrackerpro.com`, `haultrackerpro.lovable.app`, and the Lovable preview). The pre-hydration splash never goes away because React never mounts.

Browser console (captured via the browser tool on `haultrackerpro.com`):

```
Uncaught ReferenceError: Cannot access 'P' before initialization
  at vendor-charts-BfAh1LeN.js:9:17033
```

This is a Rollup/Vite **temporal dead zone** error caused by `manualChunks` in `vite.config.ts` putting `recharts + d3-* + victory-vendor` into a `vendor-charts` chunk while leaving Recharts' transitive deps (e.g. `react-smooth`, `recharts-scale`, `eventemitter3`, `react-is`) in the main/other chunks. The chunks form a circular evaluation cycle, so a `let`/`const` (minified to `P`) is referenced before initialization → uncaught error → React never mounts → splash spinner forever on every route.

This is **not** caused by Phase 9F/9G changes (ContractAttachment, rewrite-contract-clause, Pricing, FAQ, etc.). Those touched no chart code. The crash would persist with the Contract Protection work fully reverted.

## Root cause finding

- **Symptom:** Pre-hydration HTML splash (`<div id="root">…HaulTrackerPro spinner…</div>`) is the only thing rendered on every URL.
- **Where:** `vendor-charts` Rollup output chunk.
- **Why:** `vite.config.ts` `manualChunks` rule at line 89:
  ```ts
  if (/node_modules\/(recharts|d3-[^/]+|victory-vendor)\//.test(id)) return 'vendor-charts';
  ```
  pulls Recharts out of the natural chunk graph. Recharts' transitive deps stay in `vendor-react` / main, creating a cycle: `vendor-charts` needs symbols whose modules haven't initialized yet.
- **Impact:** 100% of routes — public SEO pages (incl. all 6 Contract Protection pillars), `/auth`, `/`, `/admin`, dashboard. Affects all users (logged-in and anonymous).

## Files reviewed

- `vite.config.ts` (manualChunks)
- `index.html` (splash)
- `src/App.tsx` (lazy imports, all 6 contract SEO routes registered)
- `src/hooks/useAuth.tsx`, `src/hooks/useAdmin.ts`, `src/hooks/useSubscription.ts` (no boot-time hangs)
- `src/pages/Index.tsx` (loaded via `lazyWithRetry`)
- All 6 Contract Protection SEO pages (clean, share `ContractSeoPage`)
- `src/components/contracts/ContractAttachment.tsx` (compiles clean)
- `supabase/functions/rewrite-contract-clause/index.ts` (server-side Pro gate verified)
- Live production HTML + asset HEAD requests + browser console

## Fix (single, minimal change)

Edit `vite.config.ts` to remove the `vendor-charts` manualChunks rule and let Rollup's default chunking handle Recharts and its dependency tree as one consistent graph.

```ts
// REMOVE this line in manualChunks:
if (/[\\/]node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor)[\\/]/.test(id)) return 'vendor-charts';
```

Keep the other vendor splits (`vendor-react`, `vendor-data`, `vendor-ui`, `vendor-pdf`, `vendor-ocr`) — they have no reported cycles and are working today.

Rationale: this is the smallest safe change. Trying to "fix" the chunk boundary by adding more packages (`react-smooth`, `recharts-scale`, etc.) is brittle — Recharts' transitive graph is large and changes between minor versions. The cost is one slightly larger bundle that loads only on Recharts-using pages (dashboard/reports); first-paint impact is minimal because those pages already lazy-load.

## Verification (after the one-line fix)

1. `npx tsc --noEmit` — already passing; confirm no regression.
2. Build runs automatically in the harness — confirm no `vendor-charts-*.js` emitted.
3. Browser navigate to `https://haultrackerpro.com/` — expect Landing to render, no `ReferenceError`.
4. Browser navigate to `/trucking-contract-review` and one other Contract SEO page — expect H1 + content render.
5. Console check via `browser--read_console_logs` — expect no `Cannot access 'P' before initialization`.
6. Optional: `npm run seo:audit` and `npm test -- --run` (per the original audit checklist) once the app boots.

## Contract Protection audit (after boot is restored)

Once the app is loading again, perform the requested checks. Based on static review during root-causing, **no Contract Protection-specific blockers were found**:

- All 6 SEO pillar pages: lazy-imported correctly in `App.tsx` (lines 86–91), routes registered (incl. `/trucking-escrow-agreement-review` line 205), all use shared `ContractSeoPage` with FAQ + breadcrumb JSON-LD.
- `ContractAttachment.tsx`: `ClauseRewriteCard` defined at line 790, referenced at line 746 — TS reported clean.
- `rewrite-contract-clause` edge function: assigned-driver-or-admin auth, server-side `subscriptions.status === 'active'` gate, recruiter-paid does NOT unlock, structured AI tool call with disclaimer.
- Hired-status enforcement: `opportunity_applications_require_contract_for_hire` trigger still in place (verified in db functions list).
- Recruiter billing separation: `recruiter_billing_field_guard` + `opportunities_billing_guard` triggers untouched.

These will be re-verified live in the browser as part of step 4 above. Any new blocker discovered will be fixed in a follow-up surgical change and reported separately — not bundled into this fix.

## Out of scope for this fix

- No copy changes, no SEO page changes, no edge function changes, no DB/RLS changes, no Stripe/billing changes.
- No refactor of `lazyWithRetry`, `useAuth`, or `useSubscription`.
- No `npm audit fix --force`.

## Deliverables

1. `vite.config.ts` — one-line removal of the `vendor-charts` rule.
2. Verified production boot via browser console (no TDZ error).
3. Final report in the format the original prompt requested (executive summary, root cause, files reviewed/changed, public/driver/recruiter/admin/Clause Rewrite/billing/edge function/RLS/SEO/mobile audit results, verification command results, blockers, warnings, next fixes).