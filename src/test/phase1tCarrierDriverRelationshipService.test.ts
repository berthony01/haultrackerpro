/**
 * Phase 1T — Carrier<->Driver relationship service contract proofs.
 *
 * No real Supabase, network, or database access. The Supabase client module is
 * mocked with a deterministic `rpc` fake that records calls and returns
 * controlled `{ data, error }` values.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type RpcCall = { fn: string; args: unknown };

const rpcCalls: RpcCall[] = [];
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null };

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(rpcResult);
    },
  },
}));

import {
  acceptMyCarrierDriverRelationship,
  declineMyCarrierDriverRelationship,
  endCarrierDriverRelationship,
  inviteCarrierDriverRelationship,
} from '@/lib/settlements/carrierDriverRelationshipService';
import type {
  AcceptMyCarrierDriverRelationshipArgs,
  DeclineMyCarrierDriverRelationshipArgs,
  EndCarrierDriverRelationshipArgs,
  InviteCarrierDriverRelationshipArgs,
} from '@/lib/settlements/carrierDriverRelationshipService';

const SERVICE_PATH = path.resolve(
  __dirname,
  '../../src/lib/settlements/carrierDriverRelationshipService.ts',
);
const SERVICE_SOURCE = readFileSync(SERVICE_PATH, 'utf8');
const TEST_PATH = path.resolve(
  __dirname,
  '../../src/test/phase1tCarrierDriverRelationshipService.test.ts',
);
const TEST_SOURCE = readFileSync(TEST_PATH, 'utf8');

// Escape patterns are assembled at runtime so that this guardrail file does not
// itself contain the literals it forbids.
const DOUBLE_CAST = ['as', 'unknown', 'as'].join(' ');
const TS_IGNORE = ['@ts', 'ignore'].join('-');
const TS_EXPECT_ERROR = ['@ts', 'expect', 'error'].join('-');
const ESLINT_DISABLE = ['eslint', 'disable'].join('-');
const LOOSE_TYPE_PATTERN = new RegExp(String.raw`\b` + 'an' + 'y' + String.raw`\b`);

const RELATIONSHIP_ROW = Object.freeze({
  id: 'rel-1',
  recruiter_id: 'recruiter-1',
  driver_user_id: 'driver-1',
  status: 'pending',
});

const INVITE_ARGS: InviteCarrierDriverRelationshipArgs = Object.freeze({
  _recruiter_id: 'recruiter-1',
  _driver_user_id: 'driver-1',
});
const ACCEPT_ARGS: AcceptMyCarrierDriverRelationshipArgs = Object.freeze({
  _relationship_id: 'rel-1',
});
const DECLINE_ARGS: DeclineMyCarrierDriverRelationshipArgs = Object.freeze({
  _relationship_id: 'rel-1',
});
const END_ARGS: EndCarrierDriverRelationshipArgs = Object.freeze({
  _relationship_id: 'rel-1',
});

const SENTINEL_ERROR = Object.freeze({
  code: '42501',
  message: 'sentinel authorization failure',
});

beforeEach(() => {
  rpcCalls.length = 0;
  rpcResult = { data: null, error: null };
});

describe('carrier<->driver relationship service — success paths', () => {
  it('invite maps to settlement_invite_carrier_driver and preserves identity', async () => {
    rpcResult = { data: RELATIONSHIP_ROW, error: null };
    const result = await inviteCarrierDriverRelationship(INVITE_ARGS);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('settlement_invite_carrier_driver');
    expect(rpcCalls[0].args).toBe(INVITE_ARGS);
    expect(result).toBe(RELATIONSHIP_ROW);
  });

  it('accept maps to settlement_accept_my_carrier_relationship and preserves identity', async () => {
    rpcResult = { data: RELATIONSHIP_ROW, error: null };
    const result = await acceptMyCarrierDriverRelationship(ACCEPT_ARGS);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('settlement_accept_my_carrier_relationship');
    expect(rpcCalls[0].args).toBe(ACCEPT_ARGS);
    expect(result).toBe(RELATIONSHIP_ROW);
  });

  it('decline maps to settlement_decline_my_carrier_relationship and preserves identity', async () => {
    rpcResult = { data: RELATIONSHIP_ROW, error: null };
    const result = await declineMyCarrierDriverRelationship(DECLINE_ARGS);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('settlement_decline_my_carrier_relationship');
    expect(rpcCalls[0].args).toBe(DECLINE_ARGS);
    expect(result).toBe(RELATIONSHIP_ROW);
  });

  it('end maps to settlement_end_carrier_relationship and preserves identity', async () => {
    rpcResult = { data: RELATIONSHIP_ROW, error: null };
    const result = await endCarrierDriverRelationship(END_ARGS);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('settlement_end_carrier_relationship');
    expect(rpcCalls[0].args).toBe(END_ARGS);
    expect(result).toBe(RELATIONSHIP_ROW);
  });
});

describe('carrier<->driver relationship service — error paths', () => {
  it('invite throws the sentinel error unchanged with no retry', async () => {
    rpcResult = { data: null, error: SENTINEL_ERROR };
    await expect(inviteCarrierDriverRelationship(INVITE_ARGS)).rejects.toBe(
      SENTINEL_ERROR,
    );
    expect(rpcCalls).toHaveLength(1);
  });

  it('accept throws the sentinel error unchanged with no retry', async () => {
    rpcResult = { data: null, error: SENTINEL_ERROR };
    await expect(acceptMyCarrierDriverRelationship(ACCEPT_ARGS)).rejects.toBe(
      SENTINEL_ERROR,
    );
    expect(rpcCalls).toHaveLength(1);
  });

  it('decline throws the sentinel error unchanged with no retry', async () => {
    rpcResult = { data: null, error: SENTINEL_ERROR };
    await expect(declineMyCarrierDriverRelationship(DECLINE_ARGS)).rejects.toBe(
      SENTINEL_ERROR,
    );
    expect(rpcCalls).toHaveLength(1);
  });

  it('end throws the sentinel error unchanged with no retry', async () => {
    rpcResult = { data: null, error: SENTINEL_ERROR };
    await expect(endCarrierDriverRelationship(END_ARGS)).rejects.toBe(
      SENTINEL_ERROR,
    );
    expect(rpcCalls).toHaveLength(1);
  });
});

describe('carrier<->driver relationship service — source guardrails', () => {
  const executableLines = SERVICE_SOURCE.split('\n').filter((line) => {
    const trimmed = line.trim();
    return (
      !trimmed.startsWith('*') &&
      !trimmed.startsWith('/*') &&
      !trimmed.startsWith('//')
    );
  });
  const executableSource = executableLines.join('\n');

  it('contains exactly four executable supabase.rpc calls', () => {
    const occurrences = executableSource.split('supabase.rpc(').length - 1;
    expect(occurrences).toBe(4);
  });

  it('never accesses tables directly or uses alternate transports/storage/timers', () => {
    expect(executableSource).not.toContain('.from(');
    expect(executableSource).not.toContain('fetch(');
    expect(executableSource).not.toContain('localStorage');
    expect(executableSource).not.toContain('sessionStorage');
    expect(executableSource).not.toContain('setTimeout');
    expect(executableSource).not.toContain('setInterval');
  });

  it('never calls settlement authorization helpers or auth.getUser', () => {
    expect(SERVICE_SOURCE).not.toContain('settlement_current_user_can_');
    expect(executableSource).not.toContain('auth.getUser');
  });

  it('imports no React, React Query, or UI modules', () => {
    expect(executableSource).not.toContain("from 'react'");
    expect(executableSource).not.toContain('@tanstack/react-query');
    expect(executableSource).not.toContain('@/components');
    expect(executableSource).not.toContain('@/pages');
    expect(executableSource).not.toContain('@/hooks');
  });

  it('imports only the Supabase client and generated types', () => {
    expect(SERVICE_SOURCE).toContain(
      "import { supabase } from '@/integrations/supabase/client';",
    );
    expect(SERVICE_SOURCE).toContain(
      "import type { Database } from '@/integrations/supabase/types';",
    );
  });

  it('contains no prohibited type escapes in the service or this test', () => {
    for (const source of [SERVICE_SOURCE, TEST_SOURCE]) {
      expect(source).not.toContain(DOUBLE_CAST);
      expect(source).not.toContain(TS_IGNORE);
      expect(source).not.toContain(TS_EXPECT_ERROR);
      expect(source).not.toContain(ESLINT_DISABLE);
      expect(LOOSE_TYPE_PATTERN.test(source)).toBe(false);
    }
  });

  it('contains no focused or skipped tests', () => {
    expect(TEST_SOURCE).not.toContain('it.on' + 'ly');
    expect(TEST_SOURCE).not.toContain('describe.on' + 'ly');
    expect(TEST_SOURCE).not.toContain('it.sk' + 'ip');
    expect(TEST_SOURCE).not.toContain('describe.sk' + 'ip');
  });
});
