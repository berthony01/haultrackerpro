// Phase 15: Admin-only recruiter outreach workflow tracking hook.
// No emails are sent. No driver private data is read or written.

import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAdmin } from '@/hooks/useAdmin';

export type OutreachStatus =
  | 'outreach_needed'
  | 'template_copied'
  | 'contacted_manually'
  | 'replied'
  | 'no_response'
  | 'follow_up_scheduled'
  | 'closed';

export type OutreachPriority = 'low' | 'medium' | 'high';

export interface RecruiterOutreachStatusRow {
  id: string;
  recruiter_profile_id: string;
  recruiter_user_id: string | null;
  status: OutreachStatus;
  priority: OutreachPriority;
  last_template_key: string | null;
  last_template_label: string | null;
  last_copied_at: string | null;
  last_contacted_at: string | null;
  follow_up_at: string | null;
  closed_at: string | null;
  admin_note: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export const OUTREACH_STATUS_OPTIONS: { value: OutreachStatus; label: string }[] = [
  { value: 'outreach_needed', label: 'Outreach needed' },
  { value: 'template_copied', label: 'Template copied' },
  { value: 'contacted_manually', label: 'Contacted manually' },
  { value: 'replied', label: 'Replied' },
  { value: 'no_response', label: 'No response' },
  { value: 'follow_up_scheduled', label: 'Follow-up scheduled' },
  { value: 'closed', label: 'Closed' },
];

export const OUTREACH_PRIORITY_OPTIONS: { value: OutreachPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

// Statuses that should not be auto-downgraded by a template copy.
const PROTECTED_FROM_COPY: OutreachStatus[] = ['contacted_manually', 'replied', 'closed'];

function tableKey(ids: string[]) {
  return ['admin-recruiter-outreach', [...ids].sort().join(',')];
}

export function useRecruiterOutreachStatus(recruiterProfileIds: string[]) {
  const { isAdmin } = useAdmin();
  const qc = useQueryClient();

  const ids = useMemo(() => Array.from(new Set(recruiterProfileIds.filter(Boolean))), [recruiterProfileIds]);

  const query = useQuery({
    queryKey: tableKey(ids),
    enabled: isAdmin && ids.length > 0,
    queryFn: async (): Promise<RecruiterOutreachStatusRow[]> => {
      const { data, error } = await supabase
        .from('recruiter_outreach_status' as never)
        .select('*')
        .in('recruiter_profile_id', ids);
      if (error) throw error;
      return (data ?? []) as unknown as RecruiterOutreachStatusRow[];
    },
  });

  const outreachByRecruiterId = useMemo(() => {
    const map = new Map<string, RecruiterOutreachStatusRow>();
    (query.data ?? []).forEach((r) => map.set(r.recruiter_profile_id, r));
    return map;
  }, [query.data]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-recruiter-outreach'] });

  async function upsert(payload: {
    recruiter_profile_id: string;
    recruiter_user_id?: string | null;
    patch: Partial<RecruiterOutreachStatusRow>;
  }) {
    const existing = outreachByRecruiterId.get(payload.recruiter_profile_id);
    const row = {
      recruiter_profile_id: payload.recruiter_profile_id,
      recruiter_user_id: payload.recruiter_user_id ?? existing?.recruiter_user_id ?? null,
      ...payload.patch,
    };
    const { error } = await supabase
      .from('recruiter_outreach_status' as never)
      .upsert(row as never, { onConflict: 'recruiter_profile_id' });
    if (error) throw error;
    await invalidate();
  }

  const upsertStatus = useMutation({
    mutationFn: async (vars: {
      recruiter_profile_id: string;
      recruiter_user_id?: string | null;
      status?: OutreachStatus;
      priority?: OutreachPriority;
    }) => {
      const { recruiter_profile_id, recruiter_user_id, ...patch } = vars;
      const finalPatch: Partial<RecruiterOutreachStatusRow> = { ...patch };
      if (patch.status === 'closed') finalPatch.closed_at = new Date().toISOString();
      if (patch.status && patch.status !== 'closed') finalPatch.closed_at = null;
      await upsert({ recruiter_profile_id, recruiter_user_id, patch: finalPatch });
    },
  });

  const markTemplateCopied = useMutation({
    mutationFn: async (vars: {
      recruiter_profile_id: string;
      recruiter_user_id?: string | null;
      template_key: string;
      template_label: string;
      default_priority?: OutreachPriority;
    }) => {
      const existing = outreachByRecruiterId.get(vars.recruiter_profile_id);
      const now = new Date().toISOString();
      const keepStatus = existing && PROTECTED_FROM_COPY.includes(existing.status);
      const patch: Partial<RecruiterOutreachStatusRow> = {
        last_template_key: vars.template_key,
        last_template_label: vars.template_label,
        last_copied_at: now,
        priority: existing?.priority ?? vars.default_priority ?? 'medium',
        status: keepStatus ? existing!.status : 'template_copied',
      };
      await upsert({
        recruiter_profile_id: vars.recruiter_profile_id,
        recruiter_user_id: vars.recruiter_user_id,
        patch,
      });
    },
  });

  const markContactedManually = useMutation({
    mutationFn: async (vars: { recruiter_profile_id: string; recruiter_user_id?: string | null }) => {
      const existing = outreachByRecruiterId.get(vars.recruiter_profile_id);
      const patch: Partial<RecruiterOutreachStatusRow> = {
        status: 'contacted_manually',
        last_contacted_at: new Date().toISOString(),
        priority: existing?.priority ?? 'medium',
        closed_at: null,
      };
      await upsert({
        recruiter_profile_id: vars.recruiter_profile_id,
        recruiter_user_id: vars.recruiter_user_id,
        patch,
      });
    },
  });

  const saveNote = useMutation({
    mutationFn: async (vars: {
      recruiter_profile_id: string;
      recruiter_user_id?: string | null;
      admin_note: string;
    }) => {
      const trimmed = (vars.admin_note ?? '').slice(0, 500);
      await upsert({
        recruiter_profile_id: vars.recruiter_profile_id,
        recruiter_user_id: vars.recruiter_user_id,
        patch: { admin_note: trimmed.length === 0 ? null : trimmed },
      });
    },
  });

  const scheduleFollowUp = useMutation({
    mutationFn: async (vars: {
      recruiter_profile_id: string;
      recruiter_user_id?: string | null;
      follow_up_at: string | null;
    }) => {
      const existing = outreachByRecruiterId.get(vars.recruiter_profile_id);
      const patch: Partial<RecruiterOutreachStatusRow> = { follow_up_at: vars.follow_up_at };
      if (
        vars.follow_up_at &&
        existing?.status !== 'closed' &&
        existing?.status !== 'replied'
      ) {
        patch.status = 'follow_up_scheduled';
      }
      await upsert({
        recruiter_profile_id: vars.recruiter_profile_id,
        recruiter_user_id: vars.recruiter_user_id,
        patch,
      });
    },
  });

  const closeOutreach = useMutation({
    mutationFn: async (vars: { recruiter_profile_id: string; recruiter_user_id?: string | null }) => {
      await upsert({
        recruiter_profile_id: vars.recruiter_profile_id,
        recruiter_user_id: vars.recruiter_user_id,
        patch: { status: 'closed', closed_at: new Date().toISOString() },
      });
    },
  });

  return {
    outreachByRecruiterId,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
    upsertStatus,
    markTemplateCopied,
    markContactedManually,
    saveNote,
    scheduleFollowUp,
    closeOutreach,
  };
}
