import { test, expect } from '@playwright/test';

/**
 * MOBILE SMOKE ONLY. This does NOT verify the full driver journey at mobile
 * width — no writes, no numeric assertions, no cleanup. It confirms that
 * the auth + dashboard surface render and that a primary action button is
 * not clipped at phone width. The desktop spec owns end-to-end coverage.
 *
 * Do not report mobile coverage as "full journey" based on this spec.
 */
const EMAIL = process.env.E2E_DRIVER_EMAIL;
const PASSWORD = process.env.E2E_DRIVER_PASSWORD;
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8080';

test('mobile SMOKE — auth + dashboard render at phone width (NOT a full journey)', async ({ page }) => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_DRIVER_EMAIL / E2E_DRIVER_PASSWORD not set');
  await page.goto(`${BASE}/auth`);
  await page.getByLabel(/email/i).first().fill(EMAIL!);
  await page.getByLabel(/password/i).first().fill(PASSWORD!);
  await page.getByRole('button', { name: /sign in|log in/i }).first().click();
  await expect(page.getByText(/dashboard/i).first()).toBeVisible({ timeout: 20_000 });
  const saveBtn = page.getByRole('button', { name: /save|create|add/i }).first();
  if ((await saveBtn.count()) > 0) {
    const box = await saveBtn.boundingBox();
    expect(box?.width ?? 0, 'primary action button must have width at mobile size').toBeGreaterThan(0);
  }
});
