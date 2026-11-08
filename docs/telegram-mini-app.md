# Recruiter Telegram Mini App, first release

Owner acceptance checkpoint: the frontend, new Edge endpoint and owner-only
Telegram menu are active. The default menu and new poller buttons remain staged
until final release verification. General dispatch stays enabled. No schema
migration is required. Final deployment readbacks belong in the PR release ledger.

## User experience

| Entry | Proposed behavior |
| --- | --- |
| Private bot Post Opportunity | Open `/telegram?view=post`, using the shared opportunity form |
| Private bot My Opportunities | Open saved website drafts and listings inside Telegram |
| Private bot Conversations | Open the shared recruiter inbox inside Telegram |
| Private bot Create account / Sign in | Open Mini App account access |
| Mini App Applications | Open the shared owner or staff applicant dashboard |
| Mini App Account | Owner company onboarding/profile, or staff membership information |
| Results | Existing full website destination |
| Dispatch workspace and group review | Existing website and bot workflow |
| Existing chat draft Save/Edit/Cancel/Refresh | Existing callbacks and website edit handoff |
| Typed `/post` | Existing chat draft workflow |

The Mini App offers email/password sign-in and recruiter account creation through
the existing AuthProvider. Email confirmation is still required. Users return to
Telegram after confirming their email. Invited staff sign in with their invited
account. A shared website button remains available.

Google sign-in and password recovery use the existing website. No cross-browser
session transfer or Telegram-only passwordless sign-in is claimed. Website and
Telegram share account records, not necessarily their browser session storage.

Opening the Mini App never calls the bot's new-draft callback. An unfinished chat
draft is preserved. New drafts use the existing opportunity records and appear
in both the Mini App and website.

## Identity and access

1. Normal Supabase authentication establishes the HaulTracker user.
2. The browser posts its signed Telegram `initData` and explicit current JWT to
   `telegram-mini-app`. Neither identity can be supplied separately in the body.
3. The endpoint verifies Telegram's Ed25519 signature against the production
   public key and the verified HaulTrackerBot ID, `8810994124`.
4. The endpoint uses `auth.getUser()` to verify a confirmed, nonanonymous account.
5. Both directions of the existing active Telegram account link must match.
   Conflicting links are never reassigned. New connections require an explicit
   user action and launch proof no older than five minutes.
6. The canonical user-context token issuer and service-only consumer establish
   a new link. A final read verifies the same pair. No new session or role is minted.
7. Shared capability, staff and acting-context checks select the permitted UI.
   Existing RLS, business RPCs, posting readiness, plan limits and field validation
   remain authoritative for every business operation.

Signed proof is accepted for existing work sessions for up to 24 hours, with a
30-second connection recheck and checks on focus/Telegram activation. Explicit
unlink, conflicting identity, invalid proof or account change removes the
workspace. A transient connection failure hides and preserves the open workspace
so reconnecting does not erase typed form details. Requests time out after 15 seconds.

The route does not mount owner business hooks for staff. View/create, publish,
application and conversation actions use their existing independent permissions.
Staff view-only conversations cannot reply. A driver or delegated driver-assistant
context does not acquire recruiter authority by opening a Mini App URL.

No bot token is needed by the new endpoint. The service key stays server-side.
Request bodies are bounded; responses omit tokens, Telegram IDs, account mappings
and database details. `initData` is not put in new application storage, analytics
or query-cache keys. The Telegram SDK manages its own launch state.
Application Google Analytics initialization and events are suppressed on Mini App
routes and their auth continuation. Existing font requests are not analytics.

Live hosting inspection found additional injected analytics scripts, including
`/~flock.js`, whose page-hit payload includes the full URL. Production builds now
install a route-scoped script Content Security Policy before other scripts run.
Telegram launch pages allow bundled app assets, the official Telegram SDK and
content hashes of reviewed inline bootstraps. Hosting analytics cannot execute
on those pages. Ordinary website pages retain their existing analytics behavior.

## Validation evidence

