/**
 * HP-4B2 — one-shot, module-scoped, in-memory handoff of the authenticated
 * Find Work conversation's final answers to the Driver Opportunity Profile
 * review form.
 *
 * Hard rules encoded here:
 *  - MEMORY ONLY. No browser persistence of any kind, no network, no backend,
 *    no React. A hard refresh intentionally loses the handoff and the stored
 *    profile remains the only source of truth.
 *  - One shot. `consumePendingProfileAnswers` returns the value at most once
 *    and clears the store, so a later manual visit can never be seeded by a
 *    stale conversation.
 *  - EMPLOYMENT fields only. Filtering reuses the existing HP-4B validation
 *    (`mapProfileToIntakeAnswers`) unchanged, so `initialMessage` and every
 *    identity, contact, consent, visibility and My Trucking field are
 *    structurally incapable of entering the store. No new coercions.
 *  - OWNER-BOUND. Answers are stored with the signed-in user's id; only that
 *    same id can consume them. A bounded auth listener (alive only while
 *    answers are pending) drops them on sign-out or any account change. No
 *    session or token is stored.
 */

import { supabase } from '@/integrations/supabase/client';
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

let pending: { owner: string; answers: IntakeAnswers } | null = null;
let unsubscribe: (() => void) | null = null;

/** Drops any pending answers without consuming them (Back, save success, auth change). */
export function clearPendingProfileAnswers(): void {
  pending = null;
  const stop = unsubscribe;
  unsubscribe = null;
  stop?.();
}

/**
 * Validate and store the conversation's final answers for `owner`. Anything
 * outside the approved employment set, or failing the existing validation, is
 * dropped. A missing owner or an empty result stores nothing.
 */
export function setPendingProfileAnswers(owner: string, answers: IntakeAnswers | null | undefined): void {
  clearPendingProfileAnswers();
  if (typeof owner !== 'string' || owner.length === 0) return;
  const filtered = mapProfileToIntakeAnswers(answers as StoredProfileLike | null | undefined);
  if (Object.keys(filtered).length === 0) return;
  pending = { owner, answers: filtered };
  // Listen only while answers are pending; fail closed if unavailable.
  const auth = supabase.auth;
  if (!auth?.onAuthStateChange) {
    clearPendingProfileAnswers();
    return;
  }
  const { data: { subscription } } = auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session || session.user.id !== owner) clearPendingProfileAnswers();
  });
  if (pending?.owner === owner) unsubscribe = () => subscription.unsubscribe();
  else subscription.unsubscribe();
}

/** Returns `owner`'s pending answers at most once; always clears the store. */
export function consumePendingProfileAnswers(owner: string | null | undefined): IntakeAnswers | null {
  const value = owner && pending?.owner === owner ? pending.answers : null;
  clearPendingProfileAnswers();
  return value;
}

/** Read-only probe, for tests and guards. Does not clear. */
export function hasPendingProfileAnswers(owner?: string): boolean {
  return pending !== null && (owner === undefined || pending.owner === owner);
}
