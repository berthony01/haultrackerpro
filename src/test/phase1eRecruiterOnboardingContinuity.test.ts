/**
 * Phase 1E — Recruiter Onboarding Continuity
 *
 * Executable tests for the D-01 remediation:
 *   - describeRecruiterBlock returns the correct reason/copy for every
 *     recruiter state (missing profile, pending, rejected, suspended, ok),
 *     and specifically distinguishes "signed up as recruiter but missing
 *     profile" from a generic "no access" case.
 *   - The shared block description is what feeds the Manager gate and
 *     the RecruiterAccessPage hub copy, so all three surfaces agree.
 */
import { describe, it, expect } from 'vitest';
import {
  describeRecruiterBlock,
} from '@/lib/opportunities/describeRecruiterBlock';
import type { RecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';

const baseProfile: RecruiterProfile = {
  id: '00000000-0000-0000-0000-000000000001',
  user_id: '00000000-0000-0000-0000-0000000000aa',
  company_name: 'Acme Freight',
  contact_name: null,
  contact_email: null,
  contact_phone: null,
  website: null,
  mc_number: null,
  dot_number: null,
  hiring_states: ['TX'],
  verification_status: 'approved',
  status: 'active',
  admin_notes: null,
  verified_at: null,
  verified_by: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
} as unknown as RecruiterProfile;

describe('describeRecruiterBlock', () => {
  it('returns missing_profile with generic copy when no profile and no intent', () => {
    const r = describeRecruiterBlock(null);
    expect(r.reason).toBe('missing_profile');
    expect(r.title).toMatch(/Recruiter Access/i);
    expect(r.body).toMatch(/apply for recruiter access/i);
  });

  it('returns missing_profile with "finish setup" copy when intent is recruiter', () => {
    const r = describeRecruiterBlock(null, { intentRecruiter: true });
    expect(r.reason).toBe('missing_profile');
    expect(r.title).toMatch(/Finish/i);
    expect(r.body).toMatch(/signed up as a recruiter/i);
    expect(r.cta).toMatch(/Finish Recruiter Setup/i);
  });

  it('returns pending_review when verification is pending', () => {
    const r = describeRecruiterBlock({ ...baseProfile, verification_status: 'pending' });
    expect(r.reason).toBe('pending_review');
    expect(r.title).toMatch(/Pending Review/i);
    expect(r.body).toMatch(/one business day/i);
  });

  it('returns rejected with a resubmit CTA', () => {
    const r = describeRecruiterBlock({ ...baseProfile, verification_status: 'rejected' });
    expect(r.reason).toBe('rejected');
    expect(r.cta).toMatch(/Update & Resubmit/i);
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

  it('never leaks an approved reason when verification is not approved', () => {
    (['pending', 'rejected', 'suspended'] as const).forEach((s) => {
      const r = describeRecruiterBlock({ ...baseProfile, verification_status: s });
      expect(r.reason).not.toBe('ok');
    });
  });
});
