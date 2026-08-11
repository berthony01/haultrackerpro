/**
 * Canonical docs articles — Phase 1N-F2-C1.
 *
 * Detailed, role-aware Help Center product documentation. These are NOT
 * legal policies or attorney advice. Current Terms of Service, Privacy
 * Policy, and any future canonical policies control where they apply.
 *
 * Runtime hardening:
 * - The outer article array, every article, every nested array
 *   (audiences, sections, section paragraphs, section bullets, callouts,
 *   relatedRoutes) and every nested object are deep-frozen at module load.
 * - Helpers always return frozen arrays / frozen canonical entries.
 * - No runtime date APIs (`new Date`, `Date.now`, `toLocale*`) and no
 *   raw-HTML strings anywhere in article content.
 * - `reviewedForProductAccuracy` is a fixed literal string, never derived
 *   from runtime clocks or the environment.
 */

import type { DocsAudience, DocsCategory } from '@/lib/docs/docsRegistry';

export type CalloutTone = 'info' | 'caution' | 'important';

export interface DocsArticleCallout {
  readonly tone: CalloutTone;
  readonly title: string;
  readonly body: string;
}

export interface DocsArticleSection {
  readonly heading: string;
  readonly paragraphs?: readonly string[];
  readonly bullets?: readonly string[];
  readonly callouts?: readonly DocsArticleCallout[];
}

export interface DocsArticleRelatedRoute {
  readonly label: string;
  readonly route: string;
}

export interface DocsArticle {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly category: DocsCategory;
  readonly audiences: readonly DocsAudience[];
  /** Fixed literal string date. Never runtime-generated. */
  readonly reviewedForProductAccuracy: '2026-07-24';
  readonly sections: readonly DocsArticleSection[];
  readonly callouts?: readonly DocsArticleCallout[];
  readonly relatedRoutes?: readonly DocsArticleRelatedRoute[];
}

const REVIEWED = '2026-07-24' as const;

// ---------------------------------------------------------------------------
// Article 1 — Billing, renewals, cancellation, and permanent deletion
// ---------------------------------------------------------------------------
const ARTICLE_BILLING: DocsArticle = {
  slug: 'billing-cancellation',
  title: 'Billing, renewals, cancellation, and permanent deletion',
  summary:
    'How subscriptions, cancellation, and permanent account deletion actually work today across driver, recruiter, and agency contexts.',
  category: 'billing_subscriptions',
  audiences: ['all'],
  reviewedForProductAccuracy: REVIEWED,
  sections: [
    {
      heading: 'Separate billing contexts',
      paragraphs: [
        'Driver, recruiter, and agency subscriptions are separate billing contexts. Each is owned by the applicable account or workspace owner and is managed independently.',
        'One login may hold more than one context — for example a driver plan and a recruiter plan on the same account. Contexts are tracked separately and may map to distinct Stripe subscriptions, or, in legacy or normalized cases, to the same Stripe subscription ID. When you request permanent deletion the backend deduplicates repeated subscription IDs before it retrieves or cancels them so a shared ID is not cancelled twice.',
      ],
    },
    {
      heading: 'Managing a subscription in the Stripe portal',
      paragraphs: [
        'Billing management opens the Stripe-hosted customer portal. The portal is the source of truth for payment method, invoices, current status, and the effective / paid-through date of any change you make there.',
        'When you cancel a subscription in the portal, the portal displays whether cancellation is immediate or scheduled at period end, and shows the effective date. Read that status carefully before closing the tab.',
      ],
      callouts: [
        {
          tone: 'important',
          title: 'The portal is the source of truth',
          body:
            'Confirm the status and effective date shown in the Stripe portal after any change. Do not rely on assumptions about when access will end.',
        },
      ],
    },
    {
      heading: 'What a normal cancellation does',
      paragraphs: [
        'A normal subscription cancellation is intended to stop future renewal. Access may continue through a paid period when the portal schedules cancellation at period end — but this is not guaranteed for every plan or promotion.',
        'Cancellation on its own does not delete your HaulTrackerPro account, your data, or the accounts of anyone you work with.',
      ],
      callouts: [
        {
          tone: 'caution',
          title: 'Cancellation is not deletion',
          body:
            'If you also want your personal data removed, follow the permanent account deletion flow in addition to cancelling the subscription.',
        },
      ],
    },
    {
      heading: 'Refunds and proration',
      paragraphs: [
        'Refund and proration treatment depends on the applicable checkout terms, your payment status, and any published refund policy in effect for your plan or promotion.',
        'HaulTrackerPro does not promise refunds or prorated refunds for every cancellation. If a charge looks incorrect, contact support@haultrackerpro.com with your Stripe confirmation or receipt and we will review it.',
      ],
    },
    {
      heading: 'Permanent personal-account deletion is different',
      paragraphs: [
        'Permanent deletion of the personal account is a separate destructive action. When you request it, the current backend attempts to cancel every driver and recruiter Stripe subscription owned by that login before transactional database cleanup proceeds.',
        'If one login owns both a driver subscription and a recruiter subscription, both are handled, and duplicate Stripe subscription IDs are deduplicated so the same subscription is not cancelled twice.',
      ],
    },
    {
      heading: 'Agency billing has its own rules',
      paragraphs: [
        'Agency billing is controlled by the active agency owner. An agency member or admin who leaves the workspace, or who deletes their personal HaulTrackerPro login, must not cancel the agency workspace subscription.',
        'An agency owner cannot permanently delete their personal account until ownership is transferred to another user or the agency is closed through an approved support process.',
      ],
      callouts: [
        {
          tone: 'important',
          title: 'Agency owners are blocked from personal deletion',
          body:
            'Attempting to delete the personal account while still owning an agency will be refused. Contact support to transfer ownership or close the agency first.',
        },
      ],
    },
    {
      heading: 'If a payment fails or status is unclear',
      paragraphs: [
        'A failed payment may restrict access. The portal / payment provider status controls, not the in-app messaging.',
        'Save your Stripe confirmation or receipt and contact support@haultrackerpro.com if the status shown is unclear or does not match what you expect.',
      ],
    },
  ],
  relatedRoutes: [
    { label: 'Pricing & plans', route: '/pricing' },
    { label: 'Account deletion & retained records', route: '/docs/account-deletion-data-retention' },
    { label: 'Terms of Service', route: '/terms' },
  ],
};

