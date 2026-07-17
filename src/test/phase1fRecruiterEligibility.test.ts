// Phase 1F-A — Recruiter Immediate Standard Posting Authorization (pure).
//
// Verifies the canonical client-side rule: standard posting unlocks the
// moment the recruiter's profile is complete and not suspended. Admin
// verification is a trust badge only — it does NOT gate posting. Also
// scans user-facing recruiter surfaces for stale copy that would still
// tell recruiters they must wait for approval before they can post.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { describeRecruiterEligibility } from '@/lib/opportunities/recruiterEligibility';
import { describeRecruiterBlock } from '@/lib/opportunities/describeRecruiterBlock';

function baseProfile(overrides: Partial<RecruiterProfile> = {}): RecruiterProfile {
  return {
    id: 'rp-1',
    user_id: 'u-1',
    recruiter_name: 'Alice Recruiter',
    company_name: 'Acme Freight',
    recruiter_email: 'alice@acme.example',
    hiring_states: [],
    equipment_types: [],
    driver_types_hired: [],
    status: 'active',
    verification_status: 'pending',
    // Fields present on the type but irrelevant to eligibility — cast is fine
    // because the helper only reads the properties listed above.
    ...overrides,
  } as unknown as RecruiterProfile;
}

describe('describeRecruiterEligibility — canonical posting rule', () => {
  it('missing profile → cannot post, points to onboarding', () => {
    const e = describeRecruiterEligibility(null, { intentRecruiter: false });
    expect(e.state).toBe('missing_profile');
    expect(e.canPost).toBe(false);
    expect(e.isVerified).toBe(false);
  });

  it('missing profile with recruiter intent → CTA guides them to finish setup', () => {
    const e = describeRecruiterEligibility(null, { intentRecruiter: true });
    expect(e.state).toBe('missing_profile');
    expect(e.canPost).toBe(false);
    expect(e.cta).toBe('Finish Recruiter Setup');
  });

  it('incomplete profile (missing company_name) → cannot post', () => {
    const e = describeRecruiterEligibility(baseProfile({ company_name: '' }));
    expect(e.state).toBe('incomplete_profile');
    expect(e.canPost).toBe(false);
  });

  it('incomplete profile (whitespace-only recruiter_email) → cannot post', () => {
    const e = describeRecruiterEligibility(baseProfile({ recruiter_email: '   ' }));
    expect(e.state).toBe('incomplete_profile');
    expect(e.canPost).toBe(false);
  });

  it('suspended via status → cannot post regardless of verification', () => {
    const e = describeRecruiterEligibility(
      baseProfile({ status: 'suspended', verification_status: 'approved' }),
    );
    expect(e.state).toBe('suspended');
    expect(e.canPost).toBe(false);
    expect(e.isVerified).toBe(false);
  });

  it('suspended via verification_status → cannot post', () => {
    const e = describeRecruiterEligibility(
      baseProfile({ status: 'active', verification_status: 'suspended' }),
    );
    expect(e.state).toBe('suspended');
    expect(e.canPost).toBe(false);
  });

  it('pending verification + complete profile → CAN post, unverified', () => {
    const e = describeRecruiterEligibility(
      baseProfile({ verification_status: 'pending' }),
    );
    expect(e.state).toBe('active_unverified');
    expect(e.canPost).toBe(true);
    expect(e.isVerified).toBe(false);
  });

  it('rejected verification + complete profile + not suspended → CAN post, unverified', () => {
    // Phase 1F-A: rejection is a trust decision, not a posting block.
    // Admins may suspend to actually block posting.
    const e = describeRecruiterEligibility(
      baseProfile({ verification_status: 'rejected' }),
    );
    expect(e.state).toBe('active_unverified');
    expect(e.canPost).toBe(true);
    expect(e.isVerified).toBe(false);
  });

  it('approved verification + active status → CAN post, verified badge', () => {
    const e = describeRecruiterEligibility(
      baseProfile({ verification_status: 'approved', status: 'active' }),
    );
    expect(e.state).toBe('verified');
    expect(e.canPost).toBe(true);
    expect(e.isVerified).toBe(true);
  });

  it('approved verification + inactive status is not suspended → still can post', () => {
    // The rule only bars posting on explicit suspension.
    const e = describeRecruiterEligibility(
      baseProfile({ verification_status: 'approved', status: 'inactive' as unknown as RecruiterProfile['status'] }),
    );
    expect(e.canPost).toBe(true);
  });
});

describe('describeRecruiterBlock — collapses non-blocking states to ok', () => {
  it('pending + complete → non-blocking (reason ok)', () => {
    const b = describeRecruiterBlock(baseProfile({ verification_status: 'pending' }));
    expect(b.reason).toBe('ok');
  });

  it('rejected + complete + not suspended → non-blocking (reason ok)', () => {
    const b = describeRecruiterBlock(baseProfile({ verification_status: 'rejected' }));
    expect(b.reason).toBe('ok');
  });

  it('suspended → blocking', () => {
    const b = describeRecruiterBlock(baseProfile({ status: 'suspended' }));
    expect(b.reason).toBe('suspended');
  });

  it('incomplete → blocking', () => {
    const b = describeRecruiterBlock(baseProfile({ recruiter_name: '' }));
    expect(b.reason).toBe('incomplete_profile');
  });

  it('missing → blocking', () => {
    const b = describeRecruiterBlock(null);
    expect(b.reason).toBe('missing_profile');
  });
});

describe('Recruiter-facing copy — no stale approval-blocks-posting language', () => {
  const files = [
    'src/lib/opportunities/recruiterEligibility.ts',
    'src/lib/opportunities/describeRecruiterBlock.ts',
    'src/components/opportunities/RecruiterOpportunityManager.tsx',
    'src/components/opportunities/recruiter/RecruiterAccessPage.tsx',
  ];

  const forbidden: RegExp[] = [
    /must be approved/i,
    /approved profiles unlock posting/i,
    /one business day/i,
    /posting is disabled until approval/i,
    /get approved as a recruiter to post/i,
    /Approval is required to post/i,
  ];

  for (const rel of files) {
    it(`${rel} contains no stale approval-blocks-posting phrases`, () => {
      const full = path.join(process.cwd(), rel);
      const body = fs.readFileSync(full, 'utf8');
      for (const re of forbidden) {
        expect(body, `phrase ${re} found in ${rel}`).not.toMatch(re);
      }
    });
  }
});
