import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useViewMode } from '@/hooks/useViewMode';
import { useActingContext } from '@/hooks/useActingContext';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { supabase } from '@/integrations/supabase/client';
import {
  getOwnCard, manageOwnCard, listRecruiterCards, JobSearchCardError,
  type OwnCard, type DiscoveryCard, type CardCommand, type CardFailure, type RequestIdentity,
} from '@/lib/jobSearch/jobSearchCardApi';
import { clearJobSearchCardHandoff } from '@/lib/jobSearch/jobSearchCardHandoff';

export function useCardScope() {
  const auth = useAuth();
  const view = useViewMode();
  const acting = useActingContext();
  const owner = auth.user?.id ?? null;
  const settled = !auth.loading && !view.isLoading && !view.error && !acting.isLoadingManagedDrivers;
  const personal = settled && !!owner && auth.session?.user.id === owner && !acting.isActingAsAssistant;
  const key = personal ? `${owner}:${view.driverCapabilityStatus}:${view.recruiterCapabilityStatus}:${view.effectiveRole}` : null;
  const live = useRef(key);
  live.current = key;
  const identity = (): RequestIdentity => {
    if (!owner || !auth.session || auth.session.user.id !== owner) throw new JobSearchCardError('denied');
    return { userId: owner, sessionUserId: auth.session.user.id, accessToken: auth.session.access_token };
  };
  useEffect(() => {
    if (!personal) clearJobSearchCardHandoff();
  }, [personal, owner]);
  return { owner, key, personal, canPublish: personal && view.driverWorkspaceAllowed === true,
    recruiterAllowed: personal && view.recruiterOperationsAllowed === true && view.recruiterAccessKind === 'capability',
    loading: !settled, identity, current: () => key !== null && live.current === key };
}
export type CardScope = ReturnType<typeof useCardScope>;
export interface OwnCardState {
  card: OwnCard | null;
  ready: boolean;
  busy: boolean;
  error: CardFailure | null;
  uncertain: boolean;
  pending: CardCommand | null;
  refresh: () => Promise<void>;
  submit: (command: CardCommand) => Promise<boolean>;
  retry: () => Promise<boolean>;
}
/** Local state only: no globally cached card, token, draft or command. */
export function useJobSearchCard(scope: CardScope): OwnCardState {
  const [state, setState] = useState({ card: null as OwnCard | null, ready: false, busy: false, error: null as CardFailure | null, uncertain: false, pending: null as CardCommand | null });
  const live = useRef(scope);
  live.current = scope;
  const mounted = useRef(true);
  const serial = useRef(0);
  const inFlight = useRef(false);
  const pending = useRef<CardCommand | null>(null);
  const allowed = () => mounted.current && live.current.key === scope.key && scope.current();
  useEffect(() => {
    mounted.current = true;
    const owner = scope.owner;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session || session.user.id !== owner) {
        mounted.current = false;
        pending.current = null;
        clearJobSearchCardHandoff();
        setState({ card: null, ready: false, busy: false, error: 'denied', uncertain: false, pending: null });
      }
    });
    return () => { mounted.current = false; serial.current++; pending.current = null; subscription.unsubscribe(); };
  }, [scope.owner]);
  async function refresh() {
    if (!allowed()) return;
    const seq = ++serial.current;
    setState(s => ({ ...s, ready: false, busy: true }));
    try {
      const card = await getOwnCard(live.current.identity(), allowed);
      if (!allowed() || seq !== serial.current) return;
      setState(s => ({ ...s, card, ready: true, busy: false, error: s.uncertain ? s.error : null }));
    } catch (e) {
      if (!allowed() || seq !== serial.current) return;
      const error = e instanceof JobSearchCardError ? e.kind : 'unknown';
      setState(s => ({ ...s, ready: false, busy: false, error }));
    }
  }
  useEffect(() => { void refresh(); }, []);
  async function submit(command: CardCommand): Promise<boolean> {
    if (!allowed() || inFlight.current || (command.action === 'publish' && !live.current.canPublish) || !state.ready || state.error === 'unavailable') return false;
    if (pending.current && command !== pending.current) return false;
    inFlight.current = true;
    pending.current = command;
    setState(s => ({ ...s, busy: true, error: null, pending: command }));
    try {
      const card = await manageOwnCard(command, live.current.identity(), allowed);
      if (!allowed()) return false;
      if (!card) throw new JobSearchCardError('unknown');
      pending.current = null;
      setState({ card, ready: true, busy: false, error: null, pending: null, uncertain: false });
      return true;
    } catch (e) {
      if (!allowed()) return false;
      const error = e instanceof JobSearchCardError ? e.kind : 'unknown';
      const uncertain = error === 'unknown';
      if (!uncertain) pending.current = null;
      setState(s => ({ ...s, busy: false, error, uncertain, pending: uncertain ? command : null }));
      if (error === 'stale' || error === 'no_card') await refresh();
      return false;
    } finally { inFlight.current = false; }
  }
  return { ...state, refresh, submit, retry: () => pending.current ? submit(pending.current) : Promise.resolve(false) };
}
export function useRecruiterCardScope(recruiterId: string) {
  const scope = useCardScope();
  const { profile, isLoading } = useRecruiterProfile();
  const allowed = scope.recruiterAllowed && !isLoading && profile?.id === recruiterId && profile.user_id === scope.owner && profile.status === 'active' && profile.verification_status === 'approved';
  const key = allowed ? `${scope.key}:${recruiterId}` : null;
  const live = useRef(key);
  live.current = key;
  return { ...scope, key, allowed, current: () => key !== null && key === live.current && scope.current() };
}
export interface RecruiterCardsState {
  rows: DiscoveryCard[];
  loaded: boolean;
  busy: boolean;
  error: CardFailure | null;
  more: boolean;
  load: (next?: boolean) => Promise<void>;
}
export function useRecruiterJobSearchCards(scope: ReturnType<typeof useRecruiterCardScope>, recruiterId: string): RecruiterCardsState {
  const [state, setState] = useState({ rows: [] as DiscoveryCard[], loaded: false, busy: false, error: null as CardFailure | null, more: false });
  const live = useRef(scope);
  live.current = scope;
  const mounted = useRef(true), busy = useRef(false), generation = useRef(0);
  const current = () => mounted.current && live.current.key === scope.key && scope.current();
  useEffect(() => {
    mounted.current = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session || session.user.id !== scope.owner) {
        mounted.current = false;
        setState({ rows: [], loaded: false, busy: false, error: 'denied', more: false });
      }
    });
    return () => { mounted.current = false; generation.current++; subscription.unsubscribe(); };
  }, [scope.owner]);
  async function load(next = false) {
    if (!current() || busy.current || (next && !state.more)) return;
    busy.current = true;
    const seq = ++generation.current;
    const cursor = next ? state.rows[state.rows.length - 1] ?? null : null;
    // Pagination replaces the current bounded page: no accumulating pool cache.
    setState(s => ({ ...s, busy: true, rows: [] }));
    try {
      const rows = await listRecruiterCards(recruiterId, cursor, live.current.identity(), current);
      if (!current() || seq !== generation.current) return;
      setState({ rows, loaded: true, busy: false, error: null, more: rows.length === 20 });
    } catch (e) {
      if (!current() || seq !== generation.current) return;
      setState({ rows: [], loaded: false, busy: false, error: e instanceof JobSearchCardError ? e.kind : 'unknown', more: false });
    } finally { busy.current = false; }
  }
  return { ...state, load };
}