// ---------------------------------------------------------------------------
// Article 2 — Permanent account deletion and retained / shared records
// ---------------------------------------------------------------------------
const ARTICLE_DELETION: DocsArticle = {
  slug: 'account-deletion-data-retention',
  title: 'Permanent account deletion and retained or shared records',
  summary:
    'Cancellation, leaving a relationship, closing a role, and deleting the personal login are different actions. This explains the actual order of operations and what may be retained.',
  category: 'accounts_roles_data',
  audiences: ['all'],
  reviewedForProductAccuracy: REVIEWED,
  sections: [
    {
      heading: 'Four different actions',
      paragraphs: [
        'People often use "close my account" to mean four different things. They are not the same and they have different effects:',
      ],
      bullets: [
        'Cancelling a paid plan — stops future renewal in Stripe. Does not delete data.',
        'Leaving a relationship — for example an assistant unlinking from a driver, or a member leaving an agency workspace.',
        'Closing a specific role or profile — for example downgrading or closing a recruiter profile.',
        'Deleting the personal login — permanent, and covered by this article.',
      ],
    },
    {
      heading: 'Before you request permanent deletion',
      paragraphs: [
        'Export any driver records, load history, expense records, fuel logs, and reports you still need. After successful deletion these are intended to be irrecoverable.',
      ],
      callouts: [
        {
          tone: 'caution',
          title: 'Export first — treat successful deletion as irreversible',
          body:
            'Treat a successful permanent deletion as irreversible. There is no self-service undo or restore flow in HaulTrackerPro. Export any records you still need before you confirm deletion. This callout does not promise that no backup ever exists or that no retained or third-party-held record can ever be recovered — see the retained records section below.',
        },
      ],
    },
    {
      heading: 'How the deletion flow actually runs',
      paragraphs: [
        'You must be signed in to request permanent deletion. The backend uses the authenticated session identity — you cannot target another account.',
        'The current, controlled order of operations is:',
      ],
      bullets: [
        'Agency-owner block — if any agency profile/workspace still records you as its owner, the request is refused. The backend does not inspect an active/inactive qualifier; ownership alone triggers the block.',
        'Stripe cancellation of every owned driver and recruiter subscription is attempted first.',
        'Then a single transactional database cleanup runs.',
        'Finally, the authentication user record is deleted last.',
      ],
      callouts: [
        {
          tone: 'important',
          title: 'Atomic database cleanup',
          body:
            'The database cleanup runs as one transaction. If any cleanup statement fails, the earlier database cleanup changes in that transaction roll back.',
        },
      ],
    },
    {
      heading: 'What happens to relationships and shared work',
      paragraphs: [
        'Assistant relationships tied to the departing user are removed. Driver-owned assistant relationships owned by the departing driver are also removed.',
        'Shared agency assignments may be cleared, while shared work items, requests, or historical records that belong to the agency workspace may remain with the workspace.',
        'A departing non-owner agency membership is detached or revoked, without cancelling or deleting the agency workspace itself. Agency owners must transfer or close the workspace through support before personal deletion.',
      ],
    },
    {
      heading: 'What may be retained, detached, or anonymized',
      paragraphs: [
        'HaulTrackerPro does not claim that "all data" is deleted. Some shared, audit, billing, payment, signature, application, security, fraud-prevention, dispute, legal, or compliance records may be retained, detached, anonymized, or preserved when operationally or lawfully necessary.',
        'Retention periods vary by record type and by applicable law. This article does not invent a single retention period, and does not guarantee that every retained record is anonymized.',
      ],
      callouts: [
        {
          tone: 'caution',
          title: 'Third parties keep their own records',
          body:
            'Permanent account deletion on HaulTrackerPro does not itself resolve user-to-user disputes and does not erase records independently held by Stripe, carriers, recruiters, agencies, exported-file recipients, or other third parties.',
        },
      ],
    },
    {
      heading: 'If the deletion flow fails',
      paragraphs: [
        'If the deletion flow reports an error — for example due to an owner block, a Stripe issue, or a transient network failure — contact support@haultrackerpro.com and include the exact error message shown.',
        'Do not repeatedly retry a destructive request while billing status is uncertain. Repeated submissions can complicate reconciliation.',
      ],
    },
  ],
  relatedRoutes: [
    { label: 'Billing, cancellation & permanent deletion', route: '/docs/billing-cancellation' },
    { label: 'Account roles & ending relationships', route: '/docs/roles-access-relationships' },
    { label: 'Privacy Policy', route: '/privacy' },
  ],
};

