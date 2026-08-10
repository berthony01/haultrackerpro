/**
 * Phase 1T-D1 — Settlement client orchestration layer.
 *
 * Thin React Query wrappers over the three accepted Phase 1T service modules.
 * This layer performs NO server communication of its own and re-implements no
 * server-side rule: it only schedules the accepted service calls and manages
 * cache invalidation.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getVisibleSettlementHeader,
  listVisibleSettlementEvents,
  listVisibleSettlementItems,
  listVisibleSettlementMatches,
  listVisibleSettlements,
} from '@/lib/settlements/settlementReadService';
import {
  addSettlementDraftItem,
  clearSettlementLoadMatch,
  confirmSettlementLoadMatch,
  createAgencySettlementDraft,
  createCarrierSettlementDraft,
  createDriverImportedSettlementDraft,
  createSettlementCorrectionDraft,
  deleteSettlementDraftItem,
  finalizeSettlementDraft,
  refreshSettlementLoadMatchSuggestions,
  rejectSettlementLoadMatch,
  updateSettlementDraftHeader,
  updateSettlementDraftItem,
  voidFinalizedSettlement,
} from '@/lib/settlements/settlementService';
import {
  acceptMyCarrierDriverRelationship,
  declineMyCarrierDriverRelationship,
  endCarrierDriverRelationship,
  inviteCarrierDriverRelationship,
} from '@/lib/settlements/carrierDriverRelationshipService';
import { listVisibleCarrierDriverRelationships } from '@/lib/settlements/carrierDriverRelationshipReadService';


/* -------------------------------------------------------------------------- */
/* Query keys                                                                  */
/* -------------------------------------------------------------------------- */

export const settlementQueryKeys = {
  all: ['settlements'] as const,
  list: () => ['settlements', 'list'] as const,
  header: (settlementId: string) => ['settlements', 'header', settlementId] as const,
  items: (settlementId: string) => ['settlements', 'items', settlementId] as const,
  matches: (settlementItemIds: readonly string[]) =>
    ['settlements', 'matches', [...settlementItemIds]] as const,
  events: (settlementId: string) => ['settlements', 'events', settlementId] as const,
};

export const carrierDriverRelationshipQueryKeys = {
  all: ['carrier-driver-relationships'] as const,
};

/* -------------------------------------------------------------------------- */
/* Read hooks                                                                  */
/* -------------------------------------------------------------------------- */

export function useVisibleSettlements() {
  return useQuery({
    queryKey: settlementQueryKeys.list(),
    queryFn: () => listVisibleSettlements(),
  });
}

export function useVisibleSettlementHeader(settlementId: string) {
  return useQuery({
    queryKey: settlementQueryKeys.header(settlementId),
    queryFn: () => getVisibleSettlementHeader(settlementId),
  });
}

export function useVisibleSettlementItems(settlementId: string) {
  return useQuery({
    queryKey: settlementQueryKeys.items(settlementId),
    queryFn: () => listVisibleSettlementItems(settlementId),
  });
}

export function useVisibleSettlementMatches(settlementItemIds: readonly string[]) {
  return useQuery({
    queryKey: settlementQueryKeys.matches(settlementItemIds),
    queryFn: () => listVisibleSettlementMatches(settlementItemIds),
  });
}

export function useVisibleSettlementEvents(settlementId: string) {
  return useQuery({
    queryKey: settlementQueryKeys.events(settlementId),
    queryFn: () => listVisibleSettlementEvents(settlementId),
  });
}

/* -------------------------------------------------------------------------- */
/* Internal mutation helpers                                                   */
/* -------------------------------------------------------------------------- */

function useSettlementMutation<TArgs, TData>(
  mutationFn: (args: TArgs) => Promise<TData>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: TArgs) => mutationFn(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settlementQueryKeys.all });
    },
  });
}

function useCarrierDriverRelationshipMutation<TArgs, TData>(
  mutationFn: (args: TArgs) => Promise<TData>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: TArgs) => mutationFn(args),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: carrierDriverRelationshipQueryKeys.all,
      });
      queryClient.invalidateQueries({ queryKey: settlementQueryKeys.all });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Settlement mutation hooks (14)                                              */
/* -------------------------------------------------------------------------- */

export function useCreateDriverImportedSettlementDraft() {
  return useSettlementMutation(createDriverImportedSettlementDraft);
}

export function useCreateCarrierSettlementDraft() {
  return useSettlementMutation(createCarrierSettlementDraft);
}

export function useCreateAgencySettlementDraft() {
  return useSettlementMutation(createAgencySettlementDraft);
}

export function useUpdateSettlementDraftHeader() {
  return useSettlementMutation(updateSettlementDraftHeader);
}

export function useAddSettlementDraftItem() {
  return useSettlementMutation(addSettlementDraftItem);
}

export function useUpdateSettlementDraftItem() {
  return useSettlementMutation(updateSettlementDraftItem);
}

export function useDeleteSettlementDraftItem() {
  return useSettlementMutation(deleteSettlementDraftItem);
}

export function useConfirmSettlementLoadMatch() {
  return useSettlementMutation(confirmSettlementLoadMatch);
}

export function useClearSettlementLoadMatch() {
  return useSettlementMutation(clearSettlementLoadMatch);
}

export function useRefreshSettlementLoadMatchSuggestions() {
  return useSettlementMutation(refreshSettlementLoadMatchSuggestions);
}

export function useRejectSettlementLoadMatch() {
  return useSettlementMutation(rejectSettlementLoadMatch);
}

export function useFinalizeSettlementDraft() {
  return useSettlementMutation(finalizeSettlementDraft);
}

export function useVoidFinalizedSettlement() {
  return useSettlementMutation(voidFinalizedSettlement);
}

export function useCreateSettlementCorrectionDraft() {
  return useSettlementMutation(createSettlementCorrectionDraft);
}

/* -------------------------------------------------------------------------- */
/* Carrier<->driver relationship mutation hooks (4)                            */
/* -------------------------------------------------------------------------- */

export function useInviteCarrierDriverRelationship() {
  return useCarrierDriverRelationshipMutation(inviteCarrierDriverRelationship);
}

export function useAcceptMyCarrierDriverRelationship() {
  return useCarrierDriverRelationshipMutation(acceptMyCarrierDriverRelationship);
}

export function useDeclineMyCarrierDriverRelationship() {
  return useCarrierDriverRelationshipMutation(declineMyCarrierDriverRelationship);
}

export function useEndCarrierDriverRelationship() {
  return useCarrierDriverRelationshipMutation(endCarrierDriverRelationship);
}
