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

export function formatAuditAction(action: string, entity_type: string): string {
  const a = action.toLowerCase();
  const verb =
    a === 'create' || a === 'insert' ? 'created' :
    a === 'update' ? 'updated' :
    a === 'delete' ? 'deleted' :
    a === 'invite_assistant' ? 'invited assistant' :
    a === 'accept_assistant_invite' ? 'accepted invite' :
    a === 'update_assistant_permissions' ? 'updated permissions' :
    a === 'revoke_assistant' ? 'revoked assistant' :
    a === 'assistant_delete_load_stops' ? 'deleted load stops' :
    a;
  return entity_type ? `${verb} ${entity_type.replace(/_/g, ' ')}` : verb;
}
