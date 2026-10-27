import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Plus, Trash2, History, Send, Loader2, LayoutDashboard, Compass, MessageSquare, FileText } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAiAssistant, contextKeyOf, type AiAssistantApi } from '@/hooks/useAiAssistant';
import type { AssistantContext, AssistantScope, AssistantThread } from '@/lib/assistant/api';

const SCOPE_NAME: Record<AssistantScope, string> = {
  driver_self: 'Driver', driver_delegate: 'Managed driver', recruiter: 'Recruiter', agency: 'Agency',
};
const TOOL_TEXT: Record<string, string> = {
  loads: 'most recent loads', expenses: 'most recent expenses', opportunities: 'most recent opportunities',
  applications: 'application counts by status', conversations: 'conversation counts by status',
  packages: 'service packages', work_items: 'work item counts by status', client_requests: 'client request counts by status',
};
const PROMPTS: Record<string, string[]> = {
  loads: ['Which of my most recent loads are still unpaid?', 'Summarize my most recent loads.'],
  expenses: ['What were my most recent expenses?'],
  opportunities: ['Which of my opportunities were updated most recently?'],
  applications: ['How many applications are in each status?'],
  conversations: ['How many driver conversations are open?'],
  packages: ['Which service packages are active?'],
  work_items: ['How many work items are open?'],
  client_requests: ['How many client requests are pending?'],
};
const NOTICE: Record<string, string> = {
  limit: 'You have reached the current AI assistant limit. Please try again later.',
  busy: 'A reply is still being prepared. Please wait for it before sending another message.',
  failed: 'The AI assistant could not answer that right now. Your message was not answered; you can try again.',
  forbidden: 'This workspace is no longer available to the AI assistant for your account.',
  disabled: 'AI replies are not turned on in this environment yet.',
  unavailable: 'The AI assistant is temporarily unavailable.',
  pending: 'This message is still being answered. Refresh history in a moment.',
  delete_failed: 'That conversation could not be deleted. It may already be gone, or the AI assistant is unavailable right now.',
  clear_failed: 'Your history could not be cleared right now. Nothing was deleted; please try again.',
};

function welcomeFor(ctx: AssistantContext | null) {
  if (!ctx) return '';
  const what = ctx.tools.map((t) => TOOL_TEXT[t]).filter(Boolean).join(', ');
  const who = ctx.scope === 'driver_delegate' ? `${ctx.label}'s` : ctx.scope === 'driver_self' ? 'your' : `${ctx.label}'s`;
  return `I can read ${who} ${what}, read-only. I can't create, change or send anything.`;
}

