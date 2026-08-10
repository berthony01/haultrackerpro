// In-memory settlement hook mocks. No network, no mutations executed.
import { relationships, settlements, itemsBySettlement, eventsBySettlement } from '../fixtures';

const query = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  error: null,
  refetch: () => {},
});

const noopMutation = () => ({
  mutateAsync: async () => {
    console.log('MUTATION BLOCKED IN HARNESS');
    return null;
  },
  mutate: () => {},
  isPending: false,
  isError: false,
  reset: () => {},
});

export const useVisibleCarrierDriverRelationships = () => query(relationships);
export const useVisibleSettlements = () => query(settlements);
export const useVisibleSettlementItems = (id: string) => query(itemsBySettlement[id] ?? []);
export const useVisibleSettlementEvents = (id: string) => query(eventsBySettlement[id] ?? []);
export const useVisibleSettlementLoadMatches = () => query([]);
export const useVisibleSettlementLoadMatchSuggestions = () => query([]);

export const useInviteCarrierDriverRelationship = noopMutation;
export const useEndCarrierDriverRelationship = noopMutation;
export const useAcceptCarrierDriverRelationship = noopMutation;
export const useDeclineCarrierDriverRelationship = noopMutation;
export const useAddSettlementDraftItem = noopMutation;
export const useUpdateSettlementDraftItem = noopMutation;
export const useDeleteSettlementDraftItem = noopMutation;
export const useCreateAgencySettlementDraft = noopMutation;
export const useCreateCarrierSettlementDraft = noopMutation;
export const useCreateDriverImportedSettlementDraft = noopMutation;
export const useCreateSettlementCorrectionDraft = noopMutation;
export const useUpdateSettlementDraftHeader = noopMutation;
export const useFinalizeSettlementDraft = noopMutation;
export const useVoidFinalizedSettlement = noopMutation;
export const useConfirmSettlementLoadMatch = noopMutation;
export const useClearSettlementLoadMatch = noopMutation;
export const useRefreshSettlementLoadMatchSuggestions = noopMutation;
export const useRejectSettlementLoadMatchSuggestion = noopMutation;
