/**
 * Canonical docs registry — Phase 1N-F2-B.
 *
 * Powers the /docs Help Center. Live entries must point at real, mounted
 * routes verified in src/App.tsx. Planned entries describe destinations that
 * do not exist yet and must set `route: null` so the UI cannot produce a
 * dead link. This module is intentionally static (no dates, no runtime
 * mutation) so that tests can assert its shape and honesty.
 */

export type DocsCategory =
  | 'drivers'
  | 'recruiters'
  | 'driver_assistants'
  | 'agencies'
  | 'billing_subscriptions'
  | 'accounts_roles_data'
  | 'ai_ocr_calculations'
  | 'opportunities_contracts_safety';

export type DocsStatus = 'live' | 'planned';

export type DocsAudience =
  | 'driver'
  | 'recruiter'
  | 'driver_assistant'
  | 'agency'
  | 'all';

export interface DocsEntry {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: DocsCategory;
  readonly audiences: readonly DocsAudience[];
  /**
   * Real, mounted in-app route for live entries. Null for planned entries so
   * the UI cannot accidentally ship a dead link. Never a placeholder string.
   */
  readonly route: string | null;
  readonly status: DocsStatus;
  readonly keywords: readonly string[];
}

export const DOCS_CATEGORY_LABELS: Readonly<Record<DocsCategory, string>> = Object.freeze({
  drivers: 'Drivers',
  recruiters: 'Recruiters',
  driver_assistants: 'Driver Assistants',
  agencies: 'Agencies',
  billing_subscriptions: 'Billing & Subscriptions',
  accounts_roles_data: 'Accounts, Roles & Data',
  ai_ocr_calculations: 'AI, OCR & Calculations',
  opportunities_contracts_safety: 'Opportunities, Contracts & Safety',
});

