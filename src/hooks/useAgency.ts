import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  emptyAgencyWorkspacePermissions,
  parseAgencyWorkspacePermissions,
  type ParsedAgencyWorkspacePermissions,
} from '@/lib/agencyWorkspacePermissions';


export type AgencyRole = 'agency_owner' | 'agency_admin' | 'agency_member';
export type AgencyStatus = 'active' | 'disabled';
export type AgencyMemberStatus = 'pending' | 'active' | 'revoked';

export interface Agency {
  id: string;
  owner_user_id: string;
  name: string;
  description: string | null;
  contact_email: string | null;
  status: AgencyStatus;
  created_at: string;
  updated_at: string;
  my_role: AgencyRole;
}

export interface AgencyMember {
  id: string;
  agency_id: string;
  member_user_id: string | null;
  invite_email: string;
  role: AgencyRole;
  status: AgencyMemberStatus;
  invited_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

export function useMyAgency() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-agency', user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<Agency | null> => {
      const { data, error } = await (supabase as any).rpc('get_my_agency');
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as Agency | null;
    },
  });
}

export function useAgencyMembers(agencyId: string | null | undefined) {
  return useQuery({
    queryKey: ['agency-members', agencyId],
    enabled: !!agencyId,
    staleTime: 30_000,
    queryFn: async (): Promise<AgencyMember[]> => {
      const { data, error } = await (supabase as any).rpc('list_agency_members', {
        _agency_id: agencyId,
      });
      if (error) throw error;
      return (data ?? []) as AgencyMember[];
    },
  });
}

/**
 * Phase RW-1 — canonical-owner-only read of one non-owner membership's
 * COMPLETE workspace permission map, through the read-only RPC
 * `get_agency_member_permissions`. There is no direct table read: the database
 * is the only authority and a malformed payload grants nothing.
 */
export function useAgencyMemberPermissions(memberId: string | null | undefined) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const enabled = !!userId && !!memberId;

  return useQuery({
    queryKey: ['agency-member-permissions', userId, memberId],
    enabled,
    staleTime: 15_000,
    queryFn: async (): Promise<ParsedAgencyWorkspacePermissions> => {
      const { data, error } = await (supabase as any).rpc('get_agency_member_permissions', {
        _member_id: memberId,
      });
      if (error) throw error;
      const parsed = parseAgencyWorkspacePermissions(data);
      // RW-1-H1: a malformed payload is an error, not an all-false map. In an
      // editor, a successful all-false result could be saved back over the
      // member's real permissions. Throwing keeps the query in `isError`, so
      // no editable data is ever exposed and Save stays unavailable.
      if (!parsed) throw new Error('agency_member_permissions_invalid');
      return parsed;

    },
  });
}


export function useAgencyMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['my-agency'] });
    qc.invalidateQueries({ queryKey: ['agency-members'] });
  };

  const create = useMutation({
    mutationFn: async (input: { name: string; description?: string; contact_email?: string }) => {
      const { data, error } = await (supabase as any).rpc('create_agency', {
        _name: input.name,
        _description: input.description ?? null,
        _contact_email: input.contact_email ?? null,
      });
      if (error) throw error;
      return data as Agency;
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async (input: {
      name: string;
      description?: string | null;
      contact_email?: string | null;
      status?: AgencyStatus;
    }) => {
      const { data, error } = await (supabase as any).rpc('update_my_agency', {
        _name: input.name,
        _description: input.description ?? null,
        _contact_email: input.contact_email ?? null,
        _status: input.status ?? 'active',
      });
      if (error) throw error;
      return data as Agency;
    },
    onSuccess: invalidate,
  });

  const invite = useMutation({
    mutationFn: async (input: { agency_id: string; email: string; role?: AgencyRole }) => {
      const { data, error } = await (supabase as any).rpc('invite_agency_member', {
        _agency_id: input.agency_id,
        _email: input.email,
        _role: input.role ?? 'agency_member',
      });
      if (error) throw error;
      return data as { id: string; invite_token: string; invite_email: string };
    },
    onSuccess: invalidate,
  });

  const accept = useMutation({
    mutationFn: async (token: string) => {
      const { data, error } = await (supabase as any).rpc('accept_agency_invite', {
        _token: token,
      });
      if (error) throw error;
      return data as AgencyMember;
    },
    onSuccess: invalidate,
  });

  const revoke = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await (supabase as any).rpc('revoke_agency_member', {
        _member_id: memberId,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  /**
   * Phase RW-1 — canonical-owner-only permission assignment through the
   * EXISTING `set_agency_member_permissions` RPC. The client always sends a
   * COMPLETE boolean map; the database remains the only authority.
   */
  const setPermissions = useMutation({
    mutationFn: async (input: {
      member_id: string;
      permissions: Record<string, boolean>;
    }) => {
      const { data, error } = await (supabase as any).rpc('set_agency_member_permissions', {
        _member_id: input.member_id,
        _permissions: input.permissions,
      });
      if (error) throw error;
      return data as unknown;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agency-member-permissions'] });
      qc.invalidateQueries({ queryKey: ['agency-members'] });
      qc.invalidateQueries({ queryKey: ['agency-workspace-permissions'] });
      qc.invalidateQueries({ queryKey: ['agency-audit'] });
    },
  });

  return { create, update, invite, accept, revoke, setPermissions };

}
