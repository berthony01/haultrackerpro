import React from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, renderHook, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
const fixture = vi.hoisted(() => ({
  user: '11111111-1111-1111-1111-111111111111', sessionUser: '11111111-1111-1111-1111-111111111111', driver: true, recruiter: false, acting: false, loading: false, error: null as unknown, workspace: 'driver',
  rpc: vi.fn(), callbacks: new Set<(event: string, session: unknown) => void>(), profile: null as unknown,
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: fixture.user ? {
      id: fixture.user
    } : null, session: fixture.sessionUser ? {
      user: {
        id: fixture.sessionUser
      }, access_token: 'synthetic-immediate-token'
    } : null, loading: false
  })
}));
vi.mock('@/hooks/useViewMode', () => ({
  useViewMode: () => ({
    driverWorkspaceAllowed: fixture.driver, driverCapabilityStatus: fixture.driver ? 'active' : 'revoked', recruiterCapabilityStatus: fixture.recruiter ? 'active' : null, recruiterOperationsAllowed: fixture.recruiter, recruiterAccessKind: fixture.recruiter ? 'capability' : null, effectiveRole: fixture.workspace, isLoading: fixture.loading, error: fixture.error
  })
}));
vi.mock('@/hooks/useActingContext', () => ({
  useActingContext: () => ({
    isActingAsAssistant: fixture.acting, isLoadingManagedDrivers: false
  })
}));
vi.mock('@/hooks/opportunities/useRecruiterProfile', () => ({
  useRecruiterProfile: () => ({
    profile: fixture.profile, isLoading: false
  })
}));
vi.mock('@/hooks/opportunities/useDriverOpportunityProfile', () => ({
  useDriverOpportunityProfile: () => ({
    profile: {
      state: 'TX', cdl_class: 'A', years_experience: 5, preferred_route_type: 'Regional', preferred_home_time: 'Weekly', trailer_experience: [
        'Reefer'
      ], min_weekly_gross: 2000, city: 'Houston'
    }, isLoading: false, isError: false
  })
}));
vi.mock('@/components/home/HomeOpportunityPreview', () => ({
  default: () => null
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (name: string, args: unknown) => ({
      setHeader: () => fixture.rpc(name, args)
    }), auth: {
      onAuthStateChange: (callback: (e: string, s: unknown) => void) => {
        fixture.callbacks.add(callback);
        return {
          data: {
            subscription: {
              unsubscribe: () => fixture.callbacks.delete(callback)
            }
          }
        };
      }
    }
  }
}));
import FindWork from '@/pages/FindWork';
import DriverJobSearchCard, { DriverJobSearchCardView } from '@/components/jobSearch/DriverJobSearchCard';
import RecruiterJobSearchCards from '@/components/jobSearch/RecruiterJobSearchCards';
import HomeConversationFlow from '@/components/home/HomeConversationFlow';
import { useCardScope, useJobSearchCard } from '@/hooks/jobSearch/useJobSearchCard';
import { clearJobSearchCardHandoff, setJobSearchCardHandoff } from '@/lib/jobSearch/jobSearchCardHandoff';
import { clearPendingProfileAnswers, consumePendingProfileAnswers } from '@/lib/home/pendingProfileHandoff';
const id = '22222222-2222-2222-2222-222222222222';
const payload = {
  state: 'TX', cdl_class: 'A', years_experience: 5, experience_qualifier: 'at_least', preferred_route_type: 'Regional', preferred_home_time: 'Weekly'
};
const own = {
  id, revision: 1, status: 'published', audience: 'approved_recruiters', consent_version: 'job_search_card_v1', payload, published_at: '2026-10-24T00:00:00Z', expires_at: '2099-11-07T00:00:00Z', created_at: '2026-10-24T00:00:00Z', updated_at: '2026-10-24T00:00:00Z'
};
const response = (data: unknown) => Promise.resolve({
  data, error: null
});
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {
    }
    unobserve() {
    }
    disconnect() {
    }
  });
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  fixture.user = '11111111-1111-1111-1111-111111111111';
  fixture.sessionUser = fixture.user;
  fixture.driver = true;
  fixture.recruiter = false;
  fixture.acting = false;
  fixture.loading = false;
  fixture.error = null;
  fixture.workspace = 'driver';
  fixture.profile = null;
  fixture.rpc.mockReset();
  fixture.rpc.mockImplementation(() => response(null));
  clearJobSearchCardHandoff();
  clearPendingProfileAnswers();
});
afterEach(() => {
  cleanup();
  clearJobSearchCardHandoff();
});
function Location() {
  const l = useLocation();
  return <output aria-label="Current path">
    {l.pathname}
    {l.search}
  </output>;
}
function route(path = '/find-work') {
  return render(<MemoryRouter initialEntries={[
    path
  ]}>
    <FindWork />
    <Location />
  </MemoryRouter>);
}
async function choose(label: string, value: string) {
  const u = userEvent.setup();
  await u.click(screen.getByRole('combobox', {
    name: label
  }));
  await u.click(screen.getByRole('option', {
    name: new RegExp(`^${value}$`)
  }));
}
async function reviewSeed() {
  await screen.findByText('No published card');
  await choose('Experience qualifier', 'At least');
  fireEvent.click(screen.getByRole('button', {
    name: 'Review exact card'
  }));
  await screen.findByRole('heading', {
    name: 'Review before sharing'
  });
}
it('actual chat task route uses owner-bound memory, explicit qualifier, separate consent and current returned status', async () => {
  fixture.rpc.mockImplementation((_name, args) => args._action === 'get' ? response(null) : response(own));
  route();
  fireEvent.click(screen.getByRole('button', {
    name: 'Looks right'
  }));
  fireEvent.click(screen.getByRole('button', {
    name: 'Review my job-search card'
  }));
  expect(screen.getByLabelText('Current path')).toHaveTextContent('/find-work?task=job-search-card');
  await screen.findByText('No published card');
  expect(screen.getByRole('combobox', {
    name: 'Experience qualifier'
  })).toHaveTextContent('Choose');
  expect(screen.getByRole('checkbox', {
    name: 'Include weekly gross goal'
  })).not.toBeChecked();
  await reviewSeed();
  expect(screen.getByRole('heading', {
    name: 'Review before sharing'
  })).toHaveFocus();
  expect(screen.getByRole('button', {
    name: 'Make me available to approved recruiters'
  })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', {
    name: /I choose to share/
  }));
  fireEvent.click(screen.getByRole('button', {
    name: 'Make me available to approved recruiters'
  }));
  await screen.findByText('published', {
    selector: 'strong'
  });
  const args = fixture.rpc.mock.calls.find(([, a]) => a._action === 'publish')?.[1];
  expect(args._payload).not.toHaveProperty('city');
  expect(args._payload).not.toHaveProperty('min_weekly_gross');
  expect(args._payload.experience_qualifier).toBe('at_least');
  expect(args._client_command_id).toMatch(/^[a-f0-9-]{36}$/);
});
it('original profile CTA still performs only the existing one-shot handoff', () => {
  route();
  fireEvent.click(screen.getByRole('button', {
    name: 'Looks right'
  }));
  fireEvent.click(screen.getByRole('button', {
    name: 'Review/update my work profile'
  }));
  expect(consumePendingProfileAnswers()?.city).toBe('Houston');
  expect(consumePendingProfileAnswers()).toBeNull();
  expect(fixture.rpc).not.toHaveBeenCalled();
});
it('public flow without optional callback has no card CTA', () => {
  render(<HomeConversationFlow onContinue={vi.fn()} amber="" surface="" border="" textMuted="" textDim="" />);
  expect(screen.queryByRole('button', {
    name: 'Review my job-search card'
  })).toBeNull();
});
it('missing service disables writes and never fakes a card', async () => {
  fixture.rpc.mockResolvedValue({
    data: null, error: {
      code: 'PGRST202', message: 'SQL secret'
    }
  });
  route('/find-work?task=job-search-card');
  await screen.findByText('Job-search cards are not available right now.');
  expect(screen.getByRole('button', {
    name: 'Create card'
  })).toBeDisabled();
  expect(screen.queryByText('SQL secret')).toBeNull();
});
it('revoked Driver can read and deliberately withdraw own existing card', async () => {
  fixture.driver = false;
  fixture.rpc.mockImplementation((_n, a) => response(a._action === 'withdraw' ? {
    ...own, status: 'withdrawn', revision: 2
  } : own));
  route('/find-work?task=job-search-card');
  await screen.findByText('published', {
    selector: 'strong'
  });
  expect(screen.getByRole('button', {
    name: 'Edit / review renewal'
  })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', {
    name: 'Withdraw'
  }));
  await screen.findByText('withdrawn', {
    selector: 'strong'
  });
});
for (const change of [
  'acting', 'session_mismatch', 'signed_out'
])
  it(`${change} fails closed before card read`, () => {
    if (change === 'acting')
      fixture.acting = true;
    else if (change === 'loading')
      fixture.loading = true;
    else if (change === 'error')
      fixture.error = new Error();
    else if (change === 'session_mismatch')
      fixture.sessionUser = id;
    else
      fixture.user = '';
    route('/find-work?task=job-search-card');
    expect(screen.queryByRole('heading', {
      name: 'My job-search card'
    })).toBeNull();
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
it('timeout retains exact command and payload; get-null does not imply private; replay renders withdrawn', async () => {
  setJobSearchCardHandoff(fixture.user, payload);
  let published = 0;
  fixture.rpc.mockImplementation((_n, a) => {
    if (a._action === 'get')
      return response(null);
    published++;
    return published === 1 ? Promise.reject(new Error('synthetic timeout')) : response({
      ...own, status: 'withdrawn', revision: 2
    });
  });
  route('/find-work?task=job-search-card');
  await reviewSeed();
  fireEvent.click(screen.getByRole('checkbox', {
    name: /I choose/
  }));
  fireEvent.click(screen.getByRole('button', {
    name: 'Make me available to approved recruiters'
  }));
  await screen.findByText('Outcome not confirmed');
  fireEvent.click(screen.getByRole('button', {
    name: 'Refresh status'
  }));
  await waitFor(() => expect(screen.getByRole('button', {
    name: 'Retry same request'
  })).not.toBeDisabled());
  expect(screen.queryByText('No published card')).toBeNull();
  fireEvent.click(screen.getByRole('button', {
    name: 'Retry same request'
  }));
  await screen.findByText('withdrawn', {
    selector: 'strong'
  });
  const writes = fixture.rpc.mock.calls.filter(([, a]) => a._action === 'publish');
  expect(writes).toHaveLength(2);
  expect(writes[0][1]).toEqual(writes[1][1]);
});
for (const code of [
  '40001', '22023'
])
  it(`${code} refetches without auto-write and retains dirty draft`, async () => {
    fixture.rpc.mockImplementation((_n, a) => a._action === 'get' ? response(own) : Promise.resolve({
      data: null, error: {
        code, message: code === '22023' ? 'No card' : 'stale'
      }
    }));
    route('/find-work?task=job-search-card');
    await screen.findByText('published', {
      selector: 'strong'
    });
    fireEvent.click(screen.getByRole('button', {
      name: 'Edit / review renewal'
    }));
    fireEvent.change(screen.getByLabelText('Years of experience'), {
      target: {
        value: '7'
      }
    });
    fireEvent.click(screen.getByRole('button', {
      name: 'Withdraw'
    }));
    await waitFor(() => expect(fixture.rpc.mock.calls.filter(([, a]) => a._action === 'get')).toHaveLength(2));
    expect(screen.getByLabelText('Years of experience')).toHaveValue(7);
    expect(fixture.rpc.mock.calls.filter(([, a]) => a._action === 'withdraw')).toHaveLength(1);
  });
it('editing invalidates review and consent; optional gross must be explicitly included', async () => {
  setJobSearchCardHandoff(fixture.user, payload);
  route('/find-work?task=job-search-card');
  await reviewSeed();
  fireEvent.click(screen.getByRole('checkbox', {
    name: /I choose/
  }));
  fireEvent.change(screen.getByLabelText('Years of experience'), {
    target: {
      value: '6'
    }
  });
  expect(screen.queryByRole('heading', {
    name: 'Review before sharing'
  })).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', {
    name: 'Include weekly gross goal'
  }));
  fireEvent.change(screen.getByLabelText('Weekly gross goal'), {
    target: {
      value: '1900'
    }
  });
  fireEvent.click(screen.getByRole('button', {
    name: 'Review exact card'
  }));
  expect(screen.getByRole('checkbox', {
    name: /I choose/
  })).not.toBeChecked();
  expect(screen.getByText('$1,900')).toBeInTheDocument();
});
it('newer snapshot invalidates review while preserving dirty draft', async () => {
  setJobSearchCardHandoff(fixture.user, payload);
  let gets = 0;
  fixture.rpc.mockImplementation(() => response(++gets === 1 ? null : {
    ...own, revision: 2
  }));
  route('/find-work?task=job-search-card');
  await reviewSeed();
  fireEvent.click(screen.getByRole('button', {
    name: 'Refresh status'
  }));
  await screen.findByText('published', {
    selector: 'strong'
  });
  expect(screen.queryByRole('heading', {
    name: 'Review before sharing'
  })).toBeNull();
  expect(screen.getByLabelText('Years of experience')).toHaveValue(5);
});
for (const change of [
  'account', 'revocation', 'acting', 'workspace'
])
  it(`delayed old read hidden after ${change}`, async () => {
    let release: ((v: unknown) => void) | undefined;
    fixture.rpc.mockImplementationOnce(() => new Promise(r => {
      release = r;
    }));
    fixture.rpc.mockImplementation(() => response(null));
    const tree = render(<DriverJobSearchCard />);
    await waitFor(() => expect(fixture.rpc).toHaveBeenCalledOnce());
    if (change === 'account') {
      fixture.user = id;
      fixture.sessionUser = id;
    }
    else if (change === 'revocation')
      fixture.driver = false;
    else if (change === 'acting')
      fixture.acting = true;
    else
      fixture.workspace = 'recruiter';
    tree.rerender(<DriverJobSearchCard />);
    await act(async () => {
      release?.({
        data: own, error: null
      });
    });
    if (change === 'revocation' || change === 'workspace')
      expect(screen.getByText('published', {
        selector: 'strong'
      })).toBeInTheDocument();
    else
      expect(screen.queryByText('published', {
        selector: 'strong'
      })).toBeNull();
  });
