/**
 * Phase 1N-F2-C1 — Core role-aware Help Center articles.
 *
 * Proves the article registry contract (five slugs, five routes, deep
 * runtime immutability, no runtime dates, no HTML injection), the required
 * factual content boundaries for each of the five articles, docs-registry
 * ↔ article-route parity, planned-controls remain unlinked, App.tsx route
 * shape, and fail-closed phase/cumulative-diff scope.
 */

import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';

import {
  DOCS_ARTICLE_ROUTE_PREFIX,
  articleRoute,
  getAllArticleRoutes,
  getAllArticles,
  getArticleBySlug,
  type DocsArticle,
  type DocsArticleCallout,
  type DocsArticleSection,
} from '@/lib/docs/docsArticles';
import { getAllDocs } from '@/lib/docs/docsRegistry';
import DocsArticlePage from '@/pages/DocsArticle';

const PHASE_START_SHA = '08206a82d6705a772b9d1158ee531e7bc0232b01';
const BASELINE_SHA = '3926bec94121cfca616a56e006d2a952e654a338';
// Immutable accepted endpoint for the F2-C1 historical phase scope. Any
// later authorized edits (F2-C1-R2, R3, ...) occur only inside already-
// authorized test files and must NOT rewrite the historical phase
// boundary. Endpoint pinning — never compare historical scope to HEAD.
const F2C1_ACCEPTED_SHA = '821d7e016479f12b323e6af2e70b131538c5746c';

const REQUIRED_SLUGS = [
  'billing-cancellation',
  'account-deletion-data-retention',
  'roles-access-relationships',
  'ai-ocr-calculation-limitations',
  'opportunity-recruiting-safety',
  'settlement-statements-reconciliation',
] as const;

const REQUIRED_ROUTES = REQUIRED_SLUGS.map((s) => `/docs/${s}`);

const PHASE_ALLOWED_FILES = [
  'src/App.tsx',
  'src/lib/docs/docsArticles.ts',
  'src/lib/docs/docsRegistry.ts',
  'src/pages/DocsArticle.tsx',
  'src/test/phase1nF2CoreDocsArticles.test.ts',
].sort();

const CUMULATIVE_ALLOWED_FILES = [
  'src/App.tsx',
  'src/lib/docs/docsArticles.ts',
  'src/lib/docs/docsRegistry.ts',
  'src/lib/legal/policyRegistry.ts',
  'src/pages/Docs.tsx',
  'src/pages/DocsArticle.tsx',
  'src/pages/LegalCenter.tsx',
  'src/test/phase1nF2CoreDocsArticles.test.ts',
  'src/test/phase1nF2DocsLegalFoundation.test.ts',
].sort();

