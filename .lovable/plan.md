
# Phase 1H Implementation Audit — READ-ONLY

No files were modified, no migrations created, no packages installed, no DB writes.

## A. Repository and branch state

- Current branch: `edit/edt-0c578eda-f00f-4ce9-a83b-a457a7f6128e` (Lovable working branch, tracks `main`).
- Current HEAD SHA: `4faa861661eef457a5a5608699aa9aea86af3032` — **exactly** the previously accepted main SHA.
- `phase1h-driver-application-pipeline` branch: **does not exist** (not local, not on `origin`).
- Commits since the referenced SHA on any Phase 1H topic: **zero**. Recent commits (`64a3fbce`, `ba4dfb53`, `ffb268b1`, `6c8fd220`, `fc3a1a76`, …) are all Phase 1G-R1A7 billing / CI / lockfile / workflow work. No Phase 1H commit exists in the repo.

## B. Files and migrations inspected

Source:
- `src/components/opportunities/OpportunityDetail.tsx` (Driver detail view, primary CTA)
- `src/hooks/opportunities/useOpportunityApplications.ts` (driver + recruiter application hook, RPC calls)
- `src/components/opportunities/DriverApplicationsPanel.tsx` (present, pre-1H)
- `src/components/opportunities/RecruiterApplicationsDashboard.tsx` (present, pre-1H)
- `src/components/opportunities/ApplicationTimeline.tsx` (present, pre-1H, driven by `application_events`)
- `src/lib/opportunities/applicationStatus.ts` (existing status/label/transition tables — no offer states)
- `src/integrations/supabase/types.ts` (no `opportunity_offers`, no `marketplace_user_restrictions`)

Migrations:
- Latest migration in tree: `20260717223452_ff4257ea…sql` (Phase 1F-A.2.2-R1B live consent-pair). No newer migrations.
- `opportunity_applications` table defined in `20260513003741_…sql` with `application_type text NOT NULL DEFAULT 'request_info'` and CHECK constraint `application_type IN ('apply','request_info','callback')` — so the `'apply'` value is schema-legal but no code path submits it.
- `application_events` and recruiter transition guards exist pre-1H (`20260513004834_…`, `20260513025656_…`, `20260513040206_…`, `20260516014826_…`, `20260516040340_…`, `20260528225151_…`, `20260529005635_…`, `20260627161959_…`, `20260627162043_…`, `20260627174143_…`, `20260717185620_…`).
- No migration anywhere in the tree references `opportunity_offers` or `marketplace_user_restrictions`. Grep on both source and migrations returns zero hits.

## C. Current Driver opportunity action (verbatim)

`OpportunityDetail.tsx` lines 78–110 and 306–309:

- Handler: `handleRequestInfo` → `createApplication.mutate({ application_type: 'request_info', message: "I'm interested in learning more about this opportunity.", … })`.
- Button label (verbatim): `{alreadyApplied ? 'Request Sent' : submitting ? 'Sending…' : 'Request Info'}`.
- Icon: `Send`. No secondary "Apply Now" button. No structured application form. No separate "Ask Recruiter a Question" surface — the same button *is* the inquiry path, and it's the only path.

## D. Implementation matrix

| Capability | Status |
|---|---|
| Primary "Apply Now" CTA | **Absent** |
| Structured Driver application form | **Absent** |
| `application_type='apply'` submission path | **Absent** in code (schema allows the value; nothing writes it) |
| Immutable application submission snapshot | **Absent** (only contact snapshot fields on the inquiry row) |
| Separate "Ask Recruiter a Question" form | **Absent** (Request Info is the only path) |
| Inquiry + formal application coexisting on same opportunity | **Absent** |
| Driver "My Applications" tracking | **Partial** (pre-1H `DriverApplicationsPanel` exists; no formal-application distinction) |
| Recruiter application pipeline | **Partial** (pre-1H `RecruiterApplicationsDashboard` + transition guards; no offer stage) |
| Separate `opportunity_offers` table/entity | **Absent** |
| Recruiter send-offer workflow | **Absent** |
| Driver accept/decline offer workflow | **Absent** |
| Onboarding application status | **Absent** (`applicationStatus.ts` has no `onboarding`) |
| Block direct `offer_sent → hired` | **Absent** — `getAllowedRecruiterTransitions` explicitly permits `offer_sent: ['hired', 'rejected']` |
| Offer expiration / replacement / idempotency / concurrency | **Absent** |
| Offer/application-specific timeline events + notifications | **Absent** (existing `application_events` cover only pre-1H statuses; no `offer_*` events) |
| `marketplace_user_restrictions` | **Absent** (no table, no code reference) |

