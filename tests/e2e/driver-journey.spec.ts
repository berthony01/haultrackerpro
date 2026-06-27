/**
 * HaulTrackerPro — Driver Journey E2E Runner (single sequential test).
 *
 * Strict rules:
 *   - one browser context, one logged-in session, sequential steps
 *   - Settings step ACTUALLY saves + persists + checks defaults applied
 *   - Load create is deterministic (Flat Rate / 1000 / 500 / 50 / unpaid)
 *   - Fuel + Expense create must be verified (toast OR row OR numeric impact)
 *   - Error handling requires validation message OR dialog-stays-open AND
 *     no new marker row
 *   - Verdict must be PASS to pass; PARTIAL/FAIL both fail the runner
 *   - Report ALWAYS written (try/finally), even on early failure
 *   - Never run against owner's real account — caller supplies disposable creds
 */
import { test, expect, type Page } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { cleanupRun, type CleanupResult } from './cleanup';

const RUN_ID = process.env.E2E_RUN_ID ?? `local-${Date.now()}`;
const MARKER = `QA TEST DELETE - ${RUN_ID}`;
const INVALID_MARKER = `QA TEST DELETE - INVALID - ${RUN_ID}`;
const EMAIL = process.env.E2E_DRIVER_EMAIL;
const PASSWORD = process.env.E2E_DRIVER_PASSWORD;
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8080';

// Hard guard: refuse to run against the project owner's known account.
const OWNER_EMAIL_DENYLIST = ['berthonyxyz@gmail.com'];

type StepStatus = 'PASS' | 'FAIL' | 'PARTIAL' | 'NOT TESTED';
const REQUIRED_STEPS = [
  'login', 'settings',
  'load_create', 'fuel_create', 'expense_create',
  'dashboard', 'reports',
  'refresh_persistence', 'error_handling',
  'cleanup',
] as const;
const OPTIONAL_STEPS = ['export'] as const;

const results: Record<string, { status: StepStatus; detail?: string }> = {};
const consoleErrors: string[] = [];
const pageErrors: string[] = [];
const dashboardNumbers: Record<string, { expected: number; actual: number | null; tol: number }> = {};
const reportNumbers: Record<string, { dashboard: number | null; reports: number | null; tol: number }> = {};

function record(step: string, status: StepStatus, detail?: string) {
  results[step] = { status, detail };
}

function expectClose(actual: number | null, expected: number, tol = 0.01): boolean {
  return actual != null && Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
}

async function readKpi(page: Page, testid: string): Promise<number | null> {
  const el = page.getByTestId(testid).first();
  if ((await el.count()) === 0) return null;
  const v = await el.getAttribute('data-value');
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function writeReport(verdict: StepStatus, cleanup: CleanupResult | null) {
  const redactedAccount = EMAIL
    ? `${EMAIL.split('@')[0].slice(0, 2)}***@${EMAIL.split('@')[1] ?? ''}`
    : null;
  const report = {
    runId: RUN_ID,
    timestamp: new Date().toISOString(),
    baseUrl: BASE,
    account: redactedAccount,
    browser: 'chromium',
    steps: results,
    dashboardNumbers,
    reportNumbers,
    cleanup,
    consoleErrors,
    pageErrors,
    verdict,
  };
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/driver-journey-report.json', JSON.stringify(report, null, 2));
  const md = [
    `# Driver Journey E2E Report`,
    ``,
    `- Run ID: \`${RUN_ID}\``,
    `- When: ${report.timestamp}`,
    `- Base URL: ${BASE}`,
    `- Account: ${redactedAccount ?? '(not set)'}`,
    `- Browser: chromium`,
    `- **Verdict: ${verdict}**`,
    ``,
    `## Required steps`,
    ...REQUIRED_STEPS.map((k) => {
      const r = results[k];
      return `- ${k}: **${r?.status ?? 'NOT TESTED'}**${r?.detail ? ` — ${r.detail}` : ''}`;
    }),
    ``,
    `## Optional steps`,
    ...OPTIONAL_STEPS.map((k) => {
      const r = results[k];
      return `- ${k}: **${r?.status ?? 'NOT TESTED'}**${r?.detail ? ` — ${r.detail}` : ''}`;
    }),
    ``,
    `## Dashboard expected vs actual`,
    ...Object.entries(dashboardNumbers).map(
      ([k, v]) => `- ${k}: expected \`${v.expected}\` / actual \`${v.actual}\` (tol ±${v.tol})`,
    ),
    ``,
    `## Reports parity (dashboard ↔ reports)`,
    ...Object.entries(reportNumbers).map(
      ([k, v]) => `- ${k}: dashboard \`${v.dashboard}\` vs reports \`${v.reports}\``,
    ),
    ``,
    `## Cleanup`,
    cleanup
      ? [
          `- loads deleted: ${cleanup.loads}`,
          `- fuel deleted: ${cleanup.fuel}`,
          `- expenses deleted: ${cleanup.expenses}`,
          `- remaining: loads=${cleanup.remaining.loads}, fuel=${cleanup.remaining.fuel}, expenses=${cleanup.remaining.expenses}`,
          `- errors: ${cleanup.errors.length ? cleanup.errors.join('; ') : 'none'}`,
        ].join('\n')
      : '- cleanup not attempted',
    ``,
    `## Browser diagnostics`,
    `- console errors: ${consoleErrors.length}`,
    `- page errors: ${pageErrors.length}`,
  ].join('\n');
  writeFileSync('test-results/driver-journey-report.md', md);
}

function computeVerdict(): StepStatus {
  const statuses = REQUIRED_STEPS.map((s) => results[s]?.status ?? 'NOT TESTED');
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('PARTIAL') || statuses.includes('NOT TESTED')) return 'PARTIAL';
  return 'PASS';
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => { mkdirSync('test-results', { recursive: true }); });

