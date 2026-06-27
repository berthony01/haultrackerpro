# HaulTrackerPro — Driver Journey E2E Runner

Reusable Playwright runner that drives a real browser through the full
driver money flow (login → settings → load → fuel → expense → dashboard
→ reports → refresh → invalid-form → cleanup) against a **disposable QA
driver account**. Outputs a PASS/FAIL report under `test-results/`.

## Why a disposable account

The runner creates real database rows. Running it against the owner's
production driver account would pollute live financial data. Every row
the runner creates is tagged with `QA TEST DELETE - <runId>` and the
`afterAll` hook deletes those rows over the QA driver's own RLS session
— no service-role key is ever added to the app codebase.

## Required env vars

| Var                     | Purpose                                              | Default                  |
| ----------------------- | ---------------------------------------------------- | ------------------------ |
| `E2E_BASE_URL`          | App origin to test against                           | `http://localhost:8080`  |
| `E2E_DRIVER_EMAIL`      | Disposable QA driver email                           | _required_               |
| `E2E_DRIVER_PASSWORD`   | Disposable QA driver password                        | _required_               |
| `E2E_SUPABASE_URL`      | Supabase project URL used by cleanup                 | _required for cleanup_   |
| `E2E_SUPABASE_ANON_KEY` | Supabase anon key used by cleanup                    | _required for cleanup_   |
| `E2E_RUN_ID`            | Unique marker appended to every test row             | `local-<timestamp>`      |
| `E2E_CLEANUP_MODE`      | `always` (default) or `never` to inspect manually    | `always`                 |

If `E2E_SUPABASE_URL` / `E2E_SUPABASE_ANON_KEY` are absent, cleanup falls
back to `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` only when
they are exported into the test process. If neither is available cleanup
fails clearly and the final verdict is downgraded.

The disposable account must already be confirmed (email verification is
mandatory on this project). One-time setup is by hand in the live UI; the
runner then re-uses it.

## Commands

```bash
bunx playwright install chromium

E2E_DRIVER_EMAIL=qa+driver@example.com \
E2E_DRIVER_PASSWORD='…' \
E2E_SUPABASE_URL=https://<project>.supabase.co \
E2E_SUPABASE_ANON_KEY='…' \
E2E_RUN_ID=ci-$(date +%s) \
bunx playwright test --project=desktop tests/e2e/driver-journey.spec.ts
```

Reports land at `test-results/driver-journey-report.{json,md}` plus the
full Playwright HTML report under `test-results/html/`.

## Verdict rules (strict)

The runner records each step as `PASS`, `FAIL`, `PARTIAL`, or `NOT TESTED`.
Required steps: login, settings, load_create, fuel_create, expense_create,
dashboard, reports, refresh_persistence, error_handling, cleanup.
Optional: export.

- **FAIL** — any required step is FAIL, any dashboard KPI fails the
  `expectClose` assertion, any reports↔dashboard KPI disagrees, cleanup
  deletes errored, or cleanup verification finds marker rows still present.
- **PARTIAL** — any required step is NOT TESTED, or cleanup completed with
  non-fatal errors.
- **PASS** — every required step passed. `export` may be NOT TESTED.

