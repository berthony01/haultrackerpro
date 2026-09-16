/**
 * Phase CF-1B — web conversation MVP UI contract.
 *
 * Rendered coverage of the driver dialog, recruiter inbox, staff gating, and
 * the additive OpportunityDetail entry point, plus static scope guards proving
 * CF-1B introduces no direct table writes, no admin authority, no PII lookup,
 * and no Telegram / Stripe / application / migration coupling.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

beforeAll(() => {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => {};
  proto.setPointerCapture = () => {};
  proto.scrollIntoView = () => {};
});

/* ------------------------------ source files ------------------------------ */

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** Executable source only — documentation comments are not behavior. */
const readCode = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');

const HOOK_PATH = 'src/hooks/conversations/useConversations.ts';
const DIALOG_PATH = 'src/components/conversations/DriverConversationDialog.tsx';
const INBOX_PATH = 'src/components/conversations/RecruiterConversationInbox.tsx';
const DETAIL_PATH = 'src/components/opportunities/OpportunityDetail.tsx';
const ACCESS_PAGE_PATH = 'src/components/opportunities/recruiter/RecruiterAccessPage.tsx';
const ACCESS_ROUTE_PATH = 'src/components/opportunities/recruiter/RecruiterAccessRoute.tsx';

const CF1B_FILES = [HOOK_PATH, DIALOG_PATH, INBOX_PATH];

/* -------------------------------- mocks ---------------------------------- */

type Result = { data: unknown; error: unknown };

const tableResults: Record<string, Result> = {};
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
const rpcMock = vi.fn(async (fn: string, args: Record<string, unknown>) => {
  rpcCalls.push({ fn, args });
  return { data: 'ok', error: null } as Result;
});

function builder(table: string) {
  const result = () => tableResults[table] ?? { data: [], error: null };
  const chain: Record<string, unknown> = {};
  for (const key of ['select', 'eq', 'in', 'order', 'limit', 'neq']) {
    chain[key] = () => chain;
  }
  (chain as { then: unknown }).then = (
    onFulfilled: (r: Result) => unknown,
  ) => Promise.resolve(result()).then(onFulfilled);
  return chain;
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => builder(table),
    rpc: (fn: string, args: Record<string, unknown>) => rpcMock(fn, args),
  },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'driver-1' }, session: null, loading: false }),
}));

const permissionsRef: { current: Record<string, boolean> } = { current: {} };
vi.mock('@/hooks/recruiter/useRecruiterStaffPermissions', () => ({
  useRecruiterStaffPermissions: () => ({
    permissions: permissionsRef.current,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    canViewOpportunities: false,
    canCreateOpportunities: false,
    canEditOpportunities: false,
    canChangeOpportunityStatus: false,
    canDeleteOpportunities: false,
    canViewApplications: false,
    canManageApplicationStatus: false,
    canRequestApplicationContact: false,
    canManageApplicationNotes: false,
    canViewReferrals: false,
    canManageReferralStatus: false,
    canManageReferralTerms: false,
    canViewContracts: false,
    canManageContracts: false,
    canViewReports: false,
    canExportReports: false,
    canViewSettlements: false,
    canPrepareSettlements: false,
    canFinalizeSettlements: false,
    canViewTeam: false,
    canManageTeam: false,
    canViewLoads: false,
    canDispatchLoads: false,
    canUpdateLoadStatus: false,
    canViewConversations: permissionsRef.current.conversations_view === true,
    canReplyConversations:
      permissionsRef.current.conversations_view === true &&
      permissionsRef.current.conversations_reply === true,
  }),
}));

