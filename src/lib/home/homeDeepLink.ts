/**
 * HP-3C — Pure parsing for homepage deep links.
 *
 * Hard rules encoded here:
 *  - No Supabase, no fetch, no storage, no router, no analytics, no cookies.
 *  - `job` is strictly validated as a canonical UUID BEFORE it may ever reach an
 *    RPC. Anything else is dropped entirely.
 *  - Campaign/source values are bounded client context only for this phase:
 *    allowlisted keys, allowlisted characters, clamped length, held in memory.
 *    They are never persisted, never sent to the server, and never influence
 *    which job is trusted.
 */

/** Canonical UUID (any version), case-insensitive. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CAMPAIGN_KEYS = [
  'campaign',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const;

export type CampaignKey = (typeof CAMPAIGN_KEYS)[number];

/** Bounded: longer or non-conforming values are dropped, never truncated-guessed. */
export const CAMPAIGN_VALUE_MAX_LENGTH = 64;
const CAMPAIGN_VALUE_PATTERN = /^[A-Za-z0-9_.-]+$/;

/** One identical line for malformed, unknown, ineligible, and failed lookups. */
export const UNAVAILABLE_JOB_COPY =
  "That listing isn't available right now — let's find what fits you.";

export interface HomeDeepLink {
  /** True when a `job` param was present at all, valid or not. */
  jobRequested: boolean;
  /** A canonical UUID, or null when absent/invalid. Only this value may reach the RPC. */
  jobId: string | null;
  /** Sanitized, bounded, in-memory only. */
  campaign: Partial<Record<CampaignKey, string>>;
}


export function isValidJobId(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

function sanitizeCampaignValue(value: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > CAMPAIGN_VALUE_MAX_LENGTH) return null;
  if (!CAMPAIGN_VALUE_PATTERN.test(trimmed)) return null;
  return trimmed;
}

/**
 * Parses a location search string. Accepts `?a=b`, `a=b`, or an empty string.
 */
export function readHomeDeepLink(search: string | null | undefined): HomeDeepLink {
  const raw = typeof search === 'string' ? search : '';
  const params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);

  const job = params.get('job');
  const jobRequested = job !== null;
  const jobId = isValidJobId(job) ? job.trim().toLowerCase() : null;

  const campaign: Partial<Record<CampaignKey, string>> = {};
  for (const key of CAMPAIGN_KEYS) {
    const clean = sanitizeCampaignValue(params.get(key));
    if (clean) campaign[key] = clean;
  }

  return { jobRequested, jobId, campaign };

}

/**
 * Concise, public-safe opening context. Uses only recruiter-authored listing
 * fields already returned by the public teaser RPC. No recruiter PII, no
 * qualification or match claim.
 */
export function buildTargetedOpeningNote(
  title: string | null | undefined,
  companyName: string | null | undefined,
): string | undefined {
  const cleanTitle = typeof title === 'string' ? title.trim() : '';
  if (!cleanTitle) return undefined;
  const cleanCompany = typeof companyName === 'string' ? companyName.trim() : '';
  const subject = cleanCompany ? `${cleanTitle} at ${cleanCompany}` : cleanTitle;
  return `You opened ${subject}.`;
}
