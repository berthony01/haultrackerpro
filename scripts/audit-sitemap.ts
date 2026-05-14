/**
 * SEO Sitemap Audit
 *
 * Compares the maintained allowlist of public, indexable routes against
 * the URLs in public/sitemap.xml. Fails (exit 1) on any mismatch.
 *
 * Run with: npx tsx scripts/audit-sitemap.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE_URL = 'https://haultrackerpro.com';

// Routes that MUST appear in the sitemap (public, indexable).
// Keep in sync with src/App.tsx public routes that do NOT set noindex.
const EXPECTED_PUBLIC_ROUTES: string[] = [
  '/',
  '/features',
  '/pricing',
  '/recruiters',
  '/faq',
  '/starter-kit',
  '/terms',
  '/privacy',
  '/how-to-use-haultrackerpro',
  '/truck-driver-tax-deductions',
  '/owner-operator-expense-tracker',
  '/trucking-profit-calculator',
  '/trucker-bookkeeping-guide',
  '/truck-driver-expenses',
  '/truck-driver-per-diem',
  '/owner-operator-salary',
  '/trucking-cost-per-mile',
  '/trucking-expenses-list',
  '/owner-operator-expenses-list',
  '/trucking-finance-guides',
  '/fuel-cost-per-mile-trucking',
  '/trucking-maintenance-cost-per-mile',
  '/truck-driver-fuel-expenses',
  '/trucking-expense-categories',
  '/owner-operator-tax-write-offs',
  '/trucker-fuel-cost-calculator',
  '/trucking-mileage-expense-guide',
  '/trucker-cost-per-mile-breakdown',
  '/owner-operator-operating-costs',
  '/truck-driver-operating-expenses',
  '/trucking-cost-per-mile-calculator',
  '/trucking-load-profit-calculator',
  '/tools/load-profit-calculator',
  '/tools/fuel-cost-per-mile',
];

// Routes that MUST NOT appear in the sitemap.
// Private, protected, post-submit, or otherwise noindexed.
const FORBIDDEN_ROUTES: string[] = [
  '/dashboard',
  '/auth',
  '/admin',
  '/reset-password',
  '/install',
  '/parking',
  '/updates',
  '/starter-kit/thanks',
  '/landing',
];

function pathFromUrl(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/$/, '') || '/';
  } catch {
    return url;
  }
}

function parseSitemap(xml: string): string[] {
  const matches = xml.match(/<loc>([^<]+)<\/loc>/g) ?? [];
  return matches.map((m) => pathFromUrl(m.replace(/<\/?loc>/g, '').trim()));
}

function main() {
  const sitemapPath = resolve(process.cwd(), 'public/sitemap.xml');
  const xml = readFileSync(sitemapPath, 'utf8');
  const sitemapPaths = new Set(parseSitemap(xml));

  const expected = new Set(EXPECTED_PUBLIC_ROUTES.map((p) => p.replace(/\/$/, '') || '/'));
  const forbidden = new Set(FORBIDDEN_ROUTES.map((p) => p.replace(/\/$/, '') || '/'));

  const missing: string[] = [];
  for (const route of expected) {
    if (!sitemapPaths.has(route)) missing.push(route);
  }

  const unexpected: string[] = [];
  for (const route of sitemapPaths) {
    if (forbidden.has(route)) unexpected.push(route);
  }

  const stale: string[] = [];
  for (const route of sitemapPaths) {
    if (!expected.has(route) && !forbidden.has(route)) stale.push(route);
  }

  console.log(`\nSEO sitemap audit — ${BASE_URL}`);
  console.log(`  Sitemap entries: ${sitemapPaths.size}`);
  console.log(`  Expected public routes: ${expected.size}`);

  if (missing.length) {
    console.error('\n❌ Missing from sitemap (should be added):');
    missing.forEach((r) => console.error(`  - ${BASE_URL}${r}`));
  }

  if (unexpected.length) {
    console.error('\n❌ Forbidden routes present in sitemap (must be removed):');
    unexpected.forEach((r) => console.error(`  - ${BASE_URL}${r}`));
  }

  if (stale.length) {
    console.warn('\n⚠️  Sitemap entries not in allowlist (review):');
    stale.forEach((r) => console.warn(`  - ${BASE_URL}${r}`));
  }

  if (missing.length || unexpected.length) {
    console.error('\nSitemap audit FAILED.\n');
    process.exit(1);
  }

  console.log('\n✅ Sitemap audit passed.\n');
}

main();
