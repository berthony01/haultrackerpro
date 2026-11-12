import { test, expect } from '@playwright/test';

// Public-only staging check against the built app and a synthetic, blocked backend.
// Does not log in, open checkout, create subscriptions, or mutate customer data.
test('driver, recruiter, and agency pricing are readable at 320 and 375 px', async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.protocol.startsWith('http') && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
      await route.abort();
    } else {
      await route.continue();
    }
  });

  const assertNoPageOverflow = async () => {
    await expect.poll(async () => page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    )).toBe(true);
  };

  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await page.goto('/pricing?audience=driver', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('tab', { name: 'Drivers' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('pricing-driver-view')).toBeVisible();
    await assertNoPageOverflow();
    await page.screenshot({ path: `test-results/pricing-driver-${width}.png`, fullPage: true, animations: 'disabled' });

    await page.getByRole('tab', { name: 'Recruiters & Carriers' }).click();
    await expect(page.getByTestId('pricing-recruiter-view')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recruiter Standard' })).toBeVisible();
    await expect(page.getByText(/Company Dispatch is an authorized company-workspace capability/)).toBeVisible();
    await assertNoPageOverflow();
    await page.screenshot({ path: `test-results/pricing-recruiter-${width}.png`, fullPage: true, animations: 'disabled' });

    await page.getByRole('tab', { name: 'Back-Office Businesses' }).click();
    await expect(page.getByTestId('pricing-agency-view')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Driver Assistant' })).toBeVisible();
    await expect(page.getByText(/Agency subscriptions do not automatically grant access to a carrier/)).toBeVisible();
    await assertNoPageOverflow();
    await page.screenshot({ path: `test-results/pricing-agency-${width}.png`, fullPage: true, animations: 'disabled' });
  }
});
