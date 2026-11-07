// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { injectMiniAppPrivacyGuard } from '../../vite/htpMiniAppPrivacy';

const original = readFileSync('index.html', 'utf8');
const guarded = injectMiniAppPrivacyGuard(original);
const bootstrap = /<script id="htp-mini-app-privacy">([\s\S]*?)<\/script>/.exec(guarded)![1];

function policyAt(path: string) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: `https://haultrackerpro.com${path}`, runScripts: 'outside-only' });
  dom.window.eval(bootstrap);
  const policy = dom.window.document.querySelector<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy"]')?.content ?? null;
  dom.window.close(); return policy;
}

describe('Hosted Mini App launch privacy', () => {
  it.each(['/telegram', '/telegram?view=post#tgWebAppData=synthetic', '/auth?next=%2Ftelegram%3Fview%3Dpost', '/unexpected#tgWebAppData=synthetic'])('protects %s before hosting scripts execute', path => {
    const policy = policyAt(path);
    expect(policy).toContain('script-src https://haultrackerpro.com/assets/ https://telegram.org/js/telegram-web-app.js');
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|~flock|__l5e|google|script-src 'self'/);
  });
  it.each(['/', '/dashboard', '/auth?next=%2Fdashboard', '/telegram-other'])('preserves normal website behavior at %s', path => {
    expect(policyAt(path)).toBeNull();
  });
  it('keeps existing reviewed inline bootstraps working by content hash', () => {
    for (const match of original.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      expect(policyAt('/telegram')).toContain(`'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
    }
  });
  it('runs first, is idempotent, and fails the build if no HTML head exists', () => {
    expect(guarded.indexOf('id="htp-mini-app-privacy"')).toBeLessThan(guarded.indexOf('// CRITICAL:'));
    expect(injectMiniAppPrivacyGuard(guarded)).toBe(guarded);
    expect(() => injectMiniAppPrivacyGuard('<body></body>')).toThrow();
  });
});
