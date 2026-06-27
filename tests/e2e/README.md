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

| Var                 | Purpose                                              | Default                |
| ------------------- | ---------------------------------------------------- | ---------------------- |
| `E2E_BASE_URL`      | App origin to test against                           | `http://localhost:8080` |
| `E2E_DRIVER_EMAIL`  | Disposable QA driver email                           | _required_             |
| `E2E_DRIVER_PASSWORD` | Disposable QA driver password                      | _required_             |
| `E2E_RUN_ID`        | Unique marker appended to every test row             | `local-<timestamp>`    |
| `E2E_CLEANUP_MODE`  | `always` (default) or `never` to inspect manually    | `always`               |

The disposable account must already be confirmed (email verification is
mandatory on this project). One-time setup is by hand in the live UI;
the runner then re-uses it.

## Commands

```bash
# install browsers once
bunx playwright install chromium

# desktop journey
E2E_DRIVER_EMAIL=qa+driver@example.com \
E2E_DRIVER_PASSWORD='…' \
E2E_RUN_ID=ci-$(date +%s) \
bunx playwright test --project=desktop tests/e2e/driver-journey.spec.ts

# mobile smoke
bunx playwright test --project=mobile tests/e2e/driver-journey-mobile.spec.ts
```

Reports land at:
- `test-results/driver-journey-report.json`
- `test-results/driver-journey-report.md`
- `test-results/html/` (full Playwright HTML report)

## Verdict rules

The runner records each step as `PASS`, `FAIL`, or `NOT TESTED`. The
final verdict is:

- **FAIL** if any required create step fails or any KPI is NaN/Infinity.
- **NOT TESTED** if cleanup reported errors (rows may remain — review).
- **PASS** otherwise.

Steps the runner cannot locate by stable selector in your build are
intentionally marked `NOT TESTED` rather than failing — open the JSON
report and add the missing `data-testid` to fix.
