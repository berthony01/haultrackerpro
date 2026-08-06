import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Phase 1S-A3 — Final Marketing Truth Polish
 * Static contract suite: recruiter marketing copy must match shipped behavior,
 * and the driver feature sheet must name OCR automation accurately.
 */

const recruiterSrc = readFileSync(resolve(process.cwd(), 'src/lib/recruiterFeatureList.ts'), 'utf8');
const featureSrc = readFileSync(resolve(process.cwd(), 'src/lib/featureList.ts'), 'utf8');
const agencySrc = readFileSync(resolve(process.cwd(), 'src/lib/agencyPlans.ts'), 'utf8');

const NEW_DESCRIPTIONS = [
  'Every driver application appears in your pipeline with the driver’s submitted profile details and message. Phone and email are revealed only after the driver approves a separate contact request.',
  'Move applicants through the recruiter-controlled stages available in the dashboard. Hired status remains protected by the contract-approval workflow and cannot be set directly before the required driver decision.',
  'Review the driver’s available profile details in the application pipeline. Private phone and email details appear only after the driver approves your contact request.',
  'View Total Applicants, Open Applicants, Hired Drivers, and Hire Rate on the Recruiter Dashboard.',
  'Open Stripe’s secure customer portal from Recruiter Settings to manage the billing details and subscription actions currently enabled for your account. Available options and timing are controlled by the Stripe portal configuration.',
];

const OBSOLETE_PHRASES = [
  'with their preferences, contact info, and message',
  'with a single click',
  'at the moment they request info',
  'Track response rate, hires, and interview counts',
  'changes take effect at the end of your current period',
];

describe('Phase 1S-A3 — recruiter marketing truth', () => {
  it('contains the five corrected descriptions verbatim', () => {
    for (const d of NEW_DESCRIPTIONS) {
      expect(recruiterSrc).toContain(d);
    }
  });

  it('no longer contains obsolete or misleading phrases', () => {
    for (const p of OBSOLETE_PHRASES) {
      expect(recruiterSrc).not.toContain(p);
    }
  });

  it('requires driver approval before phone/email disclosure in both contact descriptions', () => {
    expect(recruiterSrc).toContain(
      'Phone and email are revealed only after the driver approves a separate contact request.',
    );
    expect(recruiterSrc).toContain(
      'Private phone and email details appear only after the driver approves your contact request.',
    );
  });

  it('states hired status is contract/driver-decision protected', () => {
    expect(recruiterSrc).toContain(
      'Hired status remains protected by the contract-approval workflow and cannot be set directly before the required driver decision.',
    );
  });

  it('names exactly the four rendered dashboard metrics', () => {
    const metricsLine =
      'View Total Applicants, Open Applicants, Hired Drivers, and Hire Rate on the Recruiter Dashboard.';
    expect(recruiterSrc).toContain(metricsLine);
    for (const m of ['Total Applicants', 'Open Applicants', 'Hired Drivers', 'Hire Rate']) {
      expect(metricsLine).toContain(m);
    }
    expect(metricsLine).not.toMatch(/response rate|interview/i);
  });

  it('describes the billing portal as Stripe’s secure customer portal without timing promises', () => {
    expect(recruiterSrc).toContain('Open Stripe’s secure customer portal from Recruiter Settings');
    expect(recruiterSrc).toContain(
      'Available options and timing are controlled by the Stripe portal configuration.',
    );
    expect(recruiterSrc).not.toMatch(/end of your current period/i);
    expect(recruiterSrc).not.toMatch(/change plan, or cancel directly/i);
  });
});

describe('Phase 1S-A3 — driver feature sheet automation category', () => {
  it('renames the automation category to AI & OCR Automation (Pro)', () => {
    expect(featureSrc).toContain('AI & OCR Automation (Pro)');
    expect(featureSrc).not.toContain("'AI Automation (Pro)'");
    expect(featureSrc).not.toContain('"AI Automation (Pro)"');
  });

  it('keeps receipt scanning described as OCR, not AI extraction', () => {
    expect(featureSrc).toContain('Receipt & Screenshot OCR Scanning');
    expect(featureSrc).toContain('auto-extract expense details using OCR text extraction');
    expect(featureSrc).not.toMatch(/receipt[^.]*AI extracts/i);
  });
});

describe('Phase 1S-A3 — canonical truth preserved', () => {
  it('preserves recruiter 1/5/15/25 limits, unlimited drafts, and Fleet preview-only wording', () => {
    expect(recruiterSrc).toContain(
      'Recruiter Standard includes 1 active opportunity with unlimited drafts. Starter includes 5 active opportunities, Growth includes 15, and Fleet includes 25 active opportunities for existing or included Fleet access — new standalone Fleet checkout is unavailable.',
    );
    expect(recruiterSrc).toContain('Drafts are always unlimited; only active listings count toward your plan limit.');
    expect(recruiterSrc).toContain('Fleet remains preview-only for new standalone subscriptions.');
  });

  it('preserves agency prices 29/79/149 and included recruiter tiers', () => {
    expect(agencySrc).toContain('monthlyPrice: 29');
    expect(agencySrc).toContain('monthlyPrice: 79');
    expect(agencySrc).toContain('monthlyPrice: 149');
    expect(agencySrc).toContain('Includes Recruiter Starter — 5 active opportunities for the agency owner');
    expect(agencySrc).toContain('Includes Recruiter Growth — 15 active opportunities for the agency owner');
    expect(agencySrc).toContain('Includes Recruiter Fleet — 25 active opportunities for the agency owner');
  });
});