it('hook discards old mutation result on identity loss and no new-account write is initiated', async () => {
  let release: ((v: unknown) => void) | undefined;
  fixture.rpc.mockImplementation((_n, a) => a._action === 'get' ? response(null) : new Promise(r => {
    release = r;
  }));
  const hook = renderHook(() => {
    const scope = useCardScope();
    return useJobSearchCard(scope);
  });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  let pending: Promise<boolean> | undefined;
  act(() => {
    pending = hook.result.current.submit({
      action: 'publish', revision: 0, commandId: id, payload: payload as never
    });
  });
  fixture.user = '';
  fixture.sessionUser = '';
  hook.rerender();
  await act(async () => {
    release?.({
      data: own, error: null
    });
    await pending;
  });
  expect(hook.result.current.card).toBeNull();
  expect(fixture.rpc.mock.calls.filter(([, a]) => a._action === 'publish')).toHaveLength(1);
});
it('approved canonical recruiter owner fetches only on demand and shows eligible empty', async () => {
  fixture.recruiter = true;
  fixture.workspace = 'recruiter';
  fixture.profile = {
    id, user_id: fixture.user, status: 'active', verification_status: 'approved'
  };
  fixture.rpc.mockResolvedValue({
    data: [], error: null
  });
  render(<RecruiterJobSearchCards recruiterId={id} />);
  expect(fixture.rpc).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', {
    name: 'Find available drivers'
  }));
  await screen.findByText('No eligible available-driver cards on this page.');
  expect(fixture.rpc.mock.calls[0][1]._recruiter_id).toBe(id);
});
for (const reason of [
  'staff', 'foreign', 'pending', 'acting'
])
  it(`recruiter ${reason} has no discovery read`, () => {
    fixture.recruiter = reason !== 'staff';
    fixture.acting = reason === 'acting';
    fixture.profile = {
      id, user_id: reason === 'foreign' ? 'foreign' : fixture.user, status: 'active', verification_status: reason === 'pending' ? 'pending' : 'approved'
    };
    render(<RecruiterJobSearchCards recruiterId={id} />);
    expect(fixture.rpc).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', {
      name: 'Find available drivers'
    })).toBeNull();
  });