| Check | Candidate result |
| --- | --- |
| Original release regression suite | PASS, 1,412 tests, including 76 new Mini App tests |
| Hosting privacy follow-up | PASS, 10 policy tests and isolated browser checks with injected trackers |
| Real Ed25519 signature, wrong bot, tampering, age and malformed identities | PASS with synthetic signing keys |
| Deployed Edge adapter, user JWT vs service RPC context | PASS with synthetic Supabase transports |
| Owner/staff gates, revoked permissions, suspended/acting contexts | PASS in component tests |
| Canonical opportunity entry, readiness, website entry and staff form | PASS |
| Unlink/account switch and transient form recovery | PASS |
| Production frontend build and app/node typechecks | PASS |
| New production screen lint | PASS |
| Browser home, form, draft save, populated applicants and conversation reply | PASS at 320, 375 and 1,280 px |
| Sign-in, registration and unlinked screens | PASS at 320 px |
| Real PostgreSQL canonical linking, replay/conflict denial and own revoke | PASS in separate hosted QA transaction, fully rolled back |
| Production linker permissions and signatures | Read-only verified, backend-only consumer |
| Actual Telegram Web launch and signed production owner identity | PASS, existing owner link and normal account sign-in |
| Live shared draft create, reopen and website handoff | PASS, one unpublished QA opportunity; all prior opportunities/drafts unchanged |
| Live applicants, inbox and company profile | PASS read-only; four applicants and existing closed QA conversation loaded |
| Live close/reopen and keyboard Tab focus | PASS, session restored without sign-in; focus moved to the next field |
| Live Telegram Web layouts | PASS at 320/375 px, no document horizontal overflow; desktop iframe also exercised |
| Actual email confirmation, Google continuation and device keyboard/safe areas | Pending real-client checks |

The isolated browser uses local production-build assets and synthetic API/SDK
responses. Its draft and message mutations never reach production. It exercises
the shared UI and canonical RPC transport, not production business authorization.
Cryptographic and real PostgreSQL tests are separate evidence.

The hosted QA clone has older broad function grants. The SQL test temporarily
mirrors the independently verified production grants inside BEGIN/ROLLBACK.
Post-test readback confirmed zero synthetic users/links and restored QA grants.
Production function hashes were read only:

| Function | Production definition MD5 |
| --- | --- |
| `issue_telegram_link_token()` | `13e24ee675d1ed6ee6cd1122731eee2e` |
| `consume_telegram_link_token(text,bigint)` | `6b565c953d642cc011ca5f16806dc892` |
| `revoke_my_telegram_link()` | `ef1fc082ef10edd9319e765a7233c3df` |

The broad regression command excludes the unrelated LocalPostgres harness, which
cannot start `initdb` under this executor's restricted `setgroups`. That harness
is not a passing check. Hosted PostgreSQL supplies the linking evidence above.
The Vite build retains its existing large-chunk warning.

## Release order and acceptance

The owner approved publication and owner-only acceptance. The live owner checks
are complete; the release ledger records the final CI and rollout decision.

1. Confirm the exact branch head passes the new GitHub verification workflow.
   Merge only that reviewed tree. Deploy `telegram-mini-app` with its checked-in
   config and existing Supabase environment variables, then publish that frontend.
   Do not switch bot entry buttons before the frontend and endpoint are available.
2. Initially configure a per-chat `web_app` menu button for the existing owner QA
   account, URL `https://haultrackerpro.com/telegram?view=home`. The production bot
   ID and username were verified with `getMe`; its current default menu is commands.
   Inline and menu-button Mini Apps do not require a BotFather Main Mini App.
3. In the real Telegram client verify signed identity, existing owner login/link,
   email sign-in errors, account creation/confirmation where a synthetic account
   is available, reopening, keyboard, safe areas and website fallback. Exercise one
   clearly labeled QA draft under the existing account and data-change approvals.
   Publishing a QA listing must retain the existing QA isolation rules.
4. After live acceptance, deploy the changed `telegram-poll` entry buttons and
   help copy, then set the default Mini App menu. Existing messages may retain old
   buttons, so obtain a fresh `/menu`. Recheck the existing QA dispatch group.
5. Record exact frontend and backend deployment evidence in the release ledger.
   Do not infer a deployed version from the branch or test result alone.

Rollback: restore the previous poller and command menu, and revert the frontend
release if necessary. No database rollback/migration or account-link reset is
needed. Existing drafts, group bindings and dispatch flags are not replaced.

