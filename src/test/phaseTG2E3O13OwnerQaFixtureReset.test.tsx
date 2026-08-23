/**
 * Phase TG-2E3-O13 — Owner QA Center "QA Data Reset" UX.
 *
 * Proves the destructive reset card is owner-only, requires confirmation,
 * calls ONLY the two new owner QA reset RPCs (never billing/Stripe/Telegram),
 * refreshes the preview on success, and disables itself at zero.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const qaState = {
  isOwner: true,
  isActive: false,
  domain: null as string | null,
  persona: null as string | null,
  label: null as string | null,
  expiresAt: null as string | null,
  selection: null as unknown,
  isLoading: false,
  isMutating: false,
  error: null as Error | null,
  setPersona: vi.fn(async () => {}),
  disable: vi.fn(async () => {}),
  refetch: vi.fn(),
};

vi.mock('@/hooks/useOwnerQaPersona', () => ({
  useOwnerQaPersona: () => qaState,
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

const previewPayload = {
  carrier_relationships: 1,
  assistant_relationships: 1,
  agency_delegations: 1,
  driver_profiles: 1,
  loads: 2,
  expenses: 2,
  fuel_logs: 1,
  applications: 1,
  application_events: 1,
  referrals: 0,
  agency_work_items: 1,
  settlements: 1,
  settlement_items: 1,
  settlement_matches: 1,
  notifications: 3,
  lane_stats: 2,
  broker_stats: 0,
  operating_metrics: 1,
  total_rows: 21,
  roots_intact: true,
};

const emptyPayload = Object.fromEntries(
  Object.entries(previewPayload).map(([k, v]) =>
    k === 'roots_intact' ? [k, true] : [k, 0],
  ),
);

const INACTIVE_SCENARIO_STATE = {
  active: false,
  scenario: null,
  assistant_driver_count: 0,
  agency_role: null,
  agency_permission_count: 0,
  recruiter_workspace_count: 0,
  recruiter_roles: [] as string[],
};

/** Exact set of RPCs this O13 flow may reach. */
const APPROVED_O13_RPCS = [
  'owner_qa_fixture_reset_preview',
  'owner_qa_fixture_reset',
  'owner_qa_relationship_scenario_state',
] as const;

const FORBIDDEN_O13_RPCS = [
  'owner_qa_apply_relationship_scenario',
  'owner_qa_clear_relationship_scenario',
] as const;

let previewQueue: unknown[] = [];
const invoke = vi.fn(async () => ({ data: null, error: null }));
const rpc = vi.fn(async (fn: string) => {
  if (fn === 'owner_qa_fixture_reset_preview') {
    return { data: previewQueue.shift() ?? emptyPayload, error: null };
  }
  if (fn === 'owner_qa_fixture_reset') {
    return { data: { ...previewPayload }, error: null };
  }
  if (fn === 'owner_qa_relationship_scenario_state') {
    return { data: { ...INACTIVE_SCENARIO_STATE }, error: null };
  }
  return { data: null, error: null };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke }, rpc },
}));

import OwnerQaCenter from '@/pages/OwnerQaCenter';

const root = path.resolve(__dirname, '../..');
const pageSource = readFileSync(path.join(root, 'src/pages/OwnerQaCenter.tsx'), 'utf8');
const hookSource = readFileSync(
  path.join(root, 'src/hooks/useOwnerQaFixtureReset.ts'),
  'utf8',
);
const migrationSource = readFileSync(
  path.join(
    root,
    'supabase/migration-candidates/20260822210000_phase_tg2e3_o13_owner_qa_fixture_reset.sql',
  ),
  'utf8',
);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/owner-qa']}>
      <OwnerQaCenter />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  previewQueue = [];
  Object.assign(qaState, { isOwner: true, isLoading: false, isActive: false });
});

