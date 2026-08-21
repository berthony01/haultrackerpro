# TG-2E3-O5 — Owner QA Seeded Workspace Architecture (Read-Only Audit Report)

## 1. Start gate

- `git rev-parse HEAD` = `7274f133ce337a7dd4475ee4c218153bcc6aba33` — MATCH.
- `git status --porcelain` — empty.
- Gate PASS. No edits, no writes, no migrations, no deploys performed.

## 2. System-of-Record map for O5

| Domain | Authority |
| --- | --- |
| Code | this repo at HEAD above |
| Identity / RLS | Lovable Cloud `auth.users`, `admin_users`, `user_capabilities` |
| Plan entitlement | `subscriptions`, `recruiter_billing_profiles`, `agency_entitlements` + Stripe (never seeded) |
| QA persona | live `owner_qa_sessions` + `current_owner_qa_persona()` (already in production) |
| Workspace data | `loads`, `expenses`, `opportunities`, `agency_*`, `driver_assistants`, `carrier_driver_relationships`, `driver_settlements` |
| Discovery/public | `opportunities` (status=active AND admin_review_status=approved), `get_agency_public_view`, `list_agency_packages_public`, `professional_profiles`, `driver_opportunity_profiles` |
| Telegram | `telegram_user_links`, `telegram_chat_bindings`, `dispatch_command_receipts` (all currently empty) |

## 3. Existing reusable fixture inventory (live, verified)

Owner auth user: `df860876-4c44-4f93-b31c-72ca9dbd9f3d` (`super_admin` in `admin_users`). Architecture must resolve this by `admin_users.role='super_admin'`, never by email literal.

Already exists and is reusable:
- Capabilities: `driver=active`, `recruiter=active`.
- Driver data: 57 loads, 33 expenses, 1 cost_profile, 1 driver_points row, 1 `subscriptions` row (`pro_monthly/active`).
- Recruiter: `recruiter_profiles` `f6b00b66…` = "HaulTrackerPro Test Carrier LLC", approved/active; 8 opportunities; 1 `recruiter_members` row; 1 `recruiter_billing_profiles` row.
- Agency: `agency_profiles` `0459e052…` = "Haul Tracker Test Agency", active, **slug NULL**; 1 `agency_members` row; 1 `agency_entitlements` row.
- Applications: 3 rows exist platform-wide.

Missing for realistic QA:
- 0 fuel_logs, 0 driver_opportunity_profiles, 0 professional_profiles (owner).
- 0 agency service packages / client requests / delegations / work items.
- 0 `driver_assistants`, 0 `carrier_driver_relationships`, 0 settlements, 0 Telegram links.
- No seed/fixture/demo tooling exists in the repo at all. All existing "fixture" helpers live inside ephemeral Postgres Vitest suites (`tests/postgres/*`) and are unusable against production. There is no `is_test` column anywhere and no QA registry table besides `owner_qa_sessions`.

## 4. Recommended architecture — auth user count

**Three auth users total: 1 existing owner + 2 new synthetic.**

- The owner user can hold Driver + Recruiter + Agency simultaneously: capabilities are additive, `agency_profiles.owner_user_id` and `recruiter_profiles.user_id` are independent FKs to the same user, and no constraint forbids overlap. Confirmed live — the owner already owns all three.
- A **synthetic assistant user** is mandatory. `accept_assistant_invite` raises `'You cannot accept your own invitation'` when `driver_user_id = auth.uid()`, and matches `invite_email` against `auth.users.email`. Self-delegation is impossible by design.
- A **synthetic managed-driver user** is mandatory for `carrier_driver_relationships`, agency client/delegation flows, applications-received, and settlements: those all model a second party whose rows are RLS-scoped to a different `user_id`. Reusing the owner would collapse both sides and produce non-representative RLS results.

Anything beyond 3 (e.g. one login per plan) is unnecessary — plan variation is already handled server-side by `owner_qa_sessions` personas.

## 5. Per-workspace rows