Later scope: dispatcher Mini App, guided group selection, notification-to-thread
Mini App links, richer Results screens and BotFather profile launch configuration.
No new AI activation, billing checkout, driver or driver-assistant bot tools are
part of this first release.

## Owner acceptance evidence and limits

The live acceptance used production frontend `393c3258a33b148b8d56d1f2a8a485a91988353c`
inside Telegram Web in connected Chrome. The existing owner account and canonical
Telegram link were verified without relinking or changing roles.

The only business write was one opportunity, `HTP-QA-MINIAPP-01 - DO NOT PUBLISH`
(`de9126ee-d953-4f19-8314-b9ba51159ba5`), saved as `draft` with null `published_at`.
Its title, company, Dallas/TX coverage, W-2/Solo arrangement, Regional/Dry Van
selection, home-time note, $1,500 flat weekly test value and QA-only description
survived reopening. The website displayed the same record as Draft, not visible.
The transparency confirmation was left unchecked, and Publish was disabled on
the authoring review screen. The draft is retained for owner review.

All nine pre-existing opportunity records retained fingerprint
`c42c75ea22783f9ea02798a680f3e872`; all six legacy bot drafts retained fingerprint
`aa8016f82a27df3e8a7f1b8eb01cd48d`. No applicant status, contract, referral, account
profile, staff permission or group binding was changed. No new message was sent;
the existing closed QA thread displayed its prior message in each direction and
offered no reply composer.

One temporary connection-verification warning was observed. The following
automatic verification restored the open form without a reset. Its root cause
was not established, and this is not evidence of a platform-wide outage.

Live staff/driver-denial identities, new-account email confirmation, Google
continuation and physical phone keyboard/safe-area behavior were not exercised.
Existing automated tests cover role boundaries; responsive Chrome layouts do
not establish native-device keyboard behavior.

The pre-existing broad-suite failures were investigated before the default-menu
rollout: missing Router/QueryClient providers, an empty-load onboarding fixture
incorrectly expecting Dashboard, an overbroad copy/source guard and a mileage
assertion predating the canonical stored-total sanity rule. One existing Reports
navigation race was also reproduced: leaving Reports could reapply its stale
query hint. Explicit page navigation now removes that hint through Router in the
same event, preserving other query parameters, the fragment and location state.
Final test counts and the production release SHA are recorded in the PR ledger.

### Broader verification repair

The initial local inventory found 28 failures in 7,951 assertions. After triage,
the complete local rerun, excluding the unavailable LocalPostgres harness,
passed all 7,951 assertions across 278 files, with zero failed or skipped
assertions. The hosted workflow must exercise the PostgreSQL harness before
the release is approved. Application and Node typechecks, Mini App lint and the
production build also passed locally. The build retains its chunk-size warning.

The remaining source guards now follow the actual integrations: professional
summaries in AgencyTeamPanel, permission-aware package controls, the settlement
page allowlist, and server-derived application contact snapshots behind explicit
per-submission consent. SQL lookup includes the function-name boundary and
accepts exported DEFAULT casts without matching another function. Contact PII,
caller authority and canonical eligibility assertions remain enabled. The
optional experience extraction check follows RB-3B-A's no-fabricated-zero
contract and retains the canonical negative-value rejection check. Product AI,
billing, permissions, SQL and extraction behavior were not changed.

Historical change envelopes audit their verified phase endpoints rather than
all subsequent releases: AM-1A ends at `2af28b50d875a24c44d4521530e290874ee48b7c`,
RC-1H at `8a5768f7728f353fd6bf88677b62795902916bd2`, and the RC-1I correction
compares `31e6806e959528bbc9fe25aaf8bb0bc30a198749` with
`b0b98a7a01d288c4e0137039bda8f2b4ef0c2e0a`. The unavailable old RC-1I baseline
was replaced with that verifiable correction range. No historical or security
assertions were disabled, and missing git evidence now fails these audits.

The final hosted gate outcomes and production frontend/poller/menu readbacks
are maintained in the [release ledger](https://github.com/berthony01/haultrackerpro/pull/52).
Local checks alone do not establish deployment or complete platform readiness.