it('malformed/leaking recruiter response never renders', async () => {
  fixture.recruiter = true;
  fixture.profile = {
    id, user_id: fixture.user, status: 'active', verification_status: 'approved'
  };
  fixture.rpc.mockResolvedValue({
    data: [
      {
        id, revision: 1, published_at: own.published_at, expires_at: own.expires_at, payload, email: 'PRIVATE'
      }
    ], error: null
  });
  render(<RecruiterJobSearchCards recruiterId={id} />);
  fireEvent.click(screen.getByRole('button', {
    name: 'Find available drivers'
  }));
  await screen.findByRole('alert');
  expect(screen.queryByText('PRIVATE')).toBeNull();
  expect(screen.queryByText('TX')).toBeNull();
});
it('publication cannot begin before actual get succeeds', async () => {
  const submit = vi.fn();
  render(<DriverJobSearchCardView canPublish seed={payload as never} state={{
    card: null, ready: false, busy: false, error: null, uncertain: false, pending: null, refresh: vi.fn(), submit, retry: vi.fn()
  }} />);
  expect(screen.getByRole('button', {
    name: 'Review exact card'
  })).toBeDisabled();
  expect(submit).not.toHaveBeenCalled();
});
it('sign-out subscription immediately hides the draft and card before auth context rerender', async () => {
  setJobSearchCardHandoff(fixture.user, payload);
  route('/find-work?task=job-search-card');
  await reviewSeed();
  act(() => {
    for (const cb of fixture.callbacks)
      cb('SIGNED_OUT', null);
  });
  expect(screen.queryByLabelText('Years of experience')).toBeNull();
  expect(screen.queryByRole('heading', {
    name: 'Review before sharing'
  })).toBeNull();
});
it('real presentation edit, pause and withdrawal use deliberate commands and returned status', async () => {
  let card = {
    ...own
  };
  fixture.rpc.mockImplementation((_n, a) => {
    if (a._action !== 'get')
      card = {
        ...card, revision: card.revision + 1, status: a._action === 'pause' ? 'paused' : 'withdrawn'
      };
    return response(card);
  });
  route('/find-work?task=job-search-card');
  await screen.findByText('published', {
    selector: 'strong'
  });
  fireEvent.click(screen.getByRole('button', {
    name: 'Pause'
  }));
  await screen.findByText('paused', {
    selector: 'strong'
  });
  fireEvent.click(screen.getByRole('button', {
    name: 'Withdraw'
  }));
  await screen.findByText('withdrawn', {
    selector: 'strong'
  });
  expect(fixture.rpc.mock.calls.filter(([, a]) => a._action !== 'get').map(([, a]) => a._expected_revision)).toEqual([
    1, 2
  ]);
});
it('recruiter pagination replaces bounded page and clears a delayed page on workspace loss', async () => {
  fixture.recruiter = true;
  fixture.profile = {
    id, user_id: fixture.user, status: 'active', verification_status: 'approved'
  };
  const rows = Array.from({
    length: 20
  }, (_, i) => ({
    id: `22222222-2222-2222-2222-${String(99 - i).padStart(12, '0')}`, revision: 1, published_at: own.published_at, expires_at: own.expires_at, payload
  }));
  let release: ((v: unknown) => void) | undefined;
  fixture.rpc.mockResolvedValueOnce({
    data: rows, error: null
  }).mockImplementationOnce(() => new Promise(r => {
    release = r;
  }));
  const tree = render(<RecruiterJobSearchCards recruiterId={id} />);
  fireEvent.click(screen.getByRole('button', {
    name: 'Find available drivers'
  }));
  await screen.findByRole('button', {
    name: 'Next page'
  });
  expect(screen.getAllByText('TX')).toHaveLength(20);
  fireEvent.click(screen.getByRole('button', {
    name: 'Next page'
  }));
  expect(screen.queryByText('TX')).toBeNull();
  fixture.profile = {
    ...fixture.profile as object, id: '33333333-3333-3333-3333-333333333333'
  };
  tree.rerender(<RecruiterJobSearchCards recruiterId={id} />);
  await act(async () => {
    release?.({
      data: [], error: null
    });
  });
  expect(screen.queryByRole('button', {
    name: 'Next page'
  })).toBeNull();
  expect(fixture.rpc.mock.calls[1][1]._after_card_id).toBe(rows[19].id);
});
it('same-owner workspace switch preserves unknown command through get-null and same-command withdrawn replay', async () => {
  setJobSearchCardHandoff(fixture.user, payload);
  let writes = 0;
  fixture.rpc.mockImplementation((_n, a) => a._action === 'get' ? response(null) : ++writes === 1 ? Promise.reject(new Error('synthetic timeout')) : response({
    ...own, status: 'withdrawn', revision: 2
  }));
  const tree = render(<DriverJobSearchCard />);
  await reviewSeed();
  fireEvent.click(screen.getByRole('checkbox', {
    name: /I choose/
  }));
  fireEvent.click(screen.getByRole('button', {
    name: 'Make me available to approved recruiters'
  }));
  await screen.findByText('Outcome not confirmed');
  fixture.workspace = 'recruiter';
  tree.rerender(<DriverJobSearchCard />);
  await waitFor(() => expect(screen.queryByText('No published card')).toBeNull());
  expect(screen.getByText('Outcome not confirmed')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {
    name: 'Refresh status'
  }));
  await waitFor(() => expect(screen.getByRole('button', {
    name: 'Retry same request'
  })).not.toBeDisabled());
  expect(screen.queryByText('No published card')).toBeNull();
  fireEvent.click(screen.getByRole('button', {
    name: 'Retry same request'
  }));
  await screen.findByText('withdrawn', {
    selector: 'strong'
  });
  const commands = fixture.rpc.mock.calls.filter(([, a]) => a._action === 'publish');
  expect(commands).toHaveLength(2);
  expect(commands[0][1]).toEqual(commands[1][1]);
});
for (const transition of [
  'revocation', 'loading', 'error'
]) {
  it(`same-owner ${transition} preserves dispatched acknowledgment then deliberate withdrawal without new publish grant`, async () => {
    setJobSearchCardHandoff(fixture.user, payload);
    let release: ((v: unknown) => void) | undefined;
    fixture.rpc.mockImplementation((_n, a) => a._action === 'get' ? response(null) : a._action === 'publish' ? new Promise(r => {
      release = r;
    }) : response({
      ...own, status: 'withdrawn', revision: 2
    }));
    const tree = render(<DriverJobSearchCard />);
    await reviewSeed();
    fireEvent.click(screen.getByRole('checkbox', {
      name: /I choose/
    }));
    fireEvent.click(screen.getByRole('button', {
      name: 'Make me available to approved recruiters'
    }));
    await waitFor(() => expect(fixture.rpc.mock.calls.some(([, a]) => a._action === 'publish')).toBe(true));
    if (transition === 'revocation')
      fixture.driver = false;
    if (transition === 'loading')
      fixture.loading = true;
    if (transition === 'error')
      fixture.error = new Error('capability unavailable');
    tree.rerender(<DriverJobSearchCard />);
    expect(screen.queryByText('No published card')).toBeNull();
    await act(async () => {
      release?.({
        data: own, error: null
      });
    });
    expect(screen.getByText('published', {
      selector: 'strong'
    })).toBeInTheDocument();
    fixture.driver = false;
    fixture.loading = false;
    fixture.error = null;
    tree.rerender(<DriverJobSearchCard />);
    expect(screen.getByRole('button', {
      name: 'Edit / review renewal'
    })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', {
      name: 'Withdraw'
    }));
    await screen.findByText('withdrawn', {
      selector: 'strong'
    });
    expect(fixture.rpc.mock.calls.filter(([, a]) => a._action === 'publish')).toHaveLength(1);
  });
}
it('unknown publish after revocation resolves status and deliberately withdraws without replaying publication', async () => {
  setJobSearchCardHandoff(fixture.user, payload);
  let gets = 0;
  fixture.rpc.mockImplementation((_n, a) => a._action === 'get' ? response(++gets === 1 ? null : own) : a._action === 'publish' ? Promise.reject(new Error('timeout')) : response({
    ...own, status: 'withdrawn', revision: 2
  }));
  const tree = render(<DriverJobSearchCard />);
  await reviewSeed();
  fireEvent.click(screen.getByRole('checkbox', {
    name: /I choose/
  }));
  fireEvent.click(screen.getByRole('button', {
    name: 'Make me available to approved recruiters'
  }));
  await screen.findByText('Outcome not confirmed');
  fixture.driver = false;
  tree.rerender(<DriverJobSearchCard />);
  fireEvent.click(screen.getByRole('button', {
    name: 'Refresh status'
  }));
  await waitFor(() => expect(screen.getByRole('button', {
    name: 'Withdraw'
  })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', {
    name: 'Withdraw'
  }));
  await screen.findByText('withdrawn', {
    selector: 'strong'
  });
  expect(fixture.rpc.mock.calls.filter(([, a]) => a._action === 'publish')).toHaveLength(1);
});
for (const transition of [
  'account', 'acting', 'signed_out'
]) {
  it(`${transition} synchronously hides reviewed pending publication and discards its acknowledgment`, async () => {
    setJobSearchCardHandoff(fixture.user, payload);
    let release: ((v: unknown) => void) | undefined;
    fixture.rpc.mockImplementation((_n, a) => a._action === 'get' ? response(null) : new Promise(r => {
      release = r;
    }));
    const tree = render(<DriverJobSearchCard />);
    await reviewSeed();
    fireEvent.click(screen.getByRole('checkbox', {
      name: /I choose/
    }));
    fireEvent.click(screen.getByRole('button', {
      name: 'Make me available to approved recruiters'
    }));
    if (transition === 'account') {
      fixture.user = id;
      fixture.sessionUser = id;
    }
    if (transition === 'acting')
      fixture.acting = true;
    if (transition === 'signed_out') {
      fixture.user = '';
      fixture.sessionUser = '';
    }
    tree.rerender(<DriverJobSearchCard />);
    expect(screen.queryByRole('heading', {
      name: 'Review before sharing'
    })).toBeNull();
    expect(screen.queryByRole('checkbox', {
      name: /I choose/
    })).toBeNull();
    await act(async () => {
      release?.({
        data: own, error: null
      });
    });
    expect(screen.queryByText('published', {
      selector: 'strong'
    })).toBeNull();
    expect(fixture.rpc.mock.calls.filter(([, a]) => a._action === 'publish')).toHaveLength(1);
  });
}
for (const transition of [
  'capability', 'acting', 'account'
]) {
  it(`recruiter delayed page is discarded on ${transition} loss`, async () => {
    fixture.recruiter = true;
    fixture.profile = {
      id, user_id: fixture.user, status: 'active', verification_status: 'approved'
    };
    let release: ((v: unknown) => void) | undefined;
    fixture.rpc.mockImplementation(() => new Promise(r => {
      release = r;
    }));
    const tree = render(<RecruiterJobSearchCards recruiterId={id} />);
    fireEvent.click(screen.getByRole('button', {
      name: 'Find available drivers'
    }));
    if (transition === 'capability')
      fixture.recruiter = false;
    if (transition === 'acting')
      fixture.acting = true;
    if (transition === 'account') {
      fixture.user = id;
      fixture.sessionUser = id;
    }
    tree.rerender(<RecruiterJobSearchCards recruiterId={id} />);
    await act(async () => {
      release?.({
        data: [
          {
            id, revision: 1, published_at: own.published_at, expires_at: own.expires_at, payload
          }
        ], error: null
      });
    });
    expect(screen.queryByText('TX')).toBeNull();
    expect(screen.queryByRole('button', {
      name: 'Next page'
    })).toBeNull();
  });
}
it('deferred publish survives workspace switch and intervening null read before acknowledgment', async () => {
  setJobSearchCardHandoff(fixture.user, payload);
  let release: ((v: unknown) => void) | undefined;
  fixture.rpc.mockImplementation((_n, a) => a._action === 'get' ? response(null) : new Promise(r => {
    release = r;
  }));
  const tree = render(<DriverJobSearchCard />);
  await reviewSeed();
  fireEvent.click(screen.getByRole('checkbox', {
    name: /I choose/
  }));
  fireEvent.click(screen.getByRole('button', {
    name: 'Make me available to approved recruiters'
  }));
  fixture.workspace = 'recruiter';
  tree.rerender(<DriverJobSearchCard />);
  expect(screen.queryByText('No published card')).toBeNull();
  expect(screen.getByRole('button', {
    name: 'Create card'
  })).toBeDisabled();
  await act(async () => {
    release?.({
      data: {
        ...own, status: 'withdrawn', revision: 2
      }, error: null
    });
  });
  await screen.findByText('withdrawn', {
    selector: 'strong'
  });
  expect(fixture.rpc.mock.calls.filter(([, a]) => a._action === 'publish')).toHaveLength(1);
});
it('same-owner authority changes invalidate review and consent without erasing draft or auto-publication', async () => {
  setJobSearchCardHandoff(fixture.user, payload);
  const tree = render(<DriverJobSearchCard />);
  await reviewSeed();
  fireEvent.click(screen.getByRole('checkbox', {
    name: /I choose/
  }));
  fixture.workspace = 'recruiter';
  tree.rerender(<DriverJobSearchCard />);
  expect(screen.queryByRole('heading', {
    name: 'Review before sharing'
  })).toBeNull();
  expect(screen.getByLabelText('Years of experience')).toHaveValue(5);
  fixture.driver = false;
  tree.rerender(<DriverJobSearchCard />);
  fixture.driver = true;
  tree.rerender(<DriverJobSearchCard />);
  expect(fixture.rpc.mock.calls.filter(([, a]) => a._action === 'publish')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', {
    name: 'Review exact card'
  }));
  expect(screen.getByRole('checkbox', {
    name: /I choose/
  })).not.toBeChecked();
});
it('revoked unknown publication with null read remains uncertain and cannot claim a successful withdrawal', async () => {
  setJobSearchCardHandoff(fixture.user, payload);
  fixture.rpc.mockImplementation((_n, a) => a._action === 'get' ? response(null) : Promise.reject(new Error('timeout')));
  const tree = render(<DriverJobSearchCard />);
  await reviewSeed();
  fireEvent.click(screen.getByRole('checkbox', {
    name: /I choose/
  }));
  fireEvent.click(screen.getByRole('button', {
    name: 'Make me available to approved recruiters'
  }));
  await screen.findByText('Outcome not confirmed');
  fixture.driver = false;
  tree.rerender(<DriverJobSearchCard />);
  fireEvent.click(screen.getByRole('button', {
    name: 'Refresh status'
  }));
  await waitFor(() => expect(fixture.rpc.mock.calls.filter(([, a]) => a._action === 'get')).toHaveLength(2));
  expect(screen.getByText('Outcome not confirmed')).toBeInTheDocument();
  expect(screen.queryByText('No published card')).toBeNull();
  expect(screen.getByRole('button', {
    name: 'Retry same request'
  })).toBeDisabled();
  expect(screen.queryByRole('button', {
    name: 'Withdraw'
  })).toBeNull();
  fixture.driver = true;
  tree.rerender(<DriverJobSearchCard />);
  expect(fixture.rpc.mock.calls.filter(([, a]) => a._action === 'publish')).toHaveLength(1);
});
it('renewal shows current card start date deliberately and exact review lists excluded options', async () => {
  fixture.rpc.mockImplementation(() => response({
    ...own, payload: {
      ...payload, available_start_date: '2026-11-01'
    }
  }));
  render(<DriverJobSearchCard />);
  await screen.findByText('published', {
    selector: 'strong'
  });
  fireEvent.click(screen.getByRole('button', {
    name: 'Edit / review renewal'
  }));
  expect(screen.getByLabelText('Start date (optional)')).toHaveValue('2026-11-01');
  fireEvent.change(screen.getByLabelText('Start date (optional)'), {
    target: {
      value: ''
    }
  });
  await choose('Experience qualifier', 'At least');
  fireEvent.click(screen.getByRole('button', {
    name: 'Review exact card'
  }));
  const review = screen.getByRole('heading', {
    name: 'Review before sharing'
  }).parentElement;
  expect(review?.textContent).toContain('Start dateNot included');
  expect(review?.textContent).toContain('Weekly gross goalNot included');
  expect(review?.textContent).toContain('TrailersNot included');
  expect(review?.textContent).toContain('Driver typeNot included');
});
