// Phase 1N-B — Dashboard "Recommended Opportunity" selection module.
//
// Pure, deterministic selection and ranking for the driver dashboard
// "Recommended Opportunity" card. This is the single source of truth for:
//   • hiring-compatibility classification
//   • recommendation candidate construction
//   • trust-safe ranking (paid priority NEVER outranks organic signals)
//   • eligibility filtering (tier / severe warnings / hiring mismatch /
//     session-dismissed)
//   • deep-link id resolution against the driver-visible RPC result
//
// No I/O, no side effects, no DB access. All data comes in as arguments.
// Uses `normalizeOpportunity`, `calculateOpportunityFinancials`, and
// `calculateOpportunityMatch` unchanged.

import type { Tables } from '@/integrations/supabase/types';
import {
  normalizeOpportunity,
  type CanonicalOpportunity,
  type OpportunitySourceRow,
} from './opportunityCanonicalView';
import { calculateOpportunityFinancials } from './opportunityProfit';
import {
  calculateOpportunityMatch,
  type OpportunityMatch,
} from './opportunityMatch';

/* ============================ session keys ============================== */

/** SessionStorage key holding the exact opportunity id to auto-open on the
 *  Opportunities page after the driver taps "View Opportunity". Removed once
 *  consumed so pressing Back returns to the list, not the detail. */
export const RECOMMENDED_OPPORTUNITY_OPEN_KEY =
  'htp_recommended_opportunity_open_id';

/** SessionStorage key holding a JSON array of opportunity ids the driver
 *  dismissed from the dashboard recommendation this session. Session-only:
 *  no DB write, never persisted across sessions. */
export const RECOMMENDED_OPPORTUNITY_DISMISSED_KEY =
  'htp_recommended_opportunity_dismissed_ids';

/* ============================== types =================================== */

export type HiringCompatibility = 'match' | 'neutral' | 'mismatch';

type DriverProfileRow = Tables<'driver_opportunity_profiles'>;

export interface RecommendedOpportunityCandidate {
  /** Original raw opportunity row from `useOpportunities()` (server-side
   *  filtered to approved/non-suspended recruiter listings). */
  opportunity: OpportunitySourceRow;
  /** One canonical view-model per candidate. */
  canonical: CanonicalOpportunity;
  /** Legacy financial + match calculation using the completed profile. */
  match: OpportunityMatch;
  /** Explicit hiring-area compatibility vs. driver preferred_states. */
  hiringCompatibility: HiringCompatibility;
  /** Deterministic sort timestamp (published_at first, then created_at).
   *  Null when neither is a valid date. */
  sortableTimestamp: number | null;
}

/* ========================= pure helpers ================================= */

const normalizeState = (s: string): string => s.trim().toUpperCase();

/**
 * Classify how a listing's disclosed hiring geography relates to the
 * driver's saved preferred_states.
 *
 *   • preferredStates has no non-empty entries → 'neutral'
 *   • listing discloses no state(s)            → 'neutral'
 *   • any overlap                              → 'match'
 *   • disclosed states with zero overlap       → 'mismatch'
 */
export function classifyHiringCompatibility(
  canonical: CanonicalOpportunity,
  preferredStates: readonly string[] | null | undefined,
): HiringCompatibility {
  const prefs = (preferredStates ?? [])
    .map((s) => (typeof s === 'string' ? normalizeState(s) : ''))
    .filter((s) => s !== '');
  if (prefs.length === 0) return 'neutral';

  let listed: string[] = [];
  const statesDisc = canonical.hiringArea.states;
  if (statesDisc.state === 'provided' && statesDisc.value.length > 0) {
    listed = statesDisc.value
      .map((s) => (typeof s === 'string' ? normalizeState(s) : ''))
      .filter((s) => s !== '');
  }
  if (listed.length === 0) {
    const single = canonical.hiringArea.state;
    if (single.state === 'provided' && normalizeState(single.value) !== '') {
      listed = [normalizeState(single.value)];
    }
  }
  if (listed.length === 0) return 'neutral';

  const prefSet = new Set(prefs);
  for (const s of listed) if (prefSet.has(s)) return 'match';
  return 'mismatch';
}

/**
 * Deterministic sortable timestamp: valid `published_at` first, then valid
 * `created_at`, else null.
 */
export function getRecommendedOpportunityTimestamp(
  opportunity: Pick<OpportunitySourceRow, 'published_at' | 'created_at'>,
): number | null {
  const parse = (s: string | null | undefined): number | null => {
    if (!s) return null;
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  };
  const p = parse(opportunity.published_at);
  if (p != null) return p;
  return parse(opportunity.created_at);
}

