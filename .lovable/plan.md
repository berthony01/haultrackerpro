# Driver Assistants Phase 2 — Multi-Driver Operations + Agency-Ready Foundation

This is a large phase. I'll execute it in ordered sub-phases so each piece is verifiable. Phase 1 + cleanup is untouched; everything here is additive.

## 0. Package hygiene (do first)

- Inspect `package.json` + `package-lock.json` + `bun.lockb`.
- Resolve the Playwright lockfile mismatch (`npm install` to regenerate `package-lock.json`, or remove it if the project is Bun-first).
- Run and capture exact output for: `npm install`, `bunx tsgo --noEmit`, `bun run build`, `bunx vitest run`. No success claim without real output.

## 1. Database foundation (single migration)

- `agency_profiles` — `owner_user_id` (FK auth.users), `name`, `description`, `contact_email`, `status` ('active'|'disabled'), timestamps.
- `agency_members` — `agency_id`, `member_user_id`, `role` enum ('agency_owner','agency_admin','agency_member'), `invited_email`, `status` ('pending'|'active'|'revoked'), timestamps. Unique (agency_id, member_user_id).
- GRANTs to `authenticated` + `service_role`. RLS:
  - Owners full CRUD on their agency + members.
  - Members SELECT their own agency + member row.
  - **No implicit driver access.** Driver delegation stays exclusively on `driver_assistants`.
- RPCs:
  - `create_agency(_name, _description, _contact_email)` — caller becomes `agency_owner` member.
  - `invite_agency_member(_agency_id, _email, _role)` — owner only.
  - `accept_agency_invite(_token)` — accepts pending invite.
  - `revoke_agency_member(_member_id)` — owner only.
  - `get_my_agency()` / `list_agency_members(_agency_id)`.
- New RPC `list_my_assistant_audit(_limit)` — returns assistant's recent actions across their managed drivers (driven by `assistant_audit_log` filtered to `assistant_user_id = auth.uid()`).
- New RPC `list_driver_assistant_audit(_limit)` — returns driver's audit feed (filtered to `driver_user_id = auth.uid()`), joining `driver_assistants` for assistant email.

## 2. Multi-driver switcher (UI)

- New `AssistantDriverSwitcher.tsx` (Radix Popover) in the app shell: shown only when `managedDrivers.length >= 1` AND user is in acting mode OR has any managed drivers.
- Mount in the existing top header / `ActingAsBanner` row.
- Lists active delegated drivers from `useActingContext().managedDrivers` (already RPC-backed).
- Switching calls `beginActingAs(id)` and stays on the current route when safe; bounces to first allowed page otherwise.
- Adds "Exit assistant mode" entry.

## 3. Assistant Operations Dashboard upgrade (`/assistant`)

Extend `AssistantDashboard.tsx`:

- Summary cards (real data only):
  - Active drivers managed (`managedDrivers.length`).
  - Pending invites (new RPC `list_my_pending_assistant_invites` — invites addressed to my auth email, status='pending').
  - Drivers with recent activity (last_active_at within 7 days).
  - Drivers with `view_reports` permission.
- Per-driver card: permission badges, last_active_at, quick action buttons gated by `hasPerm(...)`; each opens the right route inside acting context.
- "Recent activity" panel using `list_my_assistant_audit`.
- Separate "Past / revoked" section if RPC returns any.

## 4. Driver-side audit visibility

- New `AssistantActivityLog.tsx` rendered inside the existing "Driver Assistants" accordion in `SettingsView.tsx`.
- Pulls from `list_driver_assistant_audit`. Plain-English row format: "{assistant_email} {action_label} at {timestamp}".
- Drivers only see their own log (enforced server-side).

## 5. Agency area (private)

- Route `/agency` → `AgencyDashboard.tsx`.
  - If no agency: "Create Agency Profile" card explaining the side-hustle framing.
  - If agency exists: profile editor, member list with invite/revoke, summary of drivers the **owner** personally manages via `driver_assistants` (not auto-shared with members), recent activity from owner's audit feed.