describe('TG-2E3-O13 — QA Data Reset card', () => {
  it('renders the reset card with preview totals for the owner', async () => {
    previewQueue = [{ ...previewPayload }];
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('owner-qa-reset-total')).toHaveTextContent(
        '21 rows would be removed',
      ),
    );
    expect(screen.getByTestId('owner-qa-reset-card')).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith('owner_qa_fixture_reset_preview');
  });

  it('is not rendered at all for a non-owner (page redirects)', async () => {
    qaState.isOwner = false;
    renderPage();
    await waitFor(() =>
      expect(screen.queryByTestId('owner-qa-center')).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId('owner-qa-reset-card')).not.toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('requires confirmation before resetting', async () => {
    previewQueue = [{ ...previewPayload }];
    renderPage();
    await waitFor(() => screen.getByTestId('owner-qa-reset-button'));

    fireEvent.click(screen.getByTestId('owner-qa-reset-button'));
    expect(rpc).not.toHaveBeenCalledWith('owner_qa_fixture_reset');

    await waitFor(() => screen.getByTestId('owner-qa-reset-confirm'));
    expect(screen.getByTestId('owner-qa-reset-confirm')).toHaveTextContent(
      /preserves the QA fixture roots/i,
    );
  });

  it('cancelling the confirmation performs no reset', async () => {
    previewQueue = [{ ...previewPayload }];
    renderPage();
    await waitFor(() => screen.getByTestId('owner-qa-reset-button'));
    fireEvent.click(screen.getByTestId('owner-qa-reset-button'));
    await waitFor(() => screen.getByTestId('owner-qa-reset-cancel'));
    fireEvent.click(screen.getByTestId('owner-qa-reset-cancel'));
    expect(rpc).not.toHaveBeenCalledWith('owner_qa_fixture_reset');
  });

  it('confirming invokes only the reset RPC, then refreshes the preview', async () => {
    previewQueue = [{ ...previewPayload }];
    renderPage();
    await waitFor(() => screen.getByTestId('owner-qa-reset-button'));
    fireEvent.click(screen.getByTestId('owner-qa-reset-button'));
    await waitFor(() => screen.getByTestId('owner-qa-reset-confirm-action'));
    fireEvent.click(screen.getByTestId('owner-qa-reset-confirm-action'));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('owner_qa_fixture_reset'),
    );
    // preview re-fetched after the reset (empty payload from the queue drain)
    await waitFor(() =>
      expect(
        rpc.mock.calls.filter((c) => c[0] === 'owner_qa_fixture_reset_preview')
          .length,
      ).toBeGreaterThanOrEqual(2),
    );
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        expect.stringContaining('21 rows removed'),
      ),
    );
    // Never any edge function / billing / Telegram call.
    expect(invoke).not.toHaveBeenCalled();
    const rpcNames = rpc.mock.calls.map((c) => c[0]);
    expect(
      rpcNames.every((n) =>
        ['owner_qa_fixture_reset_preview', 'owner_qa_fixture_reset'].includes(
          String(n),
        ),
      ),
    ).toBe(true);
  });

  it('zero preview disables the destructive action and shows the reset state', async () => {
    previewQueue = [{ ...emptyPayload }];
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('owner-qa-reset-empty')).toHaveTextContent(
        'QA test data is already reset.',
      ),
    );
    expect(screen.getByTestId('owner-qa-reset-button')).toBeDisabled();
  });

  it('never hardcodes fixture root or O10/O11 row UUIDs in the frontend', () => {
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    expect(uuid.test(pageSource)).toBe(false);
    expect(uuid.test(hookSource)).toBe(false);
  });

  it('exposes no control that deletes or revokes qa_fixture_roots', () => {
    expect(pageSource).not.toMatch(/qa_fixture_roots/);
    expect(hookSource).not.toMatch(/qa_fixture_roots/);
  });

  it('the hook calls only the two O13 RPCs and no Stripe/Telegram surface', () => {
    expect(hookSource).toContain('owner_qa_fixture_reset_preview');
    expect(hookSource).toContain('owner_qa_fixture_reset');
    expect(hookSource).not.toMatch(/functions\.invoke|create-checkout|stripe\.|telegram-/i);
    expect(hookSource).not.toMatch(/\.rpc\((?!\s*'owner_qa_fixture_reset)/);
  });

  it('the candidate migration keeps both RPCs owner-gated and fail-closed', () => {
    expect(migrationSource).toContain('public.is_super_admin(v_caller)');
    expect(migrationSource).toContain(
      'REVOKE ALL ON FUNCTION public.owner_qa_fixture_reset() FROM anon;',
    );
    expect(migrationSource).toContain(
      'REVOKE ALL ON FUNCTION public.owner_qa_fixture_reset_preview() FROM PUBLIC;',
    );
    expect(migrationSource).not.toMatch(/session_replication_role|DISABLE TRIGGER/i);
    expect(migrationSource).not.toMatch(/DELETE FROM public\.qa_fixture_roots/i);
  });
});
