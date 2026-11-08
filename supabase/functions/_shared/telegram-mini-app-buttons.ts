import type { TelegramInlineButton } from './telegram-poll-ingest.ts';

const BASE = 'https://haultrackerpro.com';
const mini = (view: string) => `${BASE}/telegram?view=${view}`;

/** Only private recruiter entry points change. Group reviews, Quick Post
 * save/edit/cancel callbacks, driver handoffs and external URLs retain their
 * wire shape. A Mini App entry never starts or replaces a chat draft. */
export function telegramMiniAppKeyboard(rows: TelegramInlineButton[][], chatId: number) {
  const privateChat = Number.isSafeInteger(chatId) && chatId > 0;
  return rows.map(row => row.map(button => {
    let view: string | null = null;
    if (privateChat) {
      if ('callbackData' in button && button.callbackData === 'q1:n') view = 'post';
      if ('url' in button) {
        if (button.url === `${BASE}/dashboard?page=recruiter-access:manager`) view = 'opportunities';
        if (button.url === `${BASE}/conversations?workspace=recruiter`) view = 'conversations';
        if (button.url === BASE && button.text === 'Create account / Sign in') view = 'home';
        if (button.url === `${BASE}/telegram?view=dispatch`) view = 'dispatch';
      }
    }
    if (view) return { text: button.text, web_app: { url: mini(view) } };
    return 'url' in button ? { text: button.text, url: button.url } : { text: button.text, callback_data: button.callbackData };
  }));
}
