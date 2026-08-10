/**
 * Phase 1T-C — Read-side settlement query service.
 *
 * Thin, typed read adapter over the four settlement tables. PostgreSQL RLS is
 * the SOLE read-authorization authority: this module performs no client-side
 * authorization, no helper precheck, and no role or plan evaluation.
 *
 * Contract:
 *  - read-only: table SELECTs only; no other transport is used;
 *  - errors from the client are re-thrown unchanged (no retry, no translation);
 *  - returned data is passed through unchanged;
 *  - row shapes are derived exclusively from the generated Database types.
 */

import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type SettlementRow = Database['public']['Tables']['driver_settlements']['Row'];
export type SettlementItemRow =
  Database['public']['Tables']['driver_settlement_items']['Row'];
export type SettlementMatchRow =
  Database['public']['Tables']['driver_settlement_matches']['Row'];
export type SettlementEventRow =
  Database['public']['Tables']['driver_settlement_events']['Row'];

/** All settlements visible to the caller under RLS. */
export async function listVisibleSettlements() {
  const { data, error } = await supabase
    .from('driver_settlements')
    .select('*')
    .order('period_end', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

/** A single settlement header, or null when not visible / not found. */
export async function getVisibleSettlementHeader(settlementId: string) {
  const { data, error } = await supabase
    .from('driver_settlements')
    .select('*')
    .eq('id', settlementId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Line items of one settlement, in deterministic presentation order. */
export async function listVisibleSettlementItems(settlementId: string) {
  const { data, error } = await supabase
    .from('driver_settlement_items')
    .select('*')
    .eq('settlement_id', settlementId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data;
}

/**
 * Load matches for the supplied settlement item ids. RLS independently filters
 * visibility; the supplied ids are never authorized in client code.
 */
export async function listVisibleSettlementMatches(
  settlementItemIds: readonly string[],
): Promise<SettlementMatchRow[]> {
  if (settlementItemIds.length === 0) return [];

  const { data, error } = await supabase
    .from('driver_settlement_matches')
    .select('*')
    .in('settlement_item_id', [...settlementItemIds])
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data;
}

/** Lifecycle events of one settlement, oldest first. */
export async function listVisibleSettlementEvents(settlementId: string) {
  const { data, error } = await supabase
    .from('driver_settlement_events')
    .select('*')
    .eq('settlement_id', settlementId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data;
}