const DOCS_ENTRIES: readonly DocsEntry[] = Object.freeze([
  // Drivers
  {
    id: 'driver-how-to-use',
    title: 'How to use HaulTrackerPro',
    description:
      'End-to-end product walkthrough for drivers: recording loads, expenses, fuel and pay.',
    category: 'drivers',
    audiences: ['driver'],
    route: '/how-to-use-haultrackerpro',
    status: 'live',
    keywords: ['guide', 'walkthrough', 'getting started', 'driver', 'onboarding'],
  },
  {
    id: 'driver-faq',
    title: 'Driver FAQ & CSV reference',
    description:
      'Answers to common driver questions and the canonical CSV export column reference.',
    category: 'drivers',
    audiences: ['driver'],
    route: '/faq',
    status: 'live',
    keywords: ['faq', 'questions', 'csv', 'export', 'columns', 'help'],
  },

  // Recruiters
  {
    id: 'recruiter-guide',
    title: 'Recruiter guide',
    description:
      'How recruiters and carriers post opportunities, review applications and manage outreach.',
    category: 'recruiters',
    audiences: ['recruiter'],
    route: '/recruiter/guide',
    status: 'live',
    keywords: ['recruiter', 'guide', 'opportunities', 'hiring', 'workflow'],
  },
  {
    id: 'recruiter-faq',
    title: 'Recruiter FAQ',
    description:
      'Answers to common recruiter and carrier questions about posting, plans and driver review.',
    category: 'recruiters',
    audiences: ['recruiter'],
    route: '/recruiter/faq',
    status: 'live',
    keywords: ['recruiter', 'faq', 'questions', 'hiring'],
  },
  {
    id: 'recruiter-features',
    title: 'Recruiter features overview',
    description:
      'Feature-by-feature summary of the recruiter workspace and supported workflows.',
    category: 'recruiters',
    audiences: ['recruiter'],
    route: '/recruiter/features',
    status: 'live',
    keywords: ['recruiter', 'features', 'workspace'],
  },
  {
    id: 'recruiter-profile-closure',
    title: 'Closing or downgrading a recruiter profile',
    description:
      'Guide to safely closing, transferring or downgrading a recruiter profile. In preparation — the current product does not yet offer a self-service recruiter-profile closure control.',
    category: 'recruiters',
    audiences: ['recruiter'],
    route: null,
    status: 'planned',
    keywords: ['recruiter', 'close', 'downgrade', 'exit', 'profile'],
  },

  // Driver Assistants
  {
    id: 'assistants-agencies-overview',
    title: 'Driver assistants & agencies overview',
    description:
      'How assistants and agencies work alongside drivers and how delegation is scoped.',
    category: 'driver_assistants',
    audiences: ['driver_assistant', 'agency', 'driver'],
    route: '/assistants-agencies',
    status: 'live',
    keywords: ['assistant', 'agency', 'delegation', 'permissions'],
  },
  {
    id: 'assistant-self-leave',
    title: 'Leaving a driver as an assistant',
    description:
      'Guide to how an assistant can voluntarily leave a driver relationship. In preparation — the current product does not yet expose a self-service assistant leave control.',
    category: 'driver_assistants',
    audiences: ['driver_assistant'],
    route: null,
    status: 'planned',
    keywords: ['assistant', 'leave', 'unlink', 'exit'],
  },

  // Agencies
  {
    id: 'agency-transfer-closure',
    title: 'Transferring or closing an agency',
    description:
      'Guide to transferring agency ownership or closing an agency account. In preparation — the current product does not yet offer self-service agency transfer or closure.',
    category: 'agencies',
    audiences: ['agency'],
    route: null,
    status: 'planned',
    keywords: ['agency', 'transfer', 'ownership', 'close', 'exit'],
  },

  // Billing & Subscriptions
  {
    id: 'pricing-plans',
    title: 'Pricing & plans',
    description:
      'What each plan includes for drivers, recruiters and agencies.',
    category: 'billing_subscriptions',
    audiences: ['all'],
    route: '/pricing',
    status: 'live',
    keywords: ['pricing', 'plans', 'billing', 'subscription', 'upgrade'],
  },
  {
    id: 'billing-cancellation-refunds',
    title: 'Cancellation & refunds reference',
    description:
      'Explains how cancellation works today and where refund rules will be documented. In preparation — canonical policy pending legal review.',
    category: 'billing_subscriptions',
    audiences: ['all'],
    route: null,
    status: 'planned',
    keywords: ['cancel', 'refund', 'billing', 'subscription'],
  },

  // Accounts, Roles & Data
  {
    id: 'terms-summary',
    title: 'Terms of Service',
    description:
      'The current published Terms of Service governing use of HaulTrackerPro.',
    category: 'accounts_roles_data',
    audiences: ['all'],
    route: '/terms',
    status: 'live',
    keywords: ['terms', 'legal', 'contract', 'agreement'],
  },
  {
    id: 'privacy-summary',
    title: 'Privacy Policy',
    description:
      'How HaulTrackerPro handles account and product data.',
    category: 'accounts_roles_data',
    audiences: ['all'],
    route: '/privacy',
    status: 'live',
    keywords: ['privacy', 'data', 'legal'],
  },
  {
    id: 'universal-consent-controls',
    title: 'Consent history & preferences',
    description:
      'Reviewing accepted policy versions and updating consent preferences. In preparation — the product does not yet expose a universal consent-history control.',
    category: 'accounts_roles_data',
    audiences: ['all'],
    route: null,
    status: 'planned',
    keywords: ['consent', 'history', 'policy', 'preferences'],
  },

  // AI, OCR & Calculations
  {
    id: 'ai-ocr-calculations-limits',
    title: 'AI, OCR & calculation limitations',
    description:
      'How to interpret AI, OCR and calculation output and where independent review is required. In preparation as a dedicated article.',
    category: 'ai_ocr_calculations',
    audiences: ['all'],
    route: null,
    status: 'planned',
    keywords: ['ai', 'ocr', 'calculations', 'limits', 'accuracy'],
  },

  // Opportunities, Contracts & Safety
  {
    id: 'opportunities-safety-guide',
    title: 'Reviewing opportunities safely',
    description:
      'What to verify before accepting an opportunity, and how to report a concern. In preparation as a dedicated article.',
    category: 'opportunities_contracts_safety',
    audiences: ['driver'],
    route: null,
    status: 'planned',
    keywords: ['opportunities', 'safety', 'verification', 'report', 'concern'],
  },
] as const);

export function getAllDocs(): readonly DocsEntry[] {
  return DOCS_ENTRIES;
}

export function getDocsByCategory(): Readonly<Record<DocsCategory, readonly DocsEntry[]>> {
  const buckets = Object.keys(DOCS_CATEGORY_LABELS).reduce((acc, cat) => {
    acc[cat as DocsCategory] = [];
    return acc;
  }, {} as Record<DocsCategory, DocsEntry[]>);
  for (const entry of DOCS_ENTRIES) {
    buckets[entry.category].push(entry);
  }
  const frozen = Object.keys(buckets).reduce((acc, cat) => {
    acc[cat as DocsCategory] = Object.freeze([...buckets[cat as DocsCategory]]);
    return acc;
  }, {} as Record<DocsCategory, readonly DocsEntry[]>);
  return Object.freeze(frozen);
}

export function isDocsEntryLinkable(entry: DocsEntry): boolean {
  return entry.status === 'live' && typeof entry.route === 'string' && entry.route.length > 0;
}

/**
 * Case-insensitive search across title, description, category label,
 * audience tags and keywords. Returns a new array; never mutates the
 * underlying registry. Empty / whitespace query returns the full list in
 * canonical order.
 */
export function searchDocs(query: string): readonly DocsEntry[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return DOCS_ENTRIES;
  return DOCS_ENTRIES.filter((entry) => {
    const haystack = [
      entry.title,
      entry.description,
      DOCS_CATEGORY_LABELS[entry.category],
      entry.category,
      ...entry.audiences,
      ...entry.keywords,
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalized);
  });
}
