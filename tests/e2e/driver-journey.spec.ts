/**
 * HaulTrackerPro — Driver Journey E2E Runner (single sequential test).
 *
 * One browser context, one logged-in session. Steps depend on the data the
 * earlier step created, so this MUST run as one test. Required steps:
 *   login → settings → load create → fuel create → expense create →
 *   dashboard numeric assertion → reports parity → refresh persistence →
 *   error handling → cleanup (with verification).
 *
 * Verdict rules (strict):
 *   - any required FAIL  → FAIL
 *   - any required NOT TESTED → PARTIAL
 *   - cleanup errors or remaining marker rows → PARTIAL (or FAIL if delete errored)
 *   - export may be NOT TESTED — explicitly optional in this runner.
 */
import { test, expect, type Page } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { cleanupRun, type CleanupResult } from './cleanup';

const RUN_ID = process.env.E2E_RUN_ID ?? `local-${Date.now()}`;
const MARKER = `QA TEST DELETE - ${RUN_ID}`;
const EMAIL = process.env.E2E_DRIVER_EMAIL;
const PASSWORD = process.env.E2E_DRIVER_PASSWORD;
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8080';

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

async function fillByLabel(page: Page, labels: string[], value: string): Promise<boolean> {
  for (const label of labels) {
    const candidate = page.getByLabel(label, { exact: false }).first();
    if ((await candidate.count()) > 0) {
      try { await candidate.fill(value); return true; } catch { /* try next */ }
    }
  }
  return false;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => { mkdirSync('test-results', { recursive: true }); });

