import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface DriverAuditRow {
  id: string;
  created_at: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  assistant_user_id: string | null;
  assistant_email: string | null;
  metadata: Record<string, unknown> | null;
}

export interface AssistantAuditRow {
  id: string;
  created_at: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  driver_user_id: string | null;
  driver_email: string | null;
  metadata: Record<string, unknown> | null;
}

/** Logs OF assistant activity ON the current driver's account. */
export function useDriverAssistantAudit(limit = 100) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['driver-assistant-audit', user?.id, limit],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async (): Promise<DriverAuditRow[]> => {
      const { data, error } = await (supabase as any).rpc('list_driver_assistant_audit', {
        _limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as DriverAuditRow[];
    },
  });
}

/** Recent activity the signed-in assistant performed across managed drivers. */
export function useMyAssistantAudit(limit = 100) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-assistant-audit', user?.id, limit],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async (): Promise<AssistantAuditRow[]> => {
      const { data, error } = await (supabase as any).rpc('list_my_assistant_audit', {
        _limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as AssistantAuditRow[];
    },
  });
}

/** Pending invites addressed to the signed-in user's email. */
export interface PendingAssistantInvite {
  id: string;
  driver_user_id: string;
  invite_email: string;
  invited_at: string;
  permissions: Record<string, boolean>;
}

export function useMyPendingAssistantInvites() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-pending-assistant-invites', user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async (): Promise<PendingAssistantInvite[]> => {
      const { data, error } = await (supabase as any).rpc('list_my_pending_assistant_invites');
      if (error) throw error;
      return (data ?? []) as PendingAssistantInvite[];
    },
  });
}

/**
 * Convert raw audit `action` + `entity_type` values into a plain-English phrase
 * for activity feeds. Falls back to a sensible default for unknown actions.
 */
export function formatAuditAction(action: string, entity_type: string): string {
  const a = (action || '').toLowerCase();
  const entityWord = (entity_type || '').replace(/_/g, ' ').replace(/s$/, '');

  // Explicit, hand-written phrases for the actions our triggers emit.
  const MAP: Record<string, string> = {
    invite_created: 'invited a new assistant',
    invite_accepted: 'accepted an assistant invitation',
    permissions_updated: 'updated assistant permissions',
    assistant_revoked: 'revoked an assistant',
    delete_load_stops: 'deleted load stops',
    assistant_delete_load_stops: 'deleted load stops',
    create_loads: 'added a load',
    update_loads: 'updated a load',
    delete_loads: 'deleted a load',
    create_expenses: 'added an expense',
    update_expenses: 'updated an expense',
    delete_expenses: 'deleted an expense',
    create_fuel_logs: 'added a fuel log',
    update_fuel_logs: 'updated a fuel log',
    delete_fuel_logs: 'deleted a fuel log',
    create_load_stops: 'added a load stop',
    update_load_stops: 'updated a load stop',
    // Legacy generic actions (kept for older rows).
    invite_assistant: 'invited an assistant',
    accept_assistant_invite: 'accepted an assistant invitation',
    update_assistant_permissions: 'updated assistant permissions',
    revoke_assistant: 'revoked an assistant',
  };
  if (MAP[a]) return MAP[a];

  // Generic verb + entity fallback for create/update/delete patterns.
  const verb =
    a === 'create' || a === 'insert' ? 'added' :
    a === 'update' ? 'updated' :
    a === 'delete' ? 'deleted' :
    a.replace(/_/g, ' ');
  return entityWord ? `${verb} ${entityWord}` : verb;
}
