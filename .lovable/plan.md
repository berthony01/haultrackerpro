The preview is still not showing because this is not just a stale browser tab anymore — the app is failing before React actually mounts any visible UI.

What’s confirmed:
- The dev server is up and serving `index.html` and the app scripts.
- The page title loads, but the viewport stays blank and the DOM remains nearly empty.
- There are no meaningful runtime errors from the current route guards, so the `forwardRef` change did not fix the real issue.
- The failure is happening in the top-level startup path in `src/App.tsx` before the landing page renders.
- The current bootstrap path includes two likely culprits:
  1. `src/components/ui/sonner.tsx` uses `next-themes` at the app root, but there is no theme provider mounted in `src/main.tsx`.
  2. The `TooltipProvider` import chain is showing an aborted/failed module request during app startup.

Plan
1. Repair the app bootstrap first
   - Remove the bad assumption that the issue was the route guards.
   - Patch the root-level toast/theme setup so it no longer depends on a missing theme provider, or add the proper provider in `src/main.tsx`.

2. Simplify the top-level render path
   - Reduce `src/App.tsx` to the minimal safe providers needed for first paint.
   - Keep auth guards functional, but stop wrapping them in unnecessary `forwardRef` if that added noise without solving the startup problem.

3. Verify the remaining import chain
   - Re-check the `TooltipProvider` path after the bootstrap fix.
   - If needed, temporarily isolate it and restore it once the page renders again.

4. Re-test the preview
   - Confirm `/` renders the landing page.
   - Confirm auth-gated routes still show the correct fallback/redirect behavior.
   - Confirm the app is back to a state that is safe to continue the pay-model phases.

Technical details
- Files to patch first:
  - `src/components/ui/sonner.tsx`
  - `src/main.tsx`
  - `src/App.tsx`
- Most likely concrete fix:
  - Either add a proper theme provider around `<App />`, or make the Sonner wrapper not rely on `next-themes` at the root.
- This is a startup/bootstrap problem, not a data, routing-hosting, or hard-refresh-only problem.

Approve this and I’ll apply the bootstrap fix first, then verify the preview renders before continuing the remaining phased pay-model work.