// ---------------------------------------------------------------------------
// Article 3 — Account roles, delegated access, and ending relationships
// ---------------------------------------------------------------------------
const ARTICLE_ROLES: DocsArticle = {
  slug: 'roles-access-relationships',
  title: 'Account roles, delegated access, and ending relationships',
  summary:
    'How driver, recruiter, agency, and assistant roles are scoped today, and what self-service exit controls are and are not available yet.',
  category: 'accounts_roles_data',
  audiences: ['all'],
  reviewedForProductAccuracy: REVIEWED,
  sections: [
    {
      heading: 'The current role model',
      bullets: [
        'Driver / account owner — controls their driver data and manages assistant invitations and revocation.',
        'Driver assistant — receives delegated access only for the drivers they are explicitly assigned to. Must not share credentials or exceed the granted scope.',
        'Agency owner — controls the agency workspace billing and any ownership-level decisions.',
        'Agency admin / member — acts only within the workspace permissions granted by the owner. Does not own agency billing.',
        'Recruiter — controls their recruiter profile and listings, and is responsible for authority to post and for truthful opportunity information.',
      ],
      callouts: [
        {
          tone: 'info',
          title: 'One login can hold multiple capabilities',
          body:
            'Removing a single relationship or role should not be described as deleting every capability on the login.',
        },
      ],
    },
    {
      heading: 'Ending a relationship — what works today',
      bullets: [
        'Drivers can revoke assistant relationships they have granted, from the driver-side controls.',
      ],
    },
    {
      heading: 'Ending a relationship — what is not yet available',
      paragraphs: [
        'The following self-service controls are being designed but are not exposed in the current product. Do not assume they exist; use the listed workaround instead.',
      ],
      bullets: [
        'A self-service assistant "leave driver" control is not yet available. The assistant should ask the driver or agency owner to revoke access, or contact support@haultrackerpro.com.',
        'A self-service agency-member "leave agency" control is not yet available. Contact the agency owner or admin, or contact support.',
        'Self-service agency ownership transfer and self-service agency closure are not yet available. The owner must contact support, and cannot permanently delete the personal account first.',
        'A self-service recruiter-profile-only closure is not yet available. A recruiter may manage billing and listings; permanent personal deletion affects the login and every other context it owns.',
      ],
      callouts: [
        {
          tone: 'important',
          title: 'Missing controls stay missing until announced',
          body:
            'This article intentionally does not imply that the four self-service exit controls above exist yet. Follow the workaround listed for each.',
        },
      ],
    },
    {
      heading: 'Access hygiene and safety',
      paragraphs: [
        'You are responsible for reviewing who has access to your workspace and for revoking access that is no longer authorized.',
      ],
      callouts: [
        {
          tone: 'caution',
          title: 'Never share credentials',
          body:
            'Never share passwords, authentication codes, tax IDs, banking credentials, or unrestricted account access — with anyone, including someone claiming to be support.',
        },
      ],
    },
  ],
  relatedRoutes: [
    { label: 'Permanent account deletion & retained records', route: '/docs/account-deletion-data-retention' },
    { label: 'Assistants & agencies overview', route: '/assistants-agencies' },
  ],
};