test('driver journey — full sequential flow', async ({ page }) => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_DRIVER_EMAIL / E2E_DRIVER_PASSWORD not set');
  // Safety: never run against the owner account.
  if (EMAIL && OWNER_EMAIL_DENYLIST.includes(EMAIL.toLowerCase())) {
    throw new Error(`Refusing to run E2E against owner account ${EMAIL}. Use a disposable QA driver.`);
  }
  test.setTimeout(240_000);

  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => { pageErrors.push(e.message); });

  // Pre-mark required steps NOT TESTED so the report is always honest.
  for (const s of REQUIRED_STEPS) record(s, 'NOT TESTED');
  record('export', 'NOT TESTED', 'export not automated (optional)');

  let cleanup: CleanupResult | null = null;

  try {
    // --- 1. LOGIN ---------------------------------------------------------
    try {
      await page.goto(`${BASE}/auth`);
      await page.getByLabel(/email/i).first().fill(EMAIL!);
      await page.getByLabel(/password/i).first().fill(PASSWORD!);
      await page.getByRole('button', { name: /sign in|log in/i }).first().click();
      await page.waitForURL(/\/(dashboard|app|$)/, { timeout: 30_000 }).catch(() => {});
      await expect(page.getByText(/dashboard/i).first()).toBeVisible({ timeout: 20_000 });
      record('login', 'PASS');
    } catch (e) {
      record('login', 'FAIL', String(e));
      throw e;
    }

    // --- 2. SETTINGS write + persistence ---------------------------------
    try {
      const link = page.getByRole('link', { name: /settings/i }).first();
      if ((await link.count()) === 0) {
        record('settings', 'PARTIAL', 'settings nav not found');
      } else {
        await link.click();
        await page.waitForLoadState('networkidle');

        // Expand "Pay & Calculation Defaults" accordion if collapsed.
        const payAcc = page.getByRole('button', { name: /pay.*calculation|pay.*defaults/i }).first();
        if ((await payAcc.count()) > 0) {
          const expanded = await payAcc.getAttribute('aria-expanded');
          if (expanded !== 'true') await payAcc.click();
        }

        const weekTrigger = page.getByTestId('settings-week-start');
        const payModelTrigger = page.getByTestId('settings-default-pay-model');
        const dhStatusTrigger = page.getByTestId('settings-default-dh-pay-status');
        const saveBtn = page.getByTestId('settings-save-pay-defaults');

        const reachable =
          (await weekTrigger.count()) > 0 &&
          (await payModelTrigger.count()) > 0 &&
          (await dhStatusTrigger.count()) > 0 &&
          (await saveBtn.count()) > 0;

        if (!reachable) {
          record('settings', 'PARTIAL', 'settings testids not present; cannot deterministically save');
        } else {
          // Force known values
          await weekTrigger.click();
          await page.getByTestId('settings-week-start-monday').click();
          await payModelTrigger.click();
          await page.getByTestId('settings-pay-model-option-flat_rate').click();
          await dhStatusTrigger.click();
          await page.getByTestId('settings-dh-status-unpaid').click();
          await saveBtn.click();
          // Toast or button settle
          await page.waitForTimeout(800);

          // Reload and assert persistence
          await page.reload();
          await page.waitForLoadState('networkidle');
          if ((await payAcc.count()) > 0) {
            const expanded2 = await payAcc.getAttribute('aria-expanded');
            if (expanded2 !== 'true') await payAcc.click();
          }
          const weekVal = await page.getByTestId('settings-week-start').first().textContent();
          const payVal = await page.getByTestId('settings-default-pay-model').first().textContent();
          const dhVal = await page.getByTestId('settings-default-dh-pay-status').first().textContent();
          const persisted =
            /monday/i.test(weekVal ?? '') &&
            /flat/i.test(payVal ?? '') &&
            /unpaid|no\b/i.test(dhVal ?? '');
          if (persisted) record('settings', 'PASS', 'week=monday, pay=flat_rate, dh=unpaid persisted');
          else record('settings', 'FAIL', `settings did not persist (week=${weekVal}, pay=${payVal}, dh=${dhVal})`);
        }
      }
    } catch (e) { record('settings', 'FAIL', String(e)); }

    // --- 3. LOAD create (deterministic Flat Rate) ------------------------
    try {
      const loadsTab = page.getByRole('link', { name: /^loads$/i }).first();
      if ((await loadsTab.count()) === 0) {
        record('load_create', 'FAIL', 'loads nav not found');
      } else {
        await loadsTab.click();
        await page.waitForLoadState('networkidle');
        const addLoad = page.getByRole('button', { name: /add load|new load|\+ load|log load/i }).first();
        if ((await addLoad.count()) === 0) {
          record('load_create', 'FAIL', 'add-load button not found');
        } else {
          await addLoad.click();
          // Force pay model = flat_rate
          const payTrigger = page.locator('#pay_model');
          await expect(payTrigger).toBeVisible({ timeout: 10_000 });
          await payTrigger.click();
          await page.getByTestId('pay-model-option-flat_rate').click();

          await page.locator('#pickup_location').fill('Dallas, TX');
          await page.locator('#dropoff_location').fill('Atlanta, GA');
          await page.locator('#load_date').click().catch(() => {});
          // DateInput is a popover; fall back to keyboard escape then native typing not possible.
          // Instead, set today via the calendar's "today" button if exposed; else accept default.
          await page.keyboard.press('Escape').catch(() => {});
          await page.locator('#loaded_miles').fill('500');
          await page.locator('#deadhead_miles').fill('50');
          await page.locator('#flat_rate_amount').fill('1000');
          await page.locator('#notes').fill(MARKER);

          await page.getByTestId('load-form-submit').click();

          // Deterministic row check: a list card with our marker on data-marker.
          const row = page.locator(`[data-testid="load-row"][data-marker*="${MARKER}"]`).first();
          const appeared = await row.waitFor({ state: 'visible', timeout: 15_000 })
            .then(() => true).catch(() => false);
          if (appeared) record('load_create', 'PASS');
          else record('load_create', 'FAIL', 'load saved but no load-row with marker found');
        }
      }
    } catch (e) { record('load_create', 'FAIL', String(e)); }

    // --- 4. FUEL create --------------------------------------------------
    try {
      const fuelTab = page.getByRole('link', { name: /^fuel$/i }).first();
      if ((await fuelTab.count()) === 0) {
        record('fuel_create', 'FAIL', 'fuel nav not found');
      } else {
        await fuelTab.click();
        await page.waitForLoadState('networkidle');
        const addFuel = page.getByRole('button', { name: /add fuel|log fuel|\+ fuel/i }).first();
        if ((await addFuel.count()) === 0) {
          record('fuel_create', 'FAIL', 'add-fuel button not found');
        } else {
          await addFuel.click();
          await page.getByTestId('fuel-gallons').fill('100');
          await page.getByTestId('fuel-price-per-gallon').fill('3.00');
          await page.getByTestId('fuel-notes').fill(MARKER);
          await page.getByTestId('fuel-form-submit').click();

          const row = page.locator(`[data-testid="fuel-row"][data-marker*="${MARKER}"]`).first();
          const appeared = await row.waitFor({ state: 'visible', timeout: 15_000 })
            .then(() => true).catch(() => false);
          if (appeared) record('fuel_create', 'PASS', 'fuel row visible with marker');
          else record('fuel_create', 'FAIL', 'no fuel-row with marker found after save');
        }
      }
    } catch (e) { record('fuel_create', 'FAIL', String(e)); }

    // --- 5. EXPENSE create -----------------------------------------------
    try {
      const expTab = page.getByRole('link', { name: /^expenses$/i }).first();
      if ((await expTab.count()) === 0) {
        record('expense_create', 'FAIL', 'expenses nav not found');
      } else {
        await expTab.click();
        await page.waitForLoadState('networkidle');
        const addExp = page.getByRole('button', { name: /add expense|new expense|\+ expense/i }).first();
        if ((await addExp.count()) === 0) {
          record('expense_create', 'FAIL', 'add-expense button not found');
        } else {
          await addExp.click();
          // Deterministically pick a category (Maintenance) — auto-categorization may not fire.
          await page.getByTestId('expense-category-trigger').click();
          await page.getByTestId('expense-category-option-maintenance').click();
          await page.locator('#amount').fill('50');
          await page.locator('#expense_notes').fill(MARKER);
          await page.getByTestId('expense-form-submit').click();

          const row = page.locator(`[data-testid="expense-row"][data-marker*="${MARKER}"]`).first();
          const appeared = await row.waitFor({ state: 'visible', timeout: 15_000 })
            .then(() => true).catch(() => false);
          if (appeared) record('expense_create', 'PASS', 'expense row visible with marker');
          else record('expense_create', 'FAIL', 'no expense-row with marker found after save');
        }
      }
    } catch (e) { record('expense_create', 'FAIL', String(e)); }

    // --- 6. DASHBOARD numeric verification -------------------------------
    let dashGr: number | null = null, dashExp: number | null = null, dashNp: number | null = null,
        dashRpm: number | null = null, dashOpMiles: number | null = null;
    try {
      const dash = page.getByRole('link', { name: /dashboard/i }).first();
      if ((await dash.count()) === 0) {
        record('dashboard', 'FAIL', 'dashboard nav not found');
      } else {
        await dash.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(800);

        dashGr = await readKpi(page, 'dashboard-gross-revenue-v') ?? await readKpi(page, 'dashboard-gross-revenue');
        dashNp = await readKpi(page, 'dashboard-net-profit-v') ?? await readKpi(page, 'dashboard-net-profit');
        dashRpm = await readKpi(page, 'dashboard-net-rpm-v') ?? await readKpi(page, 'dashboard-net-rpm');
        dashExp = await readKpi(page, 'dashboard-total-expenses');
        const loadedMiles = await readKpi(page, 'dashboard-loaded-miles');
        dashOpMiles = await readKpi(page, 'dashboard-operating-miles');
        const loadedRpm = await readKpi(page, 'dashboard-loaded-rpm');
        const effectiveRpm = await readKpi(page, 'dashboard-effective-rpm');

        dashboardNumbers['gross_revenue']  = { expected: 1000,  actual: dashGr,        tol: 0.01 };
        dashboardNumbers['loaded_miles']   = { expected: 500,   actual: loadedMiles,   tol: 0.01 };
        dashboardNumbers['operating_miles']= { expected: 550,   actual: dashOpMiles,   tol: 0.01 };
        dashboardNumbers['loaded_rpm']     = { expected: 2.00,  actual: loadedRpm,     tol: 0.01 };
        dashboardNumbers['effective_rpm']  = { expected: 1.82,  actual: effectiveRpm,  tol: 0.01 };
        dashboardNumbers['total_expenses'] = { expected: 350,   actual: dashExp,       tol: 0.01 };
        dashboardNumbers['net_profit']     = { expected: 650,   actual: dashNp,        tol: 0.01 };
        dashboardNumbers['net_rpm']        = { expected: 1.18,  actual: dashRpm,       tol: 0.01 };

        const failed = Object.entries(dashboardNumbers).filter(
          ([, v]) => !expectClose(v.actual, v.expected, v.tol),
        );
        if (failed.length === 0) record('dashboard', 'PASS');
        else record('dashboard', 'FAIL',
          failed.map(([k, v]) => `${k}: expected ${v.expected}, got ${v.actual}`).join('; '));
      }
    } catch (e) { record('dashboard', 'FAIL', String(e)); }

    // --- 7. REPORTS parity ------------------------------------------------
    try {
      const reports = page.getByRole('link', { name: /reports/i }).first();
      if ((await reports.count()) === 0) {
        record('reports', 'FAIL', 'reports nav not found');
      } else {
        await reports.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(800);

        const rGr = await readKpi(page, 'reports-gross-revenue');
        const rExp = await readKpi(page, 'reports-total-expenses');
        const rNp = await readKpi(page, 'reports-net-profit');
        const rRpm = await readKpi(page, 'reports-net-rpm');
        const rOp = await readKpi(page, 'reports-operating-miles');

        reportNumbers['gross_revenue']  = { dashboard: dashGr,     reports: rGr,  tol: 0.01 };
        reportNumbers['total_expenses'] = { dashboard: dashExp,    reports: rExp, tol: 0.01 };
        reportNumbers['net_profit']     = { dashboard: dashNp,     reports: rNp,  tol: 0.01 };
        reportNumbers['net_rpm']        = { dashboard: dashRpm,    reports: rRpm, tol: 0.01 };
        reportNumbers['operating_miles']= { dashboard: dashOpMiles, reports: rOp, tol: 0.01 };

        const mismatches = Object.entries(reportNumbers).filter(
          ([, v]) => v.dashboard == null || v.reports == null ||
                     !expectClose(v.reports, v.dashboard as number, v.tol),
        );
        if (mismatches.length === 0) record('reports', 'PASS', 'all dashboard↔reports KPIs match');
        else record('reports', 'FAIL',
          mismatches.map(([k, v]) => `${k}: dash=${v.dashboard} vs reports=${v.reports}`).join('; '));
      }
    } catch (e) { record('reports', 'FAIL', String(e)); }

    // --- 8. REFRESH persistence ------------------------------------------
    try {
      await page.reload();
      await page.waitForLoadState('networkidle');
      const stillIn = await page.getByRole('link', { name: /dashboard|loads|settings/i }).first().count();
      record('refresh_persistence', stillIn > 0 ? 'PASS' : 'FAIL',
        stillIn > 0 ? 'session survived reload' : 'logged out after reload');
    } catch (e) { record('refresh_persistence', 'FAIL', String(e)); }

    // --- 9. ERROR handling (invalid load submit) --------------------------
    try {
      const loadsTab = page.getByRole('link', { name: /^loads$/i }).first();
      if ((await loadsTab.count()) === 0) {
        record('error_handling', 'FAIL', 'loads nav not found');
      } else {
        await loadsTab.click();
        await page.waitForLoadState('networkidle');
        const addLoad = page.getByRole('button', { name: /add load|new load|\+ load|log load/i }).first();
        if ((await addLoad.count()) === 0) {
          record('error_handling', 'FAIL', 'add-load button not found');
        } else {
          await addLoad.click();
          // Leave required fields blank; tag with invalid marker to detect leak.
          await page.locator('#notes').fill(INVALID_MARKER);
          await page.getByTestId('load-form-submit').click();
          await page.waitForTimeout(800);

          // Dialog/form should still be open (submit blocked by HTML5/required)
          const stillOpen = (await page.getByTestId('load-form-submit').count()) > 0;
          // No row with INVALID_MARKER should exist in the list
          const invalidVisible = await page
            .getByText(new RegExp(INVALID_MARKER.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')))
            .count();
          // Close the dialog so subsequent steps work
          await page.keyboard.press('Escape').catch(() => {});
          if (stillOpen && invalidVisible === 0) record('error_handling', 'PASS', 'invalid submit blocked, no row created');
          else if (!stillOpen) record('error_handling', 'FAIL', 'form closed unexpectedly on invalid submit');
          else record('error_handling', 'FAIL', `invalid row appeared (count=${invalidVisible})`);
        }
      }
    } catch (e) { record('error_handling', 'FAIL', String(e)); }
  } finally {
    // --- 10. CLEANUP (always) ------------------------------------------
    try {
      if (process.env.E2E_CLEANUP_MODE === 'never') {
        cleanup = { loads: 0, fuel: 0, expenses: 0, remaining: { loads: 0, fuel: 0, expenses: 0 },
                    errors: ['skipped (E2E_CLEANUP_MODE=never)'] };
        record('cleanup', 'PARTIAL', 'cleanup skipped by env');
      } else {
        cleanup = await cleanupRun(RUN_ID);
        const remaining = cleanup.remaining.loads + cleanup.remaining.fuel + cleanup.remaining.expenses;
        if (cleanup.errors.length === 0 && remaining === 0) record('cleanup', 'PASS');
        else if (remaining > 0) record('cleanup', 'FAIL', `marker rows remain: ${JSON.stringify(cleanup.remaining)}`);
        else record('cleanup', 'PARTIAL', cleanup.errors.join('; '));
      }
    } catch (e) {
      record('cleanup', 'FAIL', `cleanup threw: ${String(e)}`);
    }

    // --- Always write report ------------------------------------------
    const verdict = computeVerdict();
    try { writeReport(verdict, cleanup); } catch (e) { /* never throw from finally */ }

    // Strict: PASS required to pass the runner.
    expect(verdict, 'driver journey verdict must be PASS (PARTIAL/FAIL fail the runner)').toBe('PASS');
  }
});
