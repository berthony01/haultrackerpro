/**
 * Phase 1T-D2 — Read-side carrier↔driver relationship query service.
 *
 * Thin, typed read adapter over `carrier_driver_relationships`. PostgreSQL RLS
 * is the SOLE read-authorization authority: this module performs no
 * client-side authorization, no helper precheck, and no role or plan
 * evaluation.
 *
 * Contract:
 *  - read-only: a single table SELECT; no RPC, no writes, no other transport;
 *  - errors from the client are re-thrown unchanged (no re-attempt, no translation);
 *  - returned data is passed through unchanged;
 *  - the row shape is derived exclusively from the generated Database types;
 *  - no recruiter/agency profile read or join is performed here.
 */

import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type CarrierDriverRelationshipRow =
  Database['public']['Tables']['carrier_driver_relationships']['Row'];

/** All carrier↔driver relationships visible to the caller under RLS. */
export async function listVisibleCarrierDriverRelationships() {
  const { data, error } = await supabase
    .from('carrier_driver_relationships')
    .select('*')
    .order('invited_at', { ascending: false });

  if (error) throw error;
  return data;
}
