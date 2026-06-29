# Phase 4 Strict Audit + Discoverability Pass

## Goal

Verify Phase 4A/4B/4C shipped correctly with no regressions, and make the new capabilities (Driver Assistants, Agency workflow, Driver Control Center, Waiting-on-Driver work items, Agency slugs, in-app notifications for assistant/agency events) discoverable on the landing page, Features page, SEO surfaces, and sitemap. Today none of these are mentioned in marketing copy or indexed.

## Part 1 — Strict audit (read-only verification)

For each phase, verify against code + tests and produce a PASS / FAIL line item:

**Phase 4A — Driver Control Center**
- `list_my_assistants_with_source` RPC exists and is auth.uid-scoped.
- `/driver/assistant-control` route registered + protected.
- `useAssistantsWithSource` returns typed rows; source classification UI rule matches test invariants.
- "End access" path correctly branches: agency-source → `revoke_agency_delegation`, direct → `revoke_assistant`.
- Audit visibility surface present for both action types.

**Phase 4B — Notifications**
- `notification_preferences` extended with `assistant_events` + `agency_events`.
- `create_notification` and `notification_category` respect the new toggles.
- Triggers exist on `driver_assistants`, `agency_client_requests`, `agency_delegation_requests`, `agency_work_items` and are `SECURITY DEFINER`.
- `NotificationCenter.routeForNotification` resolves assistant/agency types to `/driver/assistant-control` and `/agency`, and work-item types deep-link to `/driver/work-items/:id` / `/agency?workItem=:id`.
- `NotificationPreferencesPanel` shows both new toggles.

**Phase 4C — Slugs, deep links, waiting-on-driver**
- `agency_profiles.slug` is `citext`, validated format, reserved-words guard.
- `set_agency_slug` (owner only) + `resolve_agency_slug` RPCs present; grants correct.
- `agency_work_items.last_driver_response` + `last_driver_response_at` columns + 7-day RLS for driver self-view after response.
- `list_my_waiting_work_items`, `get_my_waiting_work_item`, `driver_respond_to_work_item` RPCs present and strict.
- Routes `/a/:slug`, `/driver/work-items`, `/driver/work-items/:id` registered.
- `AgencySlugCard` mounted in Agency Dashboard overview.

**Cross-cutting checks**
- `bun run build` clean.
- `bunx tsgo --noEmit` clean.
- `bunx vitest run` — expect 537/537.
- Supabase linter — no new criticals introduced by Phase 4 migrations.
- Security memory still accurate (RPC-only writes for Phase 3 tables still hold).

Any FAIL is fixed in this same pass with the smallest possible change before moving to Part 2.

## Part 2 — Discoverability + SEO showcase

Phase 4 added real user-visible capability but no marketing surface mentions it. Add it without touching unrelated copy.

**`src/lib/featureList.ts`** — add a new category **"Team & Agency"** with entries:
- Driver Assistants (invite, permissions, audit) — Pro
- Driver Control Center (one place to revoke any access)
- Agency Workspace (service packages, client requests, work queue)
- Driver-Approved Delegation (agency access only with explicit driver approval)
- Waiting-on-Driver work items (one-tap driver response)
- Public agency request links (`/a/your-agency`)
- Assistant & Agency in-app notifications

This auto-flows into `/features` (data-driven) and the downloadable feature sheet.

**`src/pages/Landing.tsx`** — add one new section "Built for solo drivers, teams, and agencies" with three short cards (Driver / Assistant / Agency) and a CTA into `/features#team-agency`. Keep current hero and existing sections intact.

**`src/pages/Features.tsx`** — already data-driven; verify the new category renders cleanly and add an in-page anchor `id="team-agency"`.

**`scripts/generate-sitemap.ts` + `public/sitemap.xml`** — add indexable public marketing/info routes only:
- (no change for `/driver/*` or `/agency` dashboard routes — those are auth-gated and already in `robots.txt` disallow spirit)
- Confirm `/features` entry still present (it is).
- Add `Disallow: /driver` and `Disallow: /agency` and `Disallow: /a` to `public/robots.txt` so auth/redirect routes are not crawled. `/agency/request/:agencyId` and `/a/:slug` are intentionally private per-agency links.

**SEO meta**
- `src/pages/Features.tsx` — extend `<SEOHead>` description to include "driver assistants and agency workflow" keywords (under 160 chars).
- Add JSON-LD `FAQPage` entry on `/faq` for "Can I give my back office or agency access to my HaulTrackerPro account?" (only if `FAQ.tsx` already uses JSON-LD; otherwise skip — do not introduce new schema infra).

**Resource hub** — add a single short resource card link on the Features "Resource Hub CTA" block pointing at the new section; no new article pages created in this pass.

**No changes to:** pricing tiers, billing, RPC contracts, RLS, existing copy outside the additions above. UI-only marketing edits + the audit.

## Deliverable

A single PR with:
1. A short audit report in the chat reply (PASS/FAIL per item).
2. Any minimal fixes required by the audit.
3. The featureList/Landing/Features/robots additions above.
4. Re-run build + typecheck + vitest and report green.

## Technical notes

- `featureList.ts` drives both `/features` UI and the downloadable feature sheet — single edit, two surfaces.
- Landing page must keep existing audience switcher (`useLandingAudience`) intact; new section renders for both audiences with audience-tinted copy.
- Robots disallow for `/driver` and `/agency` is the right move because these are authenticated app surfaces, not marketing. `/a/:slug` is a private redirect — disallow as well.
- No new migrations expected unless the audit surfaces a missing grant/policy.