// ---------------------------------------------------------------------------
// Article 4 — AI, OCR, contract analysis, and calculation limitations
// ---------------------------------------------------------------------------
const ARTICLE_AI: DocsArticle = {
  slug: 'ai-ocr-calculation-limitations',
  title: 'AI, OCR, contract analysis, and calculation limitations',
  summary:
    'How to interpret automated output — including OCR imports, AI summaries, contract review, and calculated reports — and where independent review is required before you rely on any of it.',
  category: 'ai_ocr_calculations',
  audiences: ['all'],
  reviewedForProductAccuracy: REVIEWED,
  sections: [
    {
      heading: 'OCR and import tools can misread',
      paragraphs: [
        'OCR and import tools may misread mileage, dates, locations, rates, fees, totals, or free-form document text. Handwriting, low-quality scans, unusual formatting, foreign characters, and multi-page documents make misreads more likely.',
      ],
      callouts: [
        {
          tone: 'important',
          title: 'Compare to the original before you rely on it',
          body:
            'Before relying on any imported value, compare it to the original receipt, rate confirmation, contract, or source record.',
        },
      ],
    },
    {
      heading: 'AI summaries and insights',
      paragraphs: [
        'AI-generated summaries, insights, contract analyses, and suggestions may be incomplete, outdated, or incorrect. They are informational assistance, not a substitute for reading the underlying document yourself.',
      ],
    },
    {
      heading: 'Contract analysis is not legal advice',
      paragraphs: [
        'The Contract Analyzer is informational assistance only. It is not legal advice, not attorney review, and not a guarantee that a clause is valid, enforceable, safe, or complete.',
      ],
      callouts: [
        {
          tone: 'caution',
          title: 'Have an attorney review anything you are about to sign',
          body:
            'Material business, legal, or tax decisions should be reviewed by an appropriate licensed professional before you act.',
        },
      ],
    },
    {
      heading: 'Tax, profit, RPM, and reserve calculations',
      paragraphs: [
        'Tax and report outputs are organizational estimates, not tax, accounting, payroll, legal, regulatory, insurance, or financial advice.',
        'Profit, RPM, tax reserve, and expense results depend on your inputs, your selected pay model, your expense settings, your exclusions, and the completeness of what you have entered.',
      ],
      bullets: [
        'HaulTrackerPro does not guarantee tax outcomes.',
        'HaulTrackerPro does not guarantee audit protection.',
        'HaulTrackerPro does not guarantee deductions, compliance, savings, earnings, or avoidance of penalties.',
      ],
    },
    {
      heading: 'What not to upload',
      paragraphs: [
        'Do not upload documents or personal information you do not have authority to process or share. Review any report before you export it or share it with a third party.',
      ],
    },
  ],
  relatedRoutes: [
    { label: 'Documentation home', route: '/docs' },
    { label: 'Terms of Service', route: '/terms' },
  ],
};

