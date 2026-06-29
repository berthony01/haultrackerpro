import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  sanitizeNextPath,
  resolvePostAuthDestination,
  buildAuthUrl,
} from '@/lib/authNavigation';

describe('sanitizeNextPath hardening — encoded attacks', () => {
  it('rejects encoded newline (/%0aevil)', () => {
    expect(sanitizeNextPath('/%0aevil')).toBeNull();
  });
  it('rejects encoded tab (/%09evil)', () => {
    expect(sanitizeNextPath('/%09evil')).toBeNull();
  });
  it('rejects encoded backslash (/%5Cevil.com)', () => {
    expect(sanitizeNextPath('/%5Cevil.com')).toBeNull();
  });
  it('rejects encoded protocol-relative (/%2F%2Fevil.com)', () => {
    expect(sanitizeNextPath('/%2F%2Fevil.com')).toBeNull();
  });
  it('rejects encoded scheme (/javascript%3Aalert(1))', () => {
    expect(sanitizeNextPath('/javascript%3Aalert(1)')).toBeNull();
  });
  it('still accepts a normal safe deep path', () => {
    expect(sanitizeNextPath('/agency/request/abc-123')).toBe('/agency/request/abc-123');
    expect(sanitizeNextPath('/driver/work-items/wi_42')).toBe('/driver/work-items/wi_42');
  });
});

describe('Phase 5 continuation — capability defaults via next', () => {
  it('?next=/assistant routes to /assistant', () => {
    expect(resolvePostAuthDestination('?next=%2Fassistant')).toBe('/assistant');
  });
  it('?next=/agency routes to /agency', () => {
    expect(resolvePostAuthDestination('?next=%2Fagency')).toBe('/agency');
  });
  it('buildAuthUrl encodes assistant/agency defaults', () => {
    expect(buildAuthUrl('/assistant')).toBe('/auth?next=%2Fassistant');
    expect(buildAuthUrl('/agency')).toBe('/auth?next=%2Fagency');
  });
});

describe('Phase 5 continuation — signup confirmation redirect preserves next', () => {
  it('Auth.tsx wires effectiveNext into signUp emailRedirectNext', () => {
    const src = readFileSync('src/pages/Auth.tsx', 'utf8');
    expect(src).toMatch(/emailRedirectNext:\s*effectiveNext/);
  });
  it('useAuth.signUp builds /auth?next= emailRedirectTo when safe', () => {
    const src = readFileSync('src/hooks/useAuth.tsx', 'utf8');
    expect(src).toMatch(/sanitizeNextPath/);
    expect(src).toMatch(/\/auth\?next=/);
  });
  it('Auth.tsx navigates to effectiveNext after successful email login', () => {
    const src = readFileSync('src/pages/Auth.tsx', 'utf8');
    expect(src).toMatch(/navigate\(effectiveNext/);
  });
});

describe('Phase 5 continuation — legacy redirect param eliminated', () => {
  it('AgencyRequestPublic uses /auth?next= and not /auth?redirect=', () => {
    const src = readFileSync('src/pages/AgencyRequestPublic.tsx', 'utf8');
    expect(src).not.toMatch(/\/auth\?redirect=/);
    expect(src).toMatch(/\/auth\?next=/);
  });
  it('DriverWorkItems uses /auth?next= and not /auth?redirect=', () => {
    const src = readFileSync('src/pages/DriverWorkItems.tsx', 'utf8');
    expect(src).not.toMatch(/\/auth\?redirect=/);
    expect(src).toMatch(/\/auth\?next=/);
  });
  it('no /auth?redirect= remains anywhere in src/ (outside tests)', async () => {
    const { execSync } = await import('child_process');
    const out = execSync(
      "grep -RIn --include='*.ts' --include='*.tsx' '/auth?redirect=' src/ | grep -v '/test/' || true",
      { encoding: 'utf8' },
    );
    expect(out.trim()).toBe('');
  });

  it('no intent=assistant or intent=agency literal remains in app code', async () => {
    const { execSync } = await import('child_process');
    const out = execSync(
      "grep -RIn --include='*.ts' --include='*.tsx' -E 'intent=(assistant|agency)' src/ | grep -v '/test/' || true",
      { encoding: 'utf8' },
    );
    expect(out.trim()).toBe('');
  });
});
