/**
 * Phase 1T-C1 — Settlement service transport layer.
 *
 * THIN typed adapter over the 14 accepted Phase 1T settlement RPCs.
 *
 * PostgreSQL remains the SOLE authority for authorization, entitlement,
 * lifecycle, locking, validation, and audit behavior. This module:
 *  - performs exactly one `supabase.rpc(...)` call per invocation;
 *  - passes the caller's argument object through verbatim (no injected actor
 *    ids, defaults, derived entitlement flags, or rewritten values);
 *  - throws the Supabase error object unchanged, with no retry or fallback;
 *  - returns the RPC `data` unchanged;
 *  - has no React, hooks, DOM, router, storage, timers, or import-time side
 *    effects, and never reads or writes settlement tables directly.
 */

import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type SettlementFunctions = Database['public']['Functions'];

export type CreateDriverImportedSettlementDraftArgs =
  SettlementFunctions['settlement_create_driver_imported_draft']['Args'];
export type CreateCarrierSettlementDraftArgs =
  SettlementFunctions['settlement_create_carrier_draft']['Args'];
export type CreateAgencySettlementDraftArgs =
  SettlementFunctions['settlement_create_agency_draft']['Args'];
export type UpdateSettlementDraftHeaderArgs =
  SettlementFunctions['settlement_update_draft_header']['Args'];
export type AddSettlementDraftItemArgs =
  SettlementFunctions['settlement_add_draft_item']['Args'];
export type UpdateSettlementDraftItemArgs =
  SettlementFunctions['settlement_update_draft_item']['Args'];
export type DeleteSettlementDraftItemArgs =
  SettlementFunctions['settlement_delete_draft_item']['Args'];
export type ConfirmSettlementLoadMatchArgs =
  SettlementFunctions['settlement_confirm_load_match']['Args'];
export type ClearSettlementLoadMatchArgs =
  SettlementFunctions['settlement_clear_load_match']['Args'];
export type RefreshSettlementLoadMatchSuggestionsArgs =
  SettlementFunctions['settlement_refresh_load_match_suggestions']['Args'];
export type RejectSettlementLoadMatchArgs =
  SettlementFunctions['settlement_reject_load_match']['Args'];
export type FinalizeSettlementDraftArgs =
  SettlementFunctions['settlement_finalize_draft']['Args'];
export type VoidFinalizedSettlementArgs =
  SettlementFunctions['settlement_void_finalized']['Args'];
export type CreateSettlementCorrectionDraftArgs =
  SettlementFunctions['settlement_create_correction_draft']['Args'];

export async function createDriverImportedSettlementDraft(
  args: CreateDriverImportedSettlementDraftArgs,
) {
  const { data, error } = await supabase.rpc(
    'settlement_create_driver_imported_draft',
    args,
  );
  if (error) throw error;
  return data;
}

export async function createCarrierSettlementDraft(
  args: CreateCarrierSettlementDraftArgs,
) {
  const { data, error } = await supabase.rpc('settlement_create_carrier_draft', args);
  if (error) throw error;
  return data;
}

export async function createAgencySettlementDraft(
  args: CreateAgencySettlementDraftArgs,
) {
  const { data, error } = await supabase.rpc('settlement_create_agency_draft', args);
  if (error) throw error;
  return data;
}

export async function updateSettlementDraftHeader(
  args: UpdateSettlementDraftHeaderArgs,
) {
  const { data, error } = await supabase.rpc('settlement_update_draft_header', args);
  if (error) throw error;
  return data;
}

export async function addSettlementDraftItem(args: AddSettlementDraftItemArgs) {
  const { data, error } = await supabase.rpc('settlement_add_draft_item', args);
  if (error) throw error;
  return data;
}

export async function updateSettlementDraftItem(
  args: UpdateSettlementDraftItemArgs,
) {
  const { data, error } = await supabase.rpc('settlement_update_draft_item', args);
  if (error) throw error;
  return data;
}

export async function deleteSettlementDraftItem(
  args: DeleteSettlementDraftItemArgs,
) {
  const { data, error } = await supabase.rpc('settlement_delete_draft_item', args);
  if (error) throw error;
  return data;
}

export async function confirmSettlementLoadMatch(
  args: ConfirmSettlementLoadMatchArgs,
) {
  const { data, error } = await supabase.rpc('settlement_confirm_load_match', args);
  if (error) throw error;
  return data;
}

export async function clearSettlementLoadMatch(args: ClearSettlementLoadMatchArgs) {
  const { data, error } = await supabase.rpc('settlement_clear_load_match', args);
  if (error) throw error;
  return data;
}

export async function refreshSettlementLoadMatchSuggestions(
  args: RefreshSettlementLoadMatchSuggestionsArgs,
) {
  const { data, error } = await supabase.rpc(
    'settlement_refresh_load_match_suggestions',
    args,
  );
  if (error) throw error;
  return data;
}

export async function rejectSettlementLoadMatch(
  args: RejectSettlementLoadMatchArgs,
) {
  const { data, error } = await supabase.rpc('settlement_reject_load_match', args);
  if (error) throw error;
  return data;
}

export async function finalizeSettlementDraft(args: FinalizeSettlementDraftArgs) {
  const { data, error } = await supabase.rpc('settlement_finalize_draft', args);
  if (error) throw error;
  return data;
}

export async function voidFinalizedSettlement(args: VoidFinalizedSettlementArgs) {
  const { data, error } = await supabase.rpc('settlement_void_finalized', args);
  if (error) throw error;
  return data;
}

export async function createSettlementCorrectionDraft(
  args: CreateSettlementCorrectionDraftArgs,
) {
  const { data, error } = await supabase.rpc(
    'settlement_create_correction_draft',
    args,
  );
  if (error) throw error;
  return data;
}
