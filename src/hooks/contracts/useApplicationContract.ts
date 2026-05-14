import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Tables } from '@/integrations/supabase/types';

export type Contract = Tables<'contracts'>;
export type ContractVersion = Tables<'contract_versions'>;

export interface ContractWithVersion {
  contract: Contract;
  current_version: ContractVersion | null;
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
      if (contract.current_version_id) {
        const { data: v } = await supabase
          .from('contract_versions')
          .select('*')
          .eq('id', contract.current_version_id)
          .maybeSingle();
        currentVersion = v ?? null;
      }
      return { contract, current_version: currentVersion };
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

  return {
    contractWithVersion: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    uploadContract,
    getSignedViewUrl,
  };
}
