/**
 * Phase 1J-C2A — Recruiter wording reconciliation (supplementary source guards).
 *
 * These tests are supplementary source-integrity scans and pure-helper
 * assertions. The authoritative rendered evidence for visible copy and
 * posting-button behavior across every recruiter state lives in
 * `phase1fa22R1aRenderedTrustState.test.tsx`, which mounts the real
 * production RecruiterAccessPage and RecruiterOnboarding.
 *
 * Product truth (canonical, do not restate in copy):
 *  - Recruiter is an ADDITIONAL workspace on the same account.
 *  - Standard posting unlocks the moment the recruiter profile is complete
 *    and the account is not suspended. NO admin approval, NO paid plan.
 *  - Verification is separate and controls the Verified Recruiter badge
 *    only. Pending/rejected badge review does NOT disable posting.
 *  - Suspension disables recruiter operations.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import {
  describeRecruiterEligibility,
  getRecruiterTrustView,
} from '@/lib/opportunities/recruiterEligibility';

// -------------------------------------------------------------------------
// 1. Source-integrity scan: no misleading approval-gate wording.
// -------------------------------------------------------------------------

const FILES_TO_SCAN = [
  'src/lib/opportunities/recruiterEligibility.ts',
  'src/components/opportunities/recruiter/RecruiterAccessPage.tsx',
  'src/components/opportunities/recruiter/RecruiterEntryRoute.tsx',
  'src/components/opportunities/RecruiterOnboarding.tsx',
  // Phase 1J-D2A public recruiter surfaces (extended scan)
  'src/pages/Pricing.tsx',
  'src/pages/Recruiters.tsx',
  'src/components/landing/RecruiterLanding.tsx',
  'src/pages/recruiter/RecruiterFAQ.tsx',
  'src/pages/recruiter/RecruiterGuide.tsx',
  'src/pages/resources/RecruiterToolsGuide.tsx',
  'src/lib/recruiterFeatureList.ts',
  // Phase RW-4 corrected recruiter surfaces (now protected by the same guard)
  'src/pages/Auth.tsx',
  'src/pages/recruiter/RecruiterFeatures.tsx',
];

const FORBIDDEN: RegExp[] = [
  /Apply for Recruiter Access/i,
  /Start Application/i,
  /submit for review/i,
  /before approval/i,
  /Apply for recruiter access/i,
  /Recruiter Access Required/i,
];

describe('Phase 1J-C2A — no misleading approval-gate wording in in-scope files', () => {
  for (const rel of FILES_TO_SCAN) {
    it(`${rel}: contains no forbidden phrases`, () => {
      const full = path.join(process.cwd(), rel);
      const body = fs.readFileSync(full, 'utf8');
      for (const re of FORBIDDEN) {
        expect(
          body,
          `phrase ${re} found in ${rel} — implies approval is required for standard posting`,
        ).not.toMatch(re);
      }
    });
  }

  it('badge review wording explicitly references Verified Recruiter badge review where review is mentioned', () => {
    const onboarding = fs.readFileSync(
      path.join(process.cwd(), 'src/components/opportunities/RecruiterOnboarding.tsx'),
      'utf8',
    );
    // Every remaining occurrence of the word "review" in user-visible strings
    // should qualify as "badge review". We accept the qualified phrases used
    // in the reconciled copy.
    expect(onboarding).toMatch(/Verified Recruiter badge review/);
    expect(onboarding).toMatch(/Resubmit for Badge Review/);
  });

  it('RecruiterAccessPage.tsx: old How It Works step 1 phrase is absent and new sentence is present (source guard)', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/components/opportunities/recruiter/RecruiterAccessPage.tsx'),
      'utf8',
    );
    expect(src).not.toContain(
      'Add recruiter as an additional workspace on your account. Standard posting unlocks the moment your profile is complete — no admin approval needed.',
    );
    expect(src).toContain(
      'Add the recruiter workspace to your account and complete the required recruiter profile fields and posting terms. Standard posting does not require admin approval or a paid plan.',
    );
  });
});

// -------------------------------------------------------------------------
// 2. Posting-enable parity across every state.
// -------------------------------------------------------------------------

function baseProfile(overrides: Partial<RecruiterProfile> = {}): RecruiterProfile {
  return {
    id: 'rp-1',
    user_id: 'u-1',
    recruiter_name: 'Alice',
    company_name: 'Acme',
    company_type: 'third_party_recruiter',
    recruiter_email: 'alice@acme.example',
    dot_number: '1234567',
    mc_number: null,
    hiring_states: [],
    equipment_types: [],
    driver_types_hired: [],
    status: 'active',
    verification_status: 'pending',
    posting_terms_accepted_at: '2026-07-17T00:00:00Z',
    posting_terms_version: '2026-07-17.v1',
    legacy_terms_grandfathered_at: null,
    ...overrides,
  } as unknown as RecruiterProfile;
}

describe('Phase 1J-C2A — eight-state eligibility parity (posting behavior unchanged)', () => {
  it('missing profile (no intent) — cannot post; CTA is additive-workspace copy', () => {
    const e = describeRecruiterEligibility(null, { intentRecruiter: false });
    expect(e.canPost).toBe(false);
    expect(e.title.toLowerCase()).toContain('recruiter workspace');
    expect(e.cta).toBe('Add Recruiter Workspace');
    expect(e.body).not.toMatch(/application|apply|before approval/i);
    expect(e.body).toMatch(/no admin approval needed/i);
  });

  it('missing profile (recruiter intent) — cannot post; CTA is Finish Recruiter Setup', () => {
    const e = describeRecruiterEligibility(null, { intentRecruiter: true });
    expect(e.canPost).toBe(false);
    expect(e.cta).toBe('Finish Recruiter Setup');
    expect(e.body).not.toMatch(/application/i);
  });

  it('incomplete profile — cannot post', () => {
    const e = describeRecruiterEligibility(baseProfile({ company_name: '' }));
    expect(e.canPost).toBe(false);
    expect(e.state).toBe('incomplete_profile');
  });

  it('pending badge review + complete profile — CAN post, unverified', () => {
    const e = describeRecruiterEligibility(baseProfile({ verification_status: 'pending' }));
    expect(e.canPost).toBe(true);
    expect(e.isVerified).toBe(false);
    const v = getRecruiterTrustView(baseProfile({ verification_status: 'pending' }));
    expect(v.canPost).toBe(true);
    expect(v.postingLabel).toMatch(/Standard posting enabled/i);
  });

  it('rejected badge review + complete profile + not suspended — CAN post, unverified', () => {
    const e = describeRecruiterEligibility(baseProfile({ verification_status: 'rejected' }));
    expect(e.canPost).toBe(true);
    expect(e.isVerified).toBe(false);
  });

  it('approved badge review — CAN post, Verified Recruiter badge', () => {
    const e = describeRecruiterEligibility(baseProfile({ verification_status: 'approved' }));
    expect(e.canPost).toBe(true);
    expect(e.isVerified).toBe(true);
    const v = getRecruiterTrustView(baseProfile({ verification_status: 'approved' }));
    expect(v.showVerifiedBadge).toBe(true);
  });

  it('suspended — cannot post regardless of verification', () => {
    const e = describeRecruiterEligibility(
      baseProfile({ status: 'suspended', verification_status: 'approved' }),
    );
    expect(e.canPost).toBe(false);
    expect(e.state).toBe('suspended');
  });

  it('eligibility helper does not encode payment as a posting gate (supplementary source guard)', () => {
    // Rendered proof that billing state does not change standard posting
    // lives in phase1fa22R1aRenderedTrustState.test.tsx (billing INACTIVE
    // vs ACTIVE against the real RecruiterAccessPage). This is only a
    // source-level guard against future regressions in the helper.
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/opportunities/recruiterEligibility.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/paid plan (is )?required/i);
    expect(src).not.toMatch(/upgrade to post/i);
  });
});
