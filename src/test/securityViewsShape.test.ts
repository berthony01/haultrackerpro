import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Phase 24: verify that the driver-facing and public views never re-expose
 * sensitive PII / internal fields, and that driver-facing hooks read from the
 * safe views (not the underlying base tables).
 *
 * Migration SQL is the source of truth; this test guards against accidental
 * regressions in either the migration or the client hook code paths.
 */
function loadMigrationContainingView(viewName: string): string {
  // Search all SQL migrations for the most recent one that defines the view.
  const migrationsDir = resolve(__dirname, '../../supabase/migrations');
  const fs = require('node:fs') as typeof import('node:fs');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f: string) => f.endsWith('.sql'))
    .sort()
    .reverse();
  for (const f of files) {
    const text = fs.readFileSync(resolve(migrationsDir, f), 'utf8');
    if (text.includes(`CREATE VIEW public.${viewName}`)) return text;
  }
  throw new Error(`No migration defines view ${viewName}`);
}

describe('Phase 24 security views', () => {
  it('driver_referrals_driver_safe omits referred_driver_email/phone/note', () => {
    const sql = loadMigrationContainingView('driver_referrals_driver_safe');
    const block = sql
      .split('CREATE VIEW public.driver_referrals_driver_safe')[1]
      .split(';')[0];
    expect(block).not.toMatch(/referred_driver_email/);
    expect(block).not.toMatch(/referred_driver_phone/);
    expect(block).not.toMatch(/referred_driver_note/);
    expect(block).toMatch(/referred_driver_name/);
    expect(block).toMatch(/auth\.uid\(\)/);
  });

  it('resource_articles_public omits ai_generation_prompt and admin fields', () => {
    const sql = loadMigrationContainingView('resource_articles_public');
    const block = sql
      .split('CREATE VIEW public.resource_articles_public')[1]
      .split(';')[0];
    expect(block).not.toMatch(/ai_generation_prompt/);
    expect(block).not.toMatch(/approval_status/);
    expect(block).not.toMatch(/reviewed_by/);
    expect(block).not.toMatch(/created_by/);
    expect(block).toMatch(/published_at IS NOT NULL/);
  });

  it('driver hooks and public resource pages read from safe views', () => {
    const driverHook = readFileSync(
      resolve(__dirname, '../hooks/opportunities/useDriverReferrals.ts'),
      'utf8',
    );
    expect(driverHook).toMatch(/driver_referrals_driver_safe/);

    const hub = readFileSync(
      resolve(__dirname, '../pages/resources/ResourcesHub.tsx'),
      'utf8',
    );
    const article = readFileSync(
      resolve(__dirname, '../pages/resources/ResourceArticleDynamic.tsx'),
      'utf8',
    );
    expect(hub).toMatch(/resource_articles_public/);
    expect(article).toMatch(/resource_articles_public/);
    // And neither should still target the base table for reads.
    expect(hub).not.toMatch(/from\('resource_articles'\)/);
    expect(article).not.toMatch(/from\('resource_articles'\)/);
  });

  it('no real personal gmail addresses remain in client src files', () => {
    // Recursively scan src/ for personal-looking gmail addresses. The build-time
    // env var path in internalTestAccounts.ts is the only allowed mechanism.
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
          const matches = text.match(/[a-zA-Z0-9._%+-]+@gmail\.com/g);
          if (matches) hits.push(`${p}: ${matches.join(', ')}`);
        }
      }
    }
    walk(srcDir);
    expect(hits).toEqual([]);
  });
});