// ---------------------------------------------------------------------------
// Article 5 — Opportunity and recruiting safety
// ---------------------------------------------------------------------------
const ARTICLE_OPPORTUNITY: DocsArticle = {
  slug: 'opportunity-recruiting-safety',
  title: 'Opportunity and recruiting safety',
  summary:
    'What drivers should independently verify before accepting an opportunity, and what recruiters and carriers are responsible for when posting on HaulTrackerPro.',
  category: 'opportunities_contracts_safety',
  audiences: ['driver', 'recruiter'],
  reviewedForProductAccuracy: REVIEWED,
  sections: [
    {
      heading: 'For drivers — what HaulTrackerPro is and is not',
      paragraphs: [
        'Opportunities and listings are submitted by recruiters, carriers, or other users. HaulTrackerPro is a platform tool. It is not the employer, carrier, broker, staffing firm, recruiter of record, background-check provider, insurer, or a party to the employment or contract relationship — unless expressly stated otherwise in a specific written agreement.',
      ],
      callouts: [
        {
          tone: 'important',
          title: 'No blanket verification promise',
          body:
            'HaulTrackerPro does not claim that every recruiter, carrier, listing, compensation statement, route, equipment, authority, insurance status, or job posted on the platform is verified.',
        },
      ],
    },
    {
      heading: 'For drivers — independently verify before you commit',
      bullets: [
        'Identity of the recruiter or carrier you are speaking with.',
        'Carrier / operating authority (for example, active MC and DOT numbers).',
        'Compensation method, deductions, and how pay is actually calculated.',
        'Employment classification (W-2 vs 1099 vs lease) and what that means for you.',
        'Home-time expectations, dispatch behavior, and forced-dispatch rules.',
        'Equipment condition, insurance coverage, and any escrow or deposit demands.',
        'A written agreement — read it fully, and see the contract-review guidance below.',
      ],
      callouts: [
        {
          tone: 'caution',
          title: 'Do not send credentials or money through insecure channels',
          body:
            'Do not send Social Security numbers, bank credentials, authentication codes, or money through email, text, chat apps, gift cards, cryptocurrency, or any channel not verified with the carrier directly.',
        },
      ],
    },
    {
      heading: 'For drivers — common red flags',
      bullets: [
        'Upfront fees, deposits, gift cards, or cryptocurrency requests.',
        'Pressure to decide immediately or to skip the written agreement.',
        'Guaranteed earnings claims without a signed agreement backing them.',
        'Requests to bypass platform safety tools or to move the conversation off-platform to avoid oversight.',
      ],
    },
    {
      heading: 'For drivers — how to report a concern',
      paragraphs: [
        'Report misleading, discriminatory, fraudulent, abusive, expired, or unauthorized listings to support@haultrackerpro.com with the opportunity link and a short description.',
      ],
    },
    {
      heading: 'For recruiters and carriers — your obligations',
      bullets: [
        'You must have authority to post, contact, and hire for the roles you list.',
        'You must provide truthful, current, non-discriminatory information about the role, pay, and requirements.',
        'You must comply with applicable employment, privacy, advertising, transportation, and communication laws.',
        'You must not impersonate another company, scrape, spam, collect information deceptively, charge unauthorized fees, or misuse driver data.',
        'You must remove or close inaccurate or expired listings promptly and safeguard information you receive from drivers.',
      ],
    },
    {
      heading: 'Platform boundaries',
      paragraphs: [
        'HaulTrackerPro may review, restrict, remove, preserve, or report content and accounts under applicable rules, but does not guarantee detection or prevention of every bad actor or dispute.',
        "Users remain responsible for their own decisions and agreements. Nothing in this article disclaims HaulTrackerPro's own legal obligations under the applicable Terms of Service, Privacy Policy, or applicable law.",
      ],
    },
  ],
  relatedRoutes: [
    { label: 'AI, OCR & calculation limitations', route: '/docs/ai-ocr-calculation-limitations' },
    { label: 'Terms of Service', route: '/terms' },
  ],
};

