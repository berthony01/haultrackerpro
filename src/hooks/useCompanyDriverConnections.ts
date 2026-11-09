import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

export interface CompanyDriverInvite { id: string; email: string; company_name: string; status: string; expires_at: string }
export interface CompanyDriverConnection { id: string; company_name: string; driver_name: string; status: string; invited_at: string }
export interface CompanyConnections { invites: CompanyDriverInvite[]; relationships: CompanyDriverConnection[]; can_invite: boolean }
type ConnectionRpc = (fn: 'company_driver_connections' | 'company_driver_invite' | 'company_driver_respond' | 'company_driver_revoke', args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
const rpc = supabase.rpc.bind(supabase) as unknown as ConnectionRpc;

export function useCompanyDriverConnections(recruiterId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['company-driver-connections', user?.id, recruiterId ?? 'driver'],
    queryFn: async (): Promise<CompanyConnections> => {
      const { data, error } = await rpc('company_driver_connections', { _recruiter_id: recruiterId ?? null });
      if (error) throw error;
      const result = data as CompanyConnections | null;
      if (!result || !Array.isArray(result.invites) || !Array.isArray(result.relationships) || typeof result.can_invite !== 'boolean') throw new Error('Connections could not be verified.');
      return result;
    },
    enabled: !!user?.id,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useCompanyConnectionAction() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async ({ fn, args }: { fn: Parameters<ConnectionRpc>[0]; args: Record<string, unknown> }) => {
      const { data, error } = await rpc(fn, args);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ['company-driver-connections'] });
      void cache.invalidateQueries({ queryKey: ['carrier-driver-relationships'] });
      void cache.invalidateQueries({ queryKey: ['loads'] });
    },
  });
}
