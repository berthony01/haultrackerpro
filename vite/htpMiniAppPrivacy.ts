import { createHash } from 'node:crypto';

/** Hosting adds analytics after the Vite build. On Telegram launch pages,
 * only bundled application scripts, the Telegram SDK and reviewed inline
 * bootstrap scripts may execute. Signed launch URLs must not reach trackers.
 * This runs only in production builds, leaving the Vite development server intact.
 */
export function injectMiniAppPrivacyGuard(html: string): string {
  const cleaned = html.replace(/<script id="htp-mini-app-privacy">[\s\S]*?<\/script>\s*/g, '');
  if (!/<head\b[^>]*>/i.test(cleaned)) throw new Error('Mini App privacy requires an HTML head');
  const hashes = [...cleaned.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
  const guard = `(function () {
    var path = window.location.pathname;
    var next = new URLSearchParams(window.location.search).get('next') || '';
    var launch = new URLSearchParams(window.location.hash.slice(1)).has('tgWebAppData');
    var mini = path === '/telegram' || path.indexOf('/telegram/') === 0 ||
      (path === '/auth' && (next === '/telegram' || next.indexOf('/telegram?') === 0));
    if (!mini && !launch) return;
    var policy = document.createElement('meta');
    policy.httpEquiv = 'Content-Security-Policy';
    policy.content = "script-src " + window.location.origin + "/assets/ https://telegram.org/js/telegram-web-app.js ${hashes.join(' ')}";
    document.head.appendChild(policy);
  })();`;
  return cleaned.replace(/(<head\b[^>]*>)/i, `$1\n    <script id="htp-mini-app-privacy">${guard}</script>`);
}