const compatRank = (c: HiringCompatibility): number =>
  c === 'match' ? 0 : c === 'neutral' ? 1 : 2;

/**
 * Rank candidates by the frozen trust contract. Paid priority
 * (`canonical.trust.featured`) MAY ONLY break an otherwise exact organic
 * tie, AFTER all of: matchScore, hiring compatibility, listing transparency,
 * and sortable timestamp are equal. Final deterministic tie-break is
 * opportunity id ascending. Never mutates the input array.
 */
export function rankRecommendedOpportunityCandidates(
  candidates: readonly RecommendedOpportunityCandidate[],
): RecommendedOpportunityCandidate[] {
  const arr = candidates.slice();
  arr.sort((a, b) => {
    // 1. matchScore desc
    const s = b.match.matchScore - a.match.matchScore;
    if (s !== 0) return s;
    // 2. hiring compatibility: match < neutral < mismatch (lower rank first)
    const g = compatRank(a.hiringCompatibility) - compatRank(b.hiringCompatibility);
    if (g !== 0) return g;
    // 3. transparency desc
    const t =
      b.canonical.derived.transparencyScore.score -
      a.canonical.derived.transparencyScore.score;
    if (t !== 0) return t;
    // 4. timestamp desc (null last)
    const at = a.sortableTimestamp;
    const bt = b.sortableTimestamp;
    if (at == null && bt != null) return 1;
    if (at != null && bt == null) return -1;
    if (at != null && bt != null && at !== bt) return bt - at;
    // 5. featured true before false — ONLY HERE
    const af = a.canonical.trust.featured ? 1 : 0;
    const bf = b.canonical.trust.featured ? 1 : 0;
    if (af !== bf) return bf - af;
    // 6. id ascending — final deterministic tie-break
    return a.canonical.identity.id.localeCompare(b.canonical.identity.id);
  });
  return arr;
}

/**
 * Pick the top-eligible recommendation, or null when nothing qualifies.
 * Applies filters in order: dismissed → tier (excellent/strong only) →
 * severe warning → hiring mismatch → rank → head.
 */
export function chooseRecommendedOpportunity(
  candidates: readonly RecommendedOpportunityCandidate[],
  dismissedIds?: readonly string[] | Iterable<string> | null,
): RecommendedOpportunityCandidate | null {
  const dismissed = new Set<string>(
    dismissedIds ? Array.from(dismissedIds as Iterable<string>) : [],
  );
  const eligible = candidates.filter((c) => {
    if (dismissed.has(c.canonical.identity.id)) return false;
    if (c.match.matchTier !== 'excellent' && c.match.matchTier !== 'strong') return false;
    if (c.match.hasSevereWarning === true) return false;
    if (c.hiringCompatibility === 'mismatch') return false;
    return true;
  });
  if (eligible.length === 0) return null;
  const ranked = rankRecommendedOpportunityCandidates(eligible);
  return ranked[0] ?? null;
}

/**
 * Build the candidate list for a driver with a completed opportunity
 * profile. Exactly one normalize, one legacy-financial calc, and one match
 * calc per opportunity. No side effects.
 */
export function buildRecommendedOpportunityCandidates(
  opportunities: readonly OpportunitySourceRow[],
  completedProfile: DriverProfileRow,
): RecommendedOpportunityCandidate[] {
  const out: RecommendedOpportunityCandidate[] = [];
  for (const o of opportunities) {
    const canonical = normalizeOpportunity(o);
    const f = calculateOpportunityFinancials(o);
    const match = calculateOpportunityMatch({
      opportunity: o,
      driverProfile: completedProfile,
      opportunityFinancials: f,
    });
    const hiringCompatibility = classifyHiringCompatibility(
      canonical,
      completedProfile.preferred_states ?? null,
    );
    out.push({
      opportunity: o,
      canonical,
      match,
      hiringCompatibility,
      sortableTimestamp: getRecommendedOpportunityTimestamp(o),
    });
  }
  return out;
}

/**
 * Resolve a raw deep-link id read from sessionStorage against the ids
 * currently returned by the safe driver-visible RPC. Trims input. Returns
 * the exact id when present in `existingIds`; otherwise null. No fuzzy
 * matching and no fallback to any other listing.
 */
export function resolveRequestedOpportunityId(
  rawId: string | null | undefined,
  existingIds: readonly string[],
): string | null {
  if (typeof rawId !== 'string') return null;
  const trimmed = rawId.trim();
  if (trimmed === '') return null;
  return existingIds.includes(trimmed) ? trimmed : null;
}
