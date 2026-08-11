/**
 * Canonical docs registry — Phase 1N-F2-B (R1).
 *
 * Powers the /docs Help Center. Live entries must point at real, mounted
 * routes verified in src/App.tsx. Planned entries describe destinations that
 * do not exist yet and must set `route: null` so the UI cannot produce a
 * dead link. This module is intentionally static (no dates, no runtime
 * mutation) so that tests can assert its shape and honesty.
 *
 * R1 hardening: every exposed docs entry, its nested `audiences` and
 * `keywords` arrays, category-label map, grouped map/values, and every
 * array returned by a helper (including `searchDocs`, even for empty
 * queries) is deeply runtime-frozen. TypeScript `readonly` alone does not
 * protect JavaScript runtime callers.
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

/**
 * Deeply freezes a single docs entry: freezes nested `audiences` and
 * `keywords` arrays and then the entry object itself. Returns the same
 * object reference (frozen in place) so identity comparisons remain stable.
 */
function freezeDocsEntry(entry: DocsEntry): DocsEntry {
  Object.freeze(entry.audiences);
  Object.freeze(entry.keywords);
  return Object.freeze(entry);
}

const DOCS_ENTRIES: readonly DocsEntry[] = Object.freeze(
  (
    [
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
      {
        id: 'settlement-statements-reconciliation',
        title: 'Settlement statements & reconciliation',
        description:
          'How company-issued settlement statements, load matching, and driver reconciliation work today — and why they are recordkeeping only.',
        category: 'drivers',
        audiences: ['driver', 'recruiter', 'agency'],
        route: '/docs/settlement-statements-reconciliation',
        status: 'live',
        keywords: ['settlement', 'statement', 'reconciliation', 'deduction', 'carrier', 'agency', 'pay'],
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
        title: 'Billing, cancellation & permanent deletion',
        description:
          'How subscriptions, cancellation, and permanent account deletion actually work today across driver, recruiter, and agency contexts.',
        category: 'billing_subscriptions',
        audiences: ['all'],
        route: '/docs/billing-cancellation',
        status: 'live',
        keywords: ['cancel', 'refund', 'billing', 'subscription', 'stripe', 'portal'],
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
        id: 'account-deletion-data-retention',
        title: 'Permanent account deletion & retained records',
        description:
          'The actual order of operations for permanent deletion, agency-owner blocking, and what may be retained, detached, or anonymized.',
        category: 'accounts_roles_data',
        audiences: ['all'],
        route: '/docs/account-deletion-data-retention',
        status: 'live',
        keywords: ['delete', 'deletion', 'retention', 'account', 'data', 'export'],
      },
      {
        id: 'roles-access-relationships',
        title: 'Account roles, delegated access & ending relationships',
        description:
          'How driver, recruiter, agency, and assistant roles are scoped today, and which self-service exit controls are not yet available.',
        category: 'accounts_roles_data',
        audiences: ['all'],
        route: '/docs/roles-access-relationships',
        status: 'live',
        keywords: ['roles', 'assistant', 'agency', 'recruiter', 'leave', 'transfer', 'access'],
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
          'How to interpret AI, OCR, contract analysis, and calculation output — and where independent review is required before you rely on any of it.',
        category: 'ai_ocr_calculations',
        audiences: ['all'],
        route: '/docs/ai-ocr-calculation-limitations',
        status: 'live',
        keywords: ['ai', 'ocr', 'calculations', 'limits', 'accuracy', 'contract'],
      },

      // Opportunities, Contracts & Safety
      {
        id: 'opportunities-safety-guide',
        title: 'Opportunity & recruiting safety',
        description:
          'What drivers should independently verify before accepting an opportunity, and what recruiters and carriers are responsible for when posting.',
        category: 'opportunities_contracts_safety',
        audiences: ['driver', 'recruiter'],
        route: '/docs/opportunity-recruiting-safety',
        status: 'live',
        keywords: ['opportunities', 'safety', 'verification', 'report', 'recruiter', 'carrier'],
      },
    ] as DocsEntry[]
  ).map(freezeDocsEntry),
);

export function getAllDocs(): readonly DocsEntry[] {
  return DOCS_ENTRIES;
}

/**
 * Return a frozen map of category -> frozen array of frozen canonical
 * entries. The outer object and every category array are frozen; entries
 * inside are the same frozen canonical objects as `getAllDocs()`.
 */
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
 * audience tags and keywords. ALWAYS returns a newly created frozen array
 * (never the canonical registry array itself), even for empty or
 * whitespace-only queries. Never mutates the underlying registry. Empty /
 * whitespace query returns the full list in canonical order.
 */
export function searchDocs(query: string): readonly DocsEntry[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return Object.freeze([...DOCS_ENTRIES]);
  return Object.freeze(
    DOCS_ENTRIES.filter((entry) => {
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
    }),
  );
}
