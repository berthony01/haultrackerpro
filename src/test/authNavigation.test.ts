import { describe, it, expect } from 'vitest';
import {
  sanitizeNextPath,
  isSafeInternalPath,
  buildAuthUrl,
  getCapabilityFromNext,
  resolvePostAuthDestination,
} from '../lib/authNavigation';

describe('authNavigation - sanitizeNextPath / isSafeInternalPath', () => {
  it('accepts safe internal paths', () => {
    expect(sanitizeNextPath('/assistant')).toBe('/assistant');
    expect(sanitizeNextPath('/agency')).toBe('/agency');
    expect(sanitizeNextPath('/driver/work-items/abc')).toBe('/driver/work-items/abc');
    expect(sanitizeNextPath('/agency/invite/xyz?foo=1')).toBe('/agency/invite/xyz?foo=1');
  });

  it('rejects external URLs', () => {
    expect(sanitizeNextPath('https://evil.com')).toBeNull();
    expect(sanitizeNextPath('http://evil.com')).toBeNull();
  });

  it('rejects protocol-relative URLs', () => {
    expect(sanitizeNextPath('//evil.com')).toBeNull();
    expect(sanitizeNextPath('/\\evil.com')).toBeNull();
  });

  it('rejects javascript: and data: URLs', () => {
    expect(sanitizeNextPath('javascript:alert(1)')).toBeNull();
    expect(sanitizeNextPath('/javascript:alert(1)')).toBeNull();
    expect(sanitizeNextPath('data:text/html,evil')).toBeNull();
  });

  it('rejects empty/null/non-relative', () => {
    expect(sanitizeNextPath(null)).toBeNull();
    expect(sanitizeNextPath('')).toBeNull();
    expect(sanitizeNextPath('relative-no-slash')).toBeNull();
  });

  it('isSafeInternalPath rejects whitespace and control chars', () => {
    expect(isSafeInternalPath('/path with space')).toBe(false);
    expect(isSafeInternalPath('/path\nnewline')).toBe(false);
  });
});

describe('authNavigation - buildAuthUrl', () => {
  it('returns /auth when no next path', () => {
    expect(buildAuthUrl(null)).toBe('/auth');
    expect(buildAuthUrl(undefined)).toBe('/auth');
  });
  it('encodes safe next path', () => {
    expect(buildAuthUrl('/assistant')).toBe('/auth?next=%2Fassistant');
    expect(buildAuthUrl('/agency/invite/xyz')).toBe('/auth?next=%2Fagency%2Finvite%2Fxyz');
  });
  it('drops unsafe next path', () => {
    expect(buildAuthUrl('https://evil.com')).toBe('/auth');
    expect(buildAuthUrl('//evil.com')).toBe('/auth');
  });
});

describe('authNavigation - getCapabilityFromNext', () => {
  it('detects assistant capability', () => {
    expect(getCapabilityFromNext('/assistant')).toBe('assistant');
    expect(getCapabilityFromNext('/assistant/invite/abc')).toBe('assistant');
  });
  it('detects agency capability', () => {
    expect(getCapabilityFromNext('/agency')).toBe('agency');
    expect(getCapabilityFromNext('/agency/invite/xyz')).toBe('agency');
    expect(getCapabilityFromNext('/a/some-slug')).toBe('agency');
  });
  it('detects recruiter capability', () => {
    expect(getCapabilityFromNext('/dashboard?page=recruiter-access')).toBe('recruiter');
  });
  it('detects driver default', () => {
    expect(getCapabilityFromNext('/dashboard')).toBe('driver');
    expect(getCapabilityFromNext('/driver/work-items/123')).toBe('driver');
  });
  it('returns null for unsafe', () => {
    expect(getCapabilityFromNext('https://evil.com')).toBeNull();
    expect(getCapabilityFromNext(null)).toBeNull();
  });
});

describe('authNavigation - resolvePostAuthDestination', () => {
  it('honors safe next', () => {
    expect(resolvePostAuthDestination('?next=%2Fassistant')).toBe('/assistant');
    expect(resolvePostAuthDestination('?next=%2Fagency%2Finvite%2Fabc')).toBe('/agency/invite/abc');
    expect(resolvePostAuthDestination('?next=%2Fdriver%2Fwork-items%2F123')).toBe('/driver/work-items/123');
  });
  it('rejects unsafe next', () => {
    expect(resolvePostAuthDestination('?next=https%3A%2F%2Fevil.com')).toBe('/dashboard');
    expect(resolvePostAuthDestination('?next=%2F%2Fevil.com')).toBe('/dashboard');
  });
  it('preserves legacy recruiter intent', () => {
    expect(resolvePostAuthDestination('?intent=recruiter')).toBe('/dashboard?page=recruiter-access');
  });
  it('next takes precedence over recruiter intent', () => {
    expect(resolvePostAuthDestination('?intent=recruiter&next=%2Fagency')).toBe('/agency');
  });
  it('falls back to /dashboard', () => {
    expect(resolvePostAuthDestination('')).toBe('/dashboard');
    expect(resolvePostAuthDestination('?foo=bar')).toBe('/dashboard');
  });
  it('does not silently create a fake role for unknown intent', () => {
    // unknown intent must NOT route to /assistant or /agency
    expect(resolvePostAuthDestination('?intent=assistant')).toBe('/dashboard');
    expect(resolvePostAuthDestination('?intent=agency')).toBe('/dashboard');
  });
});

describe('AssistantsAgencies CTAs do not use fake intent params', () => {
  it('AssistantsAgencies.tsx uses /auth?next= and never /auth?intent=assistant|agency', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('src/pages/AssistantsAgencies.tsx', 'utf8');
    expect(src).not.toMatch(/intent=assistant/);
    expect(src).not.toMatch(/intent=agency/);
    expect(src).toMatch(/next=%2Fassistant/);
    expect(src).toMatch(/next=%2Fagency/);
  });
});
