// Phase 1F-A.2.2 — canonical eligibility source-integrity & behavior tests.
//
// The full component render matrix requires QueryClient/router wiring that
// is not stood up in this suite. Instead this file locks in the invariants
// that matter for the phase: (1) both components consume the canonical
// eligibility helper, (2) neither reimplements a local three-field
// completeness rule, (3) neither gates posting on verification=approved,
// (4) explicit incomplete-copy mentions the actual required fields,
// (5) statusCfg wording reflects the eligibility-first ordering.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { describeRecruiterEligibility } from '@/lib/opportunities/recruiterEligibility';

function makeProfile(overrides: Partial<RecruiterProfile> = {}): RecruiterProfile {
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

// ---------------------------------------------------------------------------
// Eligibility matrix — the same signal both components must consume.
// ---------------------------------------------------------------------------
describe('canonical eligibility matrix — required by both components', () => {
  const complete = makeProfile;
  const incomplete = (overrides: Partial<RecruiterProfile> = {}) =>
    makeProfile({ company_name: '', ...overrides });

  it('incomplete + pending → canPost=false, not verified', () => {
    const e = describeRecruiterEligibility(incomplete({ verification_status: 'pending' }), {});
    expect(e.canPost).toBe(false);
    expect(e.isVerified).toBe(false);
  });

  it('incomplete + rejected → canPost=false', () => {
    const e = describeRecruiterEligibility(incomplete({ verification_status: 'rejected' }), {});
    expect(e.canPost).toBe(false);
  });

  it('incomplete + approved → canPost=false (approval never overrides completeness)', () => {
    const e = describeRecruiterEligibility(incomplete({ verification_status: 'approved' }), {});
    expect(e.canPost).toBe(false);
  });

  it('complete + pending → canPost=true, isVerified=false', () => {
    const e = describeRecruiterEligibility(complete({ verification_status: 'pending' }), {});
    expect(e.canPost).toBe(true);
    expect(e.isVerified).toBe(false);
  });

  it('complete + rejected + not suspended → canPost=true, isVerified=false', () => {
    const e = describeRecruiterEligibility(complete({ verification_status: 'rejected' }), {});
    expect(e.canPost).toBe(true);
    expect(e.isVerified).toBe(false);
  });

  it('complete + approved → canPost=true, isVerified=true', () => {
    const e = describeRecruiterEligibility(complete({ verification_status: 'approved' }), {});
    expect(e.canPost).toBe(true);
    expect(e.isVerified).toBe(true);
  });

  it('status suspended → canPost=false regardless of verification', () => {
    const e = describeRecruiterEligibility(
      complete({ status: 'suspended', verification_status: 'approved' }),
      {},
    );
    expect(e.canPost).toBe(false);
  });

  it('verification suspended → canPost=false', () => {
    const e = describeRecruiterEligibility(
      complete({ verification_status: 'suspended' }),
      {},
    );
    expect(e.canPost).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Source integrity — both files must consume the canonical helper and must
// NOT reintroduce a separate field-completeness rule or approval gating.
// ---------------------------------------------------------------------------
describe('Source integrity — one canonical completeness rule', () => {
  const files = [
    'src/components/opportunities/recruiter/RecruiterAccessPage.tsx',
    'src/components/opportunities/RecruiterOnboarding.tsx',
  ];

  for (const rel of files) {
    const body = readFileSync(resolve(process.cwd(), rel), 'utf8');

    it(`${rel} consumes canonical eligibility helper`, () => {
      const usesHelper =
        body.includes('describeRecruiterEligibility') ||
        body.includes('isProfileCompleteForPosting');
      expect(usesHelper, `${rel} must consume canonical eligibility`).toBe(true);
    });

    it(`${rel} does not declare a local isNonEmpty helper`, () => {
      const hasIsNonEmpty = /function\s+isNonEmpty\b/.test(body);
      expect(hasIsNonEmpty).toBe(false);
    });

    it(`${rel} does not co-locate a name+company+email trim-based completeness rule`, () => {
      const nameAndCompany =
        /recruiter_name[\s\S]{0,160}company_name[\s\S]{0,160}recruiter_email/.test(body);
      const looksLikeLocalRule =
        nameAndCompany && /\.trim\(\)\.length|isNonEmpty\(|\.trim\(\)\s*!==?\s*['"]/.test(body);
      expect(looksLikeLocalRule).toBe(false);
    });

    it(`${rel} does not gate posting on verification === 'approved'`, () => {
      const gated =
        /(canPost|postDisabled|allowPost|eligible)[^;\n]{0,80}verification_status\s*===?\s*['"]approved['"]/.test(
          body,
        ) ||
        /verification_status\s*===?\s*['"]approved['"][^;\n]{0,80}(canPost|allowPost|postDisabled|eligible)/.test(
          body,
        );
      expect(gated).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// Copy invariants for the incomplete state — must reference the actual
// required fields so users know what to fix.
// ---------------------------------------------------------------------------
describe('RecruiterAccessPage — incomplete copy references actual requirements', () => {
  const body = readFileSync(
    resolve(process.cwd(), 'src/components/opportunities/recruiter/RecruiterAccessPage.tsx'),
    'utf8',
  );
  it('mentions DOT or MC and posting terms in incomplete copy', () => {
    expect(body).toMatch(/DOT or MC/);
    expect(body).toMatch(/posting terms/i);
  });
  it('mentions recruiter name and company name in incomplete copy', () => {
    expect(body).toMatch(/recruiter name/i);
    expect(body).toMatch(/company name/i);
  });
});

// ---------------------------------------------------------------------------
// RecruiterOnboarding — statusCfg wording invariants.
// ---------------------------------------------------------------------------
describe('RecruiterOnboarding — statusCfg wording is eligibility-first', () => {
  const body = readFileSync(
    resolve(process.cwd(), 'src/components/opportunities/RecruiterOnboarding.tsx'),
    'utf8',
  );
  it('incomplete branch tells users posting is NOT yet enabled', () => {
    expect(body).toMatch(/Standard posting is not enabled yet/);
    expect(body).toMatch(/DOT or MC/);
  });
  it('complete + pending branch says Standard Posting Enabled + Pending Verification', () => {
    expect(body).toMatch(/Standard Posting Enabled/);
    expect(body).toMatch(/Pending Verification/);
  });
  it('complete + rejected branch keeps posting enabled + shows Unverified', () => {
    expect(body).toMatch(/Standard Posting Enabled — Verification Not Approved/);
    expect(body).toMatch(/Unverified/);
  });
  it('complete + approved branch shows Verified Recruiter with posting enabled', () => {
    expect(body).toMatch(/Verified Recruiter — Standard Posting Enabled/);
  });
  it('suspended branch says Access Suspended', () => {
    expect(body).toMatch(/Recruiter Access Suspended/);
  });
  it('footer copy separates standard posting eligibility from verification review', () => {
    expect(body).toMatch(/standard posting eligibility[\s\S]{0,120}(verification|Verified Recruiter)/i);
  });
});
