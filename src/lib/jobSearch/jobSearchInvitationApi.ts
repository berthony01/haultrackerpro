import { supabase } from '@/integrations/supabase/client';

// HJ-2 staging candidate RPCs. Not in generated types until the candidate is
// applied; every call fails closed (unavailable) when the server lacks them.
const rpc = (name: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (n: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>)(name, args);

export interface DriverInvitation {
  id: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  message: string;
  created_at: string;
  expires_at: string;
  thread_id: string | null;
  company_name: string | null;
  recruiter_name: string | null;
  verified: boolean;
  opportunity_id: string;
  opportunity_title: string;
  opportunity_company: string | null;
  hiring_city: string | null;
  hiring_state: string | null;
  route_type: string | null;
  opportunity_open: boolean;
}

export type InvitationFailure = 'unavailable' | 'denied' | 'limit' | 'closed' | 'invalid' | 'unknown';
export class InvitationError extends Error {
  constructor(public readonly kind: InvitationFailure) { super(kind); }
}
function fail(error: { code?: string } | null): never {
  const code = error?.code;
  throw new InvitationError(code === '42501' ? 'denied' : code === '54000' ? 'limit' : code === '55000' ? 'closed'
    : code === '22023' ? 'invalid' : code === 'PGRST202' || code === '42883' ? 'unavailable' : 'unknown');
}

/** True only when the server confirms the invitation backend AND both flags are on. */
export async function invitationsAvailable(): Promise<boolean> {
  try {
    const { data, error } = await rpc('job_search_invitations_available');
    return !error && data === true;
  } catch { return false; }
}

export async function sendInvitation(input: { recruiterId: string; cardId: string; opportunityId: string; message: string; commandId: string }) {
  const message = input.message.trim();
  if (message.length < 1 || message.length > 500) throw new InvitationError('invalid');
  const { data, error } = await rpc('send_job_search_invitation', {
    _recruiter_id: input.recruiterId, _card_id: input.cardId, _opportunity_id: input.opportunityId, _message: message, _client_command_id: input.commandId,
  });
  if (error) fail(error);
  const result = (data as { result?: string } | null)?.result;
  if (result !== 'sent' && result !== 'replayed' && result !== 'already_invited') throw new InvitationError('unknown');
  return result;
}

export async function listMyInvitations(): Promise<DriverInvitation[]> {
  const { data, error } = await rpc('list_my_job_search_invitations');
  if (error) fail(error);
  if (!Array.isArray(data)) throw new InvitationError('unknown');
  return data as DriverInvitation[];
}

export async function respondToInvitation(id: string, response: 'accept' | 'decline' | 'block') {
  const { data, error } = await rpc('respond_job_search_invitation', { _invitation_id: id, _response: response });
  if (error) fail(error);
  return data as { status: 'accepted' | 'declined'; thread_id: string | null };
}
