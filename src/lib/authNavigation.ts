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
  // Reject any embedded scheme like "javascript:" or "data:" or backslashes
  // (some browsers normalize "/\\evil.com" to "//evil.com").
  if (/[\s\x00-\x1f]/.test(path)) return false;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(path)) return false;
  if (path.includes('\\')) return false;
  // Reject anything that decodes to a protocol or external URL
  try {
    const decoded = decodeURIComponent(path);
    if (decoded.startsWith('//') || /^\/?[a-z][a-z0-9+.-]*:/i.test(decoded)) {
      return false;
    }
  } catch {
    return false;
  }
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
