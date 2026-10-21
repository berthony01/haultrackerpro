import type { ConversationThread } from '@/hooks/conversations/useConversations';

export function validThreadId(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function conversationUrl(workspace: 'driver' | 'recruiter', threadId?: string | null) {
  const query = new URLSearchParams({ workspace });
  if (validThreadId(threadId)) query.set('thread', threadId);
  return `/conversations?${query}`;
}

/** Match the applicant, not merely the listing. Input rows must already be scoped. */
export function matchingConversation(
  threads: readonly ConversationThread[],
  opportunityId: string | null | undefined,
  driverUserId: string | null | undefined,
  recruiterId?: string | null,
): ConversationThread | null {
  if (!opportunityId || !driverUserId) return null;
  return threads.find(t => t.opportunity_id === opportunityId && t.driver_user_id === driverUserId &&
    (!recruiterId || t.recruiter_id === recruiterId)) ?? null;
}
