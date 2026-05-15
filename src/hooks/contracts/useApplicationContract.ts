import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Tables } from '@/integrations/supabase/types';

export type Contract = Tables<'contracts'>;
export type ContractVersion = Tables<'contract_versions'>;

export type ContractClause = Tables<'contract_clauses'>;
export type ContractReview = Tables<'contract_reviews'>;
export type ContractSignature = Tables<'contract_signatures'>;

export interface ContractWithVersion {
  contract: Contract;
  current_version: ContractVersion | null;
  ai_review: ContractReview | null;
  driver_review: ContractReview | null;
  driver_signature: ContractSignature | null;
  clauses: ContractClause[];
}

const BUCKET = 'contract-documents';
const SIGNED_URL_TTL_SECONDS = 60 * 5; // 5 minutes

/**
 * Returns the contract (if any) attached to a single application, plus its
 * current version. RLS ensures the caller is the assigned driver, the owning
 * recruiter, or an admin.
 */
export function useApplicationContract(applicationId?: string | null) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['application-contract', applicationId],
    enabled: !!applicationId && !!user,
    queryFn: async (): Promise<ContractWithVersion | null> => {
      if (!applicationId) return null;
      const { data: contract, error } = await supabase
        .from('contracts')
        .select('*')
        .eq('application_id', applicationId)
        .maybeSingle();
      if (error) throw error;
      if (!contract) return null;
      let currentVersion: ContractVersion | null = null;
      let aiReview: ContractReview | null = null;
      let driverReview: ContractReview | null = null;
      let clauses: ContractClause[] = [];
      if (contract.current_version_id) {
        const { data: v } = await supabase
          .from('contract_versions')
          .select('*')
          .eq('id', contract.current_version_id)
          .eq('upload_status', 'uploaded')
          .maybeSingle();
        currentVersion = v ?? null;
        if (currentVersion) {
          const [{ data: rev }, { data: drv }, { data: cls }] = await Promise.all([
            supabase
              .from('contract_reviews')
              .select('*')
              .eq('contract_id', contract.id)
              .eq('version_id', currentVersion.id)
              .eq('reviewer_role', 'ai')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
            supabase
              .from('contract_reviews')
              .select('*')
              .eq('contract_id', contract.id)
              .eq('version_id', currentVersion.id)
              .eq('reviewer_role', 'driver')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
            supabase
              .from('contract_clauses')
              .select('*')
              .eq('version_id', currentVersion.id)
              .order('severity', { ascending: false }),
          ]);
          aiReview = rev ?? null;
          driverReview = drv ?? null;
          clauses = cls ?? [];
        }
      }
      return { contract, current_version: currentVersion, ai_review: aiReview, driver_review: driverReview, clauses };
    },
  });

  /**
   * Recruiter upload flow:
   *  1) Call upload-contract edge function → returns signed upload URL
   *  2) PUT the file directly to storage using the signed URL
   */
  const uploadContract = useMutation({
    mutationFn: async ({ file, applicationId: appId, title }: { file: File; applicationId: string; title?: string }) => {
      const { data, error } = await supabase.functions.invoke('upload-contract', {
        body: {
          application_id: appId,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type,
          title: title || null,
        },
      });
      if (error) throw new Error(error.message || 'Failed to start upload');
      const { signed_upload_url, token, storage_path, contract_id, version_id } = (data || {}) as any;
      if (!signed_upload_url || !storage_path) throw new Error('Server did not return an upload URL');

      // Use the storage SDK uploadToSignedUrl helper (handles correct PUT format).
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .uploadToSignedUrl(storage_path, token, file, { contentType: file.type, upsert: false });
      if (upErr) throw new Error(upErr.message || 'File upload failed');

      // Confirm with the server so the version is marked uploaded and promoted.
      const { data: confirmRes, error: confirmErr } = await supabase.functions.invoke(
        'confirm-contract-upload',
        { body: { version_id } },
      );
      if (confirmErr) throw new Error(confirmErr.message || 'Upload could not be confirmed');
      if ((confirmRes as any)?.error) throw new Error((confirmRes as any).error);

      return { contract_id, version_id, storage_path };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['application-contract'] });
    },
  });

  /**
   * Returns a short-lived signed URL for the current version's file. RLS on
   * storage.objects ensures only parties (driver/recruiter/admin) can sign.
   * Also writes a "viewed" audit log entry.
   */
  const getSignedViewUrl = useMutation({
    mutationFn: async (): Promise<string> => {
      const c = query.data;
      if (!c?.current_version) throw new Error('No contract version to view');
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(c.current_version.storage_path, SIGNED_URL_TTL_SECONDS);
      if (error || !data?.signedUrl) throw new Error(error?.message || 'Could not sign URL');

      // Best-effort audit. RLS allows parties to insert non-system actions.
      if (user) {
        await supabase.from('contract_audit_log').insert({
          contract_id: c.contract.id,
          version_id: c.current_version.id,
          actor_user_id: user.id,
          actor_role: c.contract.driver_user_id === user.id ? 'driver' : 'recruiter',
          action: 'viewed',
        });
      }

      return data.signedUrl;
    },
  });

  /**
   * Trigger server-side text extraction for the current version. Allowed for
   * recruiter, driver, or admin (auth enforced inside the edge function).
   * Clients cannot write extracted_text / parse_status directly.
   */
  const parseContract = useMutation({
    mutationFn: async (): Promise<{ parse_status: string; characters?: number; truncated?: boolean }> => {
      const c = query.data;
      if (!c?.current_version) throw new Error('No contract version to parse');
      const { data, error } = await supabase.functions.invoke('parse-contract', {
        body: { version_id: c.current_version.id },
      });
      if (error) throw new Error(error.message || 'Parsing failed');
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as any;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['application-contract'] });
    },
  });

  /**
   * Trigger server-side AI risk review for the current parsed version. The
   * edge function enforces auth and writes to AI-only fields via service role.
   * Idempotent — returns existing review unless force=true (admin only).
   */
  const analyzeContract = useMutation({
    mutationFn: async (opts?: { force?: boolean }) => {
      const c = query.data;
      if (!c?.current_version) throw new Error('No contract version to analyze');
      const { data, error } = await supabase.functions.invoke('analyze-contract', {
        body: { version_id: c.current_version.id, force: !!opts?.force },
      });
      if (error) throw new Error(error.message || 'AI review failed');
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as any;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['application-contract'] });
    },
  });

  /**
   * Driver decision (Phase 5). Server enforces:
   *  - only assigned driver (or admin) may submit
   *  - only on current uploaded version
   *  - request_changes requires a note
   *  - forward-only contract status (no regression from terminal states)
   */
  const reviewContract = useMutation({
    mutationFn: async (input: { decision: 'approve_contract' | 'reject_contract' | 'request_changes'; note?: string }) => {
      const c = query.data;
      if (!c?.current_version) throw new Error('No contract version to review');
      const { data, error } = await supabase.functions.invoke('review-contract', {
        body: { version_id: c.current_version.id, decision: input.decision, note: input.note ?? '' },
      });
      if (error) throw new Error(error.message || 'Could not submit decision');
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { ok: true; review_id: string; decision: 'approved' | 'rejected' | 'changes_requested' };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['application-contract'] });
    },
  });

  return {
    contractWithVersion: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    uploadContract,
    getSignedViewUrl,
    parseContract,
    analyzeContract,
    reviewContract,
  };
}
