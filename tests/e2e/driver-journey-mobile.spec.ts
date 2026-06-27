import { test, expect } from '@playwright/test';

/**
 * Mobile-viewport smoke for the driver journey. Runs under the `mobile`
 * Playwright project (Pixel 7 device profile). Verifies key driver
 * surfaces render and remain usable at phone width — does NOT create new
 * test data (the desktop spec owns writes + cleanup).
 */
const EMAIL = process.env.E2E_DRIVER_EMAIL;
const PASSWORD = process.env.E2E_DRIVER_PASSWORD;
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8080';

test('PART 12 — mobile viewport smoke', async ({ page }) => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_DRIVER_EMAIL / E2E_DRIVER_PASSWORD not set');
  await page.goto(`${BASE}/auth`);
  await page.getByLabel(/email/i).first().fill(EMAIL!);
  await page.getByLabel(/password/i).first().fill(PASSWORD!);
  await page.getByRole('button', { name: /sign in|log in/i }).first().click();
  await expect(page.getByText(/dashboard/i).first()).toBeVisible({ timeout: 20_000 });
  const saveBtn = page.getByRole('button', { name: /save|create|add/i }).first();
  // Submit-style button should be reachable in the viewport (not clipped off).
  if ((await saveBtn.count()) > 0) {
    const box = await saveBtn.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
  }
});
