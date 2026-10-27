import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { MessageCircle, X, Send, Loader2, Sparkles, Compass, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { useViewMode } from '@/hooks/useViewMode';
import { useActingContext } from '@/hooks/useActingContext';
import { useAiAssistant } from '@/hooks/useAiAssistant';

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
type GuideLink = { label: string; to: string; hint: string };
export const GUIDE_LINKS: Record<GuideAudience, GuideLink[]> = {
  self_driver: [
    { label: 'Add a load', to: '/dashboard?page=add', hint: 'Log pay, miles and stops.' },
    { label: 'Reports', to: '/dashboard?page=reports', hint: 'Weekly and monthly profit.' },
    { label: 'Work items', to: '/driver/work-items', hint: 'Tasks shared with your assistant.' },
    { label: 'How-to guide', to: '/how-to-use-haultrackerpro', hint: 'Step-by-step help.' },
  ],
  acting_assistant: [
    { label: 'Assistant dashboard', to: '/assistant', hint: 'Drivers you help and your access.' },
    { label: 'Help docs', to: '/docs', hint: 'How assistant access works.' },
  ],
  recruiter: [
    { label: 'Recruiter hub', to: '/recruiter', hint: 'Your recruiting workspace.' },
    { label: 'Applications', to: '/recruiter/applications', hint: 'Review driver applications.' },
    { label: 'Recruiter guide', to: '/recruiter/guide', hint: 'Set up and post opportunities.' },
    { label: 'Recruiter FAQ', to: '/recruiter/faq', hint: 'Common questions.' },
  ],
  agency: [
    { label: 'Agency dashboard', to: '/agency', hint: 'Clients, packages and requests.' },
    { label: 'Help docs', to: '/docs', hint: 'How agency access works.' },
  ],
  general: [
    { label: 'Help docs', to: '/docs', hint: 'Guides and answers.' },
    { label: 'FAQ', to: '/faq', hint: 'Common questions.' },
  ],
};

type Mode = 'guided' | 'ai';

/** Single app-wide assistant bubble. Identity-keyed so sign-out, session or managed-target switches reset it. */
export function HaulTrackerAssistantLauncher() {
  const { user, session, loading } = useAuth();
  const { pathname } = useLocation();
  const { actingDriver, isActingAsAssistant, isLoadingManagedDrivers } = useActingContext();
  if (loading || isLoadingManagedDrivers || !user?.id || session?.user?.id !== user.id) return null;
  if (!isAssistantRoute(pathname)) return null;
  const key = `${user.id}|${isActingAsAssistant ? actingDriver?.driver_user_id ?? 'pending' : 'self'}`;
  return <LauncherInner key={key} pathname={pathname} />;
}

function LauncherInner({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('guided');
  const { effectiveRole, driverWorkspaceAllowed, isLoading, error } = useViewMode();
  const { isActingAsAssistant } = useActingContext();
  if (isLoading) return null;
  const audience: GuideAudience = isActingAsAssistant ? 'acting_assistant'
    : pathname.startsWith('/agency') ? 'agency'
    : pathname.startsWith('/assistant') ? 'acting_assistant'
    : effectiveRole === 'recruiter' ? 'recruiter'
    : effectiveRole === 'driver' && driverWorkspaceAllowed === true && !error ? 'self_driver'
    : 'general';

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
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border border-border bg-card text-card-foreground shadow-2xl focus:outline-none sm:inset-x-auto sm:bottom-6 sm:right-4 sm:max-h-[min(640px,80dvh)] sm:w-[400px] sm:rounded-2xl"
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
            {mode === 'guided' ? <GuidedPanel audience={audience} /> : <AiPanel />}
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

function GuidedPanel({ audience }: { audience: GuideAudience }) {
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" data-testid="assistant-guided">
      <p className="text-xs text-muted-foreground">Step-by-step guidance and links. Not AI-generated.</p>
      {audience === 'self_driver' && (
        <section aria-label="Find Work guide" className="space-y-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><Compass className="h-4 w-4 text-primary" aria-hidden />Find Work</p>
          <p className="text-xs text-muted-foreground">Describe the work you want, then review your answers before saving. Nothing is saved automatically.</p>
          <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
            <DriverWorkConversation />
          </Suspense>
        </section>
      )}
      <nav aria-label="Helpful links" className="space-y-1.5">
        {GUIDE_LINKS[audience].map((l) => (
          <Link key={l.to} to={l.to} className="block rounded-md border border-border/60 px-3 py-2 hover:border-primary">
            <span className="block text-sm font-medium">{l.label}</span>
            <span className="block text-xs text-muted-foreground">{l.hint}</span>
          </Link>
        ))}
      </nav>
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
