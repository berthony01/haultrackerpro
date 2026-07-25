// Phase 1P-A1.2 — canonical client readiness selector + eligibility
// reconciliation. Fail-closed behavioral and source-integrity coverage
// for the shared readiness contract:
//
//   * `resolveRecruiterReadiness` is the SINGLE canonical completeness
//     rule; `isProfileCompleteForPosting` and `describeRecruiterBlock`
//     must delegate to it rather than reimplement conditions.
//   * DOT / MC is required only for `carrier`; NULL company_type is
//     always incomplete and is never inferred from DOT/MC/verification.
//   * Suspended short-circuits to the `suspended` token/message.
//   * Verification approval never bypasses missing company_type or
//     carrier DOT/MC.
//
// The suite intentionally exercises the pure module surface so it stays
// deterministic without a router, network, or Postgres.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { RecruiterProfile } from '@/lib/opportunities/recruiterEligibility';
import {
  describeRecruiterEligibility,
  getRecruiterTrustView,
  hasAcceptedPostingTerms,
  isProfileCompleteForPosting,
  isValidRecruiterEmail,
} from '@/lib/opportunities/recruiterEligibility';
import { describeRecruiterBlock } from '@/lib/opportunities/describeRecruiterBlock';
import {
  COMPANY_TYPE_LABELS,
  COMPANY_TYPE_VALUES,
  READINESS_MESSAGES,
  resolveRecruiterReadiness,
  type CompanyType,
  type ReadinessToken,
} from '@/lib/opportunities/resolveRecruiterReadiness';

// ---------------------------------------------------------------------------
// Fixture — canonical ready profile. Every test tweaks a single field
// so the deterministic missing-token order is easy to reason about.
// ---------------------------------------------------------------------------
function makeReadyCarrier(
  overrides: Partial<RecruiterProfile> & { company_type?: unknown } = {},
): RecruiterProfile {
  return {
    id: 'rp-1',
    user_id: 'u-1',
    recruiter_name: 'Alice',
    company_name: 'Acme Freight',
    recruiter_email: 'alice@acme.example',
    company_type: 'carrier',
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
// 1. Storage values + labels — exact four tokens, no extras or dupes.
// ---------------------------------------------------------------------------
describe('COMPANY_TYPE storage values and labels', () => {
  it('has exactly the four locked storage values in order', () => {
    expect([...COMPANY_TYPE_VALUES]).toEqual([
      'carrier',
      'third_party_recruiter',
      'staffing_agency',
      'independent_recruiter',
    ]);
    expect(new Set(COMPANY_TYPE_VALUES).size).toBe(COMPANY_TYPE_VALUES.length);
  });

  it('label map has exactly one entry per storage value and matches locked copy', () => {
    expect(Object.keys(COMPANY_TYPE_LABELS).sort()).toEqual(
      [...COMPANY_TYPE_VALUES].sort(),
    );
    expect(COMPANY_TYPE_LABELS.carrier).toBe('Carrier / Motor Carrier');
    expect(COMPANY_TYPE_LABELS.third_party_recruiter).toBe(
      'Third-Party Recruiting Company',
    );
    expect(COMPANY_TYPE_LABELS.staffing_agency).toBe('Staffing Agency');
    expect(COMPANY_TYPE_LABELS.independent_recruiter).toBe(
      'Independent Recruiter',
    );
  });

  it('readiness messages are the exact locked strings for every token', () => {
    expect(READINESS_MESSAGES.suspended).toBe(
      'Recruiter access is suspended. Contact support for assistance.',
    );
    expect(READINESS_MESSAGES.recruiter_name).toBe('Add your recruiter name.');
    expect(READINESS_MESSAGES.company_name).toBe('Add your company name.');
    expect(READINESS_MESSAGES.recruiter_email_missing).toBe(
      'Add a recruiter email address.',
    );
    expect(READINESS_MESSAGES.recruiter_email_invalid).toBe(
      'Enter a valid recruiter email address.',
    );
    expect(READINESS_MESSAGES.company_type).toBe('Choose your company type.');
    expect(READINESS_MESSAGES.dot_or_mc).toBe(
      'Add a DOT or MC number. This is required for Carrier / Motor Carrier accounts.',
    );
    expect(READINESS_MESSAGES.posting_terms).toBe(
      'Review and accept the current posting terms.',
    );
  });
});

// ---------------------------------------------------------------------------
// 2. NULL / invalid company_type → only the correct token, and in the
//    correct position among any other missing tokens.
// ---------------------------------------------------------------------------
describe('company_type token position', () => {
  it('NULL company_type produces exactly the company_type token when nothing else is missing', () => {
    const r = resolveRecruiterReadiness(
      makeReadyCarrier({ company_type: null as unknown as string }),
    );
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual(['company_type']);
  });

  it('invalid company_type is treated as NULL and produces the company_type token only', () => {
    const r = resolveRecruiterReadiness(
      makeReadyCarrier({ company_type: 'carrier_llc' as unknown as string }),
    );
    expect(r.missing).toEqual(['company_type']);
    expect(r.companyType).toBeNull();
  });

  it('company_type token sits between recruiter_email and dot_or_mc in a multi-miss profile', () => {
    // Missing name + company + invalid email + null company_type +
    // no DOT/MC (carrier absence) + no accepted terms. Carrier DOT/MC
    // token must NOT appear because company_type is null (not carrier).
    const r = resolveRecruiterReadiness(
      makeReadyCarrier({
        recruiter_name: '',
        company_name: '',
        recruiter_email: 'nope',
        company_type: null as unknown as string,
        dot_number: null,
        mc_number: null,
        posting_terms_accepted_at: null as unknown as string,
      }),
    );
    expect(r.missing).toEqual([
      'recruiter_name',
      'company_name',
      'recruiter_email_invalid',
      'company_type',
      'posting_terms',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 3. Carrier DOT / MC — one of DOT or MC satisfies, missing both blocks.
// ---------------------------------------------------------------------------
describe('carrier DOT/MC conditional rule', () => {
  it('carrier missing both DOT and MC → dot_or_mc token, not ready', () => {
    const r = resolveRecruiterReadiness(
      makeReadyCarrier({ dot_number: null, mc_number: null }),
    );
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual(['dot_or_mc']);
  });

  it('carrier with DOT only → ready', () => {
    const r = resolveRecruiterReadiness(
      makeReadyCarrier({ dot_number: '1234567', mc_number: null }),
    );
    expect(r.ready).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('carrier with MC only → ready', () => {
    const r = resolveRecruiterReadiness(
      makeReadyCarrier({ dot_number: null, mc_number: 'MC-987654' }),
    );
    expect(r.ready).toBe(true);
  });

  it('carrier with whitespace-only DOT and MC → still blocked', () => {
    const r = resolveRecruiterReadiness(
      makeReadyCarrier({ dot_number: '   ', mc_number: '   ' }),
    );
    expect(r.missing).toEqual(['dot_or_mc']);
  });
});

// ---------------------------------------------------------------------------
// 4. Non-carrier types can be ready without DOT/MC.
// ---------------------------------------------------------------------------
describe('non-carrier company types do not require DOT/MC', () => {
  const nonCarrier: CompanyType[] = [
    'third_party_recruiter',
    'staffing_agency',
    'independent_recruiter',
  ];

  it.each(nonCarrier)(
    '%s with DOT/MC blank → ready and dot_or_mc token absent',
    (ct) => {
      const r = resolveRecruiterReadiness(
        makeReadyCarrier({
          company_type: ct as unknown as string,
          dot_number: null,
          mc_number: null,
        }),
      );
      expect(r.ready).toBe(true);
      expect(r.missing).not.toContain('dot_or_mc');
      expect(r.companyType).toBe(ct);
    },
  );
});

// ---------------------------------------------------------------------------
// 5. Missing vs invalid email tokens are distinct.
// ---------------------------------------------------------------------------
describe('recruiter email — missing vs invalid tokens', () => {
  it('empty email → recruiter_email_missing (never recruiter_email_invalid)', () => {
    const r = resolveRecruiterReadiness(
      makeReadyCarrier({ recruiter_email: '' }),
    );
    expect(r.missing).toEqual(['recruiter_email_missing']);
  });

  it('whitespace-only email → recruiter_email_missing', () => {
    const r = resolveRecruiterReadiness(
      makeReadyCarrier({ recruiter_email: '   ' }),
    );
    expect(r.missing).toEqual(['recruiter_email_missing']);
  });

  it('non-empty but invalid email → recruiter_email_invalid', () => {
    const r = resolveRecruiterReadiness(
      makeReadyCarrier({ recruiter_email: 'alice.acme.example' }),
    );
    expect(r.missing).toEqual(['recruiter_email_invalid']);
  });

  it('isValidRecruiterEmail is the same rule the selector uses', () => {
    expect(isValidRecruiterEmail('alice@acme.example')).toBe(true);
    expect(isValidRecruiterEmail('alice.acme.example')).toBe(false);
    expect(isValidRecruiterEmail('   ')).toBe(false);
    expect(isValidRecruiterEmail(null)).toBe(false);
    expect(isValidRecruiterEmail(42)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Multi-miss ordering — recruiter_name → company_name → email →
//    company_type → dot_or_mc → posting_terms.
// ---------------------------------------------------------------------------
describe('deterministic token order across multiple misses', () => {
  it('all six carrier-relevant tokens appear in the locked order', () => {
    const r = resolveRecruiterReadiness(
      makeReadyCarrier({
        recruiter_name: '',
        company_name: '',
        recruiter_email: '',
        // Keep company_type as carrier so dot_or_mc participates.
        company_type: 'carrier',
        dot_number: null,
        mc_number: null,
        posting_terms_accepted_at: null as unknown as string,
      }),
    );
    expect(r.missing).toEqual([
      'recruiter_name',
      'company_name',
      'recruiter_email_missing',
      'dot_or_mc',
      'posting_terms',
    ]);
    // Messages array mirrors missing tokens 1:1.
    expect(r.messages).toEqual(
      r.missing.map((t) => READINESS_MESSAGES[t as ReadinessToken]),
    );
  });
});

// ---------------------------------------------------------------------------
// 7. Suspended returns ONLY the suspended token/message.
// ---------------------------------------------------------------------------
describe('suspended short-circuit', () => {
  it('status=suspended → only suspended token, even with other misses', () => {
    const r = resolveRecruiterReadiness(
      makeReadyCarrier({
        status: 'suspended',
        recruiter_name: '',
        company_name: '',
        recruiter_email: '',
        company_type: null as unknown as string,
        dot_number: null,
        mc_number: null,
        posting_terms_accepted_at: null as unknown as string,
      }),
    );
    expect(r.suspended).toBe(true);
    expect(r.missing).toEqual(['suspended']);
    expect(r.messages).toEqual([READINESS_MESSAGES.suspended]);
    expect(r.ready).toBe(false);
  });

  it('verification_status=suspended → only suspended token', () => {
    const r = resolveRecruiterReadiness(
      makeReadyCarrier({ verification_status: 'suspended' as never }),
    );
    expect(r.missing).toEqual(['suspended']);
  });
});

// ---------------------------------------------------------------------------
// 8. Missing terms token appears LAST when all other requirements pass.
// ---------------------------------------------------------------------------
describe('posting_terms token position', () => {
  it('otherwise-complete carrier without accepted terms → only posting_terms, and posting_terms is last', () => {
    const r = resolveRecruiterReadiness(
      makeReadyCarrier({
        posting_terms_accepted_at: null as unknown as string,
        legacy_terms_grandfathered_at: null,
      }),
    );
    expect(r.missing).toEqual(['posting_terms']);
    expect(r.missing[r.missing.length - 1]).toBe('posting_terms');
  });
});

// ---------------------------------------------------------------------------
// 9. Legitimate grandfathering satisfies the terms requirement.
// ---------------------------------------------------------------------------
describe('legacy_terms_grandfathered_at satisfies posting_terms', () => {
  it('grandfathered profile with no explicit accepted_at → ready and hasAcceptedPostingTerms=true', () => {
    const p = makeReadyCarrier({
      posting_terms_accepted_at: null as unknown as string,
      legacy_terms_grandfathered_at: '2026-07-17T00:00:00Z',
    });
    const r = resolveRecruiterReadiness(p);
    expect(r.ready).toBe(true);
    expect(hasAcceptedPostingTerms(p)).toBe(true);
  });

  it('neither accepted_at nor grandfathered → hasAcceptedPostingTerms=false', () => {
    const p = makeReadyCarrier({
      posting_terms_accepted_at: null as unknown as string,
      legacy_terms_grandfathered_at: null,
    });
    expect(hasAcceptedPostingTerms(p)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10. Verification approval never bypasses missing company_type or
//     carrier DOT/MC.
// ---------------------------------------------------------------------------
describe('verification approval does not bypass readiness', () => {
  it('approved verification + NULL company_type → not ready, canPost=false, not Verified for posting', () => {
    const p = makeReadyCarrier({
      verification_status: 'approved',
      company_type: null as unknown as string,
    });
    expect(resolveRecruiterReadiness(p).ready).toBe(false);
    const e = describeRecruiterEligibility(p);
    expect(e.canPost).toBe(false);
    // Not in the `verified` posting-ready state.
    expect(e.state).toBe('incomplete_profile');
    expect(e.isVerified).toBe(false);
    // Trust view: no verified badge for a non-ready profile.
    const tv = getRecruiterTrustView(p);
    expect(tv.canPost).toBe(false);
    expect(tv.showVerifiedBadge).toBe(false);
  });

  it('approved verification + carrier with no DOT/MC → not ready, canPost=false', () => {
    const p = makeReadyCarrier({
      verification_status: 'approved',
      dot_number: null,
      mc_number: null,
    });
    expect(resolveRecruiterReadiness(p).ready).toBe(false);
    expect(describeRecruiterEligibility(p).canPost).toBe(false);
    expect(getRecruiterTrustView(p).showVerifiedBadge).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 11. `isProfileCompleteForPosting` === selector.ready across a
//     table-driven matrix AND the source shows delegation, not duplication.
// ---------------------------------------------------------------------------
describe('isProfileCompleteForPosting parity + delegation', () => {
  const matrix: Array<{ name: string; profile: RecruiterProfile | null }> = [
    { name: 'null profile', profile: null },
    { name: 'ready carrier', profile: makeReadyCarrier() },
    {
      name: 'ready third-party (no DOT/MC)',
      profile: makeReadyCarrier({
        company_type: 'third_party_recruiter' as unknown as string,
        dot_number: null,
        mc_number: null,
      }),
    },
    {
      name: 'ready staffing agency',
      profile: makeReadyCarrier({
        company_type: 'staffing_agency' as unknown as string,
        dot_number: null,
        mc_number: null,
      }),
    },
    {
      name: 'ready independent recruiter',
      profile: makeReadyCarrier({
        company_type: 'independent_recruiter' as unknown as string,
        dot_number: null,
        mc_number: null,
      }),
    },
    {
      name: 'carrier missing DOT/MC',
      profile: makeReadyCarrier({ dot_number: null, mc_number: null }),
    },
    {
      name: 'null company_type',
      profile: makeReadyCarrier({ company_type: null as unknown as string }),
    },
    {
      name: 'invalid email',
      profile: makeReadyCarrier({ recruiter_email: 'bad' }),
    },
    {
      name: 'suspended',
      profile: makeReadyCarrier({ status: 'suspended' }),
    },
    {
      name: 'no accepted terms',
      profile: makeReadyCarrier({
        posting_terms_accepted_at: null as unknown as string,
      }),
    },
    {
      name: 'grandfathered non-carrier',
      profile: makeReadyCarrier({
        company_type: 'staffing_agency' as unknown as string,
        dot_number: null,
        mc_number: null,
        posting_terms_accepted_at: null as unknown as string,
        legacy_terms_grandfathered_at: '2026-07-17T00:00:00Z',
      }),
    },
  ];

  it.each(matrix)(
    '$name — isProfileCompleteForPosting matches resolveRecruiterReadiness().ready',
    ({ profile }) => {
      expect(isProfileCompleteForPosting(profile)).toBe(
        resolveRecruiterReadiness(profile).ready,
      );
    },
  );

  it('recruiterEligibility.ts source delegates isProfileCompleteForPosting to the selector', () => {
    const body = readFileSync(
      resolve(process.cwd(), 'src/lib/opportunities/recruiterEligibility.ts'),
      'utf8',
    );
    // Must import and invoke the shared selector directly.
    expect(body).toMatch(
      /from ['"]\.\/resolveRecruiterReadiness['"]/,
    );
    // Delegator body: `return resolveRecruiterReadiness(profile).ready;`
    // (allow whitespace variation but pin the shape).
    expect(body).toMatch(
      /export function isProfileCompleteForPosting[\s\S]{0,220}resolveRecruiterReadiness\(profile\)\.ready/,
    );
    // The pre-1P-A1.2 local field-check must be gone: no local
    // isNonEmpty helper, no hand-rolled company_type OR chain, no
    // local regex-based email validation.
    expect(body).not.toMatch(/function\s+isNonEmpty\b/);
    expect(body).not.toMatch(
      /companyType\s*===\s*['"]carrier['"][\s\S]{0,200}companyType\s*===\s*['"]third_party_recruiter['"]/,
    );
    // No local regex email definition — must reuse the shared helper.
    expect(body).not.toMatch(/\/\^\[\^\\s@\]\+@\[\^\\s@\]\+\\\./);
  });
});

// ---------------------------------------------------------------------------
// 12. describeRecruiterEligibility, trust view, and describeRecruiterBlock
//     remain consistent with the selector's readiness verdict.
// ---------------------------------------------------------------------------
describe('eligibility, trust view, and block descriptions stay consistent with readiness', () => {
  it('ready carrier → canPost=true, trust view canPost=true, block reason=ok', () => {
    const p = makeReadyCarrier();
    const r = resolveRecruiterReadiness(p);
    expect(r.ready).toBe(true);
    expect(describeRecruiterEligibility(p).canPost).toBe(true);
    expect(getRecruiterTrustView(p).canPost).toBe(true);
    expect(describeRecruiterBlock(p).reason).toBe('ok');
  });

  it('incomplete → block reason=incomplete_profile and body surfaces readiness messages', () => {
    const p = makeReadyCarrier({
      dot_number: null,
      mc_number: null,
    });
    const r = resolveRecruiterReadiness(p);
    expect(r.missing).toEqual(['dot_or_mc']);
    const block = describeRecruiterBlock(p);
    expect(block.reason).toBe('incomplete_profile');
    // Block body must include the exact dot_or_mc readiness message —
    // that's what makes describeRecruiterBlock "use readiness
    // meaningfully" per Phase 1P-A1.2.
    expect(block.body).toContain(READINESS_MESSAGES.dot_or_mc);
  });

  it('non-carrier incomplete profile body never claims DOT/MC is required', () => {
    const p = makeReadyCarrier({
      company_type: 'independent_recruiter' as unknown as string,
      dot_number: null,
      mc_number: null,
      recruiter_name: '', // force incomplete without touching DOT/MC
    });
    const block = describeRecruiterBlock(p);
    expect(block.reason).toBe('incomplete_profile');
    expect(block.body).not.toContain(READINESS_MESSAGES.dot_or_mc);
    expect(block.body).toContain(READINESS_MESSAGES.recruiter_name);
  });

  it('suspended → block reason=suspended and body matches eligibility copy', () => {
    const p = makeReadyCarrier({ status: 'suspended' });
    const block = describeRecruiterBlock(p);
    expect(block.reason).toBe('suspended');
    expect(block.body).toBe(describeRecruiterEligibility(p).body);
  });

  it('missing profile → block reason=missing_profile and body uses readiness message list', () => {
    const block = describeRecruiterBlock(null, { intentRecruiter: true });
    expect(block.reason).toBe('missing_profile');
    // The readiness selector yields a stable multi-token list for null
    // profiles, so the block body should include the recruiter_name
    // message from that list.
    expect(block.body).toContain(READINESS_MESSAGES.recruiter_name);
  });
});

// ---------------------------------------------------------------------------
// 13. Company type is NEVER inferred from DOT/MC or verification status.
// ---------------------------------------------------------------------------
describe('no company_type inference from other fields', () => {
  it('profile with DOT number set but company_type NULL → still company_type token', () => {
    const r = resolveRecruiterReadiness(
      makeReadyCarrier({
        company_type: null as unknown as string,
        dot_number: '9999999',
        mc_number: null,
      }),
    );
    expect(r.companyType).toBeNull();
    expect(r.missing).toContain('company_type');
  });

  it('approved verification + NULL company_type does not upgrade companyType', () => {
    const r = resolveRecruiterReadiness(
      makeReadyCarrier({
        verification_status: 'approved',
        company_type: null as unknown as string,
      }),
    );
    expect(r.companyType).toBeNull();
    expect(r.missing).toContain('company_type');
  });

  it('resolveRecruiterReadiness source contains no inference from dot_number/mc_number/verification_status into company_type', () => {
    const body = readFileSync(
      resolve(process.cwd(), 'src/lib/opportunities/resolveRecruiterReadiness.ts'),
      'utf8',
    );
    // No assignment or fallback into companyType from other columns.
    expect(body).not.toMatch(/companyType\s*=[^=][\s\S]{0,80}dot_number/);
    expect(body).not.toMatch(/companyType\s*=[^=][\s\S]{0,80}mc_number/);
    expect(body).not.toMatch(/companyType\s*=[^=][\s\S]{0,80}verification_status/);
  });
});

// ---------------------------------------------------------------------------
// 14. Exact phase scope — eight files only, no disabled tests in the
//     changed/new suites.
// ---------------------------------------------------------------------------
describe('Phase 1P-A1.2 scope + hygiene', () => {
  const ALLOWLIST = [
    'src/lib/opportunities/resolveRecruiterReadiness.ts',
    'src/lib/opportunities/recruiterEligibility.ts',
    'src/lib/opportunities/describeRecruiterBlock.ts',
    'src/test/phase1pA1RecruiterEligibilityCompanyType.test.ts',
    'src/test/phase1fRecruiterEligibility.test.ts',
    'src/test/phase1fRecruiterPostingRuntime.test.ts',
    'src/test/phase1fa22CanonicalEligibility.test.ts',
    'src/test/phase1fa22R1aRenderedTrustState.test.tsx',
  ];

  it('the phase allowlist has exactly eight entries and no duplicates', () => {
    expect(ALLOWLIST).toHaveLength(8);
    expect(new Set(ALLOWLIST).size).toBe(8);
  });

  it('no .only / .skip / .todo / xit / xdescribe in the four authorized test files or the new phase test', () => {
    const testFiles = ALLOWLIST.filter((p) => p.startsWith('src/test/'));
    const forbidden =
      /\b(?:it|test|describe)\.(?:only|skip|todo)\b|\bxit\b|\bxdescribe\b/;
    for (const rel of testFiles) {
      const body = readFileSync(resolve(process.cwd(), rel), 'utf8');
      // Strip string/regex literals + line comments so the hygiene rule
      // never self-matches on documentation of the forbidden markers.
      const scan = body
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/'(?:\\.|[^'\\])*'/g, "''")
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/`(?:\\.|[^`\\])*`/g, '``')
        .replace(/\/(?:\\.|\[[^\]]*\]|[^/\\\n])+\/[gimsuy]*/g, '/_/');
      expect(forbidden.test(scan), `disabled test marker found in ${rel}`).toBe(
        false,
      );
    }
  });
});
