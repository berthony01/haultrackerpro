import { test, expect } from '@playwright/test';

// Anonymous only. The external backend is blocked; no login or mutations.
test('public recruiter landing and business guide at narrow mobile widths', async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.protocol.startsWith('http') && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      await route.abort();
    } else {
      await route.continue();
    }
  });

  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await page.goto('/recruiters', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /Recruit Drivers Through a/i })).toBeVisible();
    await expect(page.getByText('1 active opportunity, unlimited drafts')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Read the Recruiter Business Starter Guide' })).toBeVisible();
    await page.screenshot({ path: `test-results/recruiter-landing-${width}.png`, fullPage: true, animations: 'disabled' });
    await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole('button', { name: 'Read the Recruiter Business Starter Guide' }).click();
    await expect(page).toHaveURL(/\/recruiter\/guide$/);
    await expect(page.getByRole('heading', { name: 'Start an independent trucking recruiting business' })).toBeVisible();
    await expect(page.getByText(/Carrier-client invoicing, commissions, and actual payment take place outside the platform/)).toBeVisible();
    await page.screenshot({ path: `test-results/recruiter-guide-${width}.png`, fullPage: true, animations: 'disabled' });
    await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
