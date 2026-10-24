// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
const fixture = vi.hoisted(() => ({
  client: null as unknown
}));
vi.mock('@/integrations/supabase/client', () => ({
  get supabase() {
    return fixture.client;
  }
}));
import { boundCardRpc, parseOwnCard, parseDiscoveryCards, getOwnCard, manageOwnCard, listRecruiterCards } from '@/lib/jobSearch/jobSearchCardApi';
import { setJobSearchCardHandoff, consumeJobSearchCardHandoff, clearJobSearchCardHandoff } from '@/lib/jobSearch/jobSearchCardHandoff';
const owner = '11111111-1111-1111-1111-111111111111';
const id = '22222222-2222-2222-2222-222222222222';
const identity = {
  userId: owner, sessionUserId: owner, accessToken: 'synthetic-driver-token'
};
const payload = {
  state: 'TX', cdl_class: 'A', years_experience: 5, experience_qualifier: 'at_least', preferred_route_type: 'Regional', preferred_home_time: 'Weekly'
};
const card = {
  id, revision: 1, published_at: '2026-10-24T00:00:00Z', expires_at: '2026-11-07T00:00:00Z', payload
};
const own = {
  ...card, status: 'published', audience: 'approved_recruiters', consent_version: 'job_search_card_v1', created_at: card.published_at, updated_at: card.published_at
};
beforeEach(() => {
  clearJobSearchCardHandoff();
});
it('installed 2.105.0 request builder preserves captured Authorization across delayed global token acquisition', async () => {
  let release: ((token: string) => void) | undefined;
  let started: (() => void) | undefined;
  const waiting = new Promise<void>(r => {
    started = r;
  });
  const delayed = new Promise<string>(r => {
    release = r;
  });
  const seen: {
    authorization: string | null;
    body: string;
  }[] = [];
  const client = createClient('http://127.0.0.1:9999', 'synthetic-anon-key', {
    accessToken: async () => {
      started?.();
      return delayed;
    },
    global: {
      fetch: async (_url, init) => {
        seen.push({
          authorization: new Headers(init?.headers).get('Authorization'), body: String(init?.body)
        });
        return new Response(JSON.stringify(own), {
          status: 200, headers: {
            'content-type': 'application/json'
          }
        });
      }
    },
    auth: {
      persistSession: false, autoRefreshToken: false, detectSessionInUrl: false
    },
  });
  fixture.client = client;
  let current = true;
  const request = manageOwnCard({
    action: 'publish', revision: 0, commandId: id, payload: payload as never
  }, identity, () => current);
  const outcome = request.then(value => ({
    value
  }), error => ({
    error
  }));
  await waiting;
  current = false; // Current identity changed while the installed fetch awaited auth.
  release?.('synthetic-new-account-token');
  expect(await outcome).toMatchObject({
    error: {
      kind: 'denied'
    }
  });
  expect(seen).toHaveLength(1);
  expect(seen[0].authorization).toBe('Bearer synthetic-driver-token');
  expect(seen[0].body).not.toContain('synthetic');
  expect(seen[0].body).not.toContain(owner);
});
it('request refuses mismatched context/session or stale scope before dispatch', async () => {
  const rpc = vi.fn();
  fixture.client = {
    rpc
  };
  await expect(boundCardRpc('manage_my_job_search_card', {}, {
    ...identity, sessionUserId: id
  }, () => true)).rejects.toMatchObject({
    kind: 'denied'
  });
  await expect(boundCardRpc('manage_my_job_search_card', {}, identity, () => false)).rejects.toMatchObject({
    kind: 'denied'
  });
  expect(rpc).not.toHaveBeenCalled();
});
for (const [code, kind] of [
  [
    'PGRST202', 'unavailable'
  ], [
    '42883', 'unavailable'
  ], [
    '42501', 'denied'
  ], [
    '40001', 'stale'
  ], [
    '22023', 'invalid'
  ], [
    'unknown', 'unknown'
  ]
])
  it(`sanitizes ${code} without raw SQL`, async () => {
    fixture.client = {
      rpc: () => ({
        setHeader: () => Promise.resolve({
          data: null, error: {
            code, message: 'PRIVATE SQL TOKEN'
          }
        })
      })
    };
    await expect(getOwnCard(identity, () => true)).rejects.toMatchObject({
      kind, message: kind
    });
  });
