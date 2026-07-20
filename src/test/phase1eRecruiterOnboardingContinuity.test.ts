/**
 * Phase 1E — Recruiter Onboarding Continuity
 *
 * Updated for Phase 1F-A: standard posting unlocks the moment the
 * recruiter's profile is complete and the account is not suspended.
 * Verification is a trust badge only, so pending / rejected are no
 * longer blocking reasons.
 */
import { describe, it, expect } from 'vitest';
import { describeRecruiterBlock } from '@/lib/opportunities/describeRecruiterBlock';
import type { RecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';

const baseProfile: RecruiterProfile = {
  id: '00000000-0000-0000-0000-000000000001',
  user_id: '00000000-0000-0000-0000-0000000000aa',
  recruiter_name: 'Alice Recruiter',
  company_name: 'Acme Freight',
  recruiter_email: 'alice@acme.example',
  dot_number: '1234567',
  mc_number: null,
  hiring_states: ['TX'],
  equipment_types: [],
  driver_types_hired: [],
  verification_status: 'approved',
  status: 'active',
  admin_notes: null,
  verified_at: null,
  verified_by: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  posting_terms_accepted_at: new Date().toISOString(),
  posting_terms_version: '2026-07-17.v1',
  legacy_terms_grandfathered_at: null,
} as unknown as RecruiterProfile;

describe('describeRecruiterBlock', () => {
  it('returns missing_profile with additive-workspace copy when no profile and no intent', () => {
    const r = describeRecruiterBlock(null);
    expect(r.reason).toBe('missing_profile');
    expect(r.title).toMatch(/recruiter workspace/i);
    expect(r.body).toMatch(/recruiter profile/i);
    expect(r.body).not.toMatch(/apply|application|before approval/i);
    expect(r.cta).toMatch(/Add Recruiter Workspace/i);
  });

  it('returns missing_profile with "finish setup" copy when intent is recruiter', () => {
    const r = describeRecruiterBlock(null, { intentRecruiter: true });
    expect(r.reason).toBe('missing_profile');
    expect(r.title).toMatch(/Finish/i);
    expect(r.body).toMatch(/signed up as a recruiter/i);
    expect(r.cta).toMatch(/Finish Recruiter Setup/i);
  });

  it('Phase 1F-A: pending verification with complete profile is NON-blocking (ok)', () => {
    const r = describeRecruiterBlock({ ...baseProfile, verification_status: 'pending' });
    expect(r.reason).toBe('ok');
  });

  it('Phase 1F-A: rejected verification with complete profile is NON-blocking (ok)', () => {
    const r = describeRecruiterBlock({ ...baseProfile, verification_status: 'rejected' });
    expect(r.reason).toBe('ok');
  });

  it('returns suspended when status is suspended', () => {
    const r = describeRecruiterBlock({ ...baseProfile, status: 'suspended' });
    expect(r.reason).toBe('suspended');
    expect(r.body).toMatch(/contact support/i);
  });

  it('returns suspended when verification_status is suspended', () => {
    const r = describeRecruiterBlock({
      ...baseProfile,
      verification_status: 'suspended',
    });
    expect(r.reason).toBe('suspended');
  });

  it('returns ok for approved/active recruiter', () => {
    const r = describeRecruiterBlock(baseProfile);
    expect(r.reason).toBe('ok');
  });

  it('Phase 1F-A invariant: suspended is ALWAYS blocking regardless of verification', () => {
    (['pending', 'approved', 'rejected'] as const).forEach((v) => {
      const r = describeRecruiterBlock({
        ...baseProfile,
        status: 'suspended',
        verification_status: v,
      });
      expect(r.reason).toBe('suspended');
    });
  });
});
