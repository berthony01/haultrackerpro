import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type {
  AssistantPermissionKey,
  AssistantPermissions,
} from '@/lib/assistantPermissions';

export interface AssistantRow {
  id: string;
  assistant_user_id: string | null;
  invite_email: string;
  status: 'pending' | 'active' | 'revoked' | 'expired';
  permissions: AssistantPermissions;
  invited_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  last_active_at: string | null;
}

export interface InviteResult {
  id: string;
  invite_token: string;
  invite_email: string;
  status: string;
}

export function useAssistants() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const listQuery = useQuery({
    queryKey: ['my-assistants', user?.id],
    queryFn: async (): Promise<AssistantRow[]> => {
      if (!user) return [];
      const { data, error } = await (supabase as any).rpc('list_my_assistants');
      if (error) throw error;
      return (data ?? []) as AssistantRow[];
    },
    enabled: !!user,
  });

  const invite = useMutation({
    mutationFn: async (input: {
      email: string;
      permissions: AssistantPermissions;
    }): Promise<InviteResult> => {
      const { data, error } = await (supabase as any).rpc('invite_assistant', {
        _email: input.email,
        _permissions: input.permissions,
      });
      if (error) throw error;
      return data as InviteResult;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-assistants'] }),
  });

  const updatePermissions = useMutation({
    mutationFn: async (input: { id: string; permissions: AssistantPermissions }) => {
      const { error } = await (supabase as any).rpc('update_assistant_permissions', {
        _id: input.id,
        _permissions: input.permissions,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-assistants'] }),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc('revoke_assistant', { _id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-assistants'] }),
  });

  return {
    assistants: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    invite,
    updatePermissions,
    revoke,
  };
}

export type { AssistantPermissionKey };
