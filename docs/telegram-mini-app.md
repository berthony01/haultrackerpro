# Recruiter Telegram Mini App, first release

Status: implemented and tested as a release candidate. Production frontend,
new Edge endpoint, poller buttons and Telegram menu are not activated by this PR.
General dispatch stays enabled. No schema migration is required.

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
| Actual Telegram WebView launch and signed production identity | Pending deployment and live acceptance |
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

Production release remains subject to the owner's publication approval.

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
