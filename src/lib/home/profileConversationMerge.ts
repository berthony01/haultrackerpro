/**
 * HP-4B — pure mapping from a stored Driver Opportunity Profile row to the
 * homepage conversation's IntakeAnswers.
 *
 * Hard rules encoded here:
 *  - Pure. No network, no Supabase, no storage, no React, no writes.
 *  - EMPLOYMENT fields only. Identity, contact, visibility, recruiter-contact
 *    consent, completion, and every My Trucking financial surface are never
 *    read, mapped, or disclosed.
 *  - Out-of-vocabulary values are DROPPED, never coerced. A dropped field
 *    simply means the conversation asks that question normally.
 *  - `Company Driver` and `Lease Purchase` are NOT intake driver types and are
 *    always dropped.
 */

import {
  CDL_CLASS_CHOICES,
  DRIVER_TYPE_CHOICES,
  HOME_TIME_CHOICES,
  ROUTE_TYPE_CHOICES,
  TRAILER_CHOICES,
  summarizeIntake,
  type IntakeAnswers,
} from '@/lib/home/conversationIntake';

/** The only stored columns this module is ever allowed to read. */
export const PROFILE_SEED_SOURCE_FIELDS = [
  'city',
  'state',
  'cdl_class',
  'years_experience',
  'preferred_route_type',
  'preferred_driver_type',
  'preferred_home_time',
  'trailer_experience',
  'min_weekly_gross',
] as const;

/** Never read into the conversation, under any circumstances. */
export const PROFILE_FORBIDDEN_FIELDS = [
  'full_name',
  'phone',
  'email',
  'endorsements',
  'contact_preference',
  'visibility',
  'allow_verified_recruiter_contact',
  'min_weekly_net',
  'min_effective_rpm',
  'available_start_date',
  'willing_to_relocate',
  'preferred_states',
  'profile_completed',
] as const;

export const MAX_SEED_TRAILERS = 8;
export const MAX_SEED_CITY_LENGTH = 60;
export const MAX_SEED_WEEKLY_GROSS = 100000;
export const MAX_SEED_YEARS = 60;

const STATE_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME',
  'MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA',
  'RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]);

/** Structural, deliberately narrow: only employment fields are even named. */
export interface StoredProfileLike {
  city?: unknown;
  state?: unknown;
  cdl_class?: unknown;
  years_experience?: unknown;
  preferred_route_type?: unknown;
  preferred_driver_type?: unknown;
  preferred_home_time?: unknown;
  trailer_experience?: unknown;
  min_weekly_gross?: unknown;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/**
 * Validated, employment-only seed. Anything that fails validation is dropped
 * so the conversation asks that step normally.
 */
export function mapProfileToIntakeAnswers(
  profile: StoredProfileLike | null | undefined,
): IntakeAnswers {
  const out: IntakeAnswers = {};
  if (!profile || typeof profile !== 'object') return out;

  if (typeof profile.city === 'string') {
    const city = profile.city.trim();
    if (city && city.length <= MAX_SEED_CITY_LENGTH) out.city = city;
  }

  if (typeof profile.state === 'string') {
    const state = profile.state.trim().toUpperCase();
    if (STATE_CODES.has(state)) out.state = state;
  }

  const cdl = oneOf(profile.cdl_class, CDL_CLASS_CHOICES);
  if (cdl) out.cdl_class = cdl;

  if (
    typeof profile.years_experience === 'number' &&
    Number.isFinite(profile.years_experience) &&
    Number.isInteger(profile.years_experience) &&
    profile.years_experience >= 0 &&
    profile.years_experience <= MAX_SEED_YEARS
  ) {
    out.years_experience = profile.years_experience;
  }

  const route = oneOf(profile.preferred_route_type, ROUTE_TYPE_CHOICES);
  if (route) out.preferred_route_type = route;

  // `Company Driver` / `Lease Purchase` are outside intake vocabulary: dropped.
  const driverType = oneOf(profile.preferred_driver_type, DRIVER_TYPE_CHOICES);
  if (driverType) out.preferred_driver_type = driverType;

  const homeTime = oneOf(profile.preferred_home_time, HOME_TIME_CHOICES);
  if (homeTime) out.preferred_home_time = homeTime;

  if (Array.isArray(profile.trailer_experience)) {
    const trailers = [
      ...new Set(
        profile.trailer_experience.filter(
          (t): t is string =>
            typeof t === 'string' && (TRAILER_CHOICES as readonly string[]).includes(t),
        ),
      ),
    ].slice(0, MAX_SEED_TRAILERS);
    if (trailers.length) out.trailer_experience = trailers;
  }

  if (
    typeof profile.min_weekly_gross === 'number' &&
    Number.isFinite(profile.min_weekly_gross) &&
    profile.min_weekly_gross > 0 &&
    profile.min_weekly_gross <= MAX_SEED_WEEKLY_GROSS
  ) {
    out.min_weekly_gross = profile.min_weekly_gross;
  }

  return out;
}

/**
 * Human-readable reuse disclosure, using the EXISTING summary vocabulary so the
 * driver sees the same words everywhere. Never contains identity or contact.
 */
export function describeProfileReuse(seed: IntakeAnswers): string[] {
  return summarizeIntake(seed);
}

export function hasProfileSeed(seed: IntakeAnswers): boolean {
  return describeProfileReuse(seed).length > 0;
}
