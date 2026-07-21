export type PublicationBadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive';

export type OpportunityPublicationStateKey =
  | 'live'
  | 'draft'
  | 'paused'
  | 'closed'
  | 'pending'
  | 'rejected'
  | 'incomplete'
  | 'not_visible';

export interface OpportunityPublicationInput {
  status: string;
  admin_review_status: string | null;
  published_at: string | null;
}

export interface OpportunityPublicationStatus {
  key: OpportunityPublicationStateKey;
  label: string;
  description: string;
  variant: PublicationBadgeVariant;
  isDriverVisible: boolean;
}

export function getOpportunityPublicationStatus(
  opportunity: OpportunityPublicationInput,
): OpportunityPublicationStatus {
  const { status, admin_review_status, published_at } = opportunity;

  if (status === 'draft') {
    return {
      key: 'draft',
      label: 'Draft — not visible',
      description: 'Not visible to drivers until you publish it.',
      variant: 'outline',
      isDriverVisible: false,
    };
  }

  if (status === 'paused') {
    return {
      key: 'paused',
      label: 'Paused — not visible',
      description: 'Not visible to drivers while the listing is paused.',
      variant: 'secondary',
      isDriverVisible: false,
    };
  }

  if (status === 'closed') {
    return {
      key: 'closed',
      label: 'Closed — not visible',
      description: 'Not visible to drivers because the listing is closed.',
      variant: 'secondary',
      isDriverVisible: false,
    };
  }

  if (status === 'active') {
    if (admin_review_status === 'rejected') {
      return {
        key: 'rejected',
        label: 'Changes required',
        description: 'Not visible to drivers because this opportunity was rejected.',
        variant: 'destructive',
        isDriverVisible: false,
      };
    }
    if (admin_review_status === 'pending') {
      return {
        key: 'pending',
        label: 'Pending publication',
        description:
          'Active in your dashboard, but not visible to drivers while publication is pending.',
        variant: 'secondary',
        isDriverVisible: false,
      };
    }
    if (admin_review_status === 'approved') {
      const hasPublishedAt =
        typeof published_at === 'string' && published_at.length > 0;
      if (hasPublishedAt) {
        return {
          key: 'live',
          label: 'Live to drivers',
          description: 'Visible in the driver opportunities marketplace.',
          variant: 'default',
          isDriverVisible: true,
        };
      }
      return {
        key: 'incomplete',
        label: 'Publication incomplete',
        description:
          'Active and approved, but not visible to drivers because publication has not completed.',
        variant: 'destructive',
        isDriverVisible: false,
      };
    }
  }

  return {
    key: 'not_visible',
    label: 'Not visible to drivers',
    description: 'This opportunity is not currently visible in the driver marketplace.',
    variant: 'outline',
    isDriverVisible: false,
  };
}
