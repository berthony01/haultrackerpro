import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import TelegramMiniApp from '@/pages/TelegramMiniApp';

const h = vi.hoisted(() => ({ auth: {} as any, invoke: vi.fn(), workspace: vi.fn(), signIn: vi.fn(), signUp: vi.fn(), signOut: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => h.auth }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: (...args: unknown[]) => h.invoke(...args) } } }));
vi.mock('@/components/telegram/MiniAppWorkspace', () => ({ MiniAppWorkspace: (props: any) => { h.workspace(props); return <input aria-label="Unfinished QA form" defaultValue="" />; } }));
const uid = '10000000-0000-4000-8000-000000000001';
const linked = { data: { status: 'linked' }, error: null };
const notLinked = { data: { status: 'not_linked' }, error: null };
const tree = () => <MemoryRouter initialEntries={['/telegram?view=post']}><TelegramMiniApp /></MemoryRouter>;

beforeEach(() => {
  vi.clearAllMocks();
  h.invoke.mockResolvedValue(linked); h.signIn.mockResolvedValue({ error: null }); h.signUp.mockResolvedValue({ error: null }); h.signOut.mockResolvedValue(undefined);
  h.auth = { user: { id: uid, email: 'qa@example.invalid' }, session: { access_token: 'qa-user-token' }, loading: false, signIn: h.signIn, signUp: h.signUp, signOut: h.signOut };
  window.Telegram = { WebApp: { initData: 'synthetic-launch-data', ready: vi.fn(), expand: vi.fn(), close: vi.fn(), openLink: vi.fn(), openTelegramLink: vi.fn(), onEvent: vi.fn(), offEvent: vi.fn(), enableClosingConfirmation: vi.fn(), disableClosingConfirmation: vi.fn(), BackButton: { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() } } };
});
afterEach(() => { delete window.Telegram; });

describe('Mini App account and connection boundary', () => {
  it('does not query private workspace data before account sign-in', async () => {
    h.auth.user = null; h.auth.session = null; render(tree());
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument(); expect(h.invoke).not.toHaveBeenCalled(); expect(h.workspace).not.toHaveBeenCalled();
  });
  it('uses normal HaulTracker sign-in inside the Mini App', async () => {
    h.auth.user = null; h.auth.session = null; render(tree()); await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'qa@example.invalid' } }); fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'qa-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(h.signIn).toHaveBeenCalledWith('qa@example.invalid', 'qa-password')); expect(h.invoke).not.toHaveBeenCalled();
  });
  it('creates a recruiter account with the requested Mini App continuation', async () => {
    h.auth.user = null; h.auth.session = null; render(tree()); await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getByRole('button', { name: 'New here? Create a recruiter account' }));
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'QA Recruiter' } }); fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'qa@example.invalid' } }); fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'qa-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create recruiter account' }));
    await waitFor(() => expect(h.signUp).toHaveBeenCalledWith('qa@example.invalid', 'qa-password', 'QA Recruiter', 'recruiter', { emailRedirectNext: '/telegram?view=post' }));
    expect(await screen.findByText(/Check your email to confirm/)).toBeInTheDocument();
  });
  it('requires explicit account connection before mounting business screens', async () => {
    h.invoke.mockResolvedValueOnce(notLinked).mockResolvedValueOnce(linked); render(tree());
    expect(await screen.findByRole('heading', { name: 'Connect your accounts' })).toBeInTheDocument(); expect(h.workspace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Connect this Telegram account' }));
    await screen.findByLabelText('Unfinished QA form');
    expect(h.invoke.mock.calls[1][1]).toEqual({ timeout: 15000, headers: { Authorization: 'Bearer qa-user-token' }, body: { action: 'connect', initData: 'synthetic-launch-data' } });
    expect(h.workspace).toHaveBeenCalledWith(expect.objectContaining({ view: 'post' }));
  });
  it('does not run a connection request twice for a rapid second tap', async () => {
    let complete!: (value: unknown) => void;
    h.invoke.mockResolvedValueOnce(notLinked).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })); render(tree());
    const connect = await screen.findByRole('button', { name: 'Connect this Telegram account' });
    act(() => { fireEvent.click(connect); fireEvent.click(connect); });
    expect(h.invoke).toHaveBeenCalledTimes(2);
    await act(async () => { complete(linked); });
  });
  it('rejects a cached successful response when the signed-in account changes', async () => {
    let complete!: (value: unknown) => void;
    h.invoke.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })).mockResolvedValueOnce(notLinked);
    const view = render(tree()); await waitFor(() => expect(h.invoke).toHaveBeenCalledOnce());
    h.auth = { ...h.auth, user: { id: '10000000-0000-4000-8000-000000000002', email: 'second@example.invalid' }, session: { access_token: 'second-token' } };
    view.rerender(tree()); await screen.findByRole('heading', { name: 'Connect your accounts' });
    await act(async () => { complete(linked); }); expect(h.workspace).not.toHaveBeenCalled();
    expect(h.invoke.mock.calls[1][1].headers.Authorization).toBe('Bearer second-token');
  });
  it('removes business screens when the current Telegram link is revoked', async () => {
    h.invoke.mockResolvedValueOnce(linked).mockResolvedValueOnce(notLinked); render(tree()); await screen.findByLabelText('Unfinished QA form');
    fireEvent(window, new Event('focus')); await screen.findByRole('heading', { name: 'Connect your accounts' });
    expect(screen.queryByLabelText('Unfinished QA form')).not.toBeInTheDocument();
  });
  it('preserves an open form through a transient verification outage without allowing interaction', async () => {
    h.invoke.mockResolvedValueOnce(linked).mockRejectedValueOnce(new Error('network lost')).mockResolvedValueOnce(linked);
    render(tree()); const input = await screen.findByLabelText('Unfinished QA form'); fireEvent.change(input, { target: { value: 'Unsaved QA text' } });
    fireEvent(window, new Event('focus')); await screen.findByRole('heading', { name: 'Connection needs attention' });
    expect(input).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(input).toBeVisible()); expect(input).toHaveValue('Unsaved QA text');
  });
  it('shows a website fallback without treating browser query parameters as a Telegram identity', async () => {
    window.Telegram!.WebApp!.initData = ''; render(tree());
    expect(await screen.findByRole('heading', { name: 'Open this workspace in Telegram' })).toBeInTheDocument(); expect(h.invoke).not.toHaveBeenCalled(); expect(h.workspace).not.toHaveBeenCalled();
  });
});