| Workspace | Required (minimum usable) | Optional sample |
| --- | --- | --- |
| Driver | already satisfied (capability, loads, expenses, cost_profile) | fuel_logs, settlements as driver, driver_opportunity_profile |
| Recruiter | recruiter_profile approved + ≥1 opportunity (exists) | applications from synthetic driver, carrier_driver_relationship, referral, contract, settlement batch |
| Agency | agency_profile + agency_members owner row (exists) | ≥1 service package, ≥1 client request, ≥1 approved delegation, ≥2 work items |
| Driver Assistant | synthetic assistant auth user + accepted `driver_assistants` row scoped to owner-as-driver | assistant audit rows generated naturally by use |

## 6. Isolation rules required BEFORE any seed write

1. **Discovery leak, live today**: opportunities `5ef7d201…` and `d5583699…` ("LOOKING FOR OTR DRIVERS", "HIRING OTR DRIVER IN ALL 48 STATES") are `active/approved` on the owner's test carrier — i.e. currently visible to real drivers via `driver_can_access_opportunity`. QA opportunities must be `closed` or non-approved unless a QA-exclusion filter exists first.
2. Agency slug stays NULL so `get_agency_public_view` / `list_agency_packages_public` never surface the QA agency.
3. Synthetic users must use a reserved non-deliverable domain and be added to `suppressed_emails` before any row that can trigger `send-lifecycle-emails` / `send-transactional-email` / `process-email-queue` / notifications.
4. No Stripe object, no `subscriptions` / `recruiter_billing_profiles` / `agency_entitlements` writes. Plan truth stays with the QA persona overlay.
5. Exclude QA identities from analytics events, leaderboard/points, referrals, recruiter contact requests, professional profile visibility (`visibility='private'`), and any matching surfaces.
6. No Telegram rows in this arc.

## 7. QA-fixture marker recommendation

Add **one centralized registry table**, e.g. `public.qa_fixture_registry(entity_table text, entity_id uuid, owner_user_id uuid, created_at, note)` with a unique key on `(entity_table, entity_id)`, super-admin-only RLS, plus a `SECURITY DEFINER` helper `is_qa_fixture(_table text, _id uuid)`. Reasons: no `is_test` columns spread across ~15 business tables, no RLS/perf changes to hot paths, and one authoritative list for both exclusion filters and a future single-transaction teardown. Discovery/public functions consult the helper only at their existing filter points.

## 8. Persona attachment

Seeded rows carry **no** plan information. The owner switches plan reality via `set_owner_qa_persona(domain, persona)`; `effective_recruiter_tier`, `get_effective_agency_limits`, and `driver_has_active_pro` already branch on it server-side. The seeded workspace supplies *content*; the persona supplies *entitlement*. The two must never be coupled.

## 9. Proposed next phases (atomic, candidate-first)

- **O6 — candidate only**: `qa_fixture_registry` migration candidate + `is_qa_fixture` helper + Postgres test suite. No live apply.
- **O7 — candidate only**: exclusion-filter patches to discovery / public agency / referral / leaderboard read paths, with tests proving a registered fixture is invisible to a non-owner.
- **O8 — production promotion**: apply O6 + O7 byte-identically; verify counts unchanged.
- **O9 — remediation**: close or unapprove the two live QA opportunities, register existing owner test rows in the registry.
- **O10 — synthetic identity provisioning**: create exactly 2 synthetic auth users, suppress their email, register them.
- **O11 — relationship seeding**: assistant delegation + carrier-driver relationship via existing RPCs only.
- **O12 — sample content seeding**: agency package/client/delegation/work item, applications, optional settlement batch.
- **O13 — teardown RPC**: single-transaction fixture removal driven by the registry.
- **Later, separate arc** — Telegram: only after O11, link the synthetic managed driver's Telegram identity through the real `/start` token flow. Nothing pre-seeded.

## 10. NOT to build

One auth login per plan; any `is_test` column on business tables; fake Stripe customers/subscriptions/entitlement rows; direct `telegram_user_links` / `telegram_chat_bindings` inserts; client-side seeding; any RLS weakening or QA bypass in security-definer authorization functions; public-facing QA agency slug or approved QA opportunities; email-deliverable synthetic addresses; seeding via raw inserts where a hardened RPC already exists.

Stop point: report only. No edits, commits, or database writes were made.