- Navigation entry in `SettingsView` "More" area for the owner.
- Explicit copy: "Agency membership does NOT grant access to a driver's account. Each driver must invite each assistant individually."

## 6. Driver invite flow polish

- Keep current copy-link flow as-is (works without email infra).
- If existing `send-transactional-email` edge function is present and safe to reuse, add an optional "Email this invite" button that calls a thin new edge function `send-assistant-invite` (server-side; uses existing email infra). If reusing isn't clean, ship copy-link only and document it under Known Limitations.

## 7. Route guards + permission polish

- `assistantPageGate` already covers most pages. Audit `Index.tsx` page handler list and `AppSidebar`/`BottomNav` filters.
- For BLOCKED pages, show a small `AssistantBlockedNotice.tsx` with: "You do not have permission to access this area for {driver_name}." + button → first allowed page.
- Re-verify `manage_settings_limited` only exposes cost profile (already done in Phase 1; just confirm).

## 8. Regression + final report

Run the full verification matrix from the spec, plus:

- `bunx vitest run` (full suite — currently 439).
- `bunx tsgo --noEmit`.
- `bun run build`.
- Manual checklist: invite → accept → switch → write → revoke → blocked routes → agency create → agency invite → member has no driver access.

Final report uses the A–O structure requested.

## Technical notes

- All new RPCs are `SECURITY DEFINER` with `SET search_path=public`, `auth.uid()` checks, allow-listed inputs.
- `agency_members` never participates in any existing table's RLS — there is no policy of the form `EXISTS (select 1 from agency_members ...)` on `loads`/`expenses`/`fuel_logs`. Driver delegation stays exclusively on `driver_assistants`.
- No new client-side gating replaces server checks; UI gates are convenience only.
- Tests: add `src/test/agencyMembershipNoDriverAccess.test.ts` (DB-shape test) and `src/test/assistantSwitcherFilter.test.tsx` (filters revoked drivers out).

## What's deliberately NOT in Phase 2

- Public agency directory.
- Ratings/reviews.
- Payment processing or assistant-service billing.
- Assistants inviting other assistants.
- Cross-agency driver sharing.

## Open question

Email infra for invites: the project has `send-transactional-email`. Do you want me to wire optional email-send for assistant invites in this phase (Option A), or keep copy-link only and revisit later (Option B)? I'll default to **Option A** (reuse existing infra; no new secrets) unless you say otherwise.

&nbsp;

Proceed with Phase 2.

For the open question: choose **Option A**, but with strict guardrails.

You may wire optional assistant invite email sending only if the existing `send-transactional-email` infrastructure is already safe, working, and reusable without adding new secrets or weakening security.

Rules for invite email:

1. Do not expose service role keys or email provider secrets to the client.
2. Do not fake email sending.
3. Do not create a half-working email button.
4. If the existing email function is not cleanly reusable, keep copy-link only and document email sending as a known limitation.
5. If email sending is added, it must be server-side only through a secure Edge Function.
6. The driver must still see and be able to copy the invite link manually.
7. Email sending should be optional, not required for the assistant invite flow to work.
8. The email content should be simple and professional:  
“You’ve been invited to help manage a driver’s HaulTracker Pro account.”
9. The invite acceptance must still be validated by the existing secure RPC flow.
10. Email delivery must not grant access by itself. Access only activates after the invited assistant signs in with the invited email and accepts the invite.

Also, I approve the ordered sub-phase approach. Do not skip package hygiene. Do not move forward with UI work until the dependency/lockfile issue is cleaned up and command results are captured honestly.

Final reminder:  
Build this as a production business feature, not a surface-level demo. Phase 2 must preserve Phase 1 security, keep agency membership separate from driver access, and make multi-driver assistant work clean and professional.