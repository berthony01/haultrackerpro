/**
 * Phase 1T — Carrier<->Driver relationship service transport layer.
 *
 * THIN typed adapter over the four accepted carrier<->driver relationship RPCs.
 *
 * PostgreSQL remains the SOLE authority for ownership, current actor, paid
 * entitlement, relationship state, transition legality, locking, and audit
 * behavior. This module:
 *  - performs exactly one Supabase RPC call per invocation;
 *  - passes the caller's argument object through verbatim (no injected actor
 *    ids, defaults, normalization, or rewritten values);
 *  - throws the Supabase error object unchanged, with no retry or fallback;
 *  - returns the RPC data unchanged;
 *  - has no React, hooks, DOM, router, storage, timers, direct table access,
 *    or import-time side effects.
 */

import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type SettlementFunctions = Database['public']['Functions'];

export type InviteCarrierDriverRelationshipArgs =
  SettlementFunctions['settlement_invite_carrier_driver']['Args'];
export type AcceptMyCarrierDriverRelationshipArgs =
  SettlementFunctions['settlement_accept_my_carrier_relationship']['Args'];
export type DeclineMyCarrierDriverRelationshipArgs =
  SettlementFunctions['settlement_decline_my_carrier_relationship']['Args'];
export type EndCarrierDriverRelationshipArgs =
  SettlementFunctions['settlement_end_carrier_relationship']['Args'];

export async function inviteCarrierDriverRelationship(
  args: InviteCarrierDriverRelationshipArgs,
) {
  const { data, error } = await supabase.rpc(
    'settlement_invite_carrier_driver',
    args,
  );
  if (error) throw error;
  return data;
}

export async function acceptMyCarrierDriverRelationship(
  args: AcceptMyCarrierDriverRelationshipArgs,
) {
  const { data, error } = await supabase.rpc(
    'settlement_accept_my_carrier_relationship',
    args,
  );
  if (error) throw error;
  return data;
}

export async function declineMyCarrierDriverRelationship(
  args: DeclineMyCarrierDriverRelationshipArgs,
) {
  const { data, error } = await supabase.rpc(
    'settlement_decline_my_carrier_relationship',
    args,
  );
  if (error) throw error;
  return data;
}

export async function endCarrierDriverRelationship(
  args: EndCarrierDriverRelationshipArgs,
) {
  const { data, error } = await supabase.rpc(
    'settlement_end_carrier_relationship',
    args,
  );
  if (error) throw error;
  return data;
}
