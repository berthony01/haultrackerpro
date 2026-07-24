/**
 * Canonical policy registry — Phase 1N-F2-B.
 *
 * Purpose: single source of truth for the set of legal policies the product
 * intends to publish, plus which ones are actually live today. This module is
 * intentionally static: no runtime dates, no locale formatting, no mutable
 * exports, no dependency on the browser clock. Version / effective-date
 * metadata is deliberately null for policies that have not yet been through
 * the F2-D canonical publication phase — inventing a version or date here
 * would misrepresent the product to users and would violate the F2-B
 * truthfulness contract.
 */

export type PolicyStatus = 'live' | 'planned' | 'attorney_review_required';

export type PolicyAudience =
  | 'all'
  | 'driver'
  | 'driver_assistant'
  | 'recruiter'
  | 'agency';

export interface PolicyEntry {
  /** Stable slug used for lookups and tests. Never change once shipped. */
  readonly slug: string;
  /** Public display title of the policy. */
  readonly title: string;
  /** Short plain-English description shown in directory cards. */
  readonly description: string;
  /** Absolute in-app route. Live entries link to real, mounted routes. */
  readonly route: string;
  /** Publication state. `live` means a route is mounted and reachable today. */
  readonly status: PolicyStatus;
  /** Audience tags to help filter / theme directory rendering. */
  readonly audiences: readonly PolicyAudience[];
  /**
   * Fixed canonical version identifier. Null until F2-D establishes a
   * canonical version. Do NOT compute this from a build date.
   */
  readonly version: string | null;
  /**
   * Fixed canonical effective date (ISO date, e.g. `2026-08-01`). Null until
   * F2-D publication. Must never be defaulted from the runtime clock or
   * build time.
   */
  readonly effectiveDate: string | null;
  /**
   * True when the policy contains operator/counsel-owned decisions
   * (governing law, refund rule, arbitration, retention windows, etc.).
   */
  readonly requiresAttorneyReview: boolean;
}

const POLICY_ENTRIES: readonly PolicyEntry[] = Object.freeze([
  {
    slug: 'terms',
    title: 'Terms of Service',
    description:
      'The terms that govern use of HaulTrackerPro. A canonical version and effective date will be established during upcoming policy publication.',
    route: '/terms',
    status: 'live',
    audiences: ['all'],
    version: null,
    effectiveDate: null,
    requiresAttorneyReview: true,
  },
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    description:
      'How HaulTrackerPro collects, uses, retains and secures information. A canonical version and effective date will be established during upcoming policy publication.',
    route: '/privacy',
    status: 'live',
    audiences: ['all'],
    version: null,
    effectiveDate: null,
    requiresAttorneyReview: true,
  },
  {
    slug: 'acceptable-use',
    title: 'Acceptable Use Policy',
    description:
      'Rules for how HaulTrackerPro may be used, including prohibited conduct and enforcement. In preparation — not yet published.',
    route: '/acceptable-use',
    status: 'planned',
    audiences: ['all'],
    version: null,
    effectiveDate: null,
    requiresAttorneyReview: true,
  },
  {
    slug: 'subscription-policy',
    title: 'Subscription, Cancellation & Refund Policy',
    description:
      'Billing terms, cancellation mechanics and any refund practices. In preparation — refund rule, cancellation timing and disclosures require operator and legal review before publication.',
    route: '/subscription-policy',
    status: 'attorney_review_required',
    audiences: ['all'],
    version: null,
    effectiveDate: null,
    requiresAttorneyReview: true,
  },
  {
    slug: 'account-deletion-retention',
    title: 'Account Deletion & Data Retention Policy',
    description:
      'What happens to account data on deletion, what is retained for billing, tax or audit reasons and for how long. In preparation — retention windows require legal review before publication.',
    route: '/account-deletion-retention',
    status: 'attorney_review_required',
    audiences: ['all'],
    version: null,
    effectiveDate: null,
    requiresAttorneyReview: true,
  },
  {
    slug: 'recruiting-rules',
    title: 'Recruiting & Opportunity Posting Rules',
    description:
      'Standards recruiters and carriers must follow when posting opportunities, contacting drivers and handling driver information. In preparation.',
    route: '/recruiting-rules',
    status: 'planned',
    audiences: ['recruiter', 'agency'],
    version: null,
    effectiveDate: null,
    requiresAttorneyReview: true,
  },
  {
    slug: 'legal-history',
    title: 'Policy Version History',
    description:
      'A chronological record of published policy versions and their effective dates. In preparation — will populate once canonical versions are published.',
    route: '/legal/history',
    status: 'planned',
    audiences: ['all'],
    version: null,
    effectiveDate: null,
    requiresAttorneyReview: false,
  },
] as const);

/**
 * Return the frozen list of all policy entries. Callers must treat this as
 * read-only; the underlying array is frozen.
 */
export function getAllPolicies(): readonly PolicyEntry[] {
  return POLICY_ENTRIES;
}

/**
 * Policies that are actually mounted as reachable routes today.
 * A policy is only "live" if we can safely link to it right now.
 */
export function getLivePolicies(): readonly PolicyEntry[] {
  return POLICY_ENTRIES.filter((p) => p.status === 'live');
}

/**
 * Policies that are planned or awaiting attorney review — must NOT be
 * rendered as clickable links.
 */
export function getPlannedPolicies(): readonly PolicyEntry[] {
  return POLICY_ENTRIES.filter((p) => p.status !== 'live');
}

export function findPolicyBySlug(slug: string): PolicyEntry | undefined {
  return POLICY_ENTRIES.find((p) => p.slug === slug);
}

/**
 * True when a policy is safe to render as a real clickable link. Planned and
 * attorney-review-required policies are never clickable, even if their
 * intended route string is defined.
 */
export function isPolicyLinkable(entry: PolicyEntry): boolean {
  return entry.status === 'live';
}

/**
 * Human-readable placeholder for version/effective-date metadata when the
 * canonical publication has not yet happened. Deliberately does NOT include
 * any generated date.
 */
export const POLICY_METADATA_PENDING_LABEL =
  'Version details pending canonical publication';
