import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for HaulTrackerPro driver-journey E2E.
 *
 * This config is scoped to `tests/e2e/**` only; Vitest unit tests under
 * `src/test/**` continue to run via `bun run test` and are unaffected.
 *
 * Required env vars (see tests/e2e/README.md):
 *   E2E_BASE_URL          default http://localhost:8080
 *   E2E_DRIVER_EMAIL      disposable QA driver email
 *   E2E_DRIVER_PASSWORD   disposable QA driver password
 *   E2E_RUN_ID            unique marker, default `local-<timestamp>`
 *   E2E_CLEANUP_MODE      'always' (default) | 'never'
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/driver-journey-report.json' }],
    ['html', { outputFolder: 'test-results/html', open: 'never' }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
      testIgnore: /driver-journey-mobile\.spec\.ts/,
    },

    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: /driver-journey-mobile\.spec\.ts/,
    },
  ],
});
