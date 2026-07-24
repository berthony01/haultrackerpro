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
import { getArticleBySlug } from '@/lib/docs/docsArticles';

const readSource = (relPath: string) =>
  readFileSync(resolve(process.cwd(), relPath), 'utf8');

const BASELINE_SHA = '3926bec94121cfca616a56e006d2a952e654a338';
const PHASE_START_SHA = '465a43a5060c17acdf060b152731dbccee3672ae';
// The accepted F2-B end SHA. Historical F2-B scope proofs must end here,
// NOT at current HEAD — later accepted phases (F2-C1, etc.) are permitted
// to add files while the F2-B evidence remains immutable.
const F2B_ACCEPTED_SHA = '08206a82d6705a772b9d1158ee531e7bc0232b01';

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
  // Static (non-article) destinations the docs registry is allowed to link to.
  // Verified by grepping src/App.tsx and enumerating those we intentionally link to.
  const KNOWN_STATIC_LIVE_ROUTES = [
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

  it('every known static live route is actually mounted', () => {
    for (const r of KNOWN_STATIC_LIVE_ROUTES) {
      expect(new RegExp(`path="${r}"`).test(appSource)).toBe(true);
    }
  });

  it('App.tsx mounts exactly one /docs/:articleSlug dynamic route', () => {
    const matches = appSource.match(/path="\/docs\/:articleSlug"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('every live docs entry resolves to either a mounted static route or a canonical article', () => {
    for (const entry of getAllDocs()) {
      if (entry.status !== 'live') continue;
      expect(typeof entry.route).toBe('string');
      expect(entry.route).not.toBeNull();
      expect(isDocsEntryLinkable(entry)).toBe(true);
      const route = entry.route as string;
      if (KNOWN_STATIC_LIVE_ROUTES.includes(route)) {
        expect(new RegExp(`path="${route}"`).test(appSource)).toBe(true);
        continue;
      }
      // Non-static live route MUST be a canonical /docs/<slug> article.
      expect(route.startsWith('/docs/')).toBe(true);
      const slug = route.slice('/docs/'.length);
      expect(slug.length).toBeGreaterThan(0);
      expect(slug.includes('/')).toBe(false);
      const article = getArticleBySlug(slug);
      expect(article).not.toBeNull();
      expect(article).toBeDefined();
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
//
//      FAIL-CLOSED: any git failure or missing history must fail the test with
//      full command/error context. There is no "files exist" fallback: a
//      shallow CI clone that cannot reach the baseline SHAs must fetch the
//      history or be marked failed — the scope proof must never silently PASS.
// -----------------------------------------------------------------------------
describe('phase diff integrity (fail-closed)', () => {
  const runGitStrict = (args: string): string => {
    try {
      return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer | string; stdout?: Buffer | string; message?: string };
      const stderr = e.stderr ? e.stderr.toString() : '';
      const stdout = e.stdout ? e.stdout.toString() : '';
      throw new Error(
        `git ${args} failed (exit ${e.status ?? 'n/a'}): ${e.message ?? ''}\nstderr: ${stderr}\nstdout: ${stdout}`,
      );
    }
  };

  const assertAncestor = (ancestor: string, descendant: string) => {
    // `--is-ancestor` exits 0 if `ancestor` is an ancestor of `descendant`,
    // 1 if not. Anything else (missing objects in a shallow clone, unknown
    // SHA, etc.) is treated as an outright failure — no silent PASS.
    try {
      execSync(`git merge-base --is-ancestor ${ancestor} ${descendant}`, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer | string };
      const stderr = e.stderr ? e.stderr.toString() : '';
      throw new Error(
        `git merge-base --is-ancestor ${ancestor} ${descendant} failed (exit ${e.status ?? 'n/a'}). ` +
          `The reference SHA must be reachable; a shallow CI clone must fetch full history. ` +
          `stderr: ${stderr}`,
      );
    }
  };

  it('phase start SHA is an ancestor of the accepted F2-B SHA', () => {
    assertAncestor(PHASE_START_SHA, F2B_ACCEPTED_SHA);
  });

  it('accepted baseline SHA is an ancestor of the accepted F2-B SHA', () => {
    assertAncestor(BASELINE_SHA, F2B_ACCEPTED_SHA);
  });

  it('accepted F2-B SHA is an ancestor of current HEAD', () => {
    assertAncestor(F2B_ACCEPTED_SHA, 'HEAD');
  });

  it('historical diff PHASE_START_SHA...F2B_ACCEPTED_SHA is exactly the six F2-B files', () => {
    const raw = runGitStrict(`diff --name-only ${PHASE_START_SHA}...${F2B_ACCEPTED_SHA}`);
    const changed = raw ? raw.split('\n').map((s) => s.trim()).filter(Boolean).sort() : [];
    expect(changed).toEqual(ALLOWED_FILES);
  });

  it('historical diff BASELINE_SHA...F2B_ACCEPTED_SHA is exactly the same six files and excludes forbidden paths', () => {
    const raw = runGitStrict(`diff --name-only ${BASELINE_SHA}...${F2B_ACCEPTED_SHA}`);
    const changed = raw ? raw.split('\n').map((s) => s.trim()).filter(Boolean).sort() : [];
    expect(changed).toEqual(ALLOWED_FILES);
    expect(changed).not.toContain('.lovable/plan.md');
    // Explicit forbidden set — none of these must appear in the F2-B diff.
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
    // No migration/candidate SQL / edge function files in the F2-B diff.
    for (const f of changed) {
      expect(f.startsWith('supabase/migrations/')).toBe(false);
      expect(f.startsWith('supabase/migration-candidates/')).toBe(false);
      expect(f.startsWith('supabase/functions/')).toBe(false);
    }
  });

  it('allowlisted files all exist on disk', () => {
    for (const f of ALLOWED_FILES) {
      expect(existsSync(resolve(process.cwd(), f))).toBe(true);
    }
  });
});

// -----------------------------------------------------------------------------
// (12) Deep runtime immutability — R1 hardening. Prove that every exposed
//      layer of the policy and docs registries is Object.frozen at runtime.
//      TypeScript `readonly` alone does not stop a JavaScript caller from
//      mutating shape at runtime; these tests exercise the JS behavior.
// -----------------------------------------------------------------------------
describe('policy registry — deep runtime immutability', () => {
  it('outer canonical array is frozen', () => {
    expect(Object.isFrozen(getAllPolicies())).toBe(true);
  });

  it('every policy entry object is frozen', () => {
    for (const entry of getAllPolicies()) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });

  it('every policy `audiences` array is frozen', () => {
    for (const entry of getAllPolicies()) {
      expect(Object.isFrozen(entry.audiences)).toBe(true);
    }
  });

  it('getLivePolicies() and getPlannedPolicies() return frozen arrays of frozen entries', () => {
    const live = getLivePolicies();
    const planned = getPlannedPolicies();
    expect(Object.isFrozen(live)).toBe(true);
    expect(Object.isFrozen(planned)).toBe(true);
    for (const e of live) expect(Object.isFrozen(e)).toBe(true);
    for (const e of planned) expect(Object.isFrozen(e)).toBe(true);
  });

  it('findPolicyBySlug returns a frozen canonical entry', () => {
    const terms = findPolicyBySlug('terms')!;
    expect(Object.isFrozen(terms)).toBe(true);
    expect(Object.isFrozen(terms.audiences)).toBe(true);
  });

  it('mutating status / route / version on a policy entry throws and leaves canonical values unchanged', () => {
    const planned = getPlannedPolicies();
    const acceptableUse = planned.find((p) => p.slug === 'acceptable-use')!;
    const originalStatus = acceptableUse.status;
    const originalRoute = acceptableUse.route;
    const originalVersion = acceptableUse.version;
    expect(() => {
      (acceptableUse as unknown as { status: string }).status = 'live';
    }).toThrow();
    expect(() => {
      (acceptableUse as unknown as { route: string }).route = '/hijacked';
    }).toThrow();
    expect(() => {
      (acceptableUse as unknown as { version: string }).version = '9.9.9';
    }).toThrow();
    const reread = findPolicyBySlug('acceptable-use')!;
    expect(reread.status).toBe(originalStatus);
    expect(reread.route).toBe(originalRoute);
    expect(reread.version).toBe(originalVersion);
  });

  it('mutating nested policy `audiences` array throws and leaves it unchanged', () => {
    const entry = findPolicyBySlug('recruiting-rules')!;
    const originalLen = entry.audiences.length;
    expect(() => {
      (entry.audiences as PolicyAudienceMutable).push('driver');
    }).toThrow();
    expect(findPolicyBySlug('recruiting-rules')!.audiences.length).toBe(originalLen);
  });

  it('mutating helper-returned arrays (push / pop) throws', () => {
    const live = getLivePolicies();
    expect(() => (live as unknown as PolicyEntryMutable[]).push({} as unknown as PolicyEntryMutable)).toThrow();
    const planned = getPlannedPolicies();
    expect(() => (planned as unknown as PolicyEntryMutable[]).pop()).toThrow();
  });

  it('account-deletion policy description does not commit to a "tax" retention reason', () => {
    const entry = findPolicyBySlug('account-deletion-retention')!;
    // Neutral wording — must not name "tax" as an authoritative retention
    // reason before legal review. Other authoritative reasons (billing,
    // audit, compliance, fraud prevention, disputes, security, lawful /
    // operational reasons) are acceptable.
    expect(/\btax\b/i.test(entry.description)).toBe(false);
  });
});

// Local mutable-shape helpers used only inside immutability tests.
type PolicyAudienceMutable = string[];
type PolicyEntryMutable = { status: string; route: string | null };

describe('docs registry — deep runtime immutability', () => {
  it('outer canonical array is frozen', () => {
    expect(Object.isFrozen(getAllDocs())).toBe(true);
  });

  it('every docs entry object is frozen', () => {
    for (const entry of getAllDocs()) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });

  it('every docs `audiences` and `keywords` array is frozen', () => {
    for (const entry of getAllDocs()) {
      expect(Object.isFrozen(entry.audiences)).toBe(true);
      expect(Object.isFrozen(entry.keywords)).toBe(true);
    }
  });

  it('category-label map is frozen', () => {
    expect(Object.isFrozen(DOCS_CATEGORY_LABELS)).toBe(true);
  });

  it('getDocsByCategory returns a frozen object whose category arrays are frozen and contain frozen entries', () => {
    const grouped = getDocsByCategory();
    expect(Object.isFrozen(grouped)).toBe(true);
    for (const key of Object.keys(grouped) as Array<keyof typeof grouped>) {
      const arr = grouped[key];
      expect(Object.isFrozen(arr)).toBe(true);
      for (const e of arr) expect(Object.isFrozen(e)).toBe(true);
    }
  });

  it('searchDocs ALWAYS returns a newly created frozen array — including empty and whitespace queries', () => {
    const canonical = getAllDocs();

    const emptyResult = searchDocs('');
    expect(Object.isFrozen(emptyResult)).toBe(true);
    // Same contents (canonical order) but NOT the same array identity.
    expect(emptyResult).not.toBe(canonical);
    expect(emptyResult.map((e) => e.id)).toEqual(canonical.map((e) => e.id));

    const wsResult = searchDocs('   ');
    expect(Object.isFrozen(wsResult)).toBe(true);
    expect(wsResult).not.toBe(canonical);
    expect(wsResult).not.toBe(emptyResult);

    const hits = searchDocs('driver');
    expect(Object.isFrozen(hits)).toBe(true);
    expect(hits).not.toBe(canonical);
  });

  it('mutating status / route / title on a docs entry throws and leaves canonical values unchanged', () => {
    const planned = getAllDocs().find((d) => d.status === 'planned' && d.route === null)!;
    const originalStatus = planned.status;
    const originalRoute = planned.route;
    const originalTitle = planned.title;
    expect(() => {
      (planned as unknown as { status: string }).status = 'live';
    }).toThrow();
    expect(() => {
      (planned as unknown as { route: string }).route = '/hijacked';
    }).toThrow();
    expect(() => {
      (planned as unknown as { title: string }).title = 'Hijacked';
    }).toThrow();
    const reread = getAllDocs().find((d) => d.id === planned.id)!;
    expect(reread.status).toBe(originalStatus);
    expect(reread.route).toBe(originalRoute);
    expect(reread.title).toBe(originalTitle);
  });

  it('mutating nested docs `audiences` and `keywords` arrays throws and leaves them unchanged', () => {
    const entry = getAllDocs().find((d) => d.id === 'driver-how-to-use')!;
    const audLen = entry.audiences.length;
    const kwLen = entry.keywords.length;
    expect(() => (entry.audiences as unknown as string[]).push('agency')).toThrow();
    expect(() => (entry.keywords as unknown as string[]).push('injected')).toThrow();
    const reread = getAllDocs().find((d) => d.id === 'driver-how-to-use')!;
    expect(reread.audiences.length).toBe(audLen);
    expect(reread.keywords.length).toBe(kwLen);
  });

  it('mutating helper-returned arrays (push / pop) throws', () => {
    const all = getAllDocs();
    expect(() => (all as unknown as unknown[]).push({} as unknown)).toThrow();

    const grouped = getDocsByCategory();
    const firstKey = Object.keys(grouped)[0] as keyof typeof grouped;
    expect(() => (grouped[firstKey] as unknown as unknown[]).push({} as unknown)).toThrow();

    const search = searchDocs('');
    expect(() => (search as unknown as unknown[]).pop()).toThrow();
  });
});