// OpportunityDetail collaborators — unchanged behavior, stubbed for isolation.
vi.mock('@/hooks/opportunities/useOpportunityApplications', () => ({
  useOpportunityApplications: () => ({
    driverApplications: [] as unknown[],
    submitApplication: { mutateAsync: vi.fn(), isPending: false },
    createApplication: { mutate: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/hooks/opportunities/useSavedOpportunities', () => ({
  useSavedOpportunities: () => ({ saved: [], save: { mutate: vi.fn() }, unsave: { mutate: vi.fn() } }),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));
vi.mock('@/components/opportunities/ReferDriverDialog', () => ({ ReferDriverDialog: () => null }));
const applyDialogOpenRef = { current: false };
vi.mock('@/components/opportunities/ApplyNowDialog', () => ({
  ApplyNowDialog: ({ open }: { open: boolean }) => {
    applyDialogOpenRef.current = open;
    return open ? <div data-testid="apply-dialog-open" /> : null;
  },
}));

import { DriverConversationDialog } from '@/components/conversations/DriverConversationDialog';
import { RecruiterConversationInbox } from '@/components/conversations/RecruiterConversationInbox';
import { OpportunityDetail } from '@/components/opportunities/OpportunityDetail';
import { RecruiterAccessRoute } from '@/components/opportunities/recruiter/RecruiterAccessRoute';
import type { Opportunity } from '@/hooks/opportunities/useOpportunities';

function makeOpportunity(): Opportunity {
  return {
    actual_benefits: null,
    admin_review_status: 'approved',
    benefits: null,
    canonical_version: null,
    company_name: 'Acme Trucking',
    cpm: null,
    created_at: '2026-09-01T00:00:00Z',
    deadhead_paid: null,
    description: null,
    detention_pay: null,
    driver_type: null,
    employment_model: null,
    equipment_year: null,
    escrow_amount: null,
    escrow_amount_frequency: null,
    escrow_required: false,
    escrow_required_state: null,
    estimated_deadhead_miles: null,
    estimated_loaded_miles: null,
    estimated_weekly_gross: null,
    estimated_weekly_miles: null,
    featured: false,
    flat_weekly_pay: null,
    forced_dispatch: null,
    fuel_paid_by: null,
    hiring_city: null,
    hiring_state: null,
    hiring_states: [],
    home_time: null,
    id: '00000000-0000-0000-0000-0000000000f1',
    insurance_deduction_frequency: null,
    insurance_deductions: null,
    layover_pay: null,
    lease_payment: null,
    lease_payment_frequency: null,
    maintenance_deduction_frequency: null,
    maintenance_deductions: null,
    mixed_pay_components: [],
    other_deduction_frequency: null,
    other_deductions: null,
    other_pay_method_label: null,
    other_weekly_gross: null,
    pay_model: null,
    percentage_basis_label: null,
    percentage_pay: null,
    percentage_weekly_revenue_basis: null,
    pets_allowed: null,
    published_at: null,
    recruiter_id: '00000000-0000-0000-0000-0000000000aa',
    requirements: null,
    riders_allowed: null,
    route_type: null,
    salary_amount: null,
    salary_frequency: null,
    sign_on_bonus: null,
    status: 'active',
    team_configuration: null,
    title: 'Regional Dry Van',
    trailer_type: null,
    transparency_confirmed: false,
    typical_lanes: null,
    updated_at: '2026-09-01T00:00:00Z',
    view_count: 0,
  } as unknown as Opportunity;
}

function thread(overrides: Record<string, unknown> = {}) {
  return {
    id: 'thread-1',
    driver_user_id: 'driver-1',
    recruiter_id: 'rec-1',
    opportunity_id: '00000000-0000-0000-0000-0000000000f1',
    status: 'requested',
    initiated_by_user_id: 'driver-1',
    accepted_at: null,
    declined_at: null,
    closed_at: null,
    closed_by_user_id: null,
    created_at: '2026-09-15T00:00:00Z',
    updated_at: '2026-09-15T00:00:00Z',
    ...overrides,
  };
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    thread_id: 'thread-1',
    sender_user_id: 'driver-1',
    sender_actor_type: 'driver',
    source: 'web',
    message_type: 'text',
    body: 'Hello from the driver',
    client_message_id: 'c-1',
    created_at: '2026-09-15T00:01:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  rpcCalls.length = 0;
  rpcMock.mockClear();
  for (const k of Object.keys(tableResults)) delete tableResults[k];
  permissionsRef.current = {};
  applyDialogOpenRef.current = false;
});

/* ------------------------ 1. OpportunityDetail entry ---------------------- */

describe('CF-1B / OpportunityDetail', () => {
  it('1a retains Apply Now and gains Talk to Recruiter', () => {
    render(
      <OpportunityDetail
        opportunity={makeOpportunity()}
        onBack={() => {}}
        isPro={false}
        onUpgrade={() => {}}
        driverProfile={null}
        onOpenPreferencesForApply={() => {}}
      />,
    );
    expect(screen.getByTestId('opportunity-talk-to-recruiter')).toBeTruthy();
    // Apply path remains wired and functional (label varies by profile state).
    const apply = screen.getByRole('button', { name: /Apply|Preferences to Apply/i });
    expect((apply as HTMLButtonElement).disabled).toBe(false);
  });

  it('1b Apply Now still opens the existing apply dialog (unchanged path)', async () => {
    const user = userEvent.setup();
    render(
      <OpportunityDetail
        opportunity={makeOpportunity()}
        onBack={() => {}}
        isPro={false}
        onUpgrade={() => {}}
        driverProfile={null}
        onOpenPreferencesForApply={() => {}}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Apply|Preferences to Apply/i }));
    expect(await screen.findByTestId('apply-dialog-open')).toBeTruthy();
  });

  it('1c the conversation dialog mounts only from the Talk to Recruiter action', async () => {
    const user = userEvent.setup();
    render(
      <OpportunityDetail
        opportunity={makeOpportunity()}
        onBack={() => {}}
        isPro={false}
        onUpgrade={() => {}}
        driverProfile={null}
        onOpenPreferencesForApply={() => {}}
      />,
    );
    expect(screen.queryByTestId('driver-conversation-dialog')).toBeNull();
    await user.click(screen.getByTestId('opportunity-talk-to-recruiter'));
    expect(await screen.findByTestId('driver-conversation-dialog')).toBeTruthy();
  });
});

/* --------------------------- 2. Driver dialog ----------------------------- */

describe('CF-1B / DriverConversationDialog', () => {
  it('2a start path calls start_opportunity_conversation with a client message id', async () => {
    const user = userEvent.setup();
    tableResults.conversation_threads = { data: [], error: null };
    render(
      <DriverConversationDialog
        open
        onOpenChange={() => {}}
        opportunityId="00000000-0000-0000-0000-0000000000f1"
        opportunityTitle="Regional Dry Van"
        companyName="Acme Trucking"
      />,
    );
    const start = await screen.findByRole('button', { name: /Start Conversation/i });
    await user.click(start);
    await waitFor(() => expect(rpcCalls.length).toBeGreaterThan(0));
    expect(rpcCalls[0].fn).toBe('start_opportunity_conversation');
    expect(rpcCalls[0].args._opportunity_id).toBe('00000000-0000-0000-0000-0000000000f1');
    expect(typeof rpcCalls[0].args._client_message_id).toBe('string');
    expect(String(rpcCalls[0].args._initial_message).length).toBeGreaterThan(0);
    // Never a client-supplied identity.
    expect(Object.keys(rpcCalls[0].args)).not.toContain('_driver_user_id');
    expect(Object.keys(rpcCalls[0].args)).not.toContain('_recruiter_id');
  });

  it('2b subsequent message uses conversation_post_message', async () => {
    const user = userEvent.setup();
    tableResults.conversation_threads = { data: [thread({ status: 'active' })], error: null };
    tableResults.conversation_messages = { data: [message()], error: null };
    render(
      <DriverConversationDialog
        open
        onOpenChange={() => {}}
        opportunityId="00000000-0000-0000-0000-0000000000f1"
        opportunityTitle="Regional Dry Van"
      />,
    );
    const box = await screen.findByLabelText(/Message the recruiter/i);
    await user.type(box, 'Following up');
    await user.click(screen.getByRole('button', { name: /^Send$/i }));
    await waitFor(() => expect(rpcCalls.length).toBeGreaterThan(0));
    expect(rpcCalls[0].fn).toBe('conversation_post_message');
    expect(rpcCalls[0].args._thread_id).toBe('thread-1');
  });

  it('2c requested status shows Waiting for recruiter and attributes actors server-side', async () => {
    tableResults.conversation_threads = { data: [thread()], error: null };
    tableResults.conversation_messages = { data: [message()], error: null };
    render(
      <DriverConversationDialog
        open
        onOpenChange={() => {}}
        opportunityId="00000000-0000-0000-0000-0000000000f1"
        opportunityTitle="Regional Dry Van"
      />,
    );
    expect(await screen.findByTestId('conversation-status')).toHaveTextContent(
      'Waiting for recruiter',
    );
    const row = (await screen.findAllByTestId('conversation-message'))[0];
    expect(row.getAttribute('data-actor')).toBe('driver');
    expect(within(row).getByText('You')).toBeTruthy();
  });

  it('2d no direct insert/update/delete/upsert on conversation tables anywhere in CF-1B', () => {
    for (const path of CF1B_FILES) {
      const src = read(path);
      expect(src).not.toMatch(/\.insert\(/);
      expect(src).not.toMatch(/\.update\(/);
      expect(src).not.toMatch(/\.delete\(/);
      expect(src).not.toMatch(/\.upsert\(/);
    }
    const hook = read(HOOK_PATH);
    for (const fn of [
      'start_opportunity_conversation',
      'accept_conversation_thread',
      'decline_conversation_thread',
      'conversation_post_message',
      'close_conversation_thread',
    ]) {
      expect(hook).toContain(fn);
    }
  });
});

/* -------------------------- 3/4. Recruiter inbox -------------------------- */

describe('CF-1B / RecruiterConversationInbox', () => {
  it('3a requested thread exposes Accept/Decline but no composer', async () => {
    const user = userEvent.setup();
    tableResults.conversation_threads = { data: [thread()], error: null };
    tableResults.conversation_messages = { data: [message()], error: null };
    tableResults.opportunities = { data: [], error: null };
    render(<RecruiterConversationInbox recruiterId="rec-1" canView canReply />);
    await user.click(await screen.findByTestId('conversation-thread-item'));
    expect(await screen.findByTestId('conversation-accept')).toBeTruthy();
    expect(screen.getByTestId('conversation-decline')).toBeTruthy();
    expect(screen.queryByTestId('conversation-composer')).toBeNull();
    expect(screen.queryByTestId('conversation-send')).toBeNull();
  });

  it('3b accepted thread exposes composer and close through RPCs only', async () => {
    const user = userEvent.setup();
    tableResults.conversation_threads = { data: [thread({ status: 'active' })], error: null };
    tableResults.conversation_messages = { data: [message()], error: null };
    render(<RecruiterConversationInbox recruiterId="rec-1" canView canReply />);
    await user.click(await screen.findByTestId('conversation-thread-item'));
    await user.type(await screen.findByLabelText(/Reply to driver/i), 'Thanks for reaching out');
    await user.click(screen.getByTestId('conversation-send'));
    await waitFor(() => expect(rpcCalls.length).toBeGreaterThan(0));
    expect(rpcCalls[0].fn).toBe('conversation_post_message');
  });

  it('4a view-only recruiter reads messages but gets no mutation controls', async () => {
    const user = userEvent.setup();
    tableResults.conversation_threads = { data: [thread({ status: 'active' })], error: null };
    tableResults.conversation_messages = { data: [message()], error: null };
    render(<RecruiterConversationInbox recruiterId="rec-1" canView canReply={false} />);
    await user.click(await screen.findByTestId('conversation-thread-item'));
    expect(await screen.findByText('Hello from the driver')).toBeTruthy();
    expect(screen.getByTestId('conversation-view-only')).toBeTruthy();
    expect(screen.queryByTestId('conversation-accept')).toBeNull();
    expect(screen.queryByTestId('conversation-decline')).toBeNull();
    expect(screen.queryByTestId('conversation-composer')).toBeNull();
    expect(screen.queryByTestId('conversation-close')).toBeNull();
  });

  it('4b canView false renders no thread content at all', () => {
    tableResults.conversation_threads = { data: [thread()], error: null };
    render(<RecruiterConversationInbox recruiterId="rec-1" canView={false} canReply />);
    expect(screen.getByTestId('recruiter-conversation-inbox-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('conversation-thread-list')).toBeNull();
  });

  it('4c peer identity is neutral — no driver name/PII rendering', async () => {
    const user = userEvent.setup();
    tableResults.conversation_threads = { data: [thread({ status: 'active' })], error: null };
    tableResults.conversation_messages = { data: [message()], error: null };
    render(<RecruiterConversationInbox recruiterId="rec-1" canView canReply />);
    const item = await screen.findByTestId('conversation-thread-item');
    expect(within(item).getByText('Driver')).toBeTruthy();
    expect(item.textContent).not.toContain('driver-1');
    await user.click(item);
  });
});

/* ----------------------------- 5. Staff gating ---------------------------- */

describe('CF-1B / staff gating', () => {
  const workspace = {
    recruiterId: 'rec-1',
    recruiterName: 'Acme Recruiting',
    companyName: 'Acme Trucking',
    memberRole: 'recruiter_staff' as const,
  };

  function renderStaff() {
    return render(
      <MemoryRouter>
        <RecruiterAccessRoute
          onBack={() => {}}
          recruiterHubAllowed
          recruiterAccessKind="staff"
          recruiterCapabilityStatus={null}
          selectedStaffWorkspace={workspace as never}
        />
      </MemoryRouter>,
    );
  }

  it('5a conversations_reply alone never opens the inbox entry point', () => {
    permissionsRef.current = { conversations_reply: true };
    renderStaff();
    expect(screen.queryByTestId('staff-open-conversations')).toBeNull();
  });

  it('5b conversations_view exposes the entry point', () => {
    permissionsRef.current = { conversations_view: true };
    renderStaff();
    expect(screen.getByTestId('staff-open-conversations')).toBeTruthy();
  });

  it('5c view-only staff opens a read-only inbox', async () => {
    const user = userEvent.setup();
    permissionsRef.current = { conversations_view: true };
    tableResults.conversation_threads = { data: [thread({ status: 'active' })], error: null };
    renderStaff();
    await user.click(screen.getByTestId('staff-open-conversations'));
    expect(await screen.findByTestId('recruiter-conversation-inbox')).toBeTruthy();
    expect(screen.getByTestId('conversation-view-only')).toBeTruthy();
  });

  it('5d staff route gates the inbox on canViewConversations only', () => {
    const src = read(ACCESS_ROUTE_PATH);
    expect(src).toContain(
      'const canOpenConversations =\n    !perms.isLoading && !perms.error && perms.canViewConversations;',
    );
    expect(src).toContain('canView={perms.canViewConversations}');
    expect(src).toContain('canReply={perms.canReplyConversations}');
  });
});

/* ------------------------ 6-9. Static scope guards ------------------------ */

describe('CF-1B / scope guards', () => {
  it('6 admin status is never used as client mutation authority', () => {
    for (const path of CF1B_FILES) {
      const src = read(path);
      expect(src).not.toMatch(/is_admin/);
      expect(src).not.toMatch(/useAdmin\b/);
      expect(src).not.toMatch(/isAdmin/);
      expect(src).not.toMatch(/super_admin/);
      expect(src).not.toMatch(/admin_users/);
    }
  });

  it('7 no profile / auth user / driver profile PII lookup is introduced', () => {
    for (const path of CF1B_FILES) {
      const src = read(path);
      expect(src).not.toMatch(/driver_opportunity_profiles/);
      expect(src).not.toMatch(/from\('profiles'\)/);
      expect(src).not.toMatch(/auth\.users/);
      expect(src).not.toMatch(/auth\.admin/);
      expect(src).not.toMatch(/recruiter_contact_requests/);
    }
    // Reads are limited to conversation tables plus opportunity title context.
    const hook = read(HOOK_PATH);
    const tables = Array.from(hook.matchAll(/\.from\('([a-z_]+)'\)/g)).map((m) => m[1]);
    expect(new Set(tables)).toEqual(
      new Set(['conversation_threads', 'conversation_messages', 'opportunities']),
    );
  });

  it('8 existing Apply path remains wired in OpportunityDetail', () => {
    const src = read(DETAIL_PATH);
    expect(src).toContain('<ApplyNowDialog');
    expect(src).toContain('setShowApply(true)');
    expect(src).toContain("import { ApplyNowDialog } from './ApplyNowDialog';");
    expect(src).toContain('data-testid="opportunity-talk-to-recruiter"');
  });

  it('9 no Telegram, Stripe, billing, application mutation, or migration code in CF-1B files', () => {
    for (const path of CF1B_FILES) {
      const src = read(path);
      for (const forbidden of [
        'telegram',
        'stripe',
        'checkout',
        'subscription',
        'entitlement',
        'opportunity_applications',
        'application_events',
        'CREATE TABLE',
        'ALTER TABLE',
        'contract',
        'settlement',
        'referral',
      ]) {
        expect(src.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    }
  });

  it('9b owner command center mounts the shared inbox on demand only', () => {
    const src = read(ACCESS_PAGE_PATH);
    expect(src).toContain('const [conversationsOpen, setConversationsOpen] = useState(false);');
    expect(src).toContain('{conversationsOpen && profile?.id && (');
    expect(src).toContain('<RecruiterConversationInbox');
    expect(src).toContain('recruiterId={profile.id}');
    expect(src).toContain('title="Conversation Inbox"');
  });

  it('9c polling timers are cleared and the cadence stays modest', () => {
    const hook = read(HOOK_PATH);
    expect(hook).toContain('CONVERSATION_POLL_MS = 5000');
    expect(hook).toContain('clearInterval(id)');
  });
});
