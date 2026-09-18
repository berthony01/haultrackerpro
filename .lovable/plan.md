# RB-3B-B — Editable Telegram Draft Handoff (read-only audit + proposed build)

Audit only in this turn. No code, database, deployment or publish changes were made.

## A. Current-state findings (each verified by reading source this turn)

1. **Draft record** — `public.telegram_opportunity_drafts` (created by `supabase/migration-candidates/20260922050000_phase_rb3a_telegram_quick_post.sql`) already holds everything an edit handoff needs: `id`, `actor_user_id` (FK `auth.users`), `recruiter_id` (FK `recruiter_profiles`), `telegram_user_id`, `telegram_chat_id`, `state`, `raw_source_text`, `extracted_payload jsonb`, `source_update_id`, `created_opportunity_id`, `last_error_code`, `expires_at` (2h TTL). State check allows `awaiting_input | extracting | review | confirmed | cancelled | expired | failed`. RLS on, **no policies, no anon/authenticated grants** — service-role transport state only. It has **no Telegram `message_id` column**, so the posted review message cannot currently be edited in place.
2. **Uniqueness** — one live draft per `(telegram_user_id, telegram_chat_id)` while state is `awaiting_input|extracting|review`; `source_update_id` unique. A web edit that keeps the draft in `review` preserves both invariants.
3. **Telegram review** — composed in `supabase/functions/telegram-poll/index.ts` (~line 600): body text plus three single-button rows, `✅ Confirm` / `🔄 Start Over` / `✖️ Cancel`, using `composeQuickPostActionData(...)` → `q1:<c|r|x>:<draft uuid>` (`_shared/telegram-poll-ingest.ts` lines 541–566). `q1:n` starts a new draft. Callback vocabulary has room for one more letter.
4. **Recruiter routing** — the dashboard reads `window.location.search` and the `page` param in `src/pages/Index.tsx` (lines 127, 150–153, 247); `recruiter-access:manager` is an existing recognised page value. No `telegramDraft` param exists anywhere in `src/`.
5. **Authoring form** — `src/components/opportunities/RecruiterOpportunityForm.tsx` takes `initial?: Opportunity | null`, hydrates once via `normalizeOpportunityForAuthoring(initial)` behind `hydratedRef`, and exports `mergePasteIntoState(current, data)` (line 373), which is exactly the extractor-shape → authoring-state merge the Telegram payload needs. Submit calls `controller.update(initial.id, …)` when `initial?.id` exists, else create. `RecruiterOpportunityManager` (line 55) owns `view`/`editing` state and renders the form with `initial={editing}`; it currently takes only `onBack` and reads no URL parameters.
6. **Auth continuity** — `src/lib/authNavigation.ts`: `buildAuthUrl` encodes the whole path **including query string** into `?next=`, `isSafeInternalPath` accepts `/dashboard?page=…&telegramDraft=…` (no whitespace, no scheme, single leading slash), and `resolvePostAuthDestination` returns it verbatim. `getCapabilityFromNext` already maps `/dashboard?page=recruiter…` to the recruiter capability. So query preservation through sign-in already works, provided the dashboard's own guard forwards the full `location.search` when it redirects to `/auth` — that forwarding is the one thing to confirm during the build.

## B. Recommended architecture (option 5 decision)

**Web editing updates `telegram_opportunity_drafts.extracted_payload` only, and the recruiter returns to Telegram to Confirm.** No opportunity row is created or transitioned by opening or saving Edit Details.

Why:
- Keeps exactly one creation path (`create_recruiter_opportunity_as_actor` → `create_recruiter_opportunity`) and one moment of creation (the Confirm tap), so every existing billing/limit/authorization guard still fires unchanged.
- Avoids a second "draft" concept in `opportunities` and avoids orphan rows when the recruiter abandons the browser tab.
- Leaves RB-3B-C (direct Publish Live from the web) as a pure additive step: the same corrected payload, published through the same canonical creator.
- The draft stays service-role-only; the browser never touches the row directly.

**Access model:** two SECURITY DEFINER RPCs, `authenticated`-granted, `search_path = public`, that take only the draft id as an untrusted locator and re-derive everything else from `auth.uid()`:
- read is allowed only when `actor_user_id = auth.uid()`, `state = 'review'`, `expires_at > now()`, and the actor still holds opportunity-create capability in `recruiter_id` (reuse the existing recruiter capability check used by canonical creation — no new permission vocabulary).
- write applies the same gate, whitelists fields against the existing extractor field set via the existing `_telegram_quick_post_filter_payload`, and only rewrites `extracted_payload` + `updated_at`. It never changes `state`, `recruiter_id`, `actor_user_id`, `created_opportunity_id`, or `source_update_id`.

## C. Minimal allowlist for the build phase

