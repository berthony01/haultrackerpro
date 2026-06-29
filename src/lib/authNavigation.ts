/**
 * Auth continuation helpers.
 *
 * Single canonical post-auth continuation parameter is `next`. It must be a
 * safe internal relative path. External URLs, protocol-relative URLs, and
 * `javascript:` URLs are rejected.
 */

const DEFAULT_DEST = '/dashboard';

export function isSafeInternalPath(path: string | null | undefined): boolean {
  if (!path || typeof path !== 'string') return false;
  if (path.length > 512) return false;
  // Must start with a single slash and not be protocol-relative ("//evil.com")
  if (!path.startsWith('/')) return false;
  if (path.startsWith('//')) return false;
  if (path.startsWith('/\\')) return false;
  // Reject raw whitespace, control chars, or embedded scheme/backslash
  if (/[\s\x00-\x1f]/.test(path)) return false;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(path)) return false;
  if (path.includes('\\')) return false;
  // Re-check after percent-decoding: attackers commonly hide whitespace,
  // backslashes, protocol-relative slashes, or scheme-like prefixes behind
  // encoding (e.g. /%2F%2Fevil.com, /%5Cevil.com, /%0aevil, /javascript%3A).
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  if (decoded.length > 512) return false;
  if (!decoded.startsWith('/')) return false;
  // Protocol-relative after decoding (handles "/%2F%2Fevil.com" → "///evil.com")
  if (decoded.length >= 2 && decoded[1] === '/') return false;
  if (decoded.length >= 2 && decoded[1] === '\\') return false;
  if (/[\s\x00-\x1f]/.test(decoded)) return false;
  if (decoded.includes('\\')) return false;
  // Scheme-like substring after the leading slash, e.g. "/javascript:..."
  if (/^\/?[a-z][a-z0-9+.-]*:/i.test(decoded)) return false;
  return true;
}


export function sanitizeNextPath(path: string | null | undefined): string | null {
  return isSafeInternalPath(path) ? (path as string) : null;
}

export function buildAuthUrl(nextPath?: string | null): string {
  const safe = sanitizeNextPath(nextPath ?? null);
  if (!safe) return '/auth';
  return `/auth?next=${encodeURIComponent(safe)}`;
}

export type Capability = 'driver' | 'recruiter' | 'assistant' | 'agency';

export function getCapabilityFromNext(nextPath: string | null | undefined): Capability | null {
  const safe = sanitizeNextPath(nextPath ?? null);
  if (!safe) return null;
  if (safe === '/assistant' || safe.startsWith('/assistant/') || safe.startsWith('/assistant?')) {
    return 'assistant';
  }
  if (safe === '/agency' || safe.startsWith('/agency/') || safe.startsWith('/agency?') || safe.startsWith('/a/')) {
    return 'agency';
  }
  if (safe.startsWith('/dashboard?page=recruiter') || safe.startsWith('/recruiter')) {
    return 'recruiter';
  }
  if (safe.startsWith('/driver/') || safe === '/dashboard' || safe.startsWith('/dashboard')) {
    return 'driver';
  }
  return null;
}

/**
 * Resolve where to send the user after a successful sign-in/sign-up.
 * Priority:
 *   1. Safe `next` query param
 *   2. Legacy `intent=recruiter` → recruiter access page (preserved behavior)
 *   3. Default dashboard
 */
export function resolvePostAuthDestination(search: string | URLSearchParams): string {
  const params = typeof search === 'string'
    ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    : search;
  const next = sanitizeNextPath(params.get('next'));
  if (next) return next;
  if (params.get('intent') === 'recruiter') return '/dashboard?page=recruiter-access';
  return DEFAULT_DEST;
}
