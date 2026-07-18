import { defineConfig, devices } from '@playwright/test';

/**
 * Phase R1c — Playwright + Axe browser suite for the Recruiter billing surface.
 *
 * This config is deliberately SEPARATE from the repo's existing
 * `playwright.config.ts` (a credential-based driver-journey suite). It:
 *
 *  - Builds the REAL production bundle (`vite build`) and serves it with
 *    `vite preview` on a dedicated port, so the suite exercises the shipped
 *    bundle, not a dev server.
 *  - Bakes a HARMLESS placeholder Supabase project into the build via env
 *    vars. The app's `vite.config.ts` otherwise falls back to a real Supabase
 *    project URL; the placeholder guarantees any accidentally-unmocked
 *    request fails loudly against a non-existent host instead of silently
 *    hitting production. Every request is additionally intercepted in-spec.
 *  - Runs Chromium only (per the R1c scope).
 *
 * Nothing here touches the driver-journey config or its specs.
 */

const PORT = Number(process.env.RECRUITER_BILLING_E2E_PORT ?? 4319);
const BASE_URL = `http://localhost:${PORT}`;

// Harmless placeholder project. Its subdomain ("phase1g-r1c-test") is also the
// Supabase project-ref, which determines the localStorage auth-token key
// (`sb-phase1g-r1c-test-auth-token`) the spec injects.
const PLACEHOLDER_SUPABASE_URL = 'https://phase1g-r1c-test.supabase.co';
const PLACEHOLDER_SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.phase1g_r1c_placeholder_anon_key.signature';
const PLACEHOLDER_SUPABASE_PROJECT_ID = 'phase1g-r1c-test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /recruiter-billing\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-recruiter-billing', open: 'never' }],
  ],
  outputDir: 'test-results/recruiter-billing',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    command: `bun run build && bun run preview -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      VITE_SUPABASE_URL: PLACEHOLDER_SUPABASE_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: PLACEHOLDER_SUPABASE_KEY,
      VITE_SUPABASE_PROJECT_ID: PLACEHOLDER_SUPABASE_PROJECT_ID,
    },
  },
});
