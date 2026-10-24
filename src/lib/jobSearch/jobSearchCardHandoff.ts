import { supabase } from '@/integrations/supabase/client';
import { mapProfileToIntakeAnswers, type StoredProfileLike } from '@/lib/home/profileConversationMerge';
import type { JobSearchCardPayload } from './jobSearchCardContract';
export type CardSeed = Partial<Omit<JobSearchCardPayload, 'experience_qualifier' | 'min_weekly_gross' | 'available_start_date'>>;
export const JOB_SEARCH_CARD_PATH = '/find-work?task=job-search-card';
let pending: {
  owner: string;
  seed: CardSeed;
} | null = null;
let unsubscribe: (() => void) | null = null;
export function clearJobSearchCardHandoff() {
  pending = null;
  const stop = unsubscribe;
  unsubscribe = null;
  stop?.();
}
export function setJobSearchCardHandoff(owner: string, answers: unknown) {
  clearJobSearchCardHandoff();
  if (!owner)
    return;
  const validated = mapProfileToIntakeAnswers(answers as StoredProfileLike);
  const { city: _city, min_weekly_gross: _gross, initialMessage: _text, ...seed } = validated;
  pending = {
    owner, seed: seed as CardSeed
  };
  // Subscribe only while a pending handoff exists; synchronous callbacks may
  // invalidate it before onAuthStateChange returns the subscription handle.
  const auth = supabase.auth;
  if (!auth?.onAuthStateChange) {
    clearJobSearchCardHandoff();
    return;
  }
  const { data: { subscription } } = auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session || session.user.id !== owner)
      clearJobSearchCardHandoff();
  });
  if (pending?.owner === owner)
    unsubscribe = () => subscription.unsubscribe();
  else
    subscription.unsubscribe();
}
export function consumeJobSearchCardHandoff(owner: string): CardSeed | null {
  const seed = pending?.owner === owner ? pending.seed : null;
  clearJobSearchCardHandoff();
  return seed;
}
