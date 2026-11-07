import { describe, expect, it, vi, afterEach } from 'vitest';
import { miniAppPath, miniAppView, isMiniAppLocation, websitePathForMiniApp } from '@/lib/telegramMiniApp';
import { getCapabilityFromNext, resolvePostAuthDestination } from '@/lib/authNavigation';
import { telegramMiniAppKeyboard } from '../../supabase/functions/_shared/telegram-mini-app-buttons';
import { trackPageView, trackLogin } from '@/lib/analytics';

afterEach(() => { window.history.replaceState({}, '', '/'); delete window.Telegram; delete (window as any).gtag; });
describe('Mini App navigation and launch buttons', () => {
  it('accepts only known destinations and drops untrusted launch paths', () => {
    expect(miniAppView('?view=post')).toBe('post'); expect(miniAppView('?tgWebAppStartParam=applications')).toBe('applications');
    expect(miniAppView('?view=https://attacker.invalid')).toBe('home'); expect(miniAppView('?view=owner-admin')).toBe('home');
    expect(miniAppPath('conversations', 'javascript:alert(1)')).toBe('/telegram?view=conversations');
  });
  it('preserves recruiter intent and the requested page through normal sign-in', () => {
    const next = miniAppPath('post'); expect(getCapabilityFromNext(next)).toBe('recruiter');
    expect(resolvePostAuthDestination(`?next=${encodeURIComponent(next)}`)).toBe(next);
    expect(websitePathForMiniApp('conversations')).toBe('/conversations?workspace=recruiter');
  });
  it('only recognizes the Mini App and its actual auth continuation', () => {
    expect(isMiniAppLocation('/telegram')).toBe(true); expect(isMiniAppLocation('/auth', '?next=%2Ftelegram%3Fview%3Dpost')).toBe(true);
    expect(isMiniAppLocation('/telegram-other')).toBe(false); expect(isMiniAppLocation('/auth', '?next=https://attacker.invalid/telegram')).toBe(false);
  });
  it('opens permitted private recruiter entry buttons inside Telegram without a Quick Post mutation', () => {
    const rows = telegramMiniAppKeyboard([
      [{ text: 'Post Opportunity', callbackData: 'q1:n' }],
      [{ text: 'My Opportunities', url: 'https://haultrackerpro.com/dashboard?page=recruiter-access:manager' }],
      [{ text: 'Conversations', url: 'https://haultrackerpro.com/conversations?workspace=recruiter' }],
      [{ text: 'Create account / Sign in', url: 'https://haultrackerpro.com' }],
    ], 1234);
    expect(rows.map(row => row[0])).toEqual([
      { text: 'Post Opportunity', web_app: { url: 'https://haultrackerpro.com/telegram?view=post' } },
      { text: 'My Opportunities', web_app: { url: 'https://haultrackerpro.com/telegram?view=opportunities' } },
      { text: 'Conversations', web_app: { url: 'https://haultrackerpro.com/telegram?view=conversations' } },
      { text: 'Create account / Sign in', web_app: { url: 'https://haultrackerpro.com/telegram?view=home' } },
    ]);
  });
  it('preserves group review buttons and existing draft save/cancel/edit actions', () => {
    const rows = [[{ text: 'Post', callbackData: 'q1:n' }, { text: 'Confirm', callbackData: 'g1:a:proposal' }]];
    expect(telegramMiniAppKeyboard(rows, -100)[0]).toEqual([{ text: 'Post', callback_data: 'q1:n' }, { text: 'Confirm', callback_data: 'g1:a:proposal' }]);
    expect(telegramMiniAppKeyboard([[{ text: 'Save', callbackData: 'q1:c:draft' }, { text: 'Cancel', callbackData: 'q1:x:draft' }]], 1234)[0]).toEqual([{ text: 'Save', callback_data: 'q1:c:draft' }, { text: 'Cancel', callback_data: 'q1:x:draft' }]);
  });
  it('preserves dispatcher, driver and reports website handoffs', () => {
    for (const url of ['https://haultrackerpro.com/dashboard', 'https://haultrackerpro.com/dashboard?page=recruiter-access', 'https://haultrackerpro.com/dashboard?page=recruiter-access:reports']) {
      expect(telegramMiniAppKeyboard([[{ text: 'Open', url }]], 1234)[0][0]).toEqual({ text: 'Open', url });
    }
  });
  it('does not emit tracking events for Mini App sessions', () => {
    const track = vi.fn(); (window as any).gtag = track;
    window.history.replaceState({}, '', '/telegram?view=post#tgWebAppData=sensitive');
    trackPageView('/telegram'); trackLogin(); expect(track).not.toHaveBeenCalled();
    window.history.replaceState({}, '', '/dashboard'); trackPageView('/dashboard'); expect(track).toHaveBeenCalledOnce();
  });
});
