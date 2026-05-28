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
    const src = readFileSync(
      resolve(__dirname, '../../supabase/functions/delete-account/index.ts'),
      'utf8',
    );
    // No interpolation of the dynamic table name or supabase error.message into
    // a client-facing JSON response.
    expect(src).not.toMatch(/Failed to delete from \$\{table\}/);
    expect(src).not.toMatch(/error:\s*`Failed to delete from \$\{table\}/);
    expect(src).not.toMatch(/error:\s*deleteError\.message/);
    // Generic client-safe copy is present.
    expect(src).toMatch(/Account deletion failed\. Please contact support\./);
    // Server-side logging is preserved.
    expect(src).toMatch(/console\.error\(/);
  });
});


describe('Phase 28 PII access control hardening', () => {
  function loadPhase28(): string {
    return loadMigrationContaining('CREATE OR REPLACE FUNCTION public.list_recruiter_applications_safe');
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
    expect(src).toMatch(/driver_phone_snapshot:\s*driverProfile\?\.allow_verified_recruiter_contact/);
    expect(src).toMatch(/driver_email_snapshot:\s*driverProfile\?\.allow_verified_recruiter_contact/);
  });
});