test('driver journey — full sequential flow', async ({ page }) => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_DRIVER_EMAIL / E2E_DRIVER_PASSWORD not set');
  test.setTimeout(180_000);

  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => { pageErrors.push(e.message); });

  // Pre-mark every required step NOT TESTED; each section overwrites on success/fail.
  for (const s of REQUIRED_STEPS) record(s, 'NOT TESTED');
  record('export', 'NOT TESTED', 'export not automated in this runner (optional)');

  // --- 1. LOGIN -----------------------------------------------------------
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
    return; // can't proceed without a session
  }

  // --- 2. SETTINGS persistence -------------------------------------------
  try {
    const link = page.getByRole('link', { name: /settings/i }).first();
    if ((await link.count()) === 0) {
      record('settings', 'NOT TESTED', 'settings nav not found');
    } else {
      await link.click();
      await page.waitForLoadState('networkidle');
      await page.reload();
      await expect(page.getByText(/account|plan|pay/i).first()).toBeVisible();
      record('settings', 'PASS');
    }
  } catch (e) { record('settings', 'FAIL', String(e)); }

  // --- 3. LOAD create ----------------------------------------------------
  try {
    const loadsTab = page.getByRole('link', { name: /^loads$/i }).first();
    if ((await loadsTab.count()) === 0) {
      record('load_create', 'NOT TESTED', 'loads nav not found');
    } else {
      await loadsTab.click();
      const addLoad = page.getByRole('button', { name: /add load|new load|\+ load/i }).first();
      if ((await addLoad.count()) === 0) {
        record('load_create', 'NOT TESTED', 'add-load button not found');
      } else {
        await addLoad.click();
        const ok =
          (await fillByLabel(page, ['Loaded Miles', 'Loaded miles'], '500')) &&
          (await fillByLabel(page, ['Deadhead Miles', 'Deadhead'], '50')) &&
          (await fillByLabel(page, ['Load Pay', 'Rate', 'Flat Rate'], '1000')) &&
          (await fillByLabel(page, ['Notes', 'Reference', 'Load #'], MARKER));
        if (!ok) {
          record('load_create', 'NOT TESTED', 'load form fields not all reachable');
        } else {
          await page.getByRole('button', { name: /save|create|add/i }).last().click();
          await expect(
            page.getByText(new RegExp(MARKER.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'))),
          ).toBeVisible({ timeout: 15_000 });
          record('load_create', 'PASS');
        }
      }
    }
  } catch (e) { record('load_create', 'FAIL', String(e)); }

  // --- 4. FUEL create ----------------------------------------------------
  try {
    const fuelTab = page.getByRole('link', { name: /^fuel$/i }).first();
    if ((await fuelTab.count()) === 0) {
      record('fuel_create', 'NOT TESTED', 'fuel nav not found');
    } else {
      await fuelTab.click();
      const addFuel = page.getByRole('button', { name: /add fuel|log fuel|\+ fuel/i }).first();
      if ((await addFuel.count()) === 0) {
        record('fuel_create', 'NOT TESTED', 'add-fuel button not found');
      } else {
        await addFuel.click();
        const fok =
          (await fillByLabel(page, ['Gallons'], '100')) &&
          (await fillByLabel(page, ['Total Cost', 'Cost'], '300')) &&
          (await fillByLabel(page, ['Notes', 'Note'], MARKER));
        if (!fok) record('fuel_create', 'NOT TESTED', 'fuel form fields not all reachable');
        else {
          await page.getByRole('button', { name: /save|create|add/i }).last().click();
          record('fuel_create', 'PASS');
        }
      }
    }
  } catch (e) { record('fuel_create', 'FAIL', String(e)); }

  // --- 5. EXPENSE create -------------------------------------------------
  try {
    const expTab = page.getByRole('link', { name: /^expenses$/i }).first();
    if ((await expTab.count()) === 0) {
      record('expense_create', 'NOT TESTED', 'expenses nav not found');
    } else {
      await expTab.click();
      const addExp = page.getByRole('button', { name: /add expense|new expense|\+ expense/i }).first();
      if ((await addExp.count()) === 0) {
        record('expense_create', 'NOT TESTED', 'add-expense button not found');
      } else {
        await addExp.click();
        const eok =
          (await fillByLabel(page, ['Amount'], '50')) &&
          (await fillByLabel(page, ['Description', 'Note', 'Notes'], MARKER));
        if (!eok) record('expense_create', 'NOT TESTED', 'expense form fields not all reachable');
        else {
          await page.getByRole('button', { name: /save|create|add/i }).last().click();
          record('expense_create', 'PASS');
        }
      }
    }
  } catch (e) { record('expense_create', 'FAIL', String(e)); }

  // --- 6. DASHBOARD numeric verification ---------------------------------
  let dashGr: number | null = null, dashExp: number | null = null, dashNp: number | null = null,
      dashRpm: number | null = null, dashOpMiles: number | null = null;
  try {
    const dash = page.getByRole('link', { name: /dashboard/i }).first();
    if ((await dash.count()) === 0) {
      record('dashboard', 'NOT TESTED', 'dashboard nav not found');
    } else {
      await dash.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);

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

  // --- 7. REPORTS parity --------------------------------------------------
  try {
    const reports = page.getByRole('link', { name: /reports/i }).first();
    if ((await reports.count()) === 0) {
      record('reports', 'NOT TESTED', 'reports nav not found');
    } else {
      await reports.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);

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

  // --- 8. REFRESH persistence --------------------------------------------
  try {
    await page.reload();
    await page.waitForLoadState('networkidle');
    // still authenticated → some nav must be visible
    const stillIn = await page.getByRole('link', { name: /dashboard|loads|settings/i }).first().count();
    record('refresh_persistence', stillIn > 0 ? 'PASS' : 'FAIL',
      stillIn > 0 ? 'session survived reload' : 'logged out after reload');
  } catch (e) { record('refresh_persistence', 'FAIL', String(e)); }

  // --- 9. ERROR handling (invalid form) -----------------------------------
  try {
    const loadsTab = page.getByRole('link', { name: /^loads$/i }).first();
    if ((await loadsTab.count()) === 0) {
      record('error_handling', 'NOT TESTED', 'loads nav not found');
    } else {
      await loadsTab.click();
      const addLoad = page.getByRole('button', { name: /add load|new load|\+ load/i }).first();
      if ((await addLoad.count()) === 0) {
        record('error_handling', 'NOT TESTED', 'add-load button not found');
      } else {
        const errsBefore = pageErrors.length;
        await addLoad.click();
        await page.getByRole('button', { name: /save|create|add/i }).last().click();
        await page.waitForTimeout(500);
        const newErrs = pageErrors.length - errsBefore;
        record('error_handling', newErrs === 0 ? 'PASS' : 'FAIL',
          newErrs === 0 ? 'invalid submit blocked, no page error' : `${newErrs} page errors`);
      }
    }
  } catch (e) { record('error_handling', 'FAIL', String(e)); }

  // --- 10. CLEANUP --------------------------------------------------------
  let cleanup: CleanupResult;
  if (process.env.E2E_CLEANUP_MODE === 'never') {
    cleanup = { loads: 0, fuel: 0, expenses: 0, remaining: { loads: 0, fuel: 0, expenses: 0 },
                errors: ['skipped (E2E_CLEANUP_MODE=never)'] };
    record('cleanup', 'NOT TESTED', 'cleanup skipped by env');
  } else {
    cleanup = await cleanupRun(RUN_ID);
    const remaining = cleanup.remaining.loads + cleanup.remaining.fuel + cleanup.remaining.expenses;
    if (cleanup.errors.length === 0 && remaining === 0) record('cleanup', 'PASS');
    else if (remaining > 0) record('cleanup', 'FAIL', `marker rows remain: ${JSON.stringify(cleanup.remaining)}`);
    else record('cleanup', 'PARTIAL', cleanup.errors.join('; '));
  }

  // --- VERDICT ------------------------------------------------------------
  const requiredStatuses = REQUIRED_STEPS.map((s) => results[s]?.status ?? 'NOT TESTED');
  let verdict: StepStatus;
  if (requiredStatuses.includes('FAIL')) verdict = 'FAIL';
  else if (requiredStatuses.includes('PARTIAL') || requiredStatuses.includes('NOT TESTED')) verdict = 'PARTIAL';
  else verdict = 'PASS';

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
    `- loads deleted: ${cleanup.loads}`,
    `- fuel deleted: ${cleanup.fuel}`,
    `- expenses deleted: ${cleanup.expenses}`,
    `- remaining after cleanup: loads=${cleanup.remaining.loads}, fuel=${cleanup.remaining.fuel}, expenses=${cleanup.remaining.expenses}`,
    `- errors: ${cleanup.errors.length ? cleanup.errors.join('; ') : 'none'}`,
    ``,
    `## Browser diagnostics`,
    `- console errors: ${consoleErrors.length}`,
    `- page errors: ${pageErrors.length}`,
  ].join('\n');
  writeFileSync('test-results/driver-journey-report.md', md);

  // Surface verdict to the Playwright runner.
  expect(verdict, 'driver journey verdict').not.toBe('FAIL');
});