Database (one new candidate migration, no schema change to existing columns):
- `public.get_telegram_opportunity_draft_for_edit(_draft_id uuid)` — returns filtered `extracted_payload` + a truncated source preview, nothing else.
- `public.update_telegram_opportunity_draft_payload(_draft_id uuid, _payload jsonb)` — returns the stored filtered payload.
- Optional single additive column `review_message_id bigint NULL` if stale-review refresh (option E2) is chosen.
- `GRANT EXECUTE … TO authenticated;` on both functions only. No table grants, no new policies.

Edge functions:
- `supabase/functions/telegram-poll/index.ts` — add the `✏️ Edit Details` row to the review keyboard as a **URL button** (no new callback letter needed), plus an optional "I've updated it — tap Confirm" nudge.
- `supabase/functions/_shared/telegram-poll-ingest.ts` — only if a refresh callback letter is added.

Frontend:
- `src/pages/Index.tsx` — read `telegramDraft` and pass it through to the recruiter manager; ensure the unauthenticated redirect uses `buildAuthUrl(pathname + search)`.
- `src/components/opportunities/RecruiterOpportunityManager.tsx` — accept an optional `telegramDraftId`, fetch via the read RPC, open the form pre-hydrated, and route save to the draft-save RPC instead of opportunity create.
- `src/components/opportunities/RecruiterOpportunityForm.tsx` — additive optional props only (`draftSeed` state + `onSaveDraft`), reusing `mergePasteIntoState`. No second form, no new field vocabulary.
- New focused test file `src/test/phaseRB3bBTelegramDraftHandoff.test.ts(x)`.

Explicitly untouched: billing, auth/roles, driver/agency systems, opportunity tables and their RLS, RB-3A.1 database fix, screenshot/OCR, public opportunity pages, direct Publish Live.

## D. Flow

```text
Telegram review  -> tap "✏️ Edit Details" (https URL button, draft uuid only)
  -> /dashboard?page=recruiter-access:manager&telegramDraft=<uuid>
  -> not signed in? /auth?next=<full encoded path>  (query preserved)
  -> manager calls get_telegram_opportunity_draft_for_edit(uuid)
       actor re-derived from auth.uid(); mismatch/expired/wrong-state -> "draft not available"
  -> form hydrates via mergePasteIntoState(EMPTY_AUTHORING_STATE, payload)
  -> "Save & return to Telegram" -> update_telegram_opportunity_draft_payload(uuid, payload)
       writes extracted_payload ONLY; no opportunity created; state stays 'review'
  -> user returns to Telegram and taps ✅ Confirm
  -> existing confirm path reads the CURRENT extracted_payload and creates once
```

The draft uuid in the URL is a locator, never authorization: an unauthorized or non-owning signed-in user gets a generic not-available message with no data leak.

## E. Stale review message

The review message rendered in Telegram still shows the pre-edit values, and the draft has no `message_id` today. Two options, to be chosen at build time:

- **E1 (no migration, preferred for minimality)** — after a successful save, the web page tells the user "Your changes are saved — go back to Telegram and tap Confirm", and Confirm creates from the freshly-read payload. The old review text is visibly stale but functionally harmless, because Confirm never uses the rendered text.
- **E2 (one additive column)** — store `review_message_id` when the review is posted; after a web save, the save RPC enqueues nothing, but the next poll cycle edits the review message text in place. Costs one column plus an outbox-free edit call.

E1 is recommended for RB-3B-B; E2 can follow if the staleness proves confusing in live use.

## F. Risks and required tests

- Draft id enumeration → RPC must return the same generic empty result for wrong owner, wrong state, expired, and nonexistent.
- Double creation → Confirm path is unchanged; the existing single-live-draft and `source_update_id` guards still hold since state never leaves `review`.
- Fail-safe old callbacks → after a web edit, Confirm/Start Over/Cancel must all still behave exactly as today (Start Over discards the edited payload, Cancel closes the draft); an explicit test for each.
- TTL → a save after `expires_at` must be refused, not silently extended.
- Payload whitelist → unknown fields from the browser rejected by the existing filter, not stored.
- Auth continuity → signed-out deep link round-trips through `/auth?next=` with the `telegramDraft` param intact.
- Regression suites to re-run: RB-3A, RB-3A.1, RB-3B-A, RB-2B/2C/2D, TG-2D allowlist (which will need an exact re-pin for the two new RPCs — re-pin, never loosen), plus typecheck and build.

## G. Estimated implementation size

Medium: one candidate migration with two RPCs, one keyboard row in `telegram-poll`, three small frontend touches, one new focused test file, plus the TG-2D exact-RPC re-pin. Roughly comparable to RB-3A.1 plus RB-3B-A combined; single focused build turn, with one `telegram-poll` deployment and one frontend publish required before live E2E.

STOP after audit — awaiting authorization before any build.
