import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Phase 24 + Phase 26: verify that the public/driver-safe surfaces never
 * re-expose sensitive PII / internal fields, and that the client reads them
 * via the strict RPC functions (not the underlying base tables).
 *
 * Migration SQL is the source of truth; this test guards against accidental
 * regressions in either the migration or the client hook code paths.
 */
function loadMigrationContaining(token: string): string {
  const migrationsDir = resolve(__dirname, '../../supabase/migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .reverse();
  for (const f of files) {
    const text = readFileSync(resolve(migrationsDir, f), 'utf8');
    if (text.includes(token)) return text;
  }
  throw new Error(`No migration contains token ${token}`);
}

function extractFunctionBody(sql: string, fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = sql.indexOf(marker);
  if (start < 0) throw new Error(`Function ${fnName} not found`);
  // Take everything up to the closing `$$;` of the function body.
  const tail = sql.slice(start);
  const end = tail.indexOf('$$;');
  if (end < 0) throw new Error(`Function ${fnName} body not terminated`);
  return tail.slice(0, end);
}

describe('Phase 26 security RPCs', () => {
  it('list_my_driver_referrals omits referred_driver_email/phone/note and scopes to auth.uid()', () => {
    const sql = loadMigrationContaining('CREATE OR REPLACE FUNCTION public.list_my_driver_referrals');
    const body = extractFunctionBody(sql, 'list_my_driver_referrals()');
    expect(body).not.toMatch(/referred_driver_email/);
    expect(body).not.toMatch(/referred_driver_phone/);
    expect(body).not.toMatch(/referred_driver_note/);
    expect(body).toMatch(/referred_driver_name/);
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/auth\.uid\(\)/);
    expect(body).toMatch(/referring_driver_id = auth\.uid\(\)/);
  });

  it('list_public_resource_articles + get_public_resource_article omit ai_generation_prompt and admin fields', () => {
    const sql = loadMigrationContaining('CREATE OR REPLACE FUNCTION public.list_public_resource_articles');
    for (const fn of ['list_public_resource_articles(_limit int DEFAULT 24)', 'get_public_resource_article(_slug text)']) {
      const body = extractFunctionBody(sql, fn);
      expect(body, fn).not.toMatch(/ai_generation_prompt/);
      expect(body, fn).not.toMatch(/approval_status/);
      expect(body, fn).not.toMatch(/reviewed_by/);
      expect(body, fn).not.toMatch(/created_by/);
      expect(body, fn).toMatch(/status = 'published'/);
      expect(body, fn).toMatch(/published_at IS NOT NULL/);
    }
  });

  it('driver hooks and public resource pages call the safe RPCs (not base tables)', () => {
    const driverHook = readFileSync(
      resolve(__dirname, '../hooks/opportunities/useDriverReferrals.ts'),
      'utf8',
    );
    expect(driverHook).toMatch(/list_my_driver_referrals/);
    expect(driverHook).not.toMatch(/driver_referrals_driver_safe/);

    const hub = readFileSync(
      resolve(__dirname, '../pages/resources/ResourcesHub.tsx'),
      'utf8',
    );
    const article = readFileSync(
      resolve(__dirname, '../pages/resources/ResourceArticleDynamic.tsx'),
      'utf8',
    );
    expect(hub).toMatch(/list_public_resource_articles/);
    expect(article).toMatch(/get_public_resource_article/);
    // Neither should target the base table for reads.
    expect(hub).not.toMatch(/from\(['"]resource_articles['"]\)/);
    expect(article).not.toMatch(/from\(['"]resource_articles['"]\)/);
    expect(hub).not.toMatch(/resource_articles_public/);
    expect(article).not.toMatch(/resource_articles_public/);
  });

  it('no real personal gmail addresses remain in client src files', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const srcDir = resolve(__dirname, '..');
    const hits: string[] = [];
    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          const text = fs.readFileSync(p, 'utf8');
          // Ignore obvious typo-suggestion strings like 'gmial.com' or 'gmail.comm'.
          const matches = text.match(/[a-zA-Z0-9._%+-]+@gmail\.com\b/g);
          if (matches) hits.push(`${p}: ${matches.join(', ')}`);
        }
      }
    }
    walk(srcDir);
    expect(hits).toEqual([]);
  });

  it('no real personal gmail addresses remain in active edge functions', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const fnDir = resolve(__dirname, '../../supabase/functions');
    const hits: string[] = [];
    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          const text = fs.readFileSync(p, 'utf8');
          const matches = text.match(/[a-zA-Z0-9._%+-]+@gmail\.com\b/g);
          if (matches) hits.push(`${p}: ${matches.join(', ')}`);
        }
      }
    }
    walk(fnDir);
    expect(hits).toEqual([]);
  });

  it('delete-account never leaks raw DB error messages or table names to clients', () => {
    // Phase 1B-1: the generic client-facing error message now lives in the
    // shared, Deno-neutral account-deletion module (GENERIC_DELETE_ERROR),
    // imported by the thin Edge Function adapter rather than duplicated as a
    // literal in the adapter itself. Check both: the adapter never leaks raw
    // DB errors/table names and imports the shared constant; the shared
    // module defines the exact generic client-safe copy.
    const adapterSrc = readFileSync(
      resolve(__dirname, '../../supabase/functions/delete-account/index.ts'),
      'utf8',
    );
    const sharedSrc = readFileSync(
      resolve(__dirname, '../../supabase/functions/_shared/account-deletion.ts'),
      'utf8',
    );
    // No interpolation of the dynamic table name or supabase error.message into
    // a client-facing JSON response.
    expect(adapterSrc).not.toMatch(/Failed to delete from \$\{table\}/);
    expect(adapterSrc).not.toMatch(/error:\s*`Failed to delete from \$\{table\}/);
    expect(adapterSrc).not.toMatch(/error:\s*deleteError\.message/);
    // The adapter imports the single source of truth for the generic message
    // rather than hardcoding its own copy.
    expect(adapterSrc).toMatch(/GENERIC_DELETE_ERROR/);
    // Generic client-safe copy is present at its source of truth.
    expect(sharedSrc).toMatch(/Account deletion failed\. Please contact support\./);
    // Server-side logging is preserved (in both the adapter and the shared
    // orchestration module).
    expect(adapterSrc).toMatch(/console\.error\(/);
    expect(sharedSrc).toMatch(/console\.error\(/);
  });
});


describe('Phase 28 PII access control hardening', () => {
  function loadPhase28(): string {
    return loadMigrationContaining('CREATE OR REPLACE FUNCTION public.get_my_recruiter_profile_safe');

  }

  it('drops driver-side direct SELECT policies on driver_referrals', () => {
    const sql = loadPhase28();
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Referred driver views linked referrals" ON public\.driver_referrals/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Referring driver views own referrals" ON public\.driver_referrals/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Referring driver views linked referrals" ON public\.driver_referrals/);
  });

  it('list_recruiter_applications_safe gates phone/email by approved contact request + consent', () => {
    const sql = loadPhase28();
    const body = extractFunctionBody(sql, 'list_recruiter_applications_safe(_recruiter_id uuid)');
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/allow_verified_recruiter_contact/);
    expect(body).toMatch(/recruiter_contact_requests/);
    expect(body).toMatch(/status = 'approved'/);
    // Phone/email are wrapped in conditional CASE that requires both consent
    // AND an approved contact request; otherwise NULL.
    expect(body).toMatch(/'driver_phone_snapshot',\s*CASE/);
    expect(body).toMatch(/'driver_email_snapshot',\s*CASE/);
    expect(body).toMatch(/ELSE NULL/);
    // Caller must own the recruiter profile.
    expect(body).toMatch(/rp\.user_id = _uid/);
  });

  it('snapshot guard trigger nulls phone/email when consent is false', () => {
    const sql = loadPhase28();
    const body = extractFunctionBody(sql, 'opportunity_applications_contact_snapshot_guard()');
    expect(body).toMatch(/allow_verified_recruiter_contact/);
    expect(body).toMatch(/NEW\.driver_phone_snapshot := NULL/);
    expect(body).toMatch(/NEW\.driver_email_snapshot := NULL/);
  });

  it('get_my_recruiter_profile_safe excludes admin_notes and verified_by', () => {
    const sql = loadPhase28();
    const body = extractFunctionBody(sql, 'get_my_recruiter_profile_safe()');
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/- 'admin_notes'/);
    expect(body).toMatch(/- 'verified_by'/);
    expect(body).toMatch(/rp\.user_id = _uid/);
  });

  it('useRecruiterProfile reads via safe RPC, not select(*) on recruiter_profiles', () => {
    const src = readFileSync(
      resolve(__dirname, '../hooks/opportunities/useRecruiterProfile.ts'),
      'utf8',
    );
    expect(src).toMatch(/get_my_recruiter_profile_safe/);
    // The profile read query must no longer go through .from('recruiter_profiles').select('*')
    expect(src).not.toMatch(/\.from\(['"]recruiter_profiles['"]\)\s*\n?\s*\.select\(['"]\*['"]\)/);
  });

  it('useOpportunityApplications recruiter read goes through safe RPC', () => {
    const src = readFileSync(
      resolve(__dirname, '../hooks/opportunities/useOpportunityApplications.ts'),
      'utf8',
    );
    expect(src).toMatch(/list_recruiter_applications_safe/);
  });

  it('OpportunityDetail only sends contact snapshots when driver consent is on', () => {
    const src = readFileSync(
      resolve(__dirname, '../components/opportunities/OpportunityDetail.tsx'),
      'utf8',
    );
    // Phase 28C: snapshots are computed via local `phoneSnap`/`emailSnap` that
    // gate on consent + matching contact_preference.
    expect(src).toMatch(/allow_verified_recruiter_contact/);
    expect(src).toMatch(/pref === 'phone'/);
    expect(src).toMatch(/pref === 'email'/);
    expect(src).toMatch(/driver_phone_snapshot:\s*phoneSnap/);
    expect(src).toMatch(/driver_email_snapshot:\s*emailSnap/);
  });
});


describe('Phase 28C final scanner cleanup + write-path hardening', () => {
  function loadPhase28C(): string {
    return loadMigrationContaining(
      'CREATE OR REPLACE FUNCTION public.create_driver_referral_safe',
    );
  }

  it('drops driver UPDATE policy on driver_referrals', () => {
    const sql = loadPhase28C();
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Referring driver updates own referral early" ON public\.driver_referrals/);
  });

  it('drops driver direct INSERT policy on driver_referrals', () => {
    const sql = loadPhase28C();
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Driver inserts own referral" ON public\.driver_referrals/);
  });

  it('create_driver_referral_safe is SECURITY DEFINER, validates approved opportunity, returns only id', () => {
    const sql = loadPhase28C();
    const body = extractFunctionBody(
      sql,
      'create_driver_referral_safe(\n  _opportunity_id uuid,\n  _recruiter_id uuid,\n  _referred_driver_name text DEFAULT NULL,\n  _referred_driver_email text DEFAULT NULL,\n  _referred_driver_phone text DEFAULT NULL,\n  _referred_driver_note text DEFAULT NULL\n)',
    );
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/RETURNS uuid/);
    expect(body).toMatch(/admin_review_status = 'approved'/);
    expect(body).toMatch(/verification_status = 'approved'/);
    expect(body).toMatch(/referring_driver_id/);
    expect(body).toMatch(/auth\.uid\(\)/);
  });

  it('useDriverReferrals create uses the safe RPC (no direct insert)', () => {
    const src = readFileSync(
      resolve(__dirname, '../hooks/opportunities/useDriverReferrals.ts'),
      'utf8',
    );
    expect(src).toMatch(/create_driver_referral_safe/);
    expect(src).not.toMatch(/\.from\(['"]driver_referrals['"]\)\s*\n?\s*\.insert\(/);
  });

  it('drops open "Anyone can submit lead" INSERT policy on lead_magnet_signups', () => {
    const sql = loadPhase28C();
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Anyone can submit lead" ON public\.lead_magnet_signups/);
  });

  it('submit_lead_magnet_signup validates email regex + bundle_version + length', () => {
    const sql = loadPhase28C();
    const body = extractFunctionBody(
      sql,
      "submit_lead_magnet_signup(\n  _email text,\n  _first_name text DEFAULT NULL,\n  _bundle_name text DEFAULT 'Trucker Starter Kit',\n  _bundle_version text DEFAULT 'free',\n  _source_page text DEFAULT NULL,\n  _utm_source text DEFAULT NULL,\n  _utm_medium text DEFAULT NULL,\n  _utm_campaign text DEFAULT NULL,\n  _utm_content text DEFAULT NULL,\n  _utm_term text DEFAULT NULL,\n  _converted_user_id uuid DEFAULT NULL\n)",
    );
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/\^\[a-z0-9\._%\+\-\]\+@/);
    expect(body).toMatch(/length\(_email_norm\) > 255/);
    expect(body).toMatch(/_bv NOT IN \('free'\)/);
    expect(body).toMatch(/ON CONFLICT \(email_lower, bundle_version\)/);
    expect(body).toMatch(/RETURNING id/);
  });

  it('leadMagnet.ts has no direct .from(lead_magnet_signups).insert fallback', () => {
    const src = readFileSync(resolve(__dirname, '../lib/leadMagnet.ts'), 'utf8');
    expect(src).toMatch(/submit_lead_magnet_signup/);
    expect(src).not.toMatch(/\.from\(['"]lead_magnet_signups['"]\)\s*\.insert/);
  });
});



describe('Phase 28A direct base-table PII access closures', () => {
  function loadPhase28A(): string {
    return loadMigrationContaining(
      'CREATE OR REPLACE FUNCTION public.get_application_contract_summary',
    );
  }

  it('drops broad recruiter SELECT on opportunity_applications', () => {
    const sql = loadPhase28A();
    expect(sql).toMatch(
      /DROP POLICY IF EXISTS "Recruiter views applications for own opportunities"\s+ON public\.opportunity_applications/,
    );
  });

  it('drops recruiter self SELECT on recruiter_profiles', () => {
    const sql = loadPhase28A();
    expect(sql).toMatch(
      /DROP POLICY IF EXISTS "Recruiter views own profile"\s+ON public\.recruiter_profiles/,
    );
  });

  it('exposes is_current_user_recruiter() with SECURITY DEFINER', () => {
    const sql = loadPhase28A();
    const body = extractFunctionBody(sql, 'is_current_user_recruiter()');
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/auth\.uid\(\)/);
  });

  it('list_recruiter_application_summaries returns non-PII fields only', () => {
    const sql = loadPhase28A();
    const body = extractFunctionBody(sql, 'list_recruiter_application_summaries(_recruiter_id uuid)');
    expect(body).toMatch(/SECURITY DEFINER/);
    // Must not select driver phone/email snapshots or message.
    expect(body).not.toMatch(/driver_phone_snapshot/);
    expect(body).not.toMatch(/driver_email_snapshot/);
    expect(body).not.toMatch(/oa\.message/);
    // Caller must own recruiter profile.
    expect(body).toMatch(/rp\.user_id = _uid/);
  });

  it('get_application_contract_summary excludes PII + admin fields and is party-gated', () => {
    const sql = loadPhase28A();
    const body = extractFunctionBody(sql, 'get_application_contract_summary(_application_id uuid)');
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/is_application_party/);
    expect(body).not.toMatch(/driver_phone_snapshot/);
    expect(body).not.toMatch(/driver_email_snapshot/);
    expect(body).not.toMatch(/admin_notes/);
    expect(body).not.toMatch(/verified_by/);
  });

  it('useUserRole detects recruiter role via safe RPC, not direct table SELECT', () => {
    const src = readFileSync(resolve(__dirname, '../hooks/useUserRole.ts'), 'utf8');
    expect(src).toMatch(/is_current_user_recruiter/);
    expect(src).not.toMatch(/supabase\s*\.\s*from\(['"]recruiter_profiles['"]\)/);
  });

  it('useRecruiterReportData reads applications via safe summary RPC', () => {
    const src = readFileSync(
      resolve(__dirname, '../hooks/recruiter/useRecruiterReportData.ts'),
      'utf8',
    );
    expect(src).toMatch(/list_recruiter_application_summaries/);
    expect(src).not.toMatch(/\.from\(['"]opportunity_applications['"]\)/);
  });

  it('ContractSummaryPanel reads via safe contract-summary RPC', () => {
    const src = readFileSync(
      resolve(__dirname, '../components/contracts/ContractSummaryPanel.tsx'),
      'utf8',
    );
    expect(src).toMatch(/get_application_contract_summary/);
    expect(src).not.toMatch(/\.from\(['"]opportunity_applications['"]\)/);
    expect(src).not.toMatch(/\.from\(['"]recruiter_profiles['"]\)/);
  });
});

describe('Phase 28B scanner reconciliation + opportunity board hardening', () => {
  function loadPhase28B(): string {
    return loadMigrationContaining(
      'CREATE OR REPLACE FUNCTION public.list_driver_visible_opportunities',
    );
  }

  it('defensively drops all driver-facing SELECT policies on driver_referrals', () => {
    const sql = loadPhase28B();
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Referring driver views own referrals" ON public\.driver_referrals/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Referring driver views linked referrals" ON public\.driver_referrals/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Referred driver views linked referrals" ON public\.driver_referrals/);
  });

  it('list_my_driver_referrals omits referred_driver_email/phone/note (regression)', () => {
    const sql = loadMigrationContaining('CREATE OR REPLACE FUNCTION public.list_my_driver_referrals');
    const body = extractFunctionBody(sql, 'list_my_driver_referrals()');
    expect(body).not.toMatch(/referred_driver_email/);
    expect(body).not.toMatch(/referred_driver_phone/);
    expect(body).not.toMatch(/referred_driver_note/);
  });

  it('useDriverReferrals uses only the safe RPC for reads', () => {
    const src = readFileSync(
      resolve(__dirname, '../hooks/opportunities/useDriverReferrals.ts'),
      'utf8',
    );
    expect(src).toMatch(/list_my_driver_referrals/);
    // Driver list read must not go through .from('driver_referrals').select(...)
    expect(src).not.toMatch(/\.from\(['"]driver_referrals['"]\)\s*\n?\s*\.select\(/);
  });

  it('list_recruiter_applications_safe also gates phone/email by contact_preference', () => {
    const sql = loadPhase28B();
    const body = extractFunctionBody(sql, 'list_recruiter_applications_safe(_recruiter_id uuid)');
    expect(body).toMatch(/contact_preference = 'phone'/);
    expect(body).toMatch(/contact_preference = 'email'/);
    expect(body).toMatch(/allow_verified_recruiter_contact/);
    expect(body).toMatch(/status = 'approved'/);
  });

  it('snapshot guard nulls non-matching snapshots by contact_preference', () => {
    const sql = loadPhase28B();
    const body = extractFunctionBody(sql, 'opportunity_applications_contact_snapshot_guard()');
    expect(body).toMatch(/_pref <> 'phone'/);
    expect(body).toMatch(/_pref <> 'email'/);
  });

  it('scrub trigger handles consent flip and preference changes', () => {
    const sql = loadPhase28B();
    const body = extractFunctionBody(sql, 'driver_opportunity_profiles_scrub_snapshots()');
    expect(body).toMatch(/allow_verified_recruiter_contact/);
    expect(body).toMatch(/OLD\.contact_preference IS DISTINCT FROM NEW\.contact_preference/);
    expect(body).toMatch(/NEW\.contact_preference = 'phone'/);
    expect(body).toMatch(/NEW\.contact_preference = 'email'/);
    expect(body).toMatch(/NEW\.contact_preference = 'in_app'/);
  });

  it('list_driver_visible_opportunities filters by approved recruiter and never exposes recruiter PII', () => {
    const sql = loadPhase28B();
    const body = extractFunctionBody(
      sql,
      'list_driver_visible_opportunities(\n  _state text DEFAULT NULL,\n  _driver_type text DEFAULT NULL,\n  _route_type text DEFAULT NULL\n)',
    );
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/rp\.verification_status = 'approved'/);
    expect(body).toMatch(/rp\.status <> 'suspended'/);
    expect(body).toMatch(/o\.status = 'active'/);
    expect(body).toMatch(/o\.admin_review_status = 'approved'/);
    // Returns SETOF opportunities (base table) — recruiter PII columns are not
    // on opportunities, so no recruiter contact / admin fields can leak.
    expect(body).toMatch(/RETURNS SETOF public\.opportunities/);
    expect(body).not.toMatch(/admin_notes/);
    expect(body).not.toMatch(/verified_by/);
    expect(body).not.toMatch(/contact_email/);
    expect(body).not.toMatch(/contact_phone/);
  });

  it('useOpportunities no longer joins recruiter_profiles directly', () => {
    const src = readFileSync(
      resolve(__dirname, '../hooks/opportunities/useOpportunities.ts'),
      'utf8',
    );
    expect(src).toMatch(/list_driver_visible_opportunities/);
    expect(src).not.toMatch(/recruiter_profiles/);
    expect(src).not.toMatch(/\.from\(['"]opportunities['"]\)/);
  });

  it('resource_articles has no live anon/authenticated non-admin SELECT policy (RPC-only reads)', () => {
    // Walk all migrations; any CREATE POLICY ... FOR SELECT on resource_articles
    // not scoped to is_admin must have a subsequent DROP POLICY removing it.
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const migrationsDir = resolve(__dirname, '../../supabase/migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    const liveByName: Record<string, string> = {};
    for (const f of files) {
      const text = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
      const dropRe = /DROP POLICY IF EXISTS\s+"([^"]+)"\s+ON\s+public\.resource_articles/gi;
      let m: RegExpExecArray | null;
      while ((m = dropRe.exec(text))) delete liveByName[m[1]];
      const createRe =
        /CREATE POLICY\s+"([^"]+)"\s+ON\s+public\.resource_articles[^;]+FOR\s+SELECT[^;]+;/gi;
      while ((m = createRe.exec(text))) liveByName[m[1]] = m[0];
    }
    const offenders = Object.entries(liveByName)
      .filter(([, sql]) => !/is_admin\s*\(/i.test(sql))
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });
});


