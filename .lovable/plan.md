# Publish-Blocker Audit — Read-Only Findings

## Gate
- `git fetch origin main -q` run.
- HEAD == origin/main == `3ef7347440250dc081f8733e4f1e519f241c28fa` (exact match).
- `git status --porcelain` empty (clean tree).
- HEAD commit shape: **merge commit**, parents `4c0a1645` (prior main) and `4a94f8ec` (RW-4T work), subject "Reconciled agency role gating".

## Build / typecheck
- `npx tsgo --noEmit` — clean, exit 0.
- `npx vite build` — success, built in ~29s, full `dist/` emitted.
- Only warning: chunk-size advisory (`Index` 867 kB, `vendor-pdf` 675 kB). Advisory only, not a publish blocker.
- Supabase URL/key literals are present in the emitted bundle (`vite.config.ts` `define` fallbacks working), so a missing-env prod build cannot produce the old `supabaseUrl is required` boot crash.

## Configuration inspected
- `.env` present with the three expected keys (`VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`). No missing variable names found. No values inspected or reported.
- `supabase/config.toml` lists 25 functions; `supabase/functions/` contains 32. The 7 unlisted (`generate-resource-article-draft`, `preview-transactional-email`, `send-lifecycle-emails`, `telegram-poll`, `mcp`, plus `_shared`/`deno.json`) simply default to `verify_jwt = true`. This is a config-completeness observation, **not** a publish gate.
- Backend (Lovable Cloud) reports healthy and normally responsive.
- No pending/broken migration state surfaced.

## Platform gates
- Security scan results: **zero findings** across all six scanners (`agent_security`, `app_mcp`, `connector_security_scan`, `supabase`, `supabase_lov`, `supply_chain`). `agent_security` and `supply_chain` snapshots are stale (not re-run against this SHA), the rest are current as of today. No critical finding exists that could block a publish gate.
- Publish settings: `is_published: true`, `publish_visibility: public`, `effective_publish_visibility: public`. The project is already published and publicly visible; nothing in visibility settings blocks an update.

## Classification
**No reproducible code-side or deployment-configuration blocker.** Build, typecheck, env wiring, backend health, migration state, and security gates are all green at `3ef7347`. The symptom ("Lovable will not publish the latest revision") therefore points to the **platform/account side**: publish-job scheduling, workspace plan/permission, or the deployment pipeline not picking up the merge-commit HEAD.

## What I could not inspect from this environment
- The publish/deployment job queue, its logs, and any error text the Publish dialog showed the owner.
- Workspace plan/seat/billing state and per-user publish permission.
- Whether the hosting build runner is pinned to a different commit than `3ef7347` (e.g. resolving a merge parent instead of the merge commit).
- Custom-domain (`haultrackerpro.com`) deployment/DNS pipeline state.
- Historical deploy records for the last successful publish.

## Smallest next diagnostic action
1. Owner: open the Publish dialog, attempt Update, and capture the **exact** error text/screenshot plus the timestamp — that message distinguishes a gate rejection from a job failure.
2. Owner: confirm which commit SHA the publish dialog reports as the revision being deployed, and whether it equals `3ef7347440250dc081f8733e4f1e519f241c28fa`.
3. If the dialog shows no error but the deploy never lands, this is a platform pipeline issue and should go to Lovable support with the SHA and timestamp.

No edits, no migrations, no publish performed. Stopping here.
