/**
 * Phase 1N-F2-C4-PM — Privacy §6 deletion truthfulness + non-dated
 * "Coverage note:" labels on Terms and Privacy top callouts.
 *
 * Fail-closed:
 * - reads the current-HEAD Terms.tsx / Privacy.tsx source directly;
 * - reads the phase start-SHA source via `git show` for structural
 *   comparison (numbered heading count/order preserved);
 * - git failures throw — never silently pass.
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  findPolicyBySlug,
  POLICY_METADATA_PENDING_LABEL,
} from '@/lib/legal/policyRegistry';
import {
  getArticleBySlug,
  articleRoute,
} from '@/lib/docs/docsArticles';

const PHASE_START_SHA = 'dc2daf17bca7dd62e01b5b0a1006da159e4fc418';
const REPO_ROOT = resolve(__dirname, '..', '..');

const TERMS_PATH = 'src/pages/Terms.tsx';
const PRIVACY_PATH = 'src/pages/Privacy.tsx';

function readCurrent(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8');
}

function readAtStartSha(rel: string): string {
  // Throws on any git failure — do not swallow.
  return execFileSync('git', ['show', `${PHASE_START_SHA}:${rel}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

function extractNumberedHeadings(source: string): string[] {
  const re = /"text-base font-bold">(\d+\.\s+[^<]+)</g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push(m[1].trim());
  return out;
}

const terms = readCurrent(TERMS_PATH);
const privacy = readCurrent(PRIVACY_PATH);
const termsAtStart = readAtStartSha(TERMS_PATH);
const privacyAtStart = readAtStartSha(PRIVACY_PATH);

// Runtime date / hardcoded date regexes.
const RUNTIME_DATE_APIS = [
  /\bnew\s+Date\b/,
  /\bDate\.now\b/,
  /\.toLocale(?:Date|Time|String)?\s*\(/,
  /\btoISOString\s*\(/,
];
const HARDCODED_ISO = /\b(19|20)\d{2}-\d{2}-\d{2}\b/;
const HARDCODED_US = /\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(19|20)\d{2}\b/;
const HARDCODED_VERSION = /\bVersion\s+\d+(?:\.\d+)+/;

describe('phase1nF2C4PM — start-SHA structural preservation', () => {
  it('Terms retains the same numbered section count/order as the phase start SHA', () => {
    const startHeadings = extractNumberedHeadings(termsAtStart);
    const currentHeadings = extractNumberedHeadings(terms);
    expect(startHeadings.length).toBeGreaterThan(0);
    expect(currentHeadings).toEqual(startHeadings);
  });

  it('Privacy retains the same numbered section count/order as the phase start SHA', () => {
    const startHeadings = extractNumberedHeadings(privacyAtStart);
    const currentHeadings = extractNumberedHeadings(privacy);
    expect(startHeadings.length).toBeGreaterThan(0);
    expect(currentHeadings).toEqual(startHeadings);
  });

  it('git show against the phase start SHA actually returned real source (fail-closed)', () => {
    expect(termsAtStart.length).toBeGreaterThan(1000);
    expect(privacyAtStart.length).toBeGreaterThan(1000);
    expect(termsAtStart).toContain('HaulTrackerPro Terms of Service');
    expect(privacyAtStart).toContain('HaulTrackerPro Privacy Policy');
  });
});

describe('phase1nF2C4PM — Terms top callout label', () => {
  it('Terms top callout uses "Coverage note:" and preserves the rest of the sentence', () => {
    expect(terms).toContain(
      '<span className="font-semibold text-primary">Coverage note:</span> These terms now cover both driver/owner-operator accounts and recruiter/carrier accounts, including verification, anti-harassment, anti-scam, and billing terms.',
    );
  });

  it('Terms no longer renders a visible "Updated:" label in the top callout', () => {
    expect(terms).not.toContain(
      '<span className="font-semibold text-primary">Updated:</span>',
    );
    expect(terms).not.toMatch(/>\s*Updated:\s*</);
  });
});

describe('phase1nF2C4PM — Privacy top callout label', () => {
  it('Privacy top callout uses "Coverage note:" and preserves the rest of the sentence', () => {
    expect(privacy).toContain(
      '<span className="font-semibold text-primary">Coverage note:</span> This policy now describes data collected from recruiter and carrier accounts, what drivers see, and how Stripe handles billing data.',
    );
  });

  it('Privacy no longer renders a visible "Updated:" label in the top callout', () => {
    expect(privacy).not.toContain(
      '<span className="font-semibold text-primary">Updated:</span>',
    );
    expect(privacy).not.toMatch(/>\s*Updated:\s*</);
  });
});

describe('phase1nF2C4PM — Privacy §6 factual reconciliation', () => {
  it('preserves the exact first sentence of §6', () => {
    expect(privacy).toContain('We retain your data for as long as your account is active.');
  });

  it('does not contain any unconditional whole-account erasure promise', () => {
    const forbidden = [
      'all associated data is permanently removed',
      'all associated data',
      'everything tied to your account',
      'every record',
    ];
    for (const phrase of forbidden) {
      expect(
        privacy.includes(phrase),
        `Privacy must not contain forbidden erasure phrase: "${phrase}"`,
      ).toBe(false);
    }
  });

  it('contains every required product-truth concept from C3', () => {
    const required = [
      'direct personal operational records',
      'transactional cleanup',
      'shared',
      'audit',
      'billing or payment',
      'application',
      'contract or signature',
      'security',
      'fraud-prevention',
      'dispute',
      'legal or compliance',
      'backup',
      'third-party-held',
      'retained',
      'detached',
      'anonymized',
      'remain',
      'operationally or lawfully necessary',
    ];
    for (const concept of required) {
      expect(privacy, `Privacy must contain concept: "${concept}"`).toContain(concept);
    }
  });

  it('contains the exact new §6 product-truth sentence verbatim', () => {
    expect(privacy).toContain(
      'When you permanently delete your account, direct personal operational records are targeted for transactional cleanup. Some shared, audit, billing or payment, application, contract or signature, security, fraud-prevention, dispute, legal or compliance, backup, or third-party-held records may be retained, detached, anonymized, or remain where operationally or lawfully necessary.',
    );
  });
});

describe('phase1nF2C4PM — deletion-details link', () => {
  it('renders exactly one link with the required label and route', () => {
    const label = 'Review account deletion and data retention details.';
    const occurrences = privacy.split(label).length - 1;
    expect(occurrences).toBe(1);
    // Link with react-router-dom must target the docs slug via `to="…"`.
    expect(privacy).toMatch(
      /<Link\s+to="\/docs\/account-deletion-data-retention"[^>]*>\s*Review account deletion and data retention details\.\s*<\/Link>/,
    );
  });

  it('imports Link from react-router-dom', () => {
    expect(privacy).toMatch(/from\s+['"]react-router-dom['"]/);
    expect(privacy).toMatch(/\bLink\b/);
  });

  it('docs slug "account-deletion-data-retention" resolves to a canonical live article', () => {
    const article = getArticleBySlug('account-deletion-data-retention');
    expect(article).not.toBeNull();
    expect(articleRoute('account-deletion-data-retention')).toBe(
      '/docs/account-deletion-data-retention',
    );
  });
});

describe('phase1nF2C4PM — metadata truthfulness preserved', () => {
  it('Terms and Privacy still import findPolicyBySlug and POLICY_METADATA_PENDING_LABEL', () => {
    for (const src of [terms, privacy]) {
      expect(src).toMatch(/findPolicyBySlug/);
      expect(src).toMatch(/POLICY_METADATA_PENDING_LABEL/);
    }
  });

  it('registry entries for terms and privacy still have null version and effectiveDate', () => {
    const t = findPolicyBySlug('terms');
    const p = findPolicyBySlug('privacy');
    expect(t).not.toBeNull();
    expect(p).not.toBeNull();
    expect(t!.version).toBeNull();
    expect(t!.effectiveDate).toBeNull();
    expect(p!.version).toBeNull();
    expect(p!.effectiveDate).toBeNull();
  });

  it('POLICY_METADATA_PENDING_LABEL is a non-empty pending sentinel', () => {
    expect(typeof POLICY_METADATA_PENDING_LABEL).toBe('string');
    expect(POLICY_METADATA_PENDING_LABEL.length).toBeGreaterThan(0);
  });

  it('neither page uses a runtime date API, "Last Updated:", nor a hardcoded date/version literal', () => {
    for (const [name, src] of [
      ['Terms.tsx', terms] as const,
      ['Privacy.tsx', privacy] as const,
    ]) {
      expect(src, `${name} must not contain "Last Updated:"`).not.toMatch(/Last Updated:/);
      for (const re of RUNTIME_DATE_APIS) {
        expect(src, `${name} must not use runtime date API ${re}`).not.toMatch(re);
      }
      expect(src, `${name} must not contain a hardcoded ISO date`).not.toMatch(HARDCODED_ISO);
      expect(src, `${name} must not contain a hardcoded US date`).not.toMatch(HARDCODED_US);
      expect(src, `${name} must not contain a hardcoded Version literal`).not.toMatch(
        HARDCODED_VERSION,
      );
    }
  });
});
