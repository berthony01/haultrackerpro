# Dispatcher Mini App — staged review checkpoint

## Scope and system of record

Starting clean commit: `8938880087a7e4ec3ed9527003b49dfc29fd8b05`.
Risk: HIGH (permission-scoped data access and staged command wrappers).
Authoritative loads, active carrier/driver relationships, events, command receipts,
recruiter ownership/membership and explicit permission helpers are reused.
Existing Mini App identity/link handling remains authoritative. No new tables,
roles, membership models, buckets, services or AI calls are introduced.

## Staged interface

`/telegram?view=dispatch` is gated by resolved `loads_view`; creating additionally
requires `loads_dispatch`, and status actions require `loads_update_status`.
Owner access uses the existing server-owned ownership helper, never a local role
shortcut. Suspended capability/workspace, revoked membership, missing permissions,
inactive/mismatched relationships and denied reads fail closed.

Reads return connected-driver display names and relationship IDs, not account IDs,
email, phones, private notes, billing, messages or settlements. Loads are paged at
25 (server maximum 50); roster and summary rows are paged at 50. Summaries cover
all scoped loads, not just the current load page. Active/history/status/driver
filters and a local summary date are available; refresh/focus/visibility plus
15-second refresh re-check permissions. Failed access checks clear cached rows.

Add Load is deterministic paste/manual entry followed by review and explicit
confirmation. It reuses canonical parsing/pay/mileage helpers, preserves source
and stop/appointment/requirement detail in notes, clears inherited pay evidence,
and never treats conditional penalties as earnings. Unknown agreed pay requires
entry; explicit zero remains distinct from absent pay. Multi-stop entry is not
silently converted into canonical stop rows. Notes above the canonical 5,000
character limit require correction rather than truncation.

Completed/cancelled states remain terminal under existing canonical transitions.
Delivered requires an actual local delivery date (pickup or later, not future).
Scheduled dropoff dates and financial-period fields are not rewritten. Actual
dates append versioned metadata to the existing event log. Older completed loads
without this metadata remain date-unconfirmed and are excluded from daily/weekly
confirmed-delivery counts. Week starts reuse `dispatch_week_start_day`; cancelled
and active counts/miles are separate.

## Candidate-only server contract

`supabase/migration-candidates/20261108140123_dispatcher_mini_app.sql` is UNAPPLIED.
It adds only four narrowly scoped functions: `dispatch_mini_assert_scope`,
`dispatch_mini_read`, `dispatch_mini_create`, `dispatch_mini_status`.
EXECUTE is granted to authenticated users, not anonymous/PUBLIC. Existing table
grants/RLS and canonical create/status functions remain unchanged.

Both command wrappers derive driver ownership from the exact active relationship,
re-check permissions before every attempt/replay, and reuse canonical writes and
receipts. Transaction locks serialize same recruiter/key attempts. Versioned event
metadata binds exact actor, payload, relationship and status/date intent. An
ambiguous result retains the same client intent/key; changed intent is rejected
until explicitly closed/abandoned. Server create verifies explicit pay, nonnegative
numeric inputs, the symmetric 2-mile mileage rule and canonical rounded pay.

## Telegram entry and protected boundaries

Private Dispatch buttons map to Mini App web_app buttons using the existing
private-only adapter. Group Dispatch buttons are ordinary `t.me/HaulTrackerBot?start=dispatch`
links. Exact private `/start dispatch` opens role-aware menus after existing link
token handling; group `/start dispatch` cannot launch private workspace content.
No bot menus, group settings, Telegram messages, polling invocations, deployed
functions or production records were changed. General dispatch remains ON;
legacy single-load and GENQA lanes remain OFF as in the approved baseline.

## Verification and independent acceptance

Focused deterministic/component tests and disposable PostgreSQL tests exercise
production-used helper/create/status bodies plus candidate wrappers, role-switched
calls, RLS, cross-workspace denial, active relationship ownership, permission
matrix, exact replay/conflicts, actual dates, page-independent summaries and pay.
All synthetic test scenarios roll back and the local cluster is destroyed.
These are staging checks, not production acceptance. The local projection does
not independently prove every production trigger or concurrent revocation race.

Separate authorization is required for candidate application, affected function
deployment, site publication and live authenticated owner/staff/group journeys.
Human Telegram tap testing, production persistence/readback and production
financial/export parity remain unverified. Stop at this staged checkpoint for
ChatGPT's independent diff and schema review.