// Phase 1R-D2-B6-B1 — Recruiter Checkout Eligibility Alignment.
//
// STATIC / READ-ONLY PROOF. This file performs no database access, no
// network access, and no execution of the SQL under test. It reads the
// candidate migration and the production source files from disk and
// asserts their literal contract.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CANDIDATE_PATH =
  'supabase/migration-candidates/20260731232000_phase1r_d2_b6_b1_recruiter_checkout_eligibility_alignment.sql';
const EDGE_PATH = 'supabase/functions/create-recruiter-checkout/index.ts';
const SHARED_PATH = 'supabase/functions/_shared/recruiter-checkout.ts';
const HOOK_PATH = 'src/hooks/opportunities/useRecruiterBilling.ts';

function read(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8');
}

const candidate = read(CANDIDATE_PATH);
const edge = read(EDGE_PATH);
const shared = read(SHARED_PATH);
const hook = read(HOOK_PATH);

// Executable portion only (header prose is documentation, not SQL).
const candidateBody = candidate.slice(candidate.indexOf('\nBEGIN;'));

function countOccurrences(haystack: string, needle: RegExp): number {
  const matches = haystack.match(needle);
  return matches ? matches.length : 0;
}

// ---------------------------------------------------------------------------
// 1. Candidate exists and is explicitly not live
// ---------------------------------------------------------------------------

describe('candidate migration identity', () => {
  it('exists and is non-empty', () => {
    expect(candidate.length).toBeGreaterThan(0);
  });

  it('is marked NOT APPLIED LIVE in its header', () => {
    expect(candidate.startsWith('-- CANDIDATE MIGRATION — NOT APPLIED LIVE.'))
      .toBe(true);
  });

  it('lives under migration-candidates, not under supabase/migrations', () => {
    expect(CANDIDATE_PATH).toContain('supabase/migration-candidates/');
    expect(CANDIDATE_PATH).not.toContain('supabase/migrations/');
  });

  it('is wrapped in a single BEGIN; ... COMMIT; transaction', () => {
    expect(countOccurrences(candidate, /^BEGIN;$/gm)).toBe(1);
    expect(countOccurrences(candidate, /^COMMIT;$/gm)).toBe(1);
    expect(candidate.indexOf('\nBEGIN;')).toBeLessThan(
      candidate.indexOf('\nCOMMIT;'),
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Exactly one narrow function replacement
// ---------------------------------------------------------------------------

describe('candidate replaces exactly one function', () => {
  it('contains exactly one CREATE OR REPLACE FUNCTION statement', () => {
    expect(
      countOccurrences(candidate, /CREATE\s+OR\s+REPLACE\s+FUNCTION/gi),
    ).toBe(1);
  });

  it('replaces claim_recruiter_checkout_intent with the exact signature', () => {
    expect(candidate).toMatch(
      /CREATE OR REPLACE FUNCTION public\.claim_recruiter_checkout_intent\(\s*\n\s*_recruiter_id uuid,\s*\n\s*_user_id\s+uuid,\s*\n\s*_plan\s+text\s*\n\)/,
    );
  });

  it('does not replace or create any other function', () => {
    const otherFns = [
      'bind_recruiter_checkout_customer',
      'complete_recruiter_checkout_intent',
      'fail_recruiter_checkout_intent',
    ];
    for (const fn of otherFns) {
      expect(candidate).not.toMatch(
        new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}`, 'i'),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Preserved security and state-machine invariants
// ---------------------------------------------------------------------------

describe('candidate preserves hardening invariants', () => {
  it('is SECURITY DEFINER', () => {
    expect(candidate).toMatch(/^SECURITY DEFINER$/m);
  });

  it('pins search_path to public', () => {
    expect(candidate).toMatch(/^SET search_path = public$/m);
  });

  it('takes the per-recruiter advisory transaction lock', () => {
    expect(candidate).toContain('pg_advisory_xact_lock');
    expect(candidate).toContain("hashtext('rci:' || _recruiter_id::text)");
  });

  it('keeps the fixed 300-second lease', () => {
    expect(candidate).toMatch(
      /v_lease_seconds constant integer := 300;/,
    );
    expect(candidate).toContain('make_interval(secs => v_lease_seconds)');
  });

  it('keeps the ownership check before eligibility', () => {
    expect(candidate).toContain('WHERE id = _recruiter_id AND user_id = _user_id');
    expect(candidate).toContain("outcome := 'not_owner'");
  });

  it('checks suspension BEFORE readiness', () => {
    const suspension = candidateBody.indexOf("reason := 'account_suspended'");
    const readiness = candidateBody.indexOf(
      'IF NOT public.recruiter_profile_can_manage_opportunities(_recruiter_id)',
    );
    expect(suspension).toBeGreaterThan(-1);
    expect(readiness).toBeGreaterThan(-1);
    expect(suspension).toBeLessThan(readiness);
  });

  it('preserves the full state machine outcomes', () => {
    for (const outcome of [
      "outcome := 'invalid_plan'",
      "outcome := 'not_owner'",
      "outcome := 'not_eligible'",
      "outcome := 'claimed'",
      "outcome := 'ready_candidate'",
      "outcome := 'in_progress'",
    ]) {
      expect(candidate).toContain(outcome);
    }
  });

  it('preserves generation bump behavior and customer/session handling', () => {
    expect(candidate).toContain('v_bump := NOT (');
    expect(candidate).toContain(
      'CASE WHEN v_bump THEN v_row.generation + 1',
    );
    expect(candidate).toContain('stripe_customer_id preserved across reclaim');
    expect(candidate).toContain('stripe_checkout_session_id = NULL');
  });
});

// ---------------------------------------------------------------------------
// 4. Eligibility replacement and retired approval gate
// ---------------------------------------------------------------------------

describe('candidate eligibility alignment', () => {
  it('uses the canonical readiness helper with profile_not_ready', () => {
    expect(candidate).toContain(
      'IF NOT public.recruiter_profile_can_manage_opportunities(_recruiter_id) THEN',
    );
    expect(candidate).toContain("reason := 'profile_not_ready'");
  });

  it('contains no verification_not_approved reason', () => {
    expect(candidate).not.toContain('verification_not_approved');
  });

  it('contains no approved-verification comparison', () => {
    expect(candidate).not.toMatch(/verification_status\s*,?\s*''\s*\)?\s*<>\s*'approved'/);
    expect(candidate).not.toMatch(/=\s*'approved'/);
  });
});

// ---------------------------------------------------------------------------
// 5. Least privilege and prohibited statements
// ---------------------------------------------------------------------------

describe('candidate privileges and prohibited statements', () => {
  it('revokes PUBLIC, anon and authenticated', () => {
    expect(candidate).toContain("'REVOKE ALL ON FUNCTION ' || v_sig || ' FROM PUBLIC'");
    expect(candidate).toContain("'REVOKE ALL ON FUNCTION ' || v_sig || ' FROM anon'");
    expect(candidate).toContain(
      "'REVOKE ALL ON FUNCTION ' || v_sig || ' FROM authenticated'",
    );
  });

  it('grants EXECUTE to service_role only (plus optional sandbox roles)', () => {
    expect(candidate).toContain(
      "'GRANT EXECUTE ON FUNCTION ' || v_sig || ' TO service_role'",
    );
    expect(candidate).toContain("ARRAY['pglite_test','postgres_test_runner']");
    expect(candidate).toContain('FROM pg_roles WHERE rolname = v_role');
  });

  it('never grants to anon or authenticated', () => {
    expect(candidate).not.toMatch(/GRANT\s+EXECUTE[^\n]*TO\s+anon/i);
    expect(candidate).not.toMatch(/GRANT\s+EXECUTE[^\n]*TO\s+authenticated/i);
  });

  it('contains no table creation, policy, trigger, DROP or destructive action', () => {
    expect(candidateBody).not.toMatch(/CREATE\s+TABLE/i);
    expect(candidateBody).not.toMatch(/ALTER\s+TABLE/i);
    expect(candidateBody).not.toMatch(/CREATE\s+POLICY/i);
    expect(candidateBody).not.toMatch(/CREATE\s+TRIGGER/i);
    expect(candidateBody).not.toMatch(/\bDROP\b/i);
    expect(candidateBody).not.toMatch(/\bTRUNCATE\b/i);
    expect(candidateBody).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
  });

  it('contains no DML/backfill outside the function body', () => {
    const bodyStart = candidate.indexOf('AS $$');
    const bodyEnd = candidate.indexOf('$$;', bodyStart);
    const outside =
      candidate.slice(0, bodyStart) + candidate.slice(bodyEnd + 3);
    expect(outside).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(outside).not.toMatch(/\bUPDATE\s+public\./i);
    expect(outside).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
});

// ---------------------------------------------------------------------------
// 6. Edge adapter contract
// ---------------------------------------------------------------------------

describe('create-recruiter-checkout edge adapter', () => {
  it('invokes the canonical readiness RPC with the recruiter id', () => {
    expect(edge).toContain('"recruiter_profile_can_manage_opportunities"');
    expect(edge).toContain('{ _recruiter_id: recruiter.id }');
  });

  it('maps an RPC error to transient_error', () => {
    expect(edge).toMatch(
      /if \(canManageErr\) \{[\s\S]{0,200}code: "transient_error"/,
    );
  });

  it('maps a false result to not_eligible', () => {
    expect(edge).toMatch(
      /if \(canManage !== true\) \{[\s\S]{0,200}code: "not_eligible"/,
    );
  });

  it('contains no approval-only gate or message', () => {
    expect(edge).not.toMatch(/verification_status\s*!==\s*['"]approved['"]/);
    expect(edge).not.toMatch(/verification_status\s*===\s*['"]approved['"]/);
    expect(edge).not.toContain('verification_not_approved');
  });
});

// ---------------------------------------------------------------------------
// 7. Shared origin allowlist
// ---------------------------------------------------------------------------

describe('recruiter checkout origin allowlist', () => {
  const PREVIEW_ORIGIN =
    'https://id-preview--6d28fa14-57dc-418b-9196-19e144f0e8df.lovable.app';

  it('lists the three production origins plus the exact trusted preview origin', () => {
    for (const origin of [
      'https://haultrackerpro.com',
      'https://www.haultrackerpro.com',
      'https://haultrackerpro.lovable.app',
      PREVIEW_ORIGIN,
    ]) {
      expect(shared).toContain(`"${origin}"`);
    }
  });

  it('accepts each allowed origin and rejects untrusted origins', async () => {
    const { isAllowedRecruiterOrigin, RECRUITER_ALLOWED_ORIGINS } =
      await import('../../supabase/functions/_shared/recruiter-checkout.ts');

    expect(isAllowedRecruiterOrigin('https://haultrackerpro.com')).toBe(true);
    expect(isAllowedRecruiterOrigin('https://www.haultrackerpro.com')).toBe(true);
    expect(isAllowedRecruiterOrigin('https://haultrackerpro.lovable.app')).toBe(
      true,
    );
    expect(isAllowedRecruiterOrigin(PREVIEW_ORIGIN)).toBe(true);

    // Arbitrary different preview origin must be rejected (exact match only).
    expect(
      isAllowedRecruiterOrigin(
        'https://id-preview--00000000-0000-0000-0000-000000000000.lovable.app',
      ),
    ).toBe(false);
    expect(isAllowedRecruiterOrigin('https://lovable.dev')).toBe(false);
    expect(isAllowedRecruiterOrigin('http://haultrackerpro.com')).toBe(false);
    expect(isAllowedRecruiterOrigin('')).toBe(false);

    expect(RECRUITER_ALLOWED_ORIGINS).toHaveLength(4);
  });

  it('uses exact-match membership, never suffix or wildcard matching', () => {
    expect(shared).toContain('RECRUITER_ALLOWED_ORIGINS.includes(origin)');
    expect(shared).not.toMatch(/origin\.endsWith\(/);
    expect(shared).not.toMatch(/lovable\.app\W*\)\s*\|\|/);
  });
});

// ---------------------------------------------------------------------------
// 8. Popup helper containment
// ---------------------------------------------------------------------------

describe('useRecruiterBilling popup containment', () => {
  it('defines the guarded popup helpers', () => {
    expect(hook).toContain('const isTabUsable = (w: Window | null): boolean =>');
    expect(hook).toContain('const closeTabBestEffort = (w: Window | null): void =>');
  });

  it('reads w.closed only inside the guarded helper', () => {
    const lines = hook.split('\n');
    const closedLines = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /\bw\.closed\b/.test(line));

    expect(closedLines.length).toBeGreaterThan(0);

    const helperStart = hook
      .slice(0, hook.indexOf('const isTabUsable'))
      .split('\n').length - 1;
    const helperEnd = hook
      .slice(0, hook.indexOf('const closeTabBestEffort'))
      .split('\n').length - 1;

    for (const { index } of closedLines) {
      expect(index).toBeGreaterThanOrEqual(helperStart);
      expect(index).toBeLessThan(helperEnd);
    }
  });

  it('wraps the popup usability read in try/catch', () => {
    const helper = hook.slice(
      hook.indexOf('const isTabUsable'),
      hook.indexOf('const closeTabBestEffort'),
    );
    expect(helper).toContain('try {');
    expect(helper).toContain('catch');
    expect(helper).toContain('return !w.closed;');
  });

  it('preserves the validated fallback behavior', () => {
    expect(hook).toContain('fallbackUrl');
  });
});
