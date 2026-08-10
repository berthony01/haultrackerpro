/**
 * Phase 1T — Assistant settlement access server-fact adapter.
 *
 * One read-only question, answered exclusively by the existing SECURITY
 * DEFINER helper: may the CURRENT caller manage settlements for the given
 * driver, with that TARGET driver's active Pro required?
 *
 * Contract:
 *  - exactly one RPC call, no table reads or writes;
 *  - no auth/session read, no role inference, no subscription lookup;
 *  - client errors are re-thrown unchanged, with no retry;
 *  - the result is true only when the server returned boolean true.
 */

import { supabase } from '@/integrations/supabase/client';

export async function canCurrentAssistantManageProDriverSettlements(
  driverUserId: string,
): Promise<boolean> {
  if (!driverUserId || driverUserId.trim().length === 0) return false;

  const { data, error } = await supabase.rpc(
    'settlement_current_user_can_assist_driver',
    {
      _driver_user_id: driverUserId,
      _permission: 'settlements_manage',
      _require_pro: true,
    },
  );

  if (error) throw error;
  return data === true;
}
