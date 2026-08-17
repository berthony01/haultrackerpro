/**
 * Driver Assistants Phase 3 — Agency workflow hooks.
 *
 * Server-side functions enforce all security; these hooks are thin wrappers
 * around SECURITY DEFINER RPCs. UI gating mirrors server rules cosmetically.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { AssistantPermissions } from '@/lib/assistantPermissions';

// ---------- Types ----------
export interface ServicePackage {
  id: string;
  agency_id: string;
  name: string;
  description: string | null;
  price_display_text: string | null;
  billing_frequency_display_text: string | null;
  included_services: unknown;
  recommended_permissions: AssistantPermissions;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type AgencyClientRequestStatus =
  | 'pending'
  | 'approved'
  | 'declined'
  | 'cancelled'
  | 'converted_to_client';

export interface AgencyClientRequestRow {
  id: string;
  driver_user_id: string;
  driver_email: string | null;
  driver_name: string | null;
  selected_package_id: string | null;
  package_name: string | null;
  status: AgencyClientRequestStatus;
  message: string | null;
  preferred_contact_method: string | null;
  phone: string | null;
  requested_permissions: AssistantPermissions;
  assigned_member_user_id: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface DriverOwnClientRequestRow {
  id: string;
  agency_id: string;
  agency_name: string;
  selected_package_id: string | null;
  package_name: string | null;
  status: AgencyClientRequestStatus;
  message: string | null;
  created_at: string;
  decided_at: string | null;
}

export type AgencyDelegationStatus =
  | 'pending_driver_approval'
  | 'approved'
  | 'declined'
  | 'revoked'
  | 'expired';

export interface PendingDelegationRow {
  id: string;
  agency_id: string;
  agency_name: string;
  member_user_id: string;
  member_email: string;
  member_name: string | null;
  requested_permissions: AssistantPermissions;
  client_request_id: string | null;
  package_name: string | null;
  created_at: string;
  status: AgencyDelegationStatus;
}

export type AgencyWorkItemStatus =
  | 'open'
  | 'in_progress'
  | 'waiting_on_driver'
  | 'completed'
  | 'cancelled';
export type AgencyWorkItemType =
  | 'load_entry'
  | 'expense_entry'
  | 'fuel_entry'
  | 'report_review'
  | 'monthly_closeout'
  | 'document_followup'
  | 'other';
export type AgencyWorkItemPriority = 'low' | 'normal' | 'high';

export interface WorkItemRow {
  id: string;
  agency_id: string;
  driver_user_id: string;
  driver_email: string | null;
  assigned_member_user_id: string | null;
  assigned_member_email: string | null;
  client_request_id: string | null;
  title: string;
  description: string | null;
  type: AgencyWorkItemType;
  status: AgencyWorkItemStatus;
  priority: AgencyWorkItemPriority;
  due_date: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface AgencyClientRow {
  driver_user_id: string;
  driver_email: string | null;
  driver_name: string | null;
  member_user_id: string;
  member_email: string;
  package_id: string | null;
  package_name: string | null;
  last_activity_at: string | null;
  delegation_id: string;
}

export interface AgencyPublicView {
  id: string;
  name: string;
  description: string | null;
  contact_email: string | null;
  status: string;
}

// Phase 4C — Waiting-on-driver work items (driver-side view)
export interface DriverWaitingWorkItem {
  id: string;
  agency_id: string;
  agency_name: string;
  title: string;
  description: string | null;
  type: AgencyWorkItemType;
  priority: AgencyWorkItemPriority;
  status?: AgencyWorkItemStatus;
  due_date: string | null;
  last_driver_response?: string | null;
  last_driver_response_at?: string | null;
  created_at: string;
  updated_at: string;
}

// ---------- Packages ----------
export function useAgencyPackages(
  agencyId: string | null | undefined,
  opts?: { publicView?: boolean; enabled?: boolean },
) {
  // Phase AM-1C-A: the non-public path reads `agency_service_packages`
  // directly, which now requires the `packages_view` workspace permission.
  // Callers pass `enabled: false` to fail closed while permission resolution
  // is unsettled or when `packages_view` is absent. The public driver
  // discovery path is unchanged.
  const permissionGateOpen = opts?.publicView ? true : opts?.enabled !== false;
  return useQuery({
    queryKey: ['agency-packages', agencyId, !!opts?.publicView],
    enabled: !!agencyId && permissionGateOpen,
    staleTime: 30_000,

    queryFn: async (): Promise<ServicePackage[]> => {
      const fn = opts?.publicView ? 'list_agency_packages_public' : 'list_agency_packages_public';
      // Members reading their own agency can also use the public listing,
      // which only exposes active packages. Owner/admin editing reads the
      // full table via direct select (RLS-scoped).
      if (!opts?.publicView) {
        const { data, error } = await (supabase as any)
          .from('agency_service_packages')
          .select('*')
          .eq('agency_id', agencyId)
          .order('sort_order', { ascending: true });
        if (error) throw error;
        return (data ?? []) as ServicePackage[];
      }
      const { data, error } = await (supabase as any).rpc(fn, { _agency_id: agencyId });
      if (error) throw error;
      return (data ?? []) as ServicePackage[];
    },
  });
}

export function useAgencyPackageMutations() {
  const qc = useQueryClient();
  const invalidate = (agencyId?: string) =>
    qc.invalidateQueries({ queryKey: ['agency-packages', agencyId] });

  const create = useMutation({
    mutationFn: async (input: {
      agency_id: string;
      name: string;
      description?: string;
      price_display_text?: string;
      billing_frequency_display_text?: string;
      included_services?: string[];
      recommended_permissions?: AssistantPermissions;
      sort_order?: number;
    }): Promise<ServicePackage> => {
      const { data, error } = await (supabase as any).rpc('create_agency_package', {
        _agency_id: input.agency_id,
        _name: input.name,
        _description: input.description ?? null,
        _price_display_text: input.price_display_text ?? null,
        _billing_frequency_display_text: input.billing_frequency_display_text ?? null,
        _included_services: input.included_services ?? [],
        _recommended_permissions: input.recommended_permissions ?? {},
        _sort_order: input.sort_order ?? 0,
      });
      if (error) throw error;
      return data as ServicePackage;
    },
    onSuccess: (_d, v) => invalidate(v.agency_id),
  });

  const update = useMutation({
    mutationFn: async (input: {
      id: string;
      agency_id: string;
      name: string;
      description?: string | null;
      price_display_text?: string | null;
      billing_frequency_display_text?: string | null;
      included_services?: string[];
      recommended_permissions?: AssistantPermissions;
      is_active?: boolean;
      sort_order?: number;
    }): Promise<ServicePackage> => {
      const { data, error } = await (supabase as any).rpc('update_agency_package', {
        _id: input.id,
        _name: input.name,
        _description: input.description ?? null,
        _price_display_text: input.price_display_text ?? null,
        _billing_frequency_display_text: input.billing_frequency_display_text ?? null,
        _included_services: input.included_services ?? null,
        _recommended_permissions: input.recommended_permissions ?? {},
        _is_active: input.is_active ?? null,
        _sort_order: input.sort_order ?? null,
      });
      if (error) throw error;
      return data as ServicePackage;
    },
    onSuccess: (_d, v) => invalidate(v.agency_id),
  });

  return { create, update };
}

// ---------- Public agency view ----------
export function useAgencyPublicView(agencyId: string | null | undefined) {
  return useQuery({
    queryKey: ['agency-public-view', agencyId],
    enabled: !!agencyId,
    staleTime: 60_000,
    queryFn: async (): Promise<AgencyPublicView | null> => {
      const { data, error } = await (supabase as any).rpc('get_agency_public_view', {
        _agency_id: agencyId,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as AgencyPublicView | null;
    },
  });
}

// ---------- Client requests ----------
export function useAgencyClientRequests(
  agencyId: string | null | undefined,
  opts?: { enabled?: boolean },
) {
  // AM-1C-B: callers may disable this query before the RPC runs (fail closed
  // while Agency workspace permission resolution is pending, errored or absent).
  const callerEnabled = opts?.enabled ?? true;
  return useQuery({
    queryKey: ['agency-client-requests', agencyId],
    enabled: !!agencyId && callerEnabled,
    staleTime: 15_000,
    queryFn: async (): Promise<AgencyClientRequestRow[]> => {
      const { data, error } = await (supabase as any).rpc('list_agency_client_requests', {
        _agency_id: agencyId,
      });
      if (error) throw error;
      return (data ?? []) as AgencyClientRequestRow[];
    },
  });
}

export function useMyAgencyRequests() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-agency-requests', user?.id],
    enabled: !!user,
    staleTime: 15_000,
    queryFn: async (): Promise<DriverOwnClientRequestRow[]> => {
      const { data, error } = await (supabase as any).rpc('list_my_agency_client_requests');
      if (error) throw error;
      return (data ?? []) as DriverOwnClientRequestRow[];
    },
  });
}

export function useSubmitAgencyRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      agency_id: string;
      selected_package_id?: string | null;
      message?: string;
      preferred_contact_method?: string;
      phone?: string;
      consent: boolean;
    }) => {
      const { data, error } = await (supabase as any).rpc('submit_agency_client_request', {
        _agency_id: input.agency_id,
        _selected_package_id: input.selected_package_id ?? null,
        _message: input.message ?? null,
        _preferred_contact_method: input.preferred_contact_method ?? null,
        _phone: input.phone ?? null,
        _consent: input.consent,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-agency-requests'] }),
  });
}

export function useSetClientRequestStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      status: AgencyClientRequestStatus;
      assigned_member_user_id?: string | null;
    }) => {
      const { error } = await (supabase as any).rpc('set_agency_client_request_status', {
        _id: input.id,
        _status: input.status,
        _assigned_member_user_id: input.assigned_member_user_id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agency-client-requests'] });
      qc.invalidateQueries({ queryKey: ['my-agency-requests'] });
    },
  });
}

// ---------- Delegation ----------
export function useMyPendingDelegations() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-pending-delegations', user?.id],
    enabled: !!user,
    staleTime: 15_000,
    queryFn: async (): Promise<PendingDelegationRow[]> => {
      const { data, error } = await (supabase as any).rpc('list_my_pending_delegations');
      if (error) throw error;
      return (data ?? []) as PendingDelegationRow[];
    },
  });
}

export function useCreateDelegationRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      client_request_id: string;
      member_user_id: string;
      requested_permissions: AssistantPermissions;
    }) => {
      const { data, error } = await (supabase as any).rpc('create_agency_delegation_request', {
        _client_request_id: input.client_request_id,
        _member_user_id: input.member_user_id,
        _requested_permissions: input.requested_permissions,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agency-client-requests'] });
      qc.invalidateQueries({ queryKey: ['agency-delegations'] });
    },
  });
}

export function useDriverDecideDelegation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; approve: boolean }) => {
      const { data, error } = await (supabase as any).rpc('driver_decide_delegation', {
        _id: input.id,
        _approve: input.approve,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-pending-delegations'] });
      qc.invalidateQueries({ queryKey: ['my-agency-requests'] });
      qc.invalidateQueries({ queryKey: ['managed-drivers'] });
    },
  });
}

export function useRevokeAgencyDelegation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (delegationId: string) => {
      const { data, error } = await (supabase as any).rpc('revoke_agency_delegation', {
        _delegation_id: delegationId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-pending-delegations'] });
      qc.invalidateQueries({ queryKey: ['agency-delegations'] });
      qc.invalidateQueries({ queryKey: ['agency-clients'] });
      qc.invalidateQueries({ queryKey: ['my-assistants'] });
    },
  });
}

// ---------- Clients ----------
export function useAgencyClients(agencyId: string | null | undefined) {
  return useQuery({
    queryKey: ['agency-clients', agencyId],
    enabled: !!agencyId,
    staleTime: 30_000,
    queryFn: async (): Promise<AgencyClientRow[]> => {
      const { data, error } = await (supabase as any).rpc('list_agency_clients', {
        _agency_id: agencyId,
      });
      if (error) throw error;
      return (data ?? []) as AgencyClientRow[];
    },
  });
}

// ---------- Work items ----------
export function useAgencyWorkItems(
  agencyId: string | null | undefined,
  filters?: { status?: AgencyWorkItemStatus; driverId?: string; memberId?: string },
) {
  return useQuery({
    queryKey: ['agency-work-items', agencyId, filters?.status, filters?.driverId, filters?.memberId],
    enabled: !!agencyId,
    staleTime: 15_000,
    queryFn: async (): Promise<WorkItemRow[]> => {
      const { data, error } = await (supabase as any).rpc('list_agency_work_items', {
        _agency_id: agencyId,
        _status: filters?.status ?? null,
        _driver_user_id: filters?.driverId ?? null,
        _assigned_member_user_id: filters?.memberId ?? null,
      });
      if (error) throw error;
      return (data ?? []) as WorkItemRow[];
    },
  });
}

export function useWorkItemMutations() {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: ['agency-work-items'] });
  const create = useMutation({
    mutationFn: async (input: {
      agency_id: string;
      driver_user_id: string;
      title: string;
      description?: string;
      type?: AgencyWorkItemType;
      priority?: AgencyWorkItemPriority;
      assigned_member_user_id?: string | null;
      client_request_id?: string | null;
      due_date?: string | null;
    }) => {
      const { data, error } = await (supabase as any).rpc('create_agency_work_item', {
        _agency_id: input.agency_id,
        _driver_user_id: input.driver_user_id,
        _title: input.title,
        _description: input.description ?? null,
        _type: input.type ?? 'other',
        _priority: input.priority ?? 'normal',
        _assigned_member_user_id: input.assigned_member_user_id ?? null,
        _client_request_id: input.client_request_id ?? null,
        _due_date: input.due_date ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: inv,
  });
  const update = useMutation({
    mutationFn: async (input: {
      id: string;
      status?: AgencyWorkItemStatus | null;
      assigned_member_user_id?: string | null;
      title?: string | null;
      description?: string | null;
      priority?: AgencyWorkItemPriority | null;
      due_date?: string | null;
    }) => {
      const { error } = await (supabase as any).rpc('update_agency_work_item', {
        _id: input.id,
        _status: input.status ?? null,
        _assigned_member_user_id: input.assigned_member_user_id ?? null,
        _title: input.title ?? null,
        _description: input.description ?? null,
        _priority: input.priority ?? null,
        _due_date: input.due_date ?? null,
      });
      if (error) throw error;
    },
    onSuccess: inv,
  });
  return { create, update };
}

// ---------- Audit ----------
export interface AgencyAuditRow {
  id: string;
  actor_user_id: string | null;
  agency_id: string;
  driver_user_id: string | null;
  target_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
export function useAgencyAudit(agencyId: string | null | undefined, limit = 100) {
  return useQuery({
    queryKey: ['agency-audit', agencyId, limit],
    enabled: !!agencyId,
    staleTime: 30_000,
    queryFn: async (): Promise<AgencyAuditRow[]> => {
      const { data, error } = await (supabase as any).rpc('list_agency_audit_log', {
        _agency_id: agencyId,
        _limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as AgencyAuditRow[];
    },
  });
}

export function useMyDriverAgencyAudit(limit = 100) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-driver-agency-audit', user?.id, limit],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async (): Promise<AgencyAuditRow[]> => {
      const { data, error } = await (supabase as any).rpc('list_my_driver_agency_audit_log', {
        _limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as AgencyAuditRow[];
    },
  });
}

/** Format an agency audit action into a plain-English label. */
export function formatAgencyAuditAction(action: string, entity_type: string): string {
  const map: Record<string, string> = {
    package_created: 'created a service package',
    package_updated: 'updated a service package',
    package_deactivated: 'deactivated a service package',
    client_request_submitted: 'submitted a client request',
    client_request_pending: 'reopened a client request',
    client_request_approved: 'approved a client request',
    client_request_declined: 'declined a client request',
    client_request_cancelled: 'cancelled a client request',
    client_request_converted_to_client: 'converted a request into a client',
    delegation_request_created: 'requested driver approval to delegate access',
    delegation_approved_by_driver: 'approved the delegation',
    delegation_declined_by_driver: 'declined the delegation',
    delegation_revoked_by_driver: 'revoked agency delegation',
    delegation_revoked_by_agency: 'revoked the delegation',
    work_item_created: 'created a work item',
    work_item_assigned: 'assigned a work item',
    work_item_status_changed: 'changed a work item status',
    work_item_completed: 'completed a work item',
    work_item_updated: 'updated a work item',
    work_item_driver_responded: 'replied to a waiting work item',
  };
  if (map[action]) return map[action];
  const entity = (entity_type || '').replace(/_/g, ' ');
  return `${action.replace(/_/g, ' ')} on ${entity}`;
}

