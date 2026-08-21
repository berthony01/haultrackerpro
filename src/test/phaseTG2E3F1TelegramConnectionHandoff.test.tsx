/**
 * Phase TG-2E3-F1 — Telegram connection handoff hardening (focused component tests).
 *
 * Only `useTelegramLink` is mocked. Navigation is observed through the
 * component's local `telegramHandoff` seam.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TOKEN = 'a1b2'.repeat(16);
const DEEP_LINK = `https://t.me/HaulTrackerProDispatchBot?start=${TOKEN}`;

const hookState = {
  connected: false,
  previouslyConnected: false,
  linkedAt: null as string | null,
  isLoading: false,
  isConnecting: false,
  isDisconnecting: false,
  isAwaitingConfirmation: false,
  refetch: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock('@/hooks/useTelegramLink', () => ({
  TELEGRAM_BOT_USERNAME: 'HaulTrackerProDispatchBot',
  useTelegramLink: () => hookState,
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { TelegramConnectionSection, telegramHandoff } from '@/components/TelegramConnectionSection';

const SECTION_SRC = readFileSync(
  resolve(process.cwd(), 'src/components/TelegramConnectionSection.tsx'),
  'utf8',
);

let navigateSpy: ReturnType<typeof vi.spyOn>;
let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  hookState.connected = false;
  hookState.previouslyConnected = false;
  hookState.linkedAt = null;
  hookState.isLoading = false;
  hookState.isConnecting = false;
  hookState.isDisconnecting = false;
  hookState.isAwaitingConfirmation = false;
  hookState.refetch = vi.fn();
  hookState.connect = vi.fn(async (open: (url: string) => void) => {
    open(DEEP_LINK);
    return { ok: true as const };
  });
  hookState.disconnect = vi.fn(async () => ({ ok: true as const }));
  navigateSpy = vi.spyOn(telegramHandoff, 'navigate').mockImplementation(() => {});
  openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TG-2E3-F1 — popup architecture removed', () => {
  it('source contains no window.open / about:blank / popup handle logic', () => {
    for (const forbidden of ['window.open', 'about:blank', 'opener', 'location.replace', 'postMessage']) {
      expect(SECTION_SRC).not.toContain(forbidden);
    }
  });

  it('clicking Connect never calls window.open', async () => {
    render(<TelegramConnectionSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Connect Telegram' }));
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe('TG-2E3-F1 — same-tab handoff', () => {
  it('navigates the current tab with the hook-supplied deep link', async () => {
    render(<TelegramConnectionSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Connect Telegram' }));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledTimes(1));
    expect(navigateSpy).toHaveBeenCalledWith(DEEP_LINK);
  });

  it('does not parse, rebuild or persist the URL in the component', () => {
    expect(SECTION_SRC).not.toContain('t.me/');
    expect(SECTION_SRC).not.toContain('?start=');
    expect(SECTION_SRC).not.toContain('localStorage');
    expect(SECTION_SRC).not.toContain('sessionStorage');
    expect(SECTION_SRC).not.toMatch(/useState[^\n]*(token|url|link)/i);
    expect(SECTION_SRC).not.toMatch(/console\.(log|error|warn)/);
  });

  it('never renders the token or deep link into the DOM', async () => {
    const { container } = render(<TelegramConnectionSection />);
    expect(container.innerHTML).not.toContain(TOKEN);
    await userEvent.click(screen.getByRole('button', { name: 'Connect Telegram' }));
    expect(container.innerHTML).not.toContain(TOKEN);
    expect(container.innerHTML).not.toContain(DEEP_LINK);
  });
});

describe('TG-2E3-F1 — visible fallback', () => {
  it('shows non-sensitive fallback copy when connect fails, with no token in DOM', async () => {
    hookState.connect = vi.fn(async () => ({ ok: false as const, message: 'Could not start Telegram connection.' }));
    const { container } = render(<TelegramConnectionSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Connect Telegram' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Telegram didn’t open. Try again. We’ll create a new secure one-time link.',
    );
    expect(container.innerHTML).not.toContain(TOKEN);
    expect(container.innerHTML).not.toContain(DEEP_LINK);
  });

  it('retry calls connect again for a fresh token and does not reuse a retained URL', async () => {
    const failing = vi.fn(async () => ({ ok: false as const, message: 'nope' }));
    hookState.connect = failing;
    render(<TelegramConnectionSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Connect Telegram' }));
    const retry = await screen.findByRole('button', { name: 'Try Telegram Again' });
    await userEvent.click(retry);
    expect(failing).toHaveBeenCalledTimes(2);
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

describe('TG-2E3-F1 — existing states preserved', () => {
  it('connected state renders Connected + Disconnect and hides Connect', () => {
    hookState.connected = true;
    hookState.linkedAt = '2026-08-01T00:00:00.000Z';
    render(<TelegramConnectionSection />);
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect Telegram' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect Telegram' })).toBeNull();
  });

  it('disconnect confirmation dialog remains reachable', async () => {
    hookState.connected = true;
    render(<TelegramConnectionSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect Telegram' }));
    expect(await screen.findByText('Disconnect Telegram?')).toBeInTheDocument();
  });

  it('previously connected state renders Reconnect Telegram', () => {
    hookState.previouslyConnected = true;
    render(<TelegramConnectionSection />);
    expect(screen.getByRole('button', { name: 'Reconnect Telegram' })).toBeInTheDocument();
  });
});
