import React, { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { MessageCircle, X, Send, Loader2, Sparkles, ExternalLink, ChevronLeft, RotateCcw, ChevronRight, Maximize2, Minimize2, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { useViewMode } from '@/hooks/useViewMode';
import { useActingContext } from '@/hooks/useActingContext';
import { useAiAssistant } from '@/hooks/useAiAssistant';
import { useMyAgency } from '@/hooks/useAgency';
import { GUIDE_TOPICS, findTopicPath, type GuideTopic } from '@/components/assistant/guidedTopics';

const DriverWorkConversation = lazy(() => import('@/components/home/DriverWorkConversation'));

export const ASSISTANT_NAME = 'HaulTracker Assistant';
export const GUIDED_LABEL = 'Guided help · Free';
export const AI_LABEL = 'AI answers · Pro';
export const AI_DISABLED_COPY = 'AI answers are being prepared and are not available yet. Guided help remains available.';
const MODES: Mode[] = ['guided', 'ai'];
const TAB_ID = (m: Mode) => `ht-assistant-tab-${m}`;
const PANEL_ID = 'ht-assistant-tabpanel';

/** Authenticated app areas only. /ai-assistant and /find-work host their own full chat, so no bubble there. */
const APP_PREFIXES = ['/dashboard', '/conversations', '/assistant', '/agency', '/driver/', '/start', '/professional-profile', '/parking', '/updates'];
const EXCLUDED = [/^\/ai-assistant/, /^\/find-work/, /\/invite\//, /^\/agency\/request\//, /^\/recruiter\/(faq|features|guide|updates)/];
export function isAssistantRoute(pathname: string): boolean {
  if (EXCLUDED.some((r) => r.test(pathname))) return false;
  return ['/recruiter', ...APP_PREFIXES].some((p) => p.endsWith('/') ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`));
}

export type GuideAudience = 'self_driver' | 'acting_assistant' | 'recruiter' | 'agency' | 'general';
export type { GuideLink } from '@/components/assistant/guidedTopics';

type Mode = 'guided' | 'ai';

/** Typed window event bridge so app navigation can open the one floating assistant. */
export const OPEN_ASSISTANT_EVENT = 'haultracker:open-assistant';
/** Returns true when a mounted launcher handled the request (it calls preventDefault). */
export function openHaulTrackerAssistant(): boolean {
  if (typeof window === 'undefined') return false;
  const ev = new CustomEvent(OPEN_ASSISTANT_EVENT, { cancelable: true });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
}

/** Single app-wide assistant bubble. Identity-keyed so sign-out, session or managed-target switches reset it. */
export function HaulTrackerAssistantLauncher() {
  const { user, session, loading } = useAuth();
  const { pathname, key: navKey } = useLocation();
  const { actingDriver, isActingAsAssistant, isLoadingManagedDrivers } = useActingContext();
  if (loading || isLoadingManagedDrivers || !user?.id || session?.user?.id !== user.id) return null;
  if (!isAssistantRoute(pathname)) return null;
  const key = `${user.id}|${isActingAsAssistant ? actingDriver?.driver_user_id ?? 'pending' : 'self'}`;
  return <LauncherInner key={key} pathname={pathname} navKey={navKey} />;
}

function LauncherInner({ pathname, navKey }: { pathname: string; navKey: string }) {
  // One stable LauncherBody across routes so mode/topic/draft survive /dashboard <-> /agency.
  // /agency is only treated as agency once the existing cached get_my_agency check confirms an active agency.
  const { data, isLoading, error } = useMyAgency();
  const onAgency = pathname === '/agency' || pathname.startsWith('/agency/');
  const isAgency = onAgency && !isLoading && !error && !!data && data.status === 'active';
  return <LauncherBody pathname={pathname} navKey={navKey} isAgency={isAgency} hidden={onAgency && isLoading} />;
}

/** Fail-closed audience resolution from authorized context only; URL alone never grants a role. */
export function resolveAudience(i: { isActing: boolean; onAssistantRoute: boolean; managesDrivers: boolean; isAgency: boolean; role: string | null | undefined; driverAllowed: boolean | null | undefined; error: unknown }): GuideAudience {
  if (i.isActing) return 'acting_assistant';
  if (i.isAgency) return 'agency';
  if (i.onAssistantRoute && i.managesDrivers) return 'acting_assistant';
  if (i.error) return 'general';
  if (i.role === 'recruiter') return 'recruiter';
  if (i.role === 'driver' && i.driverAllowed === true) return 'self_driver';
  return 'general';
}

function LauncherBody({ pathname, navKey, isAgency }: { pathname: string; navKey: string; isAgency: boolean }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('guided');
  const [expanded, setExpanded] = useState(false);
  const tabRefs = useRef<Record<Mode, HTMLButtonElement | null>>({ guided: null, ai: null });
  const selectMode = (m: Mode, focus = false) => { setMode(m); if (focus) tabRefs.current[m]?.focus(); };
  const onTabKey = (e: React.KeyboardEvent) => {
    const i = MODES.indexOf(mode);
    const next = e.key === 'ArrowRight' ? MODES[(i + 1) % MODES.length] : e.key === 'ArrowLeft' ? MODES[(i - 1 + MODES.length) % MODES.length] : e.key === 'Home' ? MODES[0] : e.key === 'End' ? MODES[MODES.length - 1] : null;
    if (next) { e.preventDefault(); selectMode(next, true); }
  };
  // Topic path is in memory only, keyed by audience; identity changes remount the launcher and clear it.
  const [guide, setGuide] = useState<{ audience: GuideAudience | null; path: string[] }>({ audience: null, path: [] });
  // Following a link or guided Continue closes the panel; mode and drafts are kept for reopening.
  useEffect(() => { setOpen(false); }, [navKey]);
  useEffect(() => {
    const onOpen = (e: Event) => { e.preventDefault(); setOpen(true); };
    window.addEventListener(OPEN_ASSISTANT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ASSISTANT_EVENT, onOpen);
  }, []);
  const { effectiveRole, driverWorkspaceAllowed, isLoading, error } = useViewMode();
  const { isActingAsAssistant, managedDrivers } = useActingContext();
  if (isLoading) return null;
  const audience = resolveAudience({
    isActing: isActingAsAssistant, isAgency,
    onAssistantRoute: pathname === '/assistant' || pathname.startsWith('/assistant/'),
    managesDrivers: (managedDrivers?.length ?? 0) > 0,
    role: effectiveRole, driverAllowed: driverWorkspaceAllowed, error,
  });
  const path = guide.audience === audience ? guide.path : [];
  const setPath = (p: string[]) => setGuide({ audience, path: p });

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      {!open && (
        <DialogPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label={`Open ${ASSISTANT_NAME}`}
            data-testid="assistant-launcher"
            className="fixed bottom-24 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:bottom-6"
          >
            <MessageCircle className="h-6 w-6" aria-hidden />
          </button>
        </DialogPrimitive.Trigger>
      )}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-background/60 sm:bg-transparent" />
        <DialogPrimitive.Content
          data-testid="assistant-panel"
          data-expanded={expanded}
          className={`ht-assistant-dark fixed inset-x-0 bottom-0 z-50 flex flex-col border border-border bg-card pb-[env(safe-area-inset-bottom)] text-card-foreground shadow-2xl focus:outline-none sm:inset-x-auto sm:bottom-6 sm:right-4 sm:rounded-2xl ${expanded ? 'top-0 max-h-[100dvh] rounded-none sm:top-6 sm:max-h-[calc(100dvh-3rem)] sm:w-[min(720px,calc(100vw-2rem))]' : 'max-h-[85dvh] rounded-t-2xl sm:max-h-[min(640px,80dvh)] sm:w-[400px]'}`}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
            <MessageCircle className="h-5 w-5 shrink-0 text-accent" aria-hidden />
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-base font-semibold">{ASSISTANT_NAME}</DialogPrimitive.Title>
            <Button variant="ghost" size="icon" className="h-11 w-11 text-foreground" aria-label={expanded ? 'Shrink assistant' : 'Expand assistant'} aria-pressed={expanded} onClick={() => setExpanded((v) => !v)}>
              {expanded ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}
            </Button>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" className="h-11 w-11 text-foreground" aria-label="Close assistant"><X className="h-4 w-4" /></Button>
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">Guided help and AI answers for your workspace.</DialogPrimitive.Description>
          <div role="tablist" aria-label="Assistant mode" aria-orientation="horizontal" onKeyDown={onTabKey} className="flex shrink-0 gap-2 border-b border-border p-2">
            {MODES.map((m) => (
              <button
                key={m} ref={(el) => { tabRefs.current[m] = el; }} type="button" role="tab" id={TAB_ID(m)} aria-controls={PANEL_ID}
                aria-selected={mode === m} tabIndex={mode === m ? 0 : -1} data-state={mode === m ? 'active' : 'inactive'} onClick={() => selectMode(m)}
                className={`flex min-h-[44px] min-w-0 flex-1 items-center justify-center rounded-md border px-2 py-2 text-center text-sm font-semibold leading-tight whitespace-normal break-words transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card ${mode === m ? 'border-[#B45309] bg-[#B45309] text-white shadow-sm' : 'border-border bg-secondary text-foreground hover:border-accent'}`}
              >
                {m === 'guided' ? GUIDED_LABEL : AI_LABEL}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={PANEL_ID} aria-labelledby={TAB_ID(mode)} className="flex min-h-0 flex-1 flex-col">
            {mode === 'guided' ? <GuidedPanel audience={audience} path={path} setPath={setPath} /> : <AiPanel onUseGuided={() => selectMode('guided', true)} />}
          </div>
          <div data-testid="assistant-footer" className="shrink-0 border-t border-border px-4 py-2.5 text-[13px] leading-snug text-secondary-foreground">
            Messages with real recruiters and drivers live in{' '}
            <Link to="/conversations" className="font-medium text-foreground underline underline-offset-2">Conversations</Link>.
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function GuidedPanel({ audience, path, setPath }: { audience: GuideAudience; path: string[]; setPath: (p: string[]) => void }) {
  const trail = findTopicPath(GUIDE_TOPICS[audience], path);
  const current: GuideTopic | undefined = trail[trail.length - 1];
  const choices = current ? current.children ?? [] : GUIDE_TOPICS[audience];
  const ids = trail.map((t) => t.id);
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4" data-testid="assistant-guided" data-audience={audience}>
      <p className="text-[13px] text-secondary-foreground">Step-by-step guidance and links. Not AI-generated.</p>
      {current ? (
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-9 px-2" onClick={() => setPath(ids.slice(0, -1))}><ChevronLeft className="mr-1 h-4 w-4" aria-hidden />Back</Button>
          <Button variant="ghost" size="sm" className="ml-auto h-9 px-2" onClick={() => setPath([])}><RotateCcw className="mr-1 h-4 w-4" aria-hidden />Start over</Button>
        </div>
      ) : (
        <p className="text-sm font-semibold">What do you need help with?</p>
      )}
      {current && (
        <section aria-label={current.label} className="space-y-2">
          <h3 className="text-sm font-semibold">{current.label}</h3>
          {current.body && <p className="text-sm text-muted-foreground">{current.body}</p>}
          {current.findWork && audience === 'self_driver' && (
            <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
              <DriverWorkConversation theme="dark" />
            </Suspense>
          )}
        </section>
      )}
      {choices.length > 0 && (
        <div role="group" aria-label="Choices" className="flex flex-col gap-1.5">
          {choices.map((c) => (
            <button key={c.id} type="button" onClick={() => setPath([...ids, c.id])}
              className="flex min-h-[44px] items-center justify-between rounded-md border border-border/60 px-3 py-2 text-left text-sm font-medium hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {c.label}<ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
            </button>
          ))}
        </div>
      )}
      {current?.links && current.links.length > 0 && (
        <nav aria-label="Helpful links" className="space-y-1.5">
          {current.links.map((l) => (
            <Link key={l.to} to={l.to} className="block rounded-md border border-border/60 px-3 py-2 hover:border-primary">
              <span className="block text-sm font-medium">{l.label}</span>
              <span className="block text-[13px] text-secondary-foreground">{l.hint}</span>
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

/** Compact view over the existing AiAssistantProvider store; no separate state or API. */
function AiPanel({ onUseGuided }: { onUseGuided: () => void }) {
  const a = useAiAssistant();
  const ready = a?.identityReady === true;
  const ref = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const prevHeight = useRef(0);
  useEffect(() => { if (ready) a?.ensureLoaded(); }, [ready, a]);
  const messages = a?.state.messages; const sending = a?.state.sending; const lastChange = a?.state.lastChange;
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    if (lastChange === 'prepend') el.scrollTop += Math.max(0, el.scrollHeight - prevHeight.current);
    else if (nearBottom.current) el.scrollTop = el.scrollHeight;
    prevHeight.current = el.scrollHeight;
  }, [messages, sending, lastChange]);
  if (!a) return null;
  const s = a.state; const ctx = a.currentContext;
  const canSend = s.availability === 'ready' && s.generationEnabled && !!ctx && !s.sending && s.draft.trim().length > 0 && s.draft.trim().length <= s.maxChars;
  const disabled = s.availability === 'unavailable' || (s.availability === 'ready' && !s.generationEnabled);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="assistant-ai">
      <div
        ref={ref} aria-live="polite" className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
        onScroll={(e) => { const el = e.currentTarget; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
      >
        {s.availability === 'idle' || s.availability === 'loading' ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>
        ) : s.availability === 'ready' && s.contexts.length === 0 ? (
          <p className="text-sm text-muted-foreground">AI answers are included with Driver Pro, paid Recruiter and paid Agency plans, within the access you already have. Guided help stays free.</p>
        ) : (
          <>
            {s.messagesCursor && <Button variant="ghost" size="sm" onClick={() => a.loadOlderMessages()} disabled={s.messagesLoading}>Load older messages</Button>}
            {s.messages.length === 0 && ctx && <p className="text-sm text-muted-foreground">Ask read-only questions about {ctx.scope === 'driver_self' ? 'your workspace' : ctx.label}.</p>}
            {s.messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <p className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted/50'}`}>{m.content}</p>
              </div>
            ))}
          </>
        )}
        {s.sending && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Thinking…</p>}
      </div>
      <div className="shrink-0 border-t border-border p-3">
        {disabled ? (
          <div role="status" data-testid="assistant-ai-disabled" className="flex items-start gap-3 rounded-lg border border-border bg-secondary p-3">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
            <div className="min-w-0 space-y-2">
              <p className="text-sm font-medium text-foreground">{AI_DISABLED_COPY}</p>
              <Button type="button" size="sm" variant="outline" className="min-h-[44px] border-border text-foreground" onClick={onUseGuided}>Switch to Free help</Button>
            </div>
          </div>
        ) : (
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (canSend) { nearBottom.current = true; void a.send(); } }}>
          <Textarea
            aria-label="Message the AI assistant" rows={2} className="min-h-[44px] flex-1 resize-none"
            value={s.draft} maxLength={s.maxChars} onChange={(e) => a.setDraft(e.target.value)}
            disabled={s.availability !== 'ready' || !ctx || !s.generationEnabled}
          />
          <Button type="submit" size="icon" aria-label="Send" disabled={!canSend}><Send className="h-4 w-4" /></Button>
        </form>
        )}
        <p data-testid="assistant-ai-disclosure" className="mt-2 text-xs leading-relaxed text-secondary-foreground">
          When AI replies are enabled, your question and authorized workspace records are sent to an external AI processing service. History expires after 30 days or can be deleted sooner; provider logging may differ.{' '}
          <Link to="/privacy" className="font-medium text-foreground underline underline-offset-2">Privacy Policy</Link>
        </p>
        <Link to="/ai-assistant" className="mt-2 inline-flex min-h-[44px] items-center gap-1 text-[13px] font-medium text-accent hover:underline">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />Open full workspace<ExternalLink className="h-3 w-3" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