it('No card is an explicit rejection rather than successful withdrawal', async () => {
  fixture.client = {
    rpc: () => ({
      setHeader: () => Promise.resolve({
        data: null, error: {
          code: '22023', message: 'No card'
        }
      })
    })
  };
  await expect(manageOwnCard({
    action: 'withdraw', revision: 0, commandId: id
  }, identity, () => true)).rejects.toMatchObject({
    kind: 'no_card'
  });
});
it('strict valid owner/discovery DTO and null read', () => {
  expect(parseOwnCard(own)?.payload).toEqual(payload);
  expect(parseOwnCard(null)).toBeNull();
  expect(parseDiscoveryCards([
    card
  ])).toEqual([
    card
  ]);
});
for (const extra of [
  'owner_user_id', 'email', 'phone', 'events', 'fingerprint', 'profile'
])
  it(`rejects leaking DTO field ${extra}`, () => {
    expect(() => parseOwnCard({
      ...own, [extra]: 'secret'
    })).toThrow();
    expect(() => parseDiscoveryCards([
      {
        ...card, [extra]: 'secret'
      }
    ])).toThrow();
  });
for (const altered of [
  {
    ...own, payload: {
      ...payload, city: 'secret'
    }
  }, {
    ...own, revision: 0
  }, {
    ...own, id: owner + 'x'
  }, {
    ...own, expires_at: 'invalid'
  }, {
    ...own, status: 'draft'
  }, {
    ...own, audience: 'public'
  }, {
    ...own, consent_version: 'old'
  }
])
  it('rejects malformed snapshot', () => expect(() => parseOwnCard(altered)).toThrow());
