/**
 * HP-4B2 — one-shot, module-scoped, in-memory handoff of the authenticated
 * Find Work conversation's final answers to the Driver Opportunity Profile
 * review form.
 *
 * Hard rules encoded here:
 *  - MEMORY ONLY. No sessionStorage, no localStorage, no cookies, no network,
 *    no Supabase, no React. A hard refresh intentionally loses the handoff and
 *    the stored profile remains the only source of truth.
 *  - One shot. `consumePendingProfileAnswers` returns the value at most once
 *    and clears the store, so a later manual visit can never be seeded by a
 *    stale conversation.
 *  - EMPLOYMENT fields only. Filtering reuses the existing HP-4B validation
 *    (`mapProfileToIntakeAnswers`) unchanged, so `initialMessage` and every
 *    identity, contact, consent, visibility and My Trucking field are
 *    structurally incapable of entering the store. No new coercions.
 */

import type { IntakeAnswers } from '@/lib/home/conversationIntake';
import {
  mapProfileToIntakeAnswers,
  type StoredProfileLike,
} from '@/lib/home/profileConversationMerge';

/** The only fields a pending handoff can ever carry. */
export const PENDING_HANDOFF_FIELDS = [
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

let pendingAnswers: IntakeAnswers | null = null;

/**
 * Validate and store the conversation's final answers. Anything outside the
 * approved employment set, or failing the existing validation, is dropped.
 * An empty result stores nothing.
 */
export function setPendingProfileAnswers(answers: IntakeAnswers | null | undefined): void {
  const filtered = mapProfileToIntakeAnswers(answers as StoredProfileLike | null | undefined);
  pendingAnswers = Object.keys(filtered).length > 0 ? filtered : null;
}

/** Returns the pending answers at most once, then clears the store. */
export function consumePendingProfileAnswers(): IntakeAnswers | null {
  const value = pendingAnswers;
  pendingAnswers = null;
  return value;
}

/** Drops any pending answers without consuming them (Back, save success). */
export function clearPendingProfileAnswers(): void {
  pendingAnswers = null;
}

/** Read-only probe, for tests and guards. Does not clear. */
export function hasPendingProfileAnswers(): boolean {
  return pendingAnswers !== null;
}
