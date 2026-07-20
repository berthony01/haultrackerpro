/**
 * Phase 1J-C2A — Recruiter wording reconciliation.
 *
 * Product truth (canonical, do not restate in copy):
 *  - Recruiter is an ADDITIONAL workspace on the same account.
 *  - Standard posting unlocks the moment the recruiter profile is complete
 *    and the account is not suspended. NO admin approval, NO paid plan.
 *  - Verification is separate and controls the Verified Recruiter badge
 *    only. Pending/rejected badge review does NOT disable posting.
 *  - Suspension disables recruiter operations.
 *  - Paid plans are optional and unlock premium tools only.
 *
 * This suite proves that all in-scope user-facing recruiter surfaces
 *  1. contain no misleading approval-gate wording, and
 *  2. the pure eligibility/trust view still returns the correct
 *     posting-enable/disable signal across all eight states.
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

  it('paid-plan status does NOT change eligibility — canPost derives from profile only', () => {
    // Billing is not a parameter of describeRecruiterEligibility. Prove that
    // complete + not-suspended returns canPost=true regardless of any paid
    // plan the recruiter may have (proved by the "unpaid" pending case
    // above returning canPost=true).
    const unpaid = describeRecruiterEligibility(baseProfile({ verification_status: 'pending' }));
    const paidShapedIdentical = describeRecruiterEligibility(baseProfile({ verification_status: 'pending' }));
    expect(unpaid.canPost).toBe(true);
    expect(paidShapedIdentical.canPost).toBe(true);
    // No copy in the eligibility helper implies payment is required to post.
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/opportunities/recruiterEligibility.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/paid plan (is )?required/i);
    expect(src).not.toMatch(/upgrade to post/i);
  });
});
