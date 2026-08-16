/**
 * Phase RC-1J-D — recruiter Team data hook.
 *
 * Reads ONLY the locked RPCs `list_recruiter_team_members_safe` and the
 * RC-1J-D candidate `get_recruiter_team_seat_status`. Mutations go through
 * `invite_recruiter_member_with_permissions`, `set_recruiter_member_permissions`,
 * `set_recruiter_member_role`, and `revoke_recruiter_member`.
 *
 * There is NO direct `recruiter_members` (or any other) table read here, and
 * no recruiter profile / billing / Agency / opportunity / application /
 * report / contract / settlement hook is mounted. Permission normalization is
 * PRESENTATION ONLY — the database remains authoritative.
 */
import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  RECRUITER_STAFF_PERMISSION_KEYS,
  type ParsedRecruiterStaffPermissions,
  type RecruiterStaffPermissionKey,
} from '@/lib/recruiterStaffPermissions';

// Narrow local RPC adapter — generated Supabase types are NOT edited in this
// candidate phase, so the RC-1J-D functions are called through a cast.
type TeamRpc = (
  fn:
    | 'list_recruiter_team_members_safe'
    | 'get_recruiter_team_seat_status'
    | 'invite_recruiter_member_with_permissions'
    | 'set_recruiter_member_permissions'
    | 'set_recruiter_member_role'
    | 'revoke_recruiter_member',
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;

const callTeamRpc = supabase.rpc.bind(supabase) as unknown as TeamRpc;

export interface RecruiterTeamMember {
  membershipId: string;
  memberUserId: string | null;
  inviteEmail: string;
  role: string;
  status: string;
  permissions: ParsedRecruiterStaffPermissions;
  permissionCount: number;
  invitedAt: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
  inviteExpiresAt: string | null;
  isOwner: boolean;
  isExpiredPending: boolean;
}

export interface RecruiterTeamSeatStatus {
  seatLimit: number;
  occupiedSeats: number;
  availableSeats: number;
  withinLimit: boolean;
  canInvite: boolean;
}

/**
 * Presentation-only normalization across all 21 RC-1B keys.
 * Explicit `true` => true; missing / non-true => false. Grants no authority.
 */
export function normalizeTeamMemberPermissions(raw: unknown): ParsedRecruiterStaffPermissions {
  const source =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const out = {} as ParsedRecruiterStaffPermissions;
  for (const key of RECRUITER_STAFF_PERMISSION_KEYS) {
    out[key] = source[key] === true;
  }
  return out;
}

function toMember(row: Record<string, unknown>): RecruiterTeamMember {
  const permissions = normalizeTeamMemberPermissions(row.permissions);
  const status = typeof row.member_status === 'string' ? row.member_status : 'pending';
  const expires = typeof row.invite_expires_at === 'string' ? row.invite_expires_at : null;
  const role = typeof row.member_role === 'string' ? row.member_role : 'recruiter_staff';
  return {
    membershipId: String(row.membership_id ?? ''),
    memberUserId: typeof row.member_user_id === 'string' ? row.member_user_id : null,
    inviteEmail: typeof row.invite_email === 'string' ? row.invite_email : '',
    role,
    status,
    permissions,
    permissionCount: RECRUITER_STAFF_PERMISSION_KEYS.filter((k) => permissions[k]).length,
    invitedAt: typeof row.invited_at === 'string' ? row.invited_at : null,
    acceptedAt: typeof row.accepted_at === 'string' ? row.accepted_at : null,
    revokedAt: typeof row.revoked_at === 'string' ? row.revoked_at : null,
    inviteExpiresAt: expires,
    isOwner: role === 'recruiter_owner',
    isExpiredPending:
      status === 'pending' && !!expires && new Date(expires).getTime() <= Date.now(),
  };
}

function toSeatStatus(payload: unknown): RecruiterTeamSeatStatus | null {
  const row = Array.isArray(payload) ? payload[0] : payload;
  if (row === null || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const seatLimit = num(r.seat_limit);
  const occupiedSeats = num(r.occupied_seats);
  const availableSeats = num(r.available_seats);
  if (seatLimit === null || occupiedSeats === null || availableSeats === null) return null;
  return {
    seatLimit,
    occupiedSeats,
    availableSeats,
    withinLimit: r.within_limit === true,
    canInvite: r.can_invite === true,
  };
}

export interface InviteTeamMemberInput {
  email: string;
  role: string;
  permissions: Record<RecruiterStaffPermissionKey, boolean>;
}

export function useRecruiterTeam(recruiterId: string | null | undefined, enabled = true) {
  const qc = useQueryClient();
  const id = recruiterId ?? null;
  const active = enabled && !!id;

  const membersKey = ['recruiter-team-members', id] as const;
  const seatKey = ['recruiter-team-seat-status', id] as const;

  const membersQuery = useQuery({
    queryKey: membersKey,
    enabled: active,
    queryFn: async (): Promise<RecruiterTeamMember[]> => {
      const { data, error } = await callTeamRpc('list_recruiter_team_members_safe', {
        _recruiter_id: id,
      });
      if (error) throw new Error('Unable to load team members.');
      if (!Array.isArray(data)) return [];
      return data
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map(toMember);
    },
  });

  const seatQuery = useQuery({
    queryKey: seatKey,
    enabled: active,
    queryFn: async (): Promise<RecruiterTeamSeatStatus | null> => {
      const { data, error } = await callTeamRpc('get_recruiter_team_seat_status', {
        _recruiter_id: id,
      });
      if (error) throw new Error('Unable to load seat status.');
      return toSeatStatus(data);
    },
  });

  const invalidate = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: membersKey }),
      qc.invalidateQueries({ queryKey: seatKey }),
    ]);
  }, [qc, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const inviteMember = useMutation({
    mutationFn: async (input: InviteTeamMemberInput): Promise<Record<string, unknown>> => {
      const { data, error } = await callTeamRpc('invite_recruiter_member_with_permissions', {
        _recruiter_id: id,
        _email: input.email,
        _role: input.role,
        _permissions: input.permissions,
      });
      if (error) throw error;
      return (data ?? {}) as Record<string, unknown>;
    },
    onSuccess: invalidate,
  });

  const setPermissions = useMutation({
    mutationFn: async (input: {
      membershipId: string;
      permissions: Record<RecruiterStaffPermissionKey, boolean>;
    }) => {
      const { data, error } = await callTeamRpc('set_recruiter_member_permissions', {
        _member_id: input.membershipId,
        _permissions: input.permissions,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  const setRole = useMutation({
    mutationFn: async (input: { membershipId: string; role: string }) => {
      const { data, error } = await callTeamRpc('set_recruiter_member_role', {
        _member_id: input.membershipId,
        _role: input.role,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  const revokeMember = useMutation({
    mutationFn: async (input: { membershipId: string }) => {
      const { data, error } = await callTeamRpc('revoke_recruiter_member', {
        _member_id: input.membershipId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  return {
    members: membersQuery.data ?? [],
    seatStatus: seatQuery.data ?? null,
    isLoading: active && (membersQuery.isLoading || seatQuery.isLoading),
    error: membersQuery.error ?? seatQuery.error ?? null,
    refetch: invalidate,
    inviteMember,
    setPermissions,
    setRole,
    revokeMember,
  };
}
