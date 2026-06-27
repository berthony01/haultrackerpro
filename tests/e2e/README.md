# HaulTrackerPro — Driver Journey E2E Runner

Real-browser Playwright runner that drives the full driver money flow
against a **disposable QA driver account**:

`login → settings (write + persist) → load create (deterministic flat rate) → fuel create → expense create → dashboard numeric assertions → reports parity → refresh → invalid-form error handling → cleanup`

Outputs `test-results/driver-journey-report.{json,md}` on every run —
even if the test errors out early.

## Safety

- **Never run against the project owner's real account.** The runner
  hard-refuses `berthonyxyz@gmail.com`. Use a disposable QA driver.
- Every row the runner creates is tagged with `QA TEST DELETE - <runId>`
  and the `finally` block deletes them over the QA driver's RLS session.
  No service-role key is ever embedded in this repo.

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

The disposable account must be confirmed (email verification is on).
Confirm it once in the live UI; the runner reuses it forever.

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

## Verdict rules (strict)

Each step is recorded as `PASS`, `FAIL`, `PARTIAL`, or `NOT TESTED`.
Required steps: `login, settings, load_create, fuel_create,
expense_create, dashboard, reports, refresh_persistence,
error_handling, cleanup`. Optional: `export`.

- **FAIL** — any required step is FAIL, any dashboard KPI fails
  `expectClose`, any reports↔dashboard KPI disagrees, cleanup delete
  errored, or cleanup verify found marker rows remaining.
- **PARTIAL** — any required step is NOT TESTED or PARTIAL, or cleanup
  finished with non-fatal errors.
- **PASS** — every required step is PASS. `export` may be NOT TESTED.

The runner asserts `verdict === 'PASS'`. **PARTIAL fails the runner**
so CI cannot treat it as success.

## Deterministic test load

Fixed inputs the runner submits — change in lockstep with the dashboard
assertions if you tune the formula.

| Field            | Value           |
| ---------------- | --------------- |
| Pay model        | `flat_rate`     |
| Flat rate        | `$1000`         |
| Loaded miles     | `500`           |
| Deadhead miles   | `50`            |
| Deadhead pay     | unpaid (default from settings step) |
| Pickup           | `Dallas, TX`    |
| Dropoff          | `Atlanta, GA`   |
| Notes / marker   | `QA TEST DELETE - <runId>` |
| Fuel (1 log)     | 100 gal × $3.00 = `$300` |
| Expense (1 row)  | `$50`           |

Expected KPIs (within ±0.01):

- gross revenue = `1000`
- operating miles = `550`
- loaded RPM = `2.00`
- effective/operating RPM ≈ `1.82`
- total expenses = `350`
- net profit = `650`
- net RPM ≈ `1.18`

## Mobile spec

`driver-journey-mobile.spec.ts` is a **smoke test only** — auth +
dashboard render at a Pixel 7 viewport. It does NOT verify the full
driver journey at mobile width. Don't report mobile coverage as more
than smoke based on it.
