
# Structured Hiring Workflow — Phase A + B

Transforms the existing Opportunities application system into a structured, pipeline-style hiring workflow with timeline/activity events. No chat, no uploads, no realtime infra.

## Scope checkpoint

In scope: extended statuses + guard, driver pipeline view, recruiter pipeline view, structured driver responses, `application_events` table + RLS + auto-event creation, timeline UIs on both sides, small analytics helpers.

Out of scope (untouched): Stripe, recruiter billing, LoadForm, reports, parking, admin auth, Match Engine, Profit Intelligence, RLS architecture beyond the new table + guard updates.

---

## Phase A — Pipeline

### 1. Status expansion (DB migration)

New canonical statuses on `opportunity_applications.status`:
`new, viewed, contact_requested, call_scheduled, waiting_documents, interviewing, offer_sent, hired, rejected, withdrawn`.

- Backward compat: existing rows with `status = 'contacted'` get migrated to `'contact_requested'` in the same migration. Rank function treats them as equivalent.
- Update `opportunity_applications_update_guard()`:
  - Replace the old rank ladder with the new 8-stage forward-only ladder.
  - Driver-only `withdrawn` (still gated by `app.allow_driver_withdraw`).
  - Terminal states (`hired`, `rejected`, `withdrawn`) remain locked.
  - Admin bypass preserved.
  - `opportunity_applications_require_contract_for_hire` unchanged.

### 2. Driver structured responses

No chat. Driver can trigger:
- `still_interested`, `request_callback`, `need_more_info`, `not_interested`

These do NOT change the application status (recruiter owns status). They emit `application_events` rows only, with optional 200-char note.

A SECURITY DEFINER RPC `record_driver_application_response(application_id, response_type, note)` writes the event after validating ownership + non-terminal status.

### 3. Recruiter actions

Pipeline buttons map 1:1 to status transitions allowed by the guard. UI exposes only the legal next steps for each card.

---

## Phase B — Activity timeline

### 4. `application_events` table (migration)

```
application_events
  id uuid pk
  application_id uuid not null  (refs opportunity_applications.id, FK on delete cascade)
  actor_type text not null check in ('driver','recruiter','system','admin')
  actor_user_id uuid null
  event_type text not null
  metadata jsonb not null default '{}'
  created_at timestamptz default now()
index (application_id, created_at desc)
```

Event types: `application_created, recruiter_viewed, contact_requested, call_scheduled, waiting_documents, interviewing, offer_sent, hired, rejected, withdrawn, driver_still_interested, driver_request_callback, driver_need_more_info, driver_not_interested`.

### 5. RLS

- Drivers: SELECT where `application_id` belongs to them.
- Recruiters: SELECT where `application_id`'s recruiter_id is owned by them (via `is_recruiter_owner`).
- Admins: full SELECT.
- INSERT: blocked for regular roles. Only the SECURITY DEFINER trigger + driver-response RPC write.

### 6. Auto-event creation

DB trigger `application_events_emit()` on `opportunity_applications`:
- AFTER INSERT → `application_created`.
- AFTER UPDATE OF status → event named after the new status (`recruiter_viewed`, etc.), actor inferred from `auth.uid()` matching driver vs recruiter, else `system`/`admin`.

Driver structured responses are emitted by the RPC above.

---

## UI

### 7. `DriverApplicationsPanel.tsx` (rewrite the card section)

Group cards into sections: **New Requests, Recruiter Viewed, In Discussion** (contact_requested + call_scheduled + waiting_documents), **Interviewing & Offers** (interviewing + offer_sent), **Closed** (hired/rejected/withdrawn).

Each card:
- Company + opportunity title + city/state
- Current status badge (new labels)
- Last activity timestamp
- Driver actions: Still Interested · Request Callback · Need More Info · Withdraw
- Collapsible **Activity Timeline** (vertical, dark, small icons, timestamps)

### 8. `RecruiterApplicationsDashboard.tsx`

Pipeline view with column groups (desktop = horizontal scroll; mobile = stacked):
`New · Viewed · Contact Requested · Call Scheduled · Waiting Docs · Interviewing · Offer Sent · Closed`.

Each applicant card:
- Driver name, location, experience, preferences snapshot, match score
- Status + last activity
- Quick actions = only legal forward transitions
- Expandable timeline

### 9. Timeline component

New shared `ApplicationTimeline.tsx` consuming `useApplicationEvents(applicationId)` (react-query).

### 10. Analytics helpers (local utility)

`src/lib/opportunities/pipelineAnalytics.ts` — pure functions:
- `pipelineCounts(apps)` — count per stage
- `avgRecruiterResponseHours(events)` — time from `application_created` → first recruiter event
- `hireConversionRate(apps)`

Wired into recruiter dashboard header only (no overhaul).

---

## Files

**Migrations** (single migration, two logical blocks):
- Status expansion + guard update + data backfill
- `application_events` table + RLS + trigger + driver response RPC

**New files**
- `src/hooks/opportunities/useApplicationEvents.ts`
- `src/components/opportunities/ApplicationTimeline.tsx`
- `src/lib/opportunities/applicationStatus.ts` (status labels, allowed transitions, grouping)
- `src/lib/opportunities/pipelineAnalytics.ts`

**Edited**
- `src/hooks/opportunities/useOpportunityApplications.ts` (add `recordDriverResponse`)
- `src/components/opportunities/DriverApplicationsPanel.tsx`
- `src/components/opportunities/RecruiterApplicationsDashboard.tsx`
- Any place that renders a status badge needs the new label map.

---

## Verification

- `npx tsc --noEmit` clean
- `bunx vitest run` passes
- Manual: backward transition blocked, recruiter cannot set withdrawn, driver withdraw still works via RPC, timeline visible to both sides, no chat surfaces anywhere.

---

## Confirmation needed

This is a large multi-step patch. Approving this plan will run the migration (status backfill + new table + trigger + RPC) and then edit the UI files. OK to proceed?
