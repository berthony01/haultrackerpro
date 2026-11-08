import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, LogOut, ShieldCheck, Truck } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTelegramMiniAppConnection } from '@/hooks/useTelegramMiniAppConnection';
import { Button } from '@/components/ui/button';
import { MiniAppAuth } from '@/components/telegram/MiniAppAuth';
import { MiniAppNotice } from '@/components/telegram/MiniAppNotice';
import { loadMiniAppRuntime, readMiniAppRuntime, miniAppView, miniAppPath, miniAppConnectionMessage, openMiniAppWebsite, MINI_APP_BOT_URL, type MiniAppView } from '@/lib/telegramMiniApp';
import '@/styles/telegram-mini-app.css';

const MiniAppWorkspace = lazy(() => import('@/components/telegram/MiniAppWorkspace').then(module => ({ default: module.MiniAppWorkspace })));

function ConnectedWorkspace({ userId, token, view, thread, navigate }: { userId: string; token: string; view: MiniAppView; thread: string | null; navigate: (view: MiniAppView, thread?: string | null) => void }) {
  const { user } = useAuth();
  const connection = useTelegramMiniAppConnection(userId, token);
  useEffect(() => {
    const runtime = readMiniAppRuntime();
    if (connection.preserveWorkspace) runtime?.enableClosingConfirmation?.();
    return () => runtime?.disableClosingConfirmation?.();
  }, [connection.preserveWorkspace]);
  if (connection.phase === 'checking') return <MiniAppNotice title="Verifying your Telegram connection…" />;
  if (connection.phase === 'not_linked') return <MiniAppNotice title="Connect your accounts"><p>Connect this Telegram account to your signed-in HaulTracker account: <strong className="break-all text-foreground">{user?.email}</strong>.</p><p className="mt-2">Your opportunities and team permissions stay with that HaulTracker account.</p><Button className="mt-4 min-h-11 w-full" disabled={connection.busy} onClick={() => { void connection.connect(); }}><ShieldCheck className="mr-2 h-4 w-4" />{connection.busy ? 'Connecting…' : 'Connect this Telegram account'}</Button></MiniAppNotice>;
  return <>
    {connection.phase === 'error' && <MiniAppNotice title="Connection needs attention"><p>{miniAppConnectionMessage(connection.code)}</p>{connection.preserveWorkspace && <p className="mt-2">Your open form is kept in this window while we reconnect.</p>}<Button className="mt-4" variant="outline" disabled={connection.busy} onClick={() => { void connection.retry(); }}>Try again</Button></MiniAppNotice>}
    {connection.preserveWorkspace && <div key="workspace" hidden={connection.phase !== 'linked'}><Suspense fallback={<MiniAppNotice title="Opening your workspace…" />}><MiniAppWorkspace key={userId} view={view} thread={thread} navigate={navigate} /></Suspense></div>}
  </>;
}

export default function TelegramMiniApp() {
  const { user, session, loading, signOut } = useAuth();
  const routerNavigate = useNavigate();
  const [query] = useSearchParams();
  const view = miniAppView(query.toString());
  const [runtimeState, setRuntimeState] = useState<'loading' | 'ready' | 'outside'>('loading');
  const navigate = (target: MiniAppView, thread?: string | null) => routerNavigate(miniAppPath(target, thread));
  useEffect(() => {
    let cancelled = false;
    document.body.classList.add('app-shell-active');
    void loadMiniAppRuntime().then(runtime => {
      if (cancelled) return;
      if (!runtime?.initData) { setRuntimeState('outside'); return; }
      runtime.ready(); runtime.expand(); setRuntimeState('ready');
    }).catch(() => { if (!cancelled) setRuntimeState('outside'); });
    return () => { cancelled = true; document.body.classList.remove('app-shell-active'); };
  }, []);
  useEffect(() => {
    if (runtimeState !== 'ready') return;
    const runtime = readMiniAppRuntime();
    const back = () => routerNavigate(miniAppPath('home'));
    if (view !== 'home') runtime?.BackButton.show(); else runtime?.BackButton.hide();
    runtime?.BackButton.onClick(back);
    return () => { runtime?.BackButton.offClick(back); runtime?.BackButton.hide(); };
  }, [runtimeState, view, routerNavigate]);

  return <main className="app-shell telegram-mini-app bg-background text-foreground">
    <header className="mini-app-header">
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-3">
        <button type="button" onClick={() => navigate('home')} aria-label="HaulTracker Pro home" className="flex min-h-11 min-w-0 items-center gap-2 text-left"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Truck className="h-5 w-5" /></span><span className="min-w-0"><span className="block text-sm font-extrabold">HaulTracker Pro</span><span className="block text-[11px] text-muted-foreground">{view === 'dispatch' ? 'Dispatch inside Telegram' : 'Recruiting inside Telegram'}</span></span></button>
        <div className="flex shrink-0 gap-1"><Button variant="ghost" size="icon" aria-label="Open HaulTrackerPro.com" onClick={() => openMiniAppWebsite(view)}><ExternalLink className="h-5 w-5" /></Button>{user && <Button variant="ghost" size="icon" aria-label="Sign out" onClick={() => { void signOut(); }}><LogOut className="h-5 w-5" /></Button>}</div>
      </div>
    </header>
    <div className="mx-auto w-full min-w-0 max-w-4xl space-y-5 px-4 py-5 sm:px-6">
      {view !== 'home' && <Button variant="ghost" size="sm" onClick={() => navigate('home')}><ArrowLeft className="mr-2 h-4 w-4" />Home</Button>}
      {loading || runtimeState === 'loading' ? <MiniAppNotice title="Opening HaulTracker Pro…" /> : runtimeState === 'outside' ? <MiniAppNotice title="Open this workspace in Telegram"><p>Open @HaulTrackerBot and use its Mini App buttons. You can also continue on the full website.</p><Button className="mt-4 w-full min-h-11" asChild><a href={MINI_APP_BOT_URL} target="_blank" rel="noopener noreferrer">Open HaulTracker Bot</a></Button><Button className="mt-3 w-full min-h-11" variant="outline" onClick={() => openMiniAppWebsite(view)}>Open HaulTrackerPro.com</Button></MiniAppNotice> : !user || !session ? <MiniAppAuth view={view} /> : <ConnectedWorkspace key={user.id} userId={user.id} token={session.access_token} view={view} thread={query.get('thread')} navigate={navigate} />}
      <p className="pt-2 text-center text-xs text-muted-foreground"><button type="button" className="min-h-11 underline underline-offset-4" onClick={() => openMiniAppWebsite(view)}>Open HaulTrackerPro.com</button></p>
    </div>
  </main>;
}
