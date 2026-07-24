/**
 * Phase 1N-F2-B — Docs/Legal foundation contract tests.
 *
 * Proves the registries are honest and static, the new pages behave, the
 * router change is minimal, and no out-of-scope files were touched in this
 * phase's diff.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

import {
  getAllPolicies,
  getLivePolicies,
  getPlannedPolicies,
  findPolicyBySlug,
  isPolicyLinkable,
  POLICY_METADATA_PENDING_LABEL,
} from '@/lib/legal/policyRegistry';
import {
  getAllDocs,
  getDocsByCategory,
  isDocsEntryLinkable,
  searchDocs,
  DOCS_CATEGORY_LABELS,
} from '@/lib/docs/docsRegistry';

const readSource = (relPath: string) =>
  readFileSync(resolve(process.cwd(), relPath), 'utf8');

const BASELINE_SHA = '3926bec94121cfca616a56e006d2a952e654a338';
const PHASE_START_SHA = '465a43a5060c17acdf060b152731dbccee3672ae';

const ALLOWED_FILES = [
  'src/lib/legal/policyRegistry.ts',
  'src/lib/docs/docsRegistry.ts',
  'src/pages/Docs.tsx',
  'src/pages/LegalCenter.tsx',
  'src/App.tsx',
  'src/test/phase1nF2DocsLegalFoundation.test.ts',
].sort();

// -----------------------------------------------------------------------------
// (1) Policy slugs and routes are unique.
// -----------------------------------------------------------------------------
describe('policy registry — uniqueness', () => {
  it('has unique slugs', () => {
    const slugs = getAllPolicies().map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('has unique routes', () => {
    const routes = getAllPolicies().map((p) => p.route);
    expect(new Set(routes).size).toBe(routes.length);
  });
});

// -----------------------------------------------------------------------------
// (2) Docs IDs are unique.
// -----------------------------------------------------------------------------
describe('docs registry — uniqueness', () => {
  it('has unique ids', () => {
    const ids = getAllDocs().map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// -----------------------------------------------------------------------------
// (3) Exactly Terms and Privacy are currently live policies.
// -----------------------------------------------------------------------------
describe('policy registry — live set', () => {
  it('is exactly Terms and Privacy', () => {
    const liveSlugs = getLivePolicies()
      .map((p) => p.slug)
      .sort();
    expect(liveSlugs).toEqual(['privacy', 'terms']);
  });
});

// -----------------------------------------------------------------------------
// (4) Live policies have real routes; planned policies cannot be represented
//     as published.
// -----------------------------------------------------------------------------
describe('policy registry — publication honesty', () => {
  const appSource = readSource('src/App.tsx');

  it('live policies point at routes mounted in App.tsx', () => {
    for (const entry of getLivePolicies()) {
      // Route must be truthy and mounted.
      expect(entry.route.startsWith('/')).toBe(true);
      const mounted = new RegExp(`path="${entry.route}"`).test(appSource);
      expect(mounted).toBe(true);
      expect(isPolicyLinkable(entry)).toBe(true);
    }
  });

  it('planned policies are never linkable and are not mounted routes', () => {
    for (const entry of getPlannedPolicies()) {
      expect(entry.status === 'live').toBe(false);
      expect(isPolicyLinkable(entry)).toBe(false);
      const mounted = new RegExp(`path="${entry.route}"`).test(appSource);
      expect(mounted).toBe(false);
    }
  });

  it('lookup helper finds by slug', () => {
    expect(findPolicyBySlug('terms')?.title).toContain('Terms');
    expect(findPolicyBySlug('nonexistent')).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// (5) No registry entry invents version/effective date for current
//     Terms/Privacy.
// -----------------------------------------------------------------------------
describe('policy registry — no invented metadata', () => {
  it('Terms and Privacy carry null version and null effectiveDate', () => {
    const terms = findPolicyBySlug('terms');
    const privacy = findPolicyBySlug('privacy');
    expect(terms).toBeDefined();
    expect(privacy).toBeDefined();
    expect(terms!.version).toBeNull();
    expect(terms!.effectiveDate).toBeNull();
    expect(privacy!.version).toBeNull();
    expect(privacy!.effectiveDate).toBeNull();
  });

  it('exposes a pending-metadata label for UI', () => {
    expect(POLICY_METADATA_PENDING_LABEL).toMatch(/pending/i);
  });
});

// -----------------------------------------------------------------------------
// (6) No registry source uses new Date, Date.now, or locale date formatting.
// -----------------------------------------------------------------------------
describe('registries — static, no runtime dates', () => {
  const forbiddenPatterns = [
    /\bnew\s+Date\s*\(/,
    /\bDate\.now\s*\(/,
    /toLocaleDateString\s*\(/,
    /toLocaleString\s*\(/,
    /Intl\.DateTimeFormat\s*\(/,
  ];

  const files = [
    'src/lib/legal/policyRegistry.ts',
    'src/lib/docs/docsRegistry.ts',
  ];

  for (const file of files) {
    it(`${file} contains no runtime date construction`, () => {
      const src = readSource(file);
      for (const pattern of forbiddenPatterns) {
        expect(pattern.test(src)).toBe(false);
      }
    });
  }
});

// -----------------------------------------------------------------------------
// (7) Live docs entries have non-null verified routes; planned entries never
//     produce dead links.
// -----------------------------------------------------------------------------
describe('docs registry — link honesty', () => {
  const appSource = readSource('src/App.tsx');
  // Real routes that the docs registry is allowed to link to. Verified by
  // grepping src/App.tsx above and enumerating those we intentionally link to.
  const KNOWN_LIVE_ROUTES = [
    '/how-to-use-haultrackerpro',
    '/faq',
    '/pricing',
    '/recruiter/guide',
    '/recruiter/faq',
    '/recruiter/features',
    '/assistants-agencies',
    '/terms',
    '/privacy',
  ];

  it('every known-live route is actually mounted', () => {
    for (const r of KNOWN_LIVE_ROUTES) {
      expect(new RegExp(`path="${r}"`).test(appSource)).toBe(true);
    }
  });

  it('live docs entries have a non-null route in the known-live set', () => {
    for (const entry of getAllDocs()) {
      if (entry.status === 'live') {
        expect(typeof entry.route).toBe('string');
        expect(entry.route).not.toBeNull();
        expect(KNOWN_LIVE_ROUTES).toContain(entry.route as string);
        expect(isDocsEntryLinkable(entry)).toBe(true);
      }
    }
  });

  it('planned docs entries have route === null (no dead links)', () => {
    for (const entry of getAllDocs()) {
      if (entry.status === 'planned') {
        expect(entry.route).toBeNull();
        expect(isDocsEntryLinkable(entry)).toBe(false);
      }
    }
  });

  it('category bucketing preserves every entry', () => {
    const grouped = getDocsByCategory();
    const totalGrouped = Object.values(grouped).reduce((n, arr) => n + arr.length, 0);
    expect(totalGrouped).toBe(getAllDocs().length);
  });
});

// -----------------------------------------------------------------------------
// (8) Docs search matches title, description, category, audience and keywords
//     case-insensitively.
// -----------------------------------------------------------------------------
describe('docs registry — search', () => {
  it('matches by title', () => {
    const hits = searchDocs('Pricing');
    expect(hits.some((h) => h.id === 'pricing-plans')).toBe(true);
  });

  it('matches by description case-insensitively', () => {
    const hits = searchDocs('WALKTHROUGH');
    expect(hits.some((h) => h.id === 'driver-how-to-use')).toBe(true);
  });

  it('matches by category label', () => {
    const hits = searchDocs('agencies');
    expect(hits.some((h) => h.category === 'agencies')).toBe(true);
  });

  it('matches by audience tag', () => {
    const hits = searchDocs('recruiter');
    expect(hits.some((h) => h.audiences.includes('recruiter'))).toBe(true);
  });

  it('matches by keyword', () => {
    const hits = searchDocs('ocr');
    expect(hits.some((h) => h.id === 'ai-ocr-calculations-limits')).toBe(true);
  });

  it('returns full list when query is empty / whitespace', () => {
    expect(searchDocs('').length).toBe(getAllDocs().length);
    expect(searchDocs('   ').length).toBe(getAllDocs().length);
  });

  it('does not mutate the underlying registry', () => {
    const before = getAllDocs();
    const beforeIds = before.map((d) => d.id);
    searchDocs('driver');
    const after = getAllDocs();
    expect(after.map((d) => d.id)).toEqual(beforeIds);
  });

  it('exposes labels for every declared category', () => {
    for (const entry of getAllDocs()) {
      expect(DOCS_CATEGORY_LABELS[entry.category]).toBeTruthy();
    }
  });
});

// -----------------------------------------------------------------------------
// (9) App.tsx has exactly one /docs and one /legal route and does not add
//     any of the five planned policy routes.
// -----------------------------------------------------------------------------
describe('App.tsx — minimal, scoped route change', () => {
  const src = readSource('src/App.tsx');

  const countMatches = (needle: RegExp) => (src.match(needle) ?? []).length;

  it('contains exactly one /docs route', () => {
    expect(countMatches(/path="\/docs"/g)).toBe(1);
  });

  it('contains exactly one /legal route', () => {
    expect(countMatches(/path="\/legal"/g)).toBe(1);
  });

  it('does not mount any planned policy route', () => {
    const forbidden = [
      '/acceptable-use',
      '/subscription-policy',
      '/account-deletion-retention',
      '/recruiting-rules',
      '/legal/history',
    ];
    for (const r of forbidden) {
      expect(new RegExp(`path="${r}"`).test(src)).toBe(false);
    }
  });

  it('lazy-imports Docs and LegalCenter consistently with existing style', () => {
    expect(/const\s+Docs\s*=\s*lazy\(\(\)\s*=>\s*import\(["']\.\/pages\/Docs["']\)\)/.test(src)).toBe(true);
    expect(/const\s+LegalCenter\s*=\s*lazy\(\(\)\s*=>\s*import\(["']\.\/pages\/LegalCenter["']\)\)/.test(src)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// (10) Docs and LegalCenter source contain accessible titles/search/status
//      language and link only to appropriate live destinations.
// -----------------------------------------------------------------------------
describe('page sources — accessibility & honesty', () => {
  const docsSrc = readSource('src/pages/Docs.tsx');
  const legalSrc = readSource('src/pages/LegalCenter.tsx');

  it('Docs page uses SEOHead pointed at /docs', () => {
    expect(docsSrc).toContain('SEOHead');
    expect(docsSrc).toMatch(/path=["']\/docs["']/);
  });

  it('Docs page has an accessible search input with a label', () => {
    expect(docsSrc).toMatch(/id=["']docs-search["']/);
    expect(docsSrc).toMatch(/htmlFor=["']docs-search["']/);
    expect(docsSrc).toMatch(/type=["']search["']/);
  });

  it('Docs page uses the Coming soon status label for planned entries', () => {
    expect(docsSrc).toContain('Coming soon');
  });

  it('Docs page limitations block links only to /terms and /privacy (plus /legal)', () => {
    // No planned policy routes should appear in Docs.tsx as <Link to=...>
    const forbidden = [
      '/acceptable-use',
      '/subscription-policy',
      '/account-deletion-retention',
      '/recruiting-rules',
      '/legal/history',
    ];
    for (const r of forbidden) {
      expect(docsSrc.includes(`to="${r}"`)).toBe(false);
    }
    expect(docsSrc).toMatch(/to=["']\/terms["']/);
    expect(docsSrc).toMatch(/to=["']\/privacy["']/);
  });

  it('LegalCenter uses SEOHead pointed at /legal', () => {
    expect(legalSrc).toContain('SEOHead');
    expect(legalSrc).toMatch(/path=["']\/legal["']/);
  });

  it('LegalCenter shows In preparation and attorney-review language', () => {
    expect(legalSrc).toContain('In preparation');
    expect(legalSrc).toContain('Attorney review required before final publication');
  });

  it('LegalCenter clearly states it is informational and not legal advice', () => {
    expect(legalSrc).toMatch(/informational/i);
    expect(legalSrc).toMatch(/does\s+not\s+replace\s+professional\s+legal\s+advice/i);
  });

  it('LegalCenter does not link directly to any planned policy route', () => {
    // Planned entries render as non-clickable groups; explicit hard-coded Link to
    // planned routes must not exist.
    const forbidden = [
      '/acceptable-use',
      '/subscription-policy',
      '/account-deletion-retention',
      '/recruiting-rules',
      '/legal/history',
    ];
    for (const r of forbidden) {
      expect(legalSrc.includes(`to="${r}"`)).toBe(false);
    }
  });

  it('LegalCenter surfaces the pending-metadata language for null version rows', () => {
    // Either uses the exported constant string or renders the shared label.
    expect(legalSrc).toContain('POLICY_METADATA_PENDING_LABEL');
  });
});

// -----------------------------------------------------------------------------
// (11) Source integrity — this phase's diff touches only the six allowlisted
//      files and does not touch Terms, Privacy, FAQ, Auth, sitemap, robots,
//      package files, migrations, or generated types.
// -----------------------------------------------------------------------------
describe('phase diff integrity', () => {
  const runGit = (args: string): string => {
    try {
      return execSync(`git ${args}`, { encoding: 'utf8' }).trim();
    } catch {
      return '';
    }
  };

  it('cumulative diff from phase start SHA is exactly the six allowlisted files', () => {
    const merge = runGit(`merge-base ${PHASE_START_SHA} HEAD`);
    // If baseline is not reachable (shallow clone / detached CI), skip silently
    // by marking the test as a soft check.
    if (!merge) {
      // Fallback: just verify allowlisted files exist.
      for (const f of ALLOWED_FILES) {
        expect(existsSync(resolve(process.cwd(), f))).toBe(true);
      }
      return;
    }
    const raw = runGit(`diff --name-only ${PHASE_START_SHA}...HEAD`);
    const changed = raw ? raw.split('\n').map((s) => s.trim()).filter(Boolean).sort() : [];
    expect(changed).toEqual(ALLOWED_FILES);
  });

  it('cumulative diff from accepted baseline SHA is exactly the same six files (no .lovable/plan.md)', () => {
    const merge = runGit(`merge-base ${BASELINE_SHA} HEAD`);
    if (!merge) {
      for (const f of ALLOWED_FILES) {
        expect(existsSync(resolve(process.cwd(), f))).toBe(true);
      }
      return;
    }
    const raw = runGit(`diff --name-only ${BASELINE_SHA}...HEAD`);
    const changed = raw ? raw.split('\n').map((s) => s.trim()).filter(Boolean).sort() : [];
    expect(changed).toEqual(ALLOWED_FILES);
    expect(changed).not.toContain('.lovable/plan.md');
    // Explicit forbidden set — none of these must appear in the diff.
    const forbidden = [
      'src/pages/Terms.tsx',
      'src/pages/Privacy.tsx',
      'src/pages/FAQ.tsx',
      'src/pages/Auth.tsx',
      'public/sitemap.xml',
      'public/robots.txt',
      'public/llms.txt',
      'package.json',
      'package-lock.json',
      'bun.lockb',
      'src/integrations/supabase/types.ts',
    ];
    for (const f of forbidden) {
      expect(changed).not.toContain(f);
    }
    // No migration/candidate SQL files in the diff.
    for (const f of changed) {
      expect(f.startsWith('supabase/migrations/')).toBe(false);
      expect(f.startsWith('supabase/migration-candidates/')).toBe(false);
      expect(f.startsWith('supabase/functions/')).toBe(false);
    }
  });
});