// ---------------------------------------------------------------------------
// Article 6 — Settlement statements & reconciliation
// ---------------------------------------------------------------------------
const ARTICLE_SETTLEMENTS: DocsArticle = {
  slug: 'settlement-statements-reconciliation',
  title: 'Settlement statements & reconciliation',
  summary:
    'How company-issued settlement statements, load matching, and driver reconciliation work today in HaulTrackerPro — and why they are recordkeeping only.',
  category: 'drivers',
  audiences: ['driver', 'recruiter', 'agency'],
  reviewedForProductAccuracy: REVIEWED,
  sections: [
    {
      heading: 'What a settlement statement is here',
      paragraphs: [
        'A settlement statement in HaulTrackerPro is a record of what a carrier or agency reported paying a driver for a period. It has a header (period, source, status, and a reported net amount) and line items such as load pay, other earnings, reimbursements, deductions, and withholdings.',
        'A statement can only be issued to a driver the company has an accepted carrier-to-driver relationship with. The driver receives the finalized statement in their Settlements area.',
      ],
    },
    {
      heading: 'Who can issue or prepare one',
      bullets: [
        'A carrier or recruiter issuing settlements needs a paid standalone recruiter/carrier plan.',
        'An agency preparing settlements for an approved driver client needs an active paid agency plan.',
        'An assistant or agency member can only act on a driver-approved delegation, and only if the driver granted settlement permissions.',
        'Drafts can be edited, finalized, voided, or superseded by a correction; the driver sees finalized statements.',
      ],
    },
    {
      heading: 'What drivers can do on each plan',
      bullets: [
        'Every driver plan, Free and Pro: view finalized statements issued to you, open the line items, and use basic reconciliation to confirm or clear the load match on a line.',
        'Driver Pro: advanced reconciliation — refresh or reject suggested load matches — plus creating a manual record for a settlement you received outside HaulTrackerPro.',
      ],
      paragraphs: [
        'Plan gating in the interface is presentation only. The server-side rules are the authority for what an account may actually do.',
      ],
    },
    {
      heading: 'Line totals vs the reported net',
      paragraphs: [
        'HaulTrackerPro shows the net implied by the visible line items next to the reported net on the statement header. Load pay, earnings, and reimbursements add; deductions and withholdings subtract.',
        'This is a neutral comparison so a difference is visible instead of hidden. It is not an accusation, an audit, or a finding that anyone did anything wrong. A difference can also come from lines you cannot see, rounding, or data entry.',
      ],
      callouts: [
        {
          tone: 'info',
          title: 'The comparison can decline to compute',
          body: 'If a line has an unrecognized type or an invalid amount, the comparison is not shown rather than displaying a number that could be wrong.',
        },
      ],
    },
    {
      heading: 'Recordkeeping only — no money movement',
      paragraphs: [
        'HaulTrackerPro does not pay, hold, transfer, escrow, collect, verify, audit, or guarantee any settlement amount, and is not a paying agent, factoring company, payroll provider, or accountant.',
        'A finalized statement, a matched load, or a reconciliation state is not proof that payment occurred or that an amount or deduction is correct or lawful. Payment and any dispute happen outside the platform between the driver and the company that issued the statement.',
      ],
      callouts: [
        {
          tone: 'important',
          title: 'Not financial, tax, or legal advice',
          body: 'Settlement records and comparisons are informational. Confirm amounts against the original statement from the company and consult a qualified professional for financial, tax, or legal questions.',
        },
      ],
    },
  ],
  relatedRoutes: [
    { label: 'Pricing', route: '/pricing' },
    { label: 'Terms of Service', route: '/terms' },
    { label: 'Privacy Policy', route: '/privacy' },
  ],
};


// ---------------------------------------------------------------------------
// Deep-freeze construction
// ---------------------------------------------------------------------------

function freezeCallout(c: DocsArticleCallout): DocsArticleCallout {
  return Object.freeze(c);
}

function freezeSection(s: DocsArticleSection): DocsArticleSection {
  if (s.paragraphs) Object.freeze(s.paragraphs);
  if (s.bullets) Object.freeze(s.bullets);
  if (s.callouts) {
    s.callouts.forEach(freezeCallout);
    Object.freeze(s.callouts);
  }
  return Object.freeze(s);
}

function freezeArticle(a: DocsArticle): DocsArticle {
  Object.freeze(a.audiences);
  a.sections.forEach(freezeSection);
  Object.freeze(a.sections);
  if (a.callouts) {
    a.callouts.forEach(freezeCallout);
    Object.freeze(a.callouts);
  }
  if (a.relatedRoutes) {
    a.relatedRoutes.forEach((r) => Object.freeze(r));
    Object.freeze(a.relatedRoutes);
  }
  return Object.freeze(a);
}

const ARTICLES: readonly DocsArticle[] = Object.freeze(
  [
    ARTICLE_BILLING,
    ARTICLE_DELETION,
    ARTICLE_ROLES,
    ARTICLE_AI,
    ARTICLE_OPPORTUNITY,
  ].map(freezeArticle),
);

/** Canonical route prefix for every article page. */
export const DOCS_ARTICLE_ROUTE_PREFIX = '/docs/' as const;

/** Return the frozen canonical list of articles. */
export function getAllArticles(): readonly DocsArticle[] {
  return ARTICLES;
}

/** Return the frozen canonical article by slug, or `null` if unknown. */
export function getArticleBySlug(slug: string): DocsArticle | null {
  const found = ARTICLES.find((a) => a.slug === slug);
  return found ?? null;
}

/** Full public route for an article slug. */
export function articleRoute(slug: string): string {
  return `${DOCS_ARTICLE_ROUTE_PREFIX}${slug}`;
}

/** Frozen list of every article's full public route, in canonical order. */
export function getAllArticleRoutes(): readonly string[] {
  return Object.freeze(ARTICLES.map((a) => articleRoute(a.slug)));
}