it('bounded parser rejects duplicates, unsorted rows, or more than limit', () => {
  expect(() => parseDiscoveryCards([
    card, card
  ])).toThrow();
  expect(() => parseDiscoveryCards([
    card, {
      ...card, id: owner, published_at: '2026-10-25T00:00:00Z'
    }
  ])).toThrow();
  expect(() => parseDiscoveryCards([
    card
  ], 0)).toThrow();
});
it('pagination rejects a server response on wrong side of captured cursor', async () => {
  fixture.client = {
    rpc: () => ({
      setHeader: () => Promise.resolve({
        data: [
          card
        ], error: null
      })
    })
  };
  await expect(listRecruiterCards(owner, card as never, identity, () => true)).rejects.toMatchObject({
    kind: 'unknown'
  });
});
it('memory handoff drops contact/city/transcript/gross/date and qualifier; consumed once for same owner', () => {
  const unsubscribe = vi.fn();
  fixture.client = {
    auth: {
      onAuthStateChange: () => ({
        data: {
          subscription: {
            unsubscribe
          }
        }
      })
    }
  };
  setJobSearchCardHandoff(owner, {
    ...payload, city: 'Private city', email: 'private', initialMessage: 'private', min_weekly_gross: 2000, available_start_date: '2026-10-25'
  });
  expect(consumeJobSearchCardHandoff(owner)).toEqual({
    state: 'TX', cdl_class: 'A', years_experience: 5, preferred_route_type: 'Regional', preferred_home_time: 'Weekly'
  });
  expect(consumeJobSearchCardHandoff(owner)).toBeNull();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
it('different owner cannot consume memory; sign-out and identity swap clear it', () => {
  let callback: ((event: string, session: unknown) => void) | undefined;
  fixture.client = {
    auth: {
      onAuthStateChange: (cb: typeof callback) => {
        callback = cb;
        return {
          data: {
            subscription: {
              unsubscribe: vi.fn()
            }
          }
        };
      }
    }
  };
  setJobSearchCardHandoff(owner, payload);
  expect(consumeJobSearchCardHandoff(id)).toBeNull();
  setJobSearchCardHandoff(owner, payload);
  callback?.('SIGNED_OUT', null);
  expect(consumeJobSearchCardHandoff(owner)).toBeNull();
  setJobSearchCardHandoff(owner, payload);
  callback?.('SIGNED_IN', {
    user: {
      id
    }
  });
  expect(consumeJobSearchCardHandoff(owner)).toBeNull();
});
it('synchronous subscription invalidation unsubscribes the returned handle', () => {
  const unsubscribe = vi.fn();
  fixture.client = {
    auth: {
      onAuthStateChange: (cb: (e: string, s: null) => void) => {
        cb('SIGNED_OUT', null);
        return {
          data: {
            subscription: {
              unsubscribe
            }
          }
        };
      }
    }
  };
  setJobSearchCardHandoff(owner, payload);
  expect(consumeJobSearchCardHandoff(owner)).toBeNull();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
it('rejects increasing fractional microseconds inside one millisecond', () => {
  expect(() => parseDiscoveryCards([
    {
      ...card, published_at: '2026-10-24T00:00:00.000001Z'
    },
    {
      ...card, id: owner, published_at: '2026-10-24T00:00:00.000002Z'
    },
  ])).toThrow();
});
it('accepts decreasing fractional microseconds even when UUID order increases', () => {
  expect(parseDiscoveryCards([
    {
      ...card, id: owner, published_at: '2026-10-24T00:00:00.000002Z'
    },
    {
      ...card, published_at: '2026-10-24T00:00:00.000001Z'
    },
  ])).toHaveLength(2);
});
it('equal normalized instants use UUID ordering across Z and offset strings', () => {
  expect(() => parseDiscoveryCards([
    {
      ...card, id: owner, published_at: '2026-10-24T00:00:00.000001Z'
    },
    {
      ...card, published_at: '2026-10-24T00:00:00.000001+00:00'
    },
  ])).toThrow();
  expect(parseDiscoveryCards([
    {
      ...card, published_at: '2026-10-24T01:00:00.000001+01:00'
    },
    {
      ...card, id: owner, published_at: '2026-10-24T00:00:00.000001Z'
    },
  ])).toHaveLength(2);
});
it('UUID case is normalized for ordering and duplicate detection', () => {
  const upper = 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA';
  expect(() => parseDiscoveryCards([
    {
      ...card, id: upper
    }, {
      ...card, id: upper.toLowerCase()
    }
  ])).toThrow();
  expect(parseDiscoveryCards([
    {
      ...card, id: upper
    }, card
  ])).toHaveLength(2);
});
for (const date of [
  '2026-02-30T00:00:00Z', '2026-10-24T24:00:00Z', '2026-10-24T00:60:00Z', '2026-10-24T00:00:00+24:00', '2026-10-24T00:00:00.0000001Z', '2026-10-24T00:00:00', '0000-10-24T00:00:00Z', 'infinity'
]) {
  it(`strict timestamps reject ${date}`, () => {
    expect(() => parseDiscoveryCards([
      {
        ...card, published_at: date
      }
    ])).toThrow();
  });
}
it('wrong-side microsecond cursor rejects and correct page round-trips original timestamp', async () => {
  const cursor = {
    ...card, published_at: '2026-10-24T00:00:00.000001+00:00'
  };
  let args: Record<string, unknown> | undefined;
  fixture.client = {
    rpc: (_name: string, a: Record<string, unknown>) => {
      args = a;
      return {
        setHeader: () => Promise.resolve({
          data: [
            {
              ...card, id: owner, published_at: '2026-10-24T00:00:00.000002Z'
            }
          ], error: null
        })
      };
    }
  };
  await expect(listRecruiterCards(owner, cursor as never, identity, () => true)).rejects.toMatchObject({
    kind: 'unknown'
  });
  expect(args?._after_published_at).toBe(cursor.published_at);
  fixture.client = {
    rpc: () => ({
      setHeader: () => Promise.resolve({
        data: [
          {
            ...card, id: owner, published_at: '2026-10-24T00:00:00.000000Z'
          }
        ], error: null
      })
    })
  };
  expect(await listRecruiterCards(owner, cursor as never, identity, () => true)).toHaveLength(1);
});
