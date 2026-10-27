import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { MessageCircle, X, Send, Loader2, Sparkles, ExternalLink, ChevronLeft, RotateCcw, ChevronRight } from 'lucide-react';
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
export const AI_DISABLED_COPY = 'AI replies are not turned on in this environment yet. Guided help stays available.';

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
  // /agency is only treated as agency once the existing authorized get_my_agency check confirms an active agency.
  if (pathname === '/agency' || pathname.startsWith('/agency/')) {
    return <AgencyResolver>{(isAgency) => <LauncherBody pathname={pathname} navKey={navKey} isAgency={isAgency} />}</AgencyResolver>;
  }
  return <LauncherBody pathname={pathname} navKey={navKey} isAgency={false} />;
}

function AgencyResolver({ children }: { children: (isAgency: boolean) => ReactNode }) {
  const { data, isLoading, error } = useMyAgency();
  if (isLoading) return null;
  return <>{children(!error && !!data && data.status === 'active')}</>;
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
          className="ht-assistant-dark fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border border-border bg-card text-card-foreground shadow-2xl focus:outline-none sm:inset-x-auto sm:bottom-6 sm:right-4 sm:max-h-[min(640px,80dvh)] sm:w-[400px] sm:rounded-2xl"
        >
          <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
            <MessageCircle className="h-5 w-5 text-primary" aria-hidden />
            <DialogPrimitive.Title className="text-base font-semibold">{ASSISTANT_NAME}</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" className="ml-auto h-8 w-8" aria-label="Close assistant"><X className="h-4 w-4" /></Button>
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">Guided help and AI answers for your workspace.</DialogPrimitive.Description>
          <div role="tablist" aria-label="Assistant mode" className="flex gap-1 border-b border-border/60 p-2">
            {(['guided', 'ai'] as Mode[]).map((m) => (
              <button
                key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${mode === m ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted/40'}`}
              >
                {m === 'guided' ? GUIDED_LABEL : AI_LABEL}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="flex min-h-0 flex-1 flex-col">
            {mode === 'guided' ? <GuidedPanel audience={audience} path={path} setPath={setPath} /> : <AiPanel />}
          </div>
          <div className="border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
            Messages with real recruiters and drivers live in{' '}
            <Link to="/conversations" className="underline underline-offset-2 hover:text-foreground">Conversations</Link>.
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
      <p className="text-xs text-muted-foreground">Step-by-step guidance and links. Not AI-generated.</p>
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
              <span className="block text-xs text-muted-foreground">{l.hint}</span>
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

/** Compact view over the existing AiAssistantProvider store; no separate state or API. */
function AiPanel() {
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
      <div className="border-t border-border/60 p-3">
        {disabled && <p role="status" data-testid="assistant-ai-disabled" className="mb-2 text-xs text-muted-foreground">{AI_DISABLED_COPY}</p>}
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (canSend) { nearBottom.current = true; void a.send(); } }}>
          <Textarea
            aria-label="Message the AI assistant" rows={2} className="min-h-[44px] flex-1 resize-none"
            value={s.draft} maxLength={s.maxChars} onChange={(e) => a.setDraft(e.target.value)}
            disabled={s.availability !== 'ready' || !ctx || !s.generationEnabled}
          />
          <Button type="submit" size="icon" aria-label="Send" disabled={!canSend}><Send className="h-4 w-4" /></Button>
        </form>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          When AI replies are enabled, your question and authorized workspace records are sent to an external AI processing service. History expires after 30 days or can be deleted sooner; provider logging may differ.{' '}
          <Link to="/privacy" className="underline underline-offset-2">Privacy Policy</Link>
        </p>
        <Link to="/ai-assistant" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />Open full workspace<ExternalLink className="h-3 w-3" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
