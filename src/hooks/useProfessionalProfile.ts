import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

// ---------------------------------------------------------------------
// Types — kept local; the shared Professional Profile foundation must
// NOT touch generated Supabase types.
// ---------------------------------------------------------------------

export type ProfessionalProfileAvailability = 'available' | 'limited' | 'unavailable';
export type ProfessionalProfileVisibility = 'private' | 'authorized_connections';

export interface ProfessionalProfile {
  user_id: string;
  display_name: string;
  professional_title: string | null;
  bio: string | null;
  years_experience: number | null;
  services: string[];
  service_areas: string[];
  availability: ProfessionalProfileAvailability;
  contact_email: string | null;
  contact_phone: string | null;
  visibility: ProfessionalProfileVisibility;
  share_contact_details: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProfessionalProfileSummary {
  user_id: string;
  display_name: string;
  professional_title: string | null;
  bio: string | null;
  years_experience: number | null;
  services: string[];
  service_areas: string[];
  availability: ProfessionalProfileAvailability;
  visibility: ProfessionalProfileVisibility;
  share_contact_details: boolean;
  contact_email: string | null;
  contact_phone: string | null;
  updated_at: string;
}

export interface UpsertProfessionalProfileInput {
  display_name: string;
  professional_title: string | null;
  bio: string | null;
  years_experience: number | null;
  services: string[];
  service_areas: string[];
  availability: ProfessionalProfileAvailability;
  contact_email: string | null;
  contact_phone: string | null;
  visibility: ProfessionalProfileVisibility;
  share_contact_details: boolean;
}

const MY_KEY = ['professional_profile', 'me'] as const;
const SUMMARY_KEY_PREFIX = ['professional_profile', 'summaries'] as const;

export function normalizeProfessionalProfileUserIds(
  userIds: readonly (string | null | undefined)[],
): string[] {
  const set = new Set<string>();
  for (const raw of userIds) {
    if (typeof raw === 'string') {
      const id = raw.trim();
      if (id) set.add(id);
    }
  }
  return Array.from(set).sort();
}

// ---------------------------------------------------------------------
// Own profile
// ---------------------------------------------------------------------
export function useMyProfessionalProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...MY_KEY, user?.id ?? null],
    enabled: !!user,
    queryFn: async (): Promise<ProfessionalProfile | null> => {
      const { data, error } = await (supabase as any).rpc('get_my_professional_profile');
      if (error) throw error;
      if (!data) return null;
      // SETOF RPCs are normally returned as an array. Keep the object branch
      // for compatibility with connector/mocking layers that unwrap one row.
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !row.user_id) return null;
      return row as ProfessionalProfile;
    },
  });
}

// ---------------------------------------------------------------------
// Authorized connection summaries
// ---------------------------------------------------------------------
export function useAuthorizedProfessionalProfiles(
  userIds: readonly (string | null | undefined)[],
) {
  const normalized = useMemo(
    () => normalizeProfessionalProfileUserIds(userIds),
    [userIds],
  );

  return useQuery({
    queryKey: [...SUMMARY_KEY_PREFIX, normalized],
    enabled: normalized.length > 0,
    queryFn: async (): Promise<Record<string, ProfessionalProfileSummary>> => {
      const { data, error } = await (supabase as any).rpc(
        'list_authorized_professional_profiles',
        { _user_ids: normalized },
      );
      if (error) throw error;
      const rows = (data ?? []) as ProfessionalProfileSummary[];
      const out: Record<string, ProfessionalProfileSummary> = {};
      for (const row of rows) out[row.user_id] = row;
      return out;
    },
  });
}

// ---------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------
export function useProfessionalProfileMutations() {
  const qc = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: MY_KEY });
    qc.invalidateQueries({ queryKey: SUMMARY_KEY_PREFIX });
  };

  const upsert = useMutation({
    mutationFn: async (input: UpsertProfessionalProfileInput): Promise<ProfessionalProfile> => {
      const share =
        input.visibility === 'authorized_connections' &&
        input.share_contact_details === true;

      const { data, error } = await (supabase as any).rpc(
        'upsert_my_professional_profile',
        {
          p_display_name: input.display_name,
          p_professional_title: input.professional_title,
          p_bio: input.bio,
          p_years_experience: input.years_experience,
          p_services: input.services,
          p_service_areas: input.service_areas,
          p_availability: input.availability,
          p_contact_email: input.contact_email,
          p_contact_phone: input.contact_phone,
          p_visibility: input.visibility,
          p_share_contact_details: share,
        },
      );
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !row.user_id) {
        throw new Error('Professional profile save returned no row.');
      }
      return row as ProfessionalProfile;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (): Promise<boolean> => {
      const { data, error } = await (supabase as any).rpc(
        'delete_my_professional_profile',
      );
      if (error) throw error;
      return Boolean(Array.isArray(data) ? data[0] : data);
    },
    onSuccess: invalidate,
  });

  return { upsert, remove };
}