function HistoryList({ a, onPick, onDelete }: { a: AiAssistantApi; onPick?: () => void; onDelete: (t: AssistantThread) => void }) {
  const s = a.state;
  return (
    <div className="flex h-full flex-col gap-2">
      <Button size="sm" onClick={() => { a.newConversation(); onPick?.(); }} disabled={s.availability !== 'ready'}>
        <Plus className="mr-1.5 h-4 w-4" /> New conversation
      </Button>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto" aria-label="Conversation history">
        {a.visibleThreads.length === 0 && s.availability === 'ready' && (
          <p className="px-1 py-2 text-xs text-muted-foreground">No saved conversations yet.</p>
        )}
        {a.visibleThreads.map((t) => (
          <div key={t.id} className={`group flex items-center gap-1 rounded-md ${t.id === s.threadId ? 'bg-primary/15' : 'hover:bg-muted/40'}`}>
            <button type="button" className="min-w-0 flex-1 px-2 py-2 text-left" onClick={() => { a.openThread(t.id); onPick?.(); }}>
              <span className="block truncate text-sm">{t.preview || 'Conversation'}</span>
              <span className="block text-[11px] text-muted-foreground">{SCOPE_NAME[t.scope]} · {new Date(t.createdAt).toLocaleDateString()}</span>
            </button>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`Delete conversation ${t.preview || ''}`.trim()} onClick={() => onDelete(t)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {s.threadsCursor && (
          <Button variant="ghost" size="sm" className="w-full" onClick={() => a.loadMoreThreads()} disabled={s.threadsLoading}>Load more</Button>
        )}
      </div>
    </div>
  );
}

export default function AiAssistant() {
  const a = useAiAssistant();
  const [confirm, setConfirm] = useState<null | { kind: 'delete'; thread: AssistantThread } | { kind: 'clear' }>(null);
  const [drawer, setDrawer] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const ready = a?.identityReady === true;

  useEffect(() => { if (ready) a?.ensureLoaded(); }, [ready, a]);
  const messages = a?.state.messages;
  const sending = a?.state.sending;
  const lastChange = a?.state.lastChange;
  const prevHeight = useRef(0);
  useLayoutEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    // Prepending older messages keeps the reader's place; new messages/replies/thinking go to the bottom.
    if (lastChange === 'prepend') el.scrollTop = el.scrollTop + Math.max(0, el.scrollHeight - prevHeight.current);
    else el.scrollTop = el.scrollHeight;
    prevHeight.current = el.scrollHeight;
  }, [messages, sending, lastChange]);

  if (!a) return null;
  const s = a.state;
  const ctx = a.currentContext;
  const canSend = s.availability === 'ready' && s.generationEnabled && !!ctx && !s.sending && s.draft.trim().length > 0 && s.draft.trim().length <= s.maxChars;
  const prompts = ctx ? ctx.tools.flatMap((t) => PROMPTS[t] ?? []).slice(0, 4) : [];
  const pinnedIncomplete = !!a.pinnedDriverId && s.availability === 'ready' && s.contexts.length === 0 && s.pinSearchOffset !== null;
  // Only an exhausted search (no continuation) may claim the driver is not available.
  const pinnedMissing = !!a.pinnedDriverId && s.availability === 'ready' && s.contexts.length === 0 && s.pinSearchOffset === null;

  const onDelete = (t: AssistantThread) => setConfirm({ kind: 'delete', thread: t });

  return (
    <AppShell>
      <div className="mx-auto flex h-[100dvh] max-w-6xl flex-col px-3 py-3 sm:px-4">
        <header className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-3">
          <Sparkles className="h-5 w-5 text-primary" aria-hidden />
          <h1 className="text-xl font-semibold">AI assistant</h1>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button asChild variant="ghost" size="sm"><Link to="/dashboard"><LayoutDashboard className="mr-1 h-4 w-4" />Dashboard</Link></Button>
            <Button asChild variant="ghost" size="sm"><Link to="/find-work"><Compass className="mr-1 h-4 w-4" />Find Work (free)</Link></Button>
            <Button asChild variant="ghost" size="sm"><Link to="/conversations"><MessageSquare className="mr-1 h-4 w-4" />Conversations</Link></Button>
          </div>
          <p className="w-full text-xs text-muted-foreground">
            Separate from the free Find Work guide and from Conversations with real people.
          </p>
        </header>

        {s.availability === 'unavailable' ? (
          <div role="status" className="m-auto max-w-md space-y-3 rounded-lg border border-border/60 bg-card/40 p-6 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-primary" aria-hidden />
            <p className="font-medium">AI assistant is not enabled in this environment yet.</p>
            <p className="text-sm text-muted-foreground">You can still use the free Find Work guide or your Conversations inbox.</p>
            <Textarea aria-label="Message the AI assistant" disabled placeholder="Unavailable" className="min-h-[44px]" />
            <Button disabled className="w-full"><Send className="mr-1.5 h-4 w-4" />Send</Button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 gap-4 pt-3">
            <aside className="hidden w-64 shrink-0 md:block">
              <HistoryList a={a} onDelete={onDelete} />
            </aside>
            <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-border/60 bg-card/30">
              <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-2">
                <Sheet open={drawer} onOpenChange={setDrawer}>
                  <SheetTrigger asChild>
                    <Button variant="outline" size="sm" className="md:hidden"><History className="mr-1 h-4 w-4" />History</Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-72">
                    <SheetHeader><SheetTitle>Conversation history</SheetTitle></SheetHeader>
                    <div className="mt-3 h-[80vh]"><HistoryList a={a} onPick={() => setDrawer(false)} onDelete={onDelete} /></div>
                  </SheetContent>
                </Sheet>
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Workspace</span>
                  <select
                    aria-label="AI assistant workspace"
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={s.contextKey ?? ''}
                    disabled={s.availability !== 'ready' || s.contexts.length < 2 || !!a.pinnedDriverId}
                    onChange={(e) => a.selectContext(e.target.value)}
                  >
                    {s.contexts.length === 0 && <option value="">No eligible workspace</option>}
                    {s.contexts.map((c) => (
                      <option key={contextKeyOf(c)} value={contextKeyOf(c)}>{SCOPE_NAME[c.scope]}: {c.label}</option>
                    ))}
                  </select>
                </label>
                {!a.pinnedDriverId && s.contextsNextOffset !== null && (
                  <Button variant="outline" size="sm" onClick={() => a.loadMoreContexts()} disabled={s.contextsLoading}>
                    {s.contextsLoading ? 'Loading workspaces...' : 'Load more workspaces'}
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="ml-auto" disabled={!ready || s.availability !== 'ready'} onClick={() => setConfirm({ kind: 'clear' })}>
                  Clear history
                </Button>
                {s.threadId && (
                  <Button variant="ghost" size="sm" onClick={() => { const t = a.visibleThreads.find((x) => x.id === s.threadId); if (t) onDelete(t); }}>
                    <Trash2 className="mr-1 h-4 w-4" />Delete conversation
                  </Button>
                )}
              </div>

              <div ref={transcriptRef} data-testid="ai-transcript" className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" aria-live="polite">
                {s.availability !== 'ready' ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{a.pinnedDriverId && s.contextsSearchPages > 1 ? `Looking for this driver's workspace (page ${s.contextsSearchPages})...` : 'Loading…'}</p>
                ) : pinnedIncomplete ? (
                  <div className="m-auto max-w-md space-y-3 py-10 text-center" role="status">
                    <p className="font-medium">Still looking for this driver's workspace.</p>
                    <p className="text-sm text-muted-foreground">
                      {s.pinSearchFailed ? 'The search could not continue right now.' : `Searched ${s.contextsSearchPages} pages of workspaces so far.`} You can keep searching.
                    </p>
                    <Button variant="outline" size="sm" onClick={() => a.continuePinnedSearch()} disabled={s.pinSearchLoading}>
                      {s.pinSearchLoading ? 'Searching...' : 'Continue searching'}
                    </Button>
                  </div>
                ) : s.contexts.length === 0 ? (
                  <div className="m-auto max-w-md space-y-2 py-10 text-center">
                    <p className="font-medium">{pinnedMissing ? 'The AI assistant is not available for this driver.' : 'The AI assistant is included with paid plans.'}</p>
                    <p className="text-sm text-muted-foreground">Driver Pro, paid Recruiter and paid Agency plans include it, within the access you already have. The free Find Work guide stays available.</p>
                  </div>
                ) : s.messages.length === 0 && !s.messagesLoading ? (
                  <div className="mx-auto max-w-lg space-y-3 py-6 text-center">
                    <p className="font-medium">Ask about {ctx?.scope === 'driver_self' ? 'your workspace' : ctx?.label}</p>
                    <p className="text-sm text-muted-foreground">{welcomeFor(ctx)}</p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {prompts.map((p) => (
                        <Button key={p} variant="outline" size="sm" className="h-auto whitespace-normal py-1.5 text-left" onClick={() => a.setDraft(p)}>{p}</Button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    {s.messagesCursor && <Button variant="ghost" size="sm" onClick={() => a.loadOlderMessages()} disabled={s.messagesLoading}>Load older messages</Button>}
                    {s.messages.map((m) => (
                      <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted/50'}`}>
                          <p className="whitespace-pre-wrap break-words">{m.content}</p>
                          {m.sources.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Sources">
                              {m.sources.map((src) => (
                                <Link key={src.key} to={src.href} className="inline-flex items-center gap-1 rounded border border-border/60 bg-background/60 px-2 py-0.5 text-[11px] text-foreground hover:border-primary">
                                  <FileText className="h-3 w-3" />{src.label}
                                </Link>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                )}
                {s.sending && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Thinking…</p>}
              </div>

              <footer className="border-t border-border/60 p-2">
                {s.notice && <p role="alert" className="mb-2 text-sm text-destructive">{NOTICE[s.notice]}</p>}
                {s.availability === 'ready' && !s.generationEnabled && s.contexts.length > 0 && !s.notice && (
                  <p className="mb-2 text-xs text-muted-foreground">{NOTICE.disabled} Your saved history and deletion controls still work.</p>
                )}
                <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (canSend) void a.send(); }}>
                  <Textarea
                    aria-label="Message the AI assistant"
                    value={s.draft}
                    maxLength={s.maxChars}
                    onChange={(e) => a.setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canSend) void a.send(); } }}
                    placeholder={ctx ? 'Ask about your records…' : ''}
                    disabled={s.availability !== 'ready' || !ctx}
                    className="min-h-[44px] flex-1 resize-none"
                    rows={2}
                  />
                  <Button type="submit" disabled={!canSend}><Send className="mr-1.5 h-4 w-4" />Send</Button>
                </form>
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  When AI replies are enabled, your question and the authorized workspace records you can already access are sent to an external AI processing service to generate the reply. Conversation history expires after 30 days or can be deleted sooner; the AI provider's own logging and retention may differ and are governed by its policies. Please avoid including sensitive details beyond what is needed.{' '}
                  <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">See our Privacy Policy</Link>.
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Read-only. Uses only records you can already access.{s.retentionDays === 30 ? ' Conversations are kept for 30 days unless you delete them sooner.' : ''}
                </p>
              </footer>
            </section>
          </div>
        )}
      </div>

      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.kind === 'clear' ? 'Clear all AI assistant history?' : 'Delete this conversation?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === 'clear'
                ? 'This permanently deletes every AI assistant conversation saved for your account, in every workspace. Usage limits are not reset.'
                : `This permanently deletes “${confirm?.kind === 'delete' ? confirm.thread.preview || 'Conversation' : ''}” and its messages.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              const c = confirm; setConfirm(null);
              if (c?.kind === 'clear') void a.clearHistory(); else if (c?.kind === 'delete') void a.deleteThread(c.thread.id);
            }}>
              {confirm?.kind === 'clear' ? 'Clear history' : 'Delete conversation'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