## E. Existing reusable application infrastructure (pre-1H, safe to build on)

- `opportunity_applications` table with `application_type` CHECK already includes `'apply'`.
- `application_events` table + trigger that logs status transitions.
- Recruiter transition guard trigger restricting server-side status moves.
- `list_recruiter_applications_safe` RPC with PII gating.
- `record_driver_application_response` and `withdraw_opportunity_application` RPCs.
- `applicationStatus.ts` status/label/badge/transition tables (extendable, not offer-aware).
- `DriverApplicationsPanel`, `RecruiterApplicationsDashboard`, `ApplicationTimeline` components.

## F. Missing Phase 1H functionality

Everything listed in D as Absent or Partial. Specifically, no code, migration, RPC, edge function, hook, component, route, type, test, or notification implements:
- Apply Now CTA + structured form,
- immutable submission snapshot,
- offer entity + workflow,
- Driver offer accept/decline,
- onboarding stage,
- offer_sent → hired guard,
- offer expiration/replacement/idempotency,
- offer/application notifications,
- marketplace user restrictions.

## G. Deployment / publish status

- No Phase 1H commits exist, therefore nothing Phase 1H-related has been merged, deployed, or published.
- The published app at the project's Preview / Published URLs is serving the exact code at `4faa8616`, which contains the pre-1H `Request Info` flow.
- No pending migration in `supabase/migration-candidates/` references Phase 1H (only the pre-existing `20260717235300_phase1g_r1a1_recruiter_checkout_intents.sql`).

## H. Documentation vs. code discrepancies

- `.lovable/plan.md` describes only Phase 1G-R1A7-R1. It contains **no** Phase 1H plan. There is no Phase 1H design document, checklist, or migration candidate in the repo.
- If a prior agent turn described Phase 1H as "implemented", "in progress", "branch created", or "deployed", that claim is **not** supported by the repository: no branch, no commits, no files, no migrations. The only accurate historical statement is that Phase 1H was *discussed as future work*.

## I. Exact reason the user still sees "Request Info"

`src/components/opportunities/OpportunityDetail.tsx` line 306–309 is the only primary CTA rendered on a Driver's opportunity detail view. Its label is the string literal `'Request Info'` (with `'Request Sent'` / `'Sending…'` as its only other states), and its click handler unconditionally calls `createApplication.mutate({ application_type: 'request_info', … })`. No other button, route, dialog, or feature-flagged branch exists to render an "Apply Now" CTA. Because no Phase 1H code was ever committed, the label and behavior are simply the pre-1H code still in production.

## J. Verdicts

| Area | Verdict |
|---|---|
| Apply Now CTA | **FAIL** |
| Structured application form + snapshot | **FAIL** |
| Inquiry vs. formal application separation | **FAIL** |
| Driver My Applications (1H scope) | **FAIL** |
| Recruiter pipeline (1H scope, incl. offer stage) | **FAIL** |
| Offers entity + send/accept/decline | **FAIL** |
| Onboarding stage + offer_sent→hired guard | **FAIL** |
| Offer lifecycle safety (expire/replace/idempotency/concurrency) | **FAIL** |
| Offer/application notifications + timeline events | **FAIL** |
| `marketplace_user_restrictions` | **FAIL** |
| **Overall Phase 1H** | **FAIL — not implemented** |

## K. Safest next action (not performed)

Author a Phase 1H patch-level execution packet (following the workspace's Standing Delivery Protocol) that:
1. Defines the final product rule for Apply Now vs. Ask Recruiter, offer lifecycle, and onboarding stage.
2. Lists exact new files, one new migration for `opportunity_offers` (+ RLS + grants + transition guards + `marketplace_user_restrictions` if in scope), and extensions to `applicationStatus.ts` / `application_events`.
3. Specifies the offer_sent → hired block (must route through offer accept + onboarding).
4. Provides an acceptance-test matrix and live-DB post-checks.
5. Ships as a dedicated branch `phase1h-driver-application-pipeline`, split into sub-phases (schema → driver apply → recruiter pipeline → offers → onboarding → notifications) so each can be independently proven.

Awaiting explicit approval before any implementation work.