// ---------------------------------------------------------------------------
// Registry shape
// ---------------------------------------------------------------------------
describe('article registry shape', () => {
  it('exposes exactly the five required unique slugs in canonical order', () => {
    const slugs = getAllArticles().map((a) => a.slug);
    expect(slugs).toEqual(REQUIRED_SLUGS);
    expect(new Set(slugs).size).toBe(REQUIRED_SLUGS.length);
  });

  it('exposes exactly the five required route paths', () => {
    const routes = getAllArticleRoutes();
    expect([...routes].sort()).toEqual([...REQUIRED_ROUTES].sort());
    for (const r of routes) expect(r.startsWith(DOCS_ARTICLE_ROUTE_PREFIX)).toBe(true);
  });

  it('every article has the fixed reviewed-for-product-accuracy date literal', () => {
    for (const a of getAllArticles()) {
      expect(a.reviewedForProductAccuracy).toBe('2026-08-10');
    }
  });

  it('every article has meaningful sections, audiences, category, summary, and at least one caution/important callout', () => {
    for (const a of getAllArticles()) {
      expect(a.summary.length).toBeGreaterThan(20);
      expect(a.audiences.length).toBeGreaterThan(0);
      expect(typeof a.category).toBe('string');
      expect(a.sections.length).toBeGreaterThanOrEqual(3);
      for (const s of a.sections) {
        expect(s.heading.length).toBeGreaterThan(0);
        const hasContent =
          (s.paragraphs?.length ?? 0) > 0 ||
          (s.bullets?.length ?? 0) > 0 ||
          (s.callouts?.length ?? 0) > 0;
        expect(hasContent).toBe(true);
      }
      const allCallouts: DocsArticleCallout[] = [
        ...(a.callouts ?? []),
        ...a.sections.flatMap((s: DocsArticleSection) => s.callouts ?? []),
      ];
      const hasCautionOrImportant = allCallouts.some(
        (c) => c.tone === 'caution' || c.tone === 'important',
      );
      expect(hasCautionOrImportant).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Deep runtime immutability
// ---------------------------------------------------------------------------
describe('deep runtime immutability', () => {
  it('outer array and every article are frozen', () => {
    const list = getAllArticles();
    expect(Object.isFrozen(list)).toBe(true);
    for (const a of list) expect(Object.isFrozen(a)).toBe(true);
  });

  it('every nested audiences/sections/paragraphs/bullets/callouts/relatedRoutes is frozen', () => {
    for (const a of getAllArticles()) {
      expect(Object.isFrozen(a.audiences)).toBe(true);
      expect(Object.isFrozen(a.sections)).toBe(true);
      for (const s of a.sections) {
        expect(Object.isFrozen(s)).toBe(true);
        if (s.paragraphs) expect(Object.isFrozen(s.paragraphs)).toBe(true);
        if (s.bullets) expect(Object.isFrozen(s.bullets)).toBe(true);
        if (s.callouts) {
          expect(Object.isFrozen(s.callouts)).toBe(true);
          for (const c of s.callouts) expect(Object.isFrozen(c)).toBe(true);
        }
      }
      if (a.relatedRoutes) {
        expect(Object.isFrozen(a.relatedRoutes)).toBe(true);
        for (const r of a.relatedRoutes) expect(Object.isFrozen(r)).toBe(true);
      }
    }
  });

  it('mutation attempts throw in strict mode and do not corrupt canonical state', () => {
    const list = getAllArticles();
    expect(() => {
      (list as unknown as DocsArticle[]).push({} as DocsArticle);
    }).toThrow();
    const first = list[0];
    expect(() => {
      (first as unknown as { slug: string }).slug = 'mutated';
    }).toThrow();
    expect(() => {
      (first.audiences as unknown as string[]).push('driver');
    }).toThrow();
    expect(() => {
      (first.sections as unknown as DocsArticleSection[]).push({ heading: 'x' } as DocsArticleSection);
    }).toThrow();
    // Canonical state intact.
    expect(getAllArticles()[0].slug).toBe(REQUIRED_SLUGS[0]);
  });

  it('helper results are frozen and independent of registry identity where applicable', () => {
    const routes = getAllArticleRoutes();
    expect(Object.isFrozen(routes)).toBe(true);
    expect(() => {
      (routes as unknown as string[]).push('/docs/x');
    }).toThrow();
    const same = getAllArticles();
    expect(same).toBe(getAllArticles()); // canonical
    const byslug = getArticleBySlug(REQUIRED_SLUGS[0]);
    expect(byslug).not.toBeNull();
    expect(Object.isFrozen(byslug)).toBe(true);
    expect(getArticleBySlug('does-not-exist')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// No runtime dates, no HTML injection (source scan)
// ---------------------------------------------------------------------------
describe('no runtime dates / no raw HTML in article sources', () => {
  const files = [
    'src/lib/docs/docsArticles.ts',
    'src/pages/DocsArticle.tsx',
  ];

  it('does not use runtime date APIs', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/new\s+Date\s*\(/);
      expect(src).not.toMatch(/Date\.now\s*\(/);
      expect(src).not.toMatch(/toLocaleDateString/);
      expect(src).not.toMatch(/toLocaleString/);
      expect(src).not.toMatch(/toLocaleTimeString/);
    }
  });

  it('does not use dangerouslySetInnerHTML or inject raw HTML', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toContain('dangerouslySetInnerHTML');
    }
  });
});

// ---------------------------------------------------------------------------
// Article ↔ registry parity
// ---------------------------------------------------------------------------
describe('docs registry ↔ article parity', () => {
  it('every article slug maps to exactly one live docs-registry entry with the correct /docs/ route', () => {
    const entries = getAllDocs();
    for (const a of getAllArticles()) {
      const expectedRoute = articleRoute(a.slug);
      const matches = entries.filter((e) => e.route === expectedRoute);
      expect(matches.length).toBe(1);
      expect(matches[0].status).toBe('live');
    }
  });

  it('every live /docs/ registry entry resolves to a canonical article', () => {
    const entries = getAllDocs();
    const liveArticleEntries = entries.filter(
      (e) => e.status === 'live' && e.route !== null && e.route.startsWith('/docs/'),
    );
    expect(liveArticleEntries.length).toBe(REQUIRED_SLUGS.length);
    for (const e of liveArticleEntries) {
      const slug = e.route!.slice('/docs/'.length);
      expect(getArticleBySlug(slug)).not.toBeNull();
    }
  });

  it('the five required registry ids are live and point at the exact required routes', () => {
    const entries = getAllDocs();
    const required: Record<string, string> = {
      'billing-cancellation-refunds': '/docs/billing-cancellation',
      'account-deletion-data-retention': '/docs/account-deletion-data-retention',
      'roles-access-relationships': '/docs/roles-access-relationships',
      'ai-ocr-calculations-limits': '/docs/ai-ocr-calculation-limitations',
      'opportunities-safety-guide': '/docs/opportunity-recruiting-safety',
    };
    for (const [id, route] of Object.entries(required)) {
      const entry = entries.find((e) => e.id === id);
      expect(entry, `missing registry entry ${id}`).toBeDefined();
      expect(entry!.status).toBe('live');
      expect(entry!.route).toBe(route);
    }
  });

  it('planned role-exit and consent controls remain planned with null route', () => {
    const entries = getAllDocs();
    const stillPlanned = [
      'recruiter-profile-closure',
      'assistant-self-leave',
      'agency-transfer-closure',
      'universal-consent-controls',
    ];
    for (const id of stillPlanned) {
      const entry = entries.find((e) => e.id === id);
      expect(entry, `missing planned entry ${id}`).toBeDefined();
      expect(entry!.status).toBe('planned');
      expect(entry!.route).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Article factual-content boundaries
// ---------------------------------------------------------------------------
function fullText(a: DocsArticle): string {
  const parts: string[] = [a.title, a.summary];
  for (const s of a.sections) {
    parts.push(s.heading);
    if (s.paragraphs) parts.push(...s.paragraphs);
    if (s.bullets) parts.push(...s.bullets);
    if (s.callouts) for (const c of s.callouts) parts.push(c.title, c.body);
  }
  if (a.callouts) for (const c of a.callouts) parts.push(c.title, c.body);
  return parts.join('\n').toLowerCase();
}

describe('article factual content', () => {
  it('Billing article covers cancel-only vs permanent deletion, agency billing, no refund guarantee, portal as source of truth', () => {
    const a = getArticleBySlug('billing-cancellation')!;
    const t = fullText(a);
    expect(t).toContain('stripe');
    expect(t).toContain('portal');
    expect(t).toMatch(/source of truth/);
    expect(t).toMatch(/agency (billing|owner)/);
    expect(t).toMatch(/permanent (personal-account )?deletion/);
    // No refund guarantee.
    expect(t).not.toMatch(/we guarantee (a )?refund/);
    expect(t).not.toMatch(/refund is guaranteed/);
    expect(t).toMatch(/does not promise refunds/);
    // Distinction present.
    expect(t).toMatch(/cancellation is not deletion/);
  });

  it('Deletion article covers owner block, Stripe-before-cleanup, transactional rollback, auth deletion last, no "all data" promise, retained records', () => {
    const a = getArticleBySlug('account-deletion-data-retention')!;
    const t = fullText(a);
    expect(t).toMatch(/agency[- ]owner block/);
    expect(t).toMatch(/stripe cancellation/);
    expect(t).toMatch(/transaction/);
    expect(t).toMatch(/roll back|rolls back|rollback/);
    expect(t).toMatch(/authentication user (record )?is deleted last/);
    expect(t).not.toMatch(/all your data (is|will be) deleted/);
    expect(t).not.toMatch(/deletes all data/);
    expect(t).toMatch(/does not claim that "all data" is deleted/);
    expect(t).toMatch(/retained|retention|anonymized|preserved/);
    expect(t).toMatch(/third part(y|ies)/);
  });

  it('Roles article marks all four missing self-service controls as unavailable and does not imply they exist', () => {
    const a = getArticleBySlug('roles-access-relationships')!;
    const t = fullText(a);
    const missing = [
      /assistant .*leave.* not yet available/,
      /agency-member .*leave.* not yet available/,
      /agency ownership transfer and self-service agency closure are not yet available/,
      /recruiter-profile-only closure is not yet available/,
    ];
    for (const re of missing) expect(t).toMatch(re);
    // Do not claim these controls exist affirmatively.
    expect(t).not.toMatch(/click .* to leave the agency/);
    expect(t).not.toMatch(/use the transfer ownership button/);
    // Never advise sharing credentials.
    expect(t).toMatch(/never share (passwords|credentials)/);
  });

  it('AI/OCR article includes independent-review requirement and no legal/tax/accounting guarantee', () => {
    const a = getArticleBySlug('ai-ocr-calculation-limitations')!;
    const t = fullText(a);
    expect(t).toMatch(/independently|compare to the original|review/);
    expect(t).toMatch(/not (legal advice|attorney)/);
    expect(t).toMatch(/does not guarantee (tax|audit|deductions|compliance)/);
    expect(t).toMatch(/organizational estimates/);
  });

  it('Opportunity article includes driver + recruiter obligations, independent verification, no blanket verification, and platform-obligations qualifier', () => {
    const a = getArticleBySlug('opportunity-recruiting-safety')!;
    const t = fullText(a);
    expect(t).toMatch(/for drivers/);
    expect(t).toMatch(/for recruiters/);
    expect(t).toMatch(/independently verify|verify identity|carrier .* authority/);
    expect(t).toMatch(/no blanket verification|does not claim that every/);
    expect(t).toMatch(/does not disclaim haultrackerpro’s own legal obligations|own legal obligations/);
    // Not the employer/broker.
    expect(t).toMatch(/not the employer/);
  });

  it('no article makes affirmative platform guarantees; warning language about third-party claims is allowed', () => {
    // Fail-closed: prohibit affirmative platform promises only. Warnings that
    // caution users about third-party "guaranteed earnings" claims are risk
    // advice and must remain permitted.
    const forbiddenAffirmative: RegExp[] = [
      /haultrackerpro guarantees/,
      /\bwe guarantee\b/,
      /\byou are guaranteed\b/,
      /\bwill always\b/,
      /all data will be deleted/,
      /complete erasure is guaranteed/,
      /protection from liability/,
      /immune from liability/,
    ];
    for (const a of getAllArticles()) {
      const t = fullText(a);
      for (const re of forbiddenAffirmative) {
        expect(t, `${a.slug} contains forbidden affirmative promise ${re}`).not.toMatch(re);
      }
    }
  });

  it('opportunity article warns about third-party "guaranteed earnings" claims in a red-flag/warning context and never states HaulTrackerPro guarantees earnings', () => {
    const a = getArticleBySlug('opportunity-recruiting-safety')!;
    const t = fullText(a);
    // Warning language is present.
    expect(t).toMatch(/guaranteed earnings/);
    // Presented as a caution / red flag / warning, not as a platform promise.
    expect(t).toMatch(/red flag|red-flag|warning|caution/);
    // Never an affirmative HaulTrackerPro earnings promise.
    expect(t).not.toMatch(/haultrackerpro guarantees earnings/);
    expect(t).not.toMatch(/we guarantee earnings/);
    expect(t).not.toMatch(/you are guaranteed earnings/);
  });

  it('billing article no longer says every context has "its own Stripe subscription" and documents shared-ID deduplication', () => {
    const a = getArticleBySlug('billing-cancellation')!;
    const t = fullText(a);
    expect(t).not.toMatch(/each context has its own stripe subscription/);
    expect(t).toMatch(/contexts are tracked separately/);
    expect(t).toMatch(/same stripe subscription id/);
    expect(t).toMatch(/deduplicate/);
  });

  it('deletion article owner-block text does not use an "active agency workspace" qualifier and refers to any agency profile/workspace recording the caller as owner', () => {
    const a = getArticleBySlug('account-deletion-data-retention')!;
    const t = fullText(a);
    expect(t).not.toMatch(/active agency workspace/);
    expect(t).toMatch(/agency profile\/workspace still records you as its owner|records you as (its )?owner/);
    expect(t).toMatch(/does not inspect an active\/inactive qualifier/);
  });

  it('deletion article does not absolutely promise HaulTrackerPro cannot restore records; it says treat successful deletion as irreversible with no self-service undo/restore', () => {
    const a = getArticleBySlug('account-deletion-data-retention')!;
    const t = fullText(a);
    expect(t).not.toMatch(/haultrackerpro is not able to restore/);
    expect(t).not.toMatch(/haultrackerpro cannot restore/);
    expect(t).not.toMatch(/we cannot restore/);
    expect(t).toMatch(/treat (a )?successful (permanent )?deletion as irreversible/);
    expect(t).toMatch(/no self-service undo/);
    expect(t).toMatch(/export .* before you confirm deletion/);
  });

  it('article source and flattened article text contain no literal backslash-u escape sequences', () => {
    const src = readFileSync('src/lib/docs/docsArticles.ts', 'utf8');
    // Source: no literal "\u2019" or generic backslash-u escape in article strings.
    expect(src).not.toMatch(/\\u2019/);
    expect(src).not.toMatch(/\\u[0-9a-fA-F]{4}/);
    for (const a of getAllArticles()) {
      const t = fullText(a);
      expect(t).not.toContain('\\u');
      expect(t).not.toContain('\\u2019');
    }
    // Platform-own-obligations sentence remains present with a real apostrophe.
    const opp = getArticleBySlug('opportunity-recruiting-safety')!;
    const oppText = fullText(opp);
    expect(oppText).toMatch(/haultrackerpro's own legal obligations/);
  });
});

// ---------------------------------------------------------------------------
// Article page rendering
// ---------------------------------------------------------------------------
function renderAt(path: string) {
  return render(
    React.createElement(
      HelmetProvider,
      null,
      React.createElement(
        MemoryRouter,
        { initialEntries: [path] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, {
            path: '/docs/:articleSlug',
            element: React.createElement(DocsArticlePage),
          }),
        ),
      ),
    ),
  );
}

describe('DocsArticle page', () => {
  it('renders a valid article with structured headings, no raw HTML, and product-documentation label', () => {
    renderAt('/docs/billing-cancellation');
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /billing, renewals, cancellation, and permanent deletion/i,
      }),
    ).toBeTruthy();
    // Page intentionally references "Product documentation" more than once
    // (label chip + disclaimer). Assert at least two, not a single match.
    const productDocMatches = screen.getAllByText(/product documentation/i);
    expect(productDocMatches.length).toBeGreaterThanOrEqual(2);
    // Reviewed-for-product-accuracy fixed literal appears.
    expect(screen.getByText(/2026-08-10/)).toBeTruthy();
    // No raw HTML in source.
    const src = readFileSync('src/pages/DocsArticle.tsx', 'utf8');
    expect(src).not.toContain('dangerouslySetInnerHTML');
  });

  it('renders a professional not-found state for unknown slugs (no silent redirect)', () => {
    renderAt('/docs/does-not-exist-xyz');
    expect(
      screen.getByRole('heading', { level: 1, name: /this help article isn’t available/i }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: /back to help center/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /return home/i })).toBeTruthy();
  });

  it('renders every required article without throwing', () => {
    for (const slug of REQUIRED_SLUGS) {
      const { unmount } = renderAt(`/docs/${slug}`);
      expect(screen.getAllByRole('heading', { level: 1 }).length).toBeGreaterThan(0);
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// App route shape
// ---------------------------------------------------------------------------
describe('App.tsx route shape', () => {
  const src = readFileSync('src/App.tsx', 'utf8');
  it('has exactly one /docs/:articleSlug route and preserves /docs', () => {
    const dynamicMatches = src.match(/path="\/docs\/:articleSlug"/g) ?? [];
    expect(dynamicMatches.length).toBe(1);
    const docsRoot = src.match(/path="\/docs"/g) ?? [];
    expect(docsRoot.length).toBeGreaterThanOrEqual(1);
    expect(src).toContain('DocsArticle');
  });
});

// ---------------------------------------------------------------------------
// Fail-closed phase and cumulative diff scope
// ---------------------------------------------------------------------------
describe('phase diff integrity (fail-closed)', () => {
  const runGitStrict = (args: string): string => {
    try {
      return execSync(`git ${args}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
        .toString()
        .trim();
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer | string; message?: string };
      const stderr = e.stderr ? e.stderr.toString() : '';
      throw new Error(
        `git ${args} failed (exit ${e.status ?? 'n/a'}): ${e.message ?? ''}\nstderr: ${stderr}`,
      );
    }
  };

  // Fail-closed ancestor proof: throws diagnostic on failure, never
  // silently converts a failure into PASS.
  const assertIsAncestor = (ancestor: string, descendant: string) => {
    try {
      execSync(`git merge-base --is-ancestor ${ancestor} ${descendant}`, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer | string };
      throw new Error(
        `git merge-base --is-ancestor ${ancestor} ${descendant} failed (exit ${
          e.status ?? 'n/a'
        }); ${e.stderr ? e.stderr.toString() : ''}`,
      );
    }
  };

  it('BASELINE_SHA is an ancestor of PHASE_START_SHA', () => {
    assertIsAncestor(BASELINE_SHA, PHASE_START_SHA);
  });

  it('PHASE_START_SHA is an ancestor of F2C1_ACCEPTED_SHA', () => {
    assertIsAncestor(PHASE_START_SHA, F2C1_ACCEPTED_SHA);
  });

  it('F2C1_ACCEPTED_SHA remains reachable from current HEAD', () => {
    assertIsAncestor(F2C1_ACCEPTED_SHA, 'HEAD');
  });

  it('historical phase diff PHASE_START_SHA..F2C1_ACCEPTED_SHA is exactly the five allowlisted files', () => {
    const raw = runGitStrict(
      `diff --name-only ${PHASE_START_SHA}...${F2C1_ACCEPTED_SHA}`,
    );
    const changed = raw ? raw.split('\n').map((s) => s.trim()).filter(Boolean).sort() : [];
    expect(changed).toEqual(PHASE_ALLOWED_FILES);
  });

  it('historical cumulative diff BASELINE_SHA..F2C1_ACCEPTED_SHA equals the accepted F2-B + F2-C1 file set (no .lovable/plan.md, no supabase/*)', () => {
    const raw = runGitStrict(
      `diff --name-only ${BASELINE_SHA}...${F2C1_ACCEPTED_SHA}`,
    );
    const changed = raw ? raw.split('\n').map((s) => s.trim()).filter(Boolean).sort() : [];
    expect(changed).toEqual(CUMULATIVE_ALLOWED_FILES);
    expect(changed).not.toContain('.lovable/plan.md');
    for (const f of changed) {
      expect(f.startsWith('supabase/migrations/')).toBe(false);
      expect(f.startsWith('supabase/migration-candidates/')).toBe(false);
      expect(f.startsWith('supabase/functions/')).toBe(false);
    }
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
    for (const f of forbidden) expect(changed).not.toContain(f);
  });

  // Future-phase safety: the historical scope commands in THIS section
  // must end at F2C1_ACCEPTED_SHA, not at HEAD. The only HEAD-based git
  // use permitted here is proving the accepted endpoint remains
  // reachable from HEAD.
  it('historical scope commands are endpoint-pinned to F2C1_ACCEPTED_SHA (not HEAD)', () => {
    const src = readFileSync('src/test/phase1nF2CoreDocsArticles.test.ts', 'utf8');
    // Isolate this describe block to avoid matching unrelated commentary.
    const start = src.indexOf('phase diff integrity (fail-closed)');
    expect(start).toBeGreaterThan(-1);
    const section = src.slice(start);
    // Every `git diff --name-only ...` in the historical-scope section
    // must terminate at F2C1_ACCEPTED_SHA; none may terminate at HEAD.
    // Match only real historical-scope helper invocations. This excludes
    // this meta-check block's own descriptive prose by requiring the
    // exact SHA-constant identifiers used above.
    const diffCalls =
      section.match(
        /runGitStrict\(\s*`diff --name-only \$\{[A-Z0-9_]+\}\.\.\.\$\{[A-Z0-9_]+\}`/g,
      ) ?? [];
    expect(diffCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of diffCalls) {
      // Right-hand endpoint must be F2C1_ACCEPTED_SHA.
      expect(call).toMatch(/\.\.\.\$\{F2C1_ACCEPTED_SHA\}`$/);
      expect(call).not.toContain('HEAD');
    }
    // The only HEAD-based git call permitted in this section is the
    // ancestor proof that F2C1_ACCEPTED_SHA is reachable from HEAD.
    expect(section).toContain(
      "assertIsAncestor(F2C1_ACCEPTED_SHA, 'HEAD')",
    );
    // Fail-closed contract: no silent-fallback patterns.
    expect(section).not.toMatch(/\|\|\s*true/);
    expect(section).not.toMatch(/catch\s*\([^)]*\)\s*\{\s*\}/);
  });
});
