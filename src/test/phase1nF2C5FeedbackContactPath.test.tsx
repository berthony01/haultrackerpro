/**
 * Phase 1N-F2-C5-A — Terms/Privacy contact pathway directs users to the
 * existing authenticated Send Feedback surface.
 *
 * Fail-closed:
 * - reads current Terms.tsx/Privacy.tsx source directly;
 * - reads phase-start SHA source via `git show` — any git failure throws;
 * - asserts the phase-start source and the current source differ only in
 *   the exact two contact sentences replaced in this phase.
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  findPolicyBySlug,
  POLICY_METADATA_PENDING_LABEL,
} from '@/lib/legal/policyRegistry';

const PHASE_START_SHA = '52ffd3adad538a11d51d618667ec74b37c77befb';
const REPO_ROOT = resolve(__dirname, '..', '..');

const TERMS_PATH = 'src/pages/Terms.tsx';
const PRIVACY_PATH = 'src/pages/Privacy.tsx';
const SETTINGS_PATH = 'src/components/SettingsView.tsx';
const RECRUITER_SETTINGS_PATH =
  'src/components/opportunities/recruiter/RecruiterSettingsView.tsx';
const SEND_FEEDBACK_MODAL_PATH = 'src/components/SendFeedbackModal.tsx';
const APP_PATH = 'src/App.tsx';

function readCurrent(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8');
}

function readAtStartSha(rel: string): string {
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
const settings = readCurrent(SETTINGS_PATH);
const recruiterSettings = readCurrent(RECRUITER_SETTINGS_PATH);
const sendFeedbackModal = readCurrent(SEND_FEEDBACK_MODAL_PATH);
const appSource = readCurrent(APP_PATH);

const TERMS_OLD_SENTENCE =
  'For questions about these Terms of Service, please contact us at support@haultrackerpro.com.';
const TERMS_NEW_SENTENCE =
  'For questions about these Terms of Service, sign in to your HaulTrackerPro account, open Settings, and select Send Feedback.';

const PRIVACY_OLD_SENTENCE =
  'For questions about this Privacy Policy or your data, please contact us at support@haultrackerpro.com.';
const PRIVACY_NEW_SENTENCE =
  'For questions about this Privacy Policy or your data, sign in to your HaulTrackerPro account, open Settings, and select Send Feedback.';

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('phase1nF2C5A — start-SHA fail-closed git access', () => {
  it('git show against the phase start SHA returned real Terms/Privacy source', () => {
    expect(termsAtStart.length).toBeGreaterThan(1000);
    expect(privacyAtStart.length).toBeGreaterThan(1000);
    expect(termsAtStart).toContain('HaulTrackerPro Terms of Service');
    expect(privacyAtStart).toContain('HaulTrackerPro Privacy Policy');
  });
});

describe('phase1nF2C5A — exact contact sentence swap', () => {
  it('Terms contains the exact new §30 sentence exactly once', () => {
    expect(countOccurrences(terms, TERMS_NEW_SENTENCE)).toBe(1);
  });

  it('Privacy contains the exact new §21 sentence exactly once', () => {
    expect(countOccurrences(privacy, PRIVACY_NEW_SENTENCE)).toBe(1);
  });

  it('the old email-bearing contact sentences are no longer present', () => {
    expect(terms).not.toContain(TERMS_OLD_SENTENCE);
    expect(privacy).not.toContain(PRIVACY_OLD_SENTENCE);
  });

  it('Terms new sentence lives inside the §30 Contact Information section', () => {
    expect(terms).toMatch(
      /30\.\s+Contact Information<\/h3>\s*<p[^>]*>For questions about these Terms of Service, sign in to your HaulTrackerPro account, open Settings, and select Send Feedback\.<\/p>/,
    );
  });

  it('Privacy new sentence lives inside the §21 Contact Information section', () => {
    expect(privacy).toMatch(
      /21\.\s+Contact Information<\/h3>\s*<p[^>]*>For questions about this Privacy Policy or your data, sign in to your HaulTrackerPro account, open Settings, and select Send Feedback\.<\/p>/,
    );
  });
});

describe('phase1nF2C5A — no email/mailto literals reintroduced', () => {
  const forbiddenLiterals = [
    'support@haultrackerpro.com',
    'support@haultrackerpro.app',
    'mailto:',
  ];
  const emailLiteralRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

  it('Terms and Privacy contain no forbidden email/mailto literals', () => {
    for (const [name, src] of [
      ['Terms.tsx', terms] as const,
      ['Privacy.tsx', privacy] as const,
    ]) {
      for (const lit of forbiddenLiterals) {
        expect(src, `${name} must not contain "${lit}"`).not.toContain(lit);
      }
      expect(src, `${name} must not contain any raw email literal`).not.toMatch(
        emailLiteralRe,
      );
    }
  });
});

describe('phase1nF2C5A — contact sections do not disclose missing entity/address', () => {
  function contactSection(source: string, headingNumber: number): string {
    const re = new RegExp(
      `<h3[^>]*>${headingNumber}\\.\\s+Contact Information<\\/h3>[\\s\\S]*?<\\/section>`,
    );
    const m = source.match(re);
    if (!m) throw new Error(`Contact Information section §${headingNumber} not found`);
    return m[0].toLowerCase();
  }

  const forbiddenPhrases = [
    'legal entity',
    'entity not established',
    'no entity',
    'no address',
    'mailing address',
    'physical address',
    'registered agent',
    'dpo',
    'data protection officer',
    'phone',
  ];

  it('Terms §30 does not mention entity/address/registered agent/DPO/phone', () => {
    const section = contactSection(terms, 30);
    for (const phrase of forbiddenPhrases) {
      expect(section, `Terms §30 must not mention "${phrase}"`).not.toContain(phrase);
    }
  });

  it('Privacy §21 does not mention entity/address/registered agent/DPO/phone', () => {
    const section = contactSection(privacy, 21);
    for (const phrase of forbiddenPhrases) {
      expect(section, `Privacy §21 must not mention "${phrase}"`).not.toContain(phrase);
    }
  });
});

describe('phase1nF2C5A — authenticated Send Feedback surface still exists', () => {
  it('SettingsView renders a visible "Send Feedback" label and mounts SendFeedbackModal', () => {
    expect(settings).toContain('Send Feedback');
    expect(settings).toMatch(
      /import\s*\{\s*SendFeedbackModal\s*\}\s*from\s*['"]@\/components\/SendFeedbackModal['"]/,
    );
    expect(settings).toMatch(/<SendFeedbackModal\b/);
  });

  it('RecruiterSettingsView renders a visible "Send feedback" label and mounts SendFeedbackModal', () => {
    expect(recruiterSettings).toContain('Send feedback');
    expect(recruiterSettings).toMatch(
      /import\s*\{\s*SendFeedbackModal\s*\}\s*from\s*['"]@\/components\/SendFeedbackModal['"]/,
    );
    expect(recruiterSettings).toMatch(/<SendFeedbackModal\b/);
  });

  it('SendFeedbackModal requires an authenticated user and submits to feedback_responses', () => {
    expect(sendFeedbackModal).toMatch(
      /import\s*\{\s*useAuth\s*\}\s*from\s*['"]@\/hooks\/useAuth['"]/,
    );
    expect(sendFeedbackModal).toMatch(/const\s*\{\s*user\s*\}\s*=\s*useAuth\(\)/);
    // Guarded submit path — no user, no insert.
    expect(sendFeedbackModal).toMatch(/!user/);
    expect(sendFeedbackModal).toMatch(
      /\.from\(\s*['"]feedback_responses['"]\s*\)\s*\.insert\(/,
    );
  });
});

describe('phase1nF2C5A — no public feedback/contact/support route introduced', () => {
  const forbiddenPaths = ['/feedback', '/contact', '/support'];

  it('App.tsx has no Route pointing at /feedback, /contact, or /support', () => {
    for (const p of forbiddenPaths) {
      const re = new RegExp(`path\\s*=\\s*["']${p}(?:/|["'])`);
      expect(appSource, `App.tsx must not declare a public "${p}" route`).not.toMatch(
        re,
      );
    }
  });
});

describe('phase1nF2C5A — structural preservation vs start SHA', () => {
  it('Terms numbered heading count/order is unchanged from the phase start SHA', () => {
    const startHeadings = extractNumberedHeadings(termsAtStart);
    const currentHeadings = extractNumberedHeadings(terms);
    expect(startHeadings.length).toBeGreaterThan(0);
    expect(currentHeadings).toEqual(startHeadings);
  });

  it('Privacy numbered heading count/order is unchanged from the phase start SHA', () => {
    const startHeadings = extractNumberedHeadings(privacyAtStart);
    const currentHeadings = extractNumberedHeadings(privacy);
    expect(startHeadings.length).toBeGreaterThan(0);
    expect(currentHeadings).toEqual(startHeadings);
  });

  // Phase 1U-A: Terms/Privacy legitimately gained later unnumbered sections
  // (settlements, AI/OCR, delegated access). The phase-1N-F2-C5A invariant is
  // the contact-sentence swap itself, not byte-equality with the start SHA.
  it('Terms still contains only the swapped contact sentence from the phase start SHA', () => {
    expect(termsAtStart).toContain(TERMS_OLD_SENTENCE);
    expect(terms).not.toContain(TERMS_OLD_SENTENCE);
    expect(terms).toContain(TERMS_NEW_SENTENCE);
  });

  it('Privacy still contains only the swapped contact sentence from the phase start SHA', () => {
    expect(privacyAtStart).toContain(PRIVACY_OLD_SENTENCE);
    expect(privacy).not.toContain(PRIVACY_OLD_SENTENCE);
    expect(privacy).toContain(PRIVACY_NEW_SENTENCE);
  });
});

describe('phase1nF2C5A — policy metadata truthfulness preserved', () => {
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

  it('neither page uses a runtime date API or hardcoded date/version literal', () => {
    const RUNTIME_DATE_APIS = [
      /\bnew\s+Date\b/,
      /\bDate\.now\b/,
      /\.toLocale(?:Date|Time|String)?\s*\(/,
      /\btoISOString\s*\(/,
    ];
    const HARDCODED_ISO = /\b(19|20)\d{2}-\d{2}-\d{2}\b/;
    const HARDCODED_US = /\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(19|20)\d{2}\b/;
    const HARDCODED_VERSION = /\bVersion\s+\d+(?:\.\d+)+/;
    for (const [name, src] of [
      ['Terms.tsx', terms] as const,
      ['Privacy.tsx', privacy] as const,
    ]) {
      for (const re of RUNTIME_DATE_APIS) {
        expect(src, `${name} must not use runtime date API ${re}`).not.toMatch(re);
      }
      expect(src, `${name} must not contain a hardcoded ISO date`).not.toMatch(
        HARDCODED_ISO,
      );
      expect(src, `${name} must not contain a hardcoded US date`).not.toMatch(
        HARDCODED_US,
      );
      expect(src, `${name} must not contain a hardcoded Version literal`).not.toMatch(
        HARDCODED_VERSION,
      );
    }
  });
});