// ---------- Phase 4C: Agency slugs ----------
export function useSetAgencySlug() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { agencyId: string; slug: string | null }) => {
      const { data, error } = await (supabase as any).rpc('set_agency_slug', {
        _agency_id: input.agencyId,
        _slug: input.slug ?? '',
      });
      if (error) throw error;
      return data as string | null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agency-owned'] });
      qc.invalidateQueries({ queryKey: ['agency-public-view'] });
    },
  });
}

export function useResolveAgencySlug(slug: string | null | undefined) {
  return useQuery({
    queryKey: ['agency-slug', slug],
    enabled: !!slug,
    staleTime: 60_000,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await (supabase as any).rpc('resolve_agency_slug', {
        _slug: slug,
      });
      if (error) throw error;
      return (data as string) ?? null;
    },
  });
}

// ---------- Phase 4C: Driver waiting-on-driver workflow ----------
export function useMyWaitingWorkItems() {
  return useQuery({
    queryKey: ['my-waiting-work-items'],
    staleTime: 15_000,
    queryFn: async (): Promise<DriverWaitingWorkItem[]> => {
      const { data, error } = await (supabase as any).rpc('list_my_waiting_work_items');
      if (error) throw error;
      return (data ?? []) as DriverWaitingWorkItem[];
    },
  });
}

export function useMyWaitingWorkItem(id: string | null | undefined) {
  return useQuery({
    queryKey: ['my-waiting-work-item', id],
    enabled: !!id,
    staleTime: 5_000,
    queryFn: async (): Promise<DriverWaitingWorkItem | null> => {
      const { data, error } = await (supabase as any).rpc('get_my_waiting_work_item', {
        _id: id,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as DriverWaitingWorkItem | null;
    },
  });
}

export function useDriverRespondWorkItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; response: string }) => {
      const { error } = await (supabase as any).rpc('driver_respond_to_work_item', {
        _id: input.id,
        _response: input.response,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['my-waiting-work-items'] });
      qc.invalidateQueries({ queryKey: ['my-waiting-work-item', v.id] });
    },
  });
}
