

## Full cleanup — Phases A through D

I'll execute all four phases in sequence. Here's exactly what ships.

### Phase A — Quick wins (restore tab + fix unsubscribe + ref warnings)

1. **Hard reload guidance** — after deploy, you Cmd+Shift+R `/admin`. The Emails tab is already in the source; the warning about it being missing is a stale Vite chunk. No code change needed for the tab itself.
2. **Fix `PageFallback` ref warning** in `src/App.tsx` — wrap with `React.forwardRef` so React Router can pass refs without warning.
3. **Fix `SEOHead` and `Badge` ref warnings** in `src/pages/Admin.tsx` and `src/components/SEOHead.tsx` — forwardRef on `SEOHead`; `Badge` already uses forwardRef but is being passed a ref through a non-forwarding wrapper — fix the wrapper.
4. **Add `verify_jwt = false`** for `handle-email-unsubscribe` and `handle-email-suppression` in `supabase/config.toml`. Redeploy both functions so unsubscribe links work without a session.

### Phase B — Email pipeline correctness

1. **Drain the 7 pending emails** — query `email_send_log` for stuck rows, inspect `process-email-queue` logs to identify the cause (likely the cron secret refresh after recent function deploys), and either re-enqueue via `pgmq.send` or mark them `failed` with a reason so the dashboard reflects reality. If the cron job is broken, re-run setup to refresh the vault secret.
2. **Create `lifecycle-day0` template** in `supabase/functions/_shared/transactional-email-templates/lifecycle-day0.tsx` and register in `registry.ts`. Wire `Auth.tsx` signup to send `lifecycle-day0` (replacing the generic `welcome` for activation tracking) so the Day 0 column in the activation dashboard populates. Keep `welcome` template available for manual sends.
3. **Fix `Index.tsx` useEffect deps** at line ~139 — add `subscription` and `user?.id` to dep array so subscription state stays fresh on user change.

### Phase C — Admin visibility upgrades

1. **Suppression list panel** in Admin → Emails tab. Reads `suppressed_emails` (email, reason, suppressed_at). Includes a "Remove from suppression" button that deletes the row (admin-only, audited).
2. **Retry button on each email log row** — for `pending`/`failed`/`dlq` rows, button re-invokes `send-transactional-email` with the same idempotency key. Calls a new `admin-api` action `retry-email` that reads the original metadata from `email_send_log`.
3. **Lifecycle opt-out badge in Users tab** — shows a small "opted out" tag next to users where `user_settings.lifecycle_emails_opt_in = false` so you know who won't receive lifecycle emails.

### Phase D — Code hygiene

1. **Knock out the 76 ESLint errors** in batches — typed `any` → proper interfaces (mostly in `admin-api`, `Admin.tsx`, hooks), and drop useless regex escapes in `parseLoadText.ts` / `parseExpenseText.ts`. Pure cleanup, no behavior change. Skip ESLint warnings that require risky refactors (e.g. exhaustive-deps inside the AI hooks where the omission is intentional and commented).

### Files touched

**Frontend**
- `src/App.tsx` — forwardRef wrap
- `src/components/SEOHead.tsx` — forwardRef
- `src/pages/Admin.tsx` — suppression panel, retry buttons, opt-out badge, fix Badge wrapper
- `src/pages/Index.tsx` — useEffect dep fix
- `src/pages/Auth.tsx` — switch signup email to `lifecycle-day0`
- ~10 small files for ESLint cleanup

**Backend**
- `supabase/config.toml` — `verify_jwt = false` for unsubscribe + suppression
- `supabase/functions/_shared/transactional-email-templates/lifecycle-day0.tsx` (new)
- `supabase/functions/_shared/transactional-email-templates/registry.ts` — register day0
- `supabase/functions/admin-api/index.ts` — `retry-email`, `remove-suppression` actions; update activation analytics to read `lifecycle-day0`
- `supabase/functions/send-lifecycle-emails/index.ts` — minor: include day0 metric tracking

**Functions redeployed**: `admin-api`, `handle-email-unsubscribe`, `handle-email-suppression`, `send-lifecycle-emails`

**No new tables, no migrations.** All data layer changes are runtime (drain pending queue) or use existing tables.

### Order of execution

A → B → C → D, with a verification step between each. After Phase A I'll confirm the unsubscribe link works and the console is clean. After B I'll confirm `email_send_log` has zero rows stuck in `pending`. After C I'll confirm the new admin controls render. D is pure cleanup so no functional verification needed.

