# CF-1A Repo Parity Audit (read-only findings + recommended action)

Nothing was changed. No SQL was run against production; the only database access was read-only
`SELECT`s against the migration ledger.

## Starting state

- HEAD `91a55a2ecb4af7a027838539b344135110aedab1` ("Hardened conversation table RLS"), working tree clean.
- Live ledger: highest recorded version in `supabase_migrations.schema_migrations` is
  `20260824111352` (TG-2F-B). **No `20260916050000` or `20260916050500` row exists** — the CF-1A
  live apply was manual and is unrecorded in the ledger.
- Live schema already has `conversation_threads`, `conversation_participants`,
  `conversation_messages`, `conversation_events` (1 policy each) plus the hardened grants.
- `src/integrations/supabase/types.ts` already contains the conversation tables at HEAD
  (6 `conversation_threads` occurrences) — regenerated and committed by the platform, not by hand.

## Convention found in this repository

Two distinct promotion patterns exist, and they are not interchangeable.

**1. Managed-tool apply (TG-2F-B).** Applying through the platform migration tool writes its own
file `supabase/migrations/<version>_<uuid>.sql` and records that version in the ledger. The
separately authored, identically-scoped file
`20260824110800_phase_tg2fb_...sql` was then deleted in commit `542d65db`
("Remove unrecorded TG-2F-B duplicate migration") precisely because it was an unrecorded twin of a
recorded apply. 195 of 244 files in `supabase/migrations` are this uuid form.

**2. Manual apply, then record the file (AM-1C series, and the general phase pattern).** Commits
`9b9017c1` / `002904b7` / `7ed7f6f7` / `4c85404c` ("Record AM-1C-C/D/E/FG live migration") each add
exactly one file to `supabase/migrations` whose **basename is identical to the candidate** and whose
**contents are byte-identical to the candidate** (verified: `diff` of
`20260818090000_phase_am1cfg_...sql` candidate vs migration is empty, header comment included —
even the "CANDIDATE MIGRATION — NOT APPLIED LIVE" first line is preserved verbatim). None of the
AM-1C versions appear in the ledger, and they have been retained without incident. 48 phase-named
files exist; 20+ have a same-named candidate still present.

**Candidates are never moved or deleted after promotion.** `phase1tSettlementMigrationPromotion.test.ts`
(test 1 and test 9) and `phase1rD2B1...MigrationPromotion.test.ts` both assert the candidate still
exists at its original path, and the 1R suite additionally asserts the candidate was *not* rewritten
into promotion wording. Parity is asserted on the executable body only — first exact `BEGIN;` line
through last exact `COMMIT;` line — with string plus UTF-8 byte equality, exactly one `BEGIN;`/`COMMIT;`
per file, and dependency-ordered basenames.

**Generated types.** `src/integrations/supabase/types.ts` is regenerated and committed automatically
after each applied schema change (long commit history on that path, including the current HEAD chain).
It is never hand-edited.

## Recommended CF-1A parity action

1. **Add two production migration files**, byte-identical to the candidates, at the same basenames:
   - `supabase/migrations/20260916050000_phase_cf1a_conversation_permission_vocabulary.sql`
   - `supabase/migrations/20260916050500_phase_cf1a_conversation_foundation.sql`
   This is the AM-1C "Record ... live migration" pattern and is the correct fit, because CF-1A was
   applied manually and produced no platform-generated file. The schema candidate must be copied in
   its current post-hardening state (with the four `REVOKE ALL ... FROM PUBLIC, anon, authenticated`
   statements), so the file matches live reality.
2. **Copy, do not move or rename.** Both candidate files stay exactly where they are, unchanged.
3. **Do not re-apply anything.** Neither file gets pushed through the migration tool. Re-running the
   schema file would fail on `CREATE TABLE`, and re-running it through the managed tool would create
   a second, ledger-recorded copy — the exact duplicate condition commit `542d65db` removed.
4. **Leave `src/integrations/supabase/types.ts` as committed.** It is already correct and current;
   no regeneration or edit is needed.
5. **Header wording is a judgment call.** AM-1C precedent keeps the candidate header verbatim
   (byte parity wins over accurate wording); TG-2F-B precedent rewrites the header to
   "PRODUCTION MIGRATION — promoted from the certified candidate". Recommendation: follow AM-1C and
   keep byte parity, so a promotion test can assert exact file equality.
6. **If a promotion test is wanted**, it must compare **whole files**, not `BEGIN;`…`COMMIT;` bodies:
   the CF-1A enum migration deliberately has no transaction block, so the existing body-extraction
   helper would fail on it.

## Residual risk to note

Both files would be unrecorded in the ledger (same status as the AM-1C set). That is harmless under
the platform's apply path, but any future `supabase db push` from a local CLI against this project
would attempt them and fail on the non-idempotent `CREATE TABLE`. The repository has been accepting
that tradeoff since AM-1C.

## Scope of a future build phase, if authorized

Allowlist: create the two files under `supabase/migrations/`; optionally one new promotion test file.
Prohibited: applying either migration, running production SQL, editing candidates, editing
`types.ts`, touching any other migration, deploying or publishing.
