export const MINI_APP_VIEWS = ['home', 'post', 'opportunities', 'applications', 'conversations', 'dispatch', 'account'] as const;
export type MiniAppView = typeof MINI_APP_VIEWS[number];
export const MINI_APP_BOT_URL = 'https://t.me/HaulTrackerBot';

export interface TelegramMiniAppRuntime {
  initData: string;
  ready: () => void;
  expand: () => void;
  close: () => void;
  openLink: (url: string) => void;
  openTelegramLink: (url: string) => void;
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
  onEvent: (event: string, callback: () => void) => void;
  offEvent: (event: string, callback: () => void) => void;
  BackButton: { show: () => void; hide: () => void; onClick: (callback: () => void) => void; offClick: (callback: () => void) => void };
}

declare global { interface Window { Telegram?: { WebApp?: TelegramMiniAppRuntime } } }

export function readMiniAppRuntime(): TelegramMiniAppRuntime | null {
  return typeof window !== 'undefined' ? window.Telegram?.WebApp ?? null : null;
}

export function miniAppView(search: string): MiniAppView {
  const query = new URLSearchParams(search);
  const requested = query.get('view') ?? query.get('tgWebAppStartParam') ?? 'home';
  return MINI_APP_VIEWS.includes(requested as MiniAppView) ? requested as MiniAppView : 'home';
}

export function miniAppPath(view: MiniAppView, thread?: string | null): string {
  const query = new URLSearchParams({ view });
  if (view === 'conversations' && thread && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(thread)) query.set('thread', thread);
  return `/telegram?${query}`;
}

export function isMiniAppLocation(pathname: string, search = ''): boolean {
  if (pathname === '/telegram' || pathname.startsWith('/telegram/')) return true;
  const next = new URLSearchParams(search).get('next') ?? '';
  return pathname === '/auth' && (next === '/telegram' || next.startsWith('/telegram?'));
}

export function websitePathForMiniApp(view: MiniAppView): string {
  if (view === 'conversations') return '/conversations?workspace=recruiter';
  if (view === 'post' || view === 'opportunities') return '/dashboard?page=recruiter-access:manager';
  if (view === 'applications') return '/dashboard?page=recruiter-access:applications';
  return '/dashboard?page=recruiter-access';
}

export function openMiniAppWebsite(view: MiniAppView) {
  const url = `https://haultrackerpro.com${websitePathForMiniApp(view)}`;
  const runtime = readMiniAppRuntime();
  if (runtime?.initData && runtime.openLink) runtime.openLink(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

let sdkPromise: Promise<TelegramMiniAppRuntime | null> | null = null;
export function loadMiniAppRuntime(): Promise<TelegramMiniAppRuntime | null> {
  if (readMiniAppRuntime()) return Promise.resolve(readMiniAppRuntime());
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise(resolve => {
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-web-app.js';
    script.async = true;
    let finished = false;
    const finish = () => { if (!finished) { finished = true; clearTimeout(timer); resolve(readMiniAppRuntime()); } };
    const timer = setTimeout(finish, 10000);
    script.onload = finish;
    script.onerror = finish;
    document.head.appendChild(script);
  });
  return sdkPromise;
}

export function miniAppConnectionMessage(code: string | null) {
  if (code === 'telegram_session_expired') return 'Close this window and reopen the Mini App from the bot to refresh your Telegram session.';
  if (code === 'telegram_connection_conflict') return 'This Telegram account and HaulTracker account are not connected to each other. Sign in to the connected HaulTracker account, or manage the connection on the website.';
  if (code === 'sign_in_required') return 'Please sign in again with your confirmed HaulTracker account.';
  return 'The Telegram connection could not be verified. Try again or open HaulTrackerPro.com.';
}
