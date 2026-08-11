/**
 * Phase 1U-A — public product truth + settlement documentation alignment.
 *
 * Source-contract proofs only. No network, no database, no runtime clocks.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');

const PRICING = read('src/pages/Pricing.tsx');
const AGENCY_PLANS = read('src/lib/agencyPlans.ts');
const FEATURE_LIST = read('src/lib/featureList.ts');
const FEATURES_PAGE = read('src/pages/Features.tsx');
const FAQ = read('src/pages/FAQ.tsx');
const TERMS = read('src/pages/Terms.tsx');
const PRIVACY = read('src/pages/Privacy.tsx');
const DOCS_REGISTRY = read('src/lib/docs/docsRegistry.ts');
const DOCS_ARTICLES = read('src/lib/docs/docsArticles.ts');
const HOWTO = read('src/pages/HowToUseHaulTrackerPro.tsx');
const RECRUITER_FEATURES = read('src/lib/recruiterFeatureList.ts');
const RECRUITER_FEATURES_PAGE = read('src/pages/recruiter/RecruiterFeatures.tsx');
const RECRUITER_FAQ = read('src/pages/recruiter/RecruiterFAQ.tsx');
const RECRUITER_GUIDE = read('src/pages/recruiter/RecruiterGuide.tsx');
const ASSISTANTS = read('src/pages/AssistantsAgencies.tsx');

describe('Phase 1U-A — A. Driver settlement truth in pricing and features', () => {
  it('Pricing free plan lists viewing and basic reconciliation', () => {
    expect(PRICING).toContain('View finalized settlement statements issued to you');
    expect(PRICING).toContain('Basic settlement reconciliation');
  });

  it('Pricing Pro plan lists advanced reconciliation and manual records', () => {
    expect(PRICING).toContain('Advanced settlement reconciliation (refresh or reject suggested load matches)');
    expect(PRICING).toContain('Create manual records for settlements you received outside HaulTrackerPro');
  });

  it('Pricing comparison table states HaulTrackerPro does not process settlement payments', () => {
    expect(PRICING).toContain('Settlement payment processing by HaulTrackerPro');
    expect(PRICING).toContain('Not offered — recordkeeping only');
  });

  it('featureList has a settlement category with free/pro split and no money movement', () => {
    expect(FEATURE_LIST).toContain('Settlement Statements & Reconciliation');
    expect(FEATURE_LIST).toContain('Basic Reconciliation (Free)');
    expect(FEATURE_LIST).toContain('Advanced Reconciliation (Pro)');
    expect(FEATURE_LIST).toContain('Manual Outside-Settlement Records (Pro)');
    expect(FEATURE_LIST).toContain('Recordkeeping Only — No Money Movement');
  });

  it('Features page SEO description mentions settlement statements', () => {
    expect(FEATURES_PAGE).toContain('settlement statements');
  });

  it('How-to page reflects settlements and OCR receipt wording', () => {
    expect(HOWTO).toContain('Settlement Statements');
    expect(HOWTO).toContain('Receipt & screenshot scanning (OCR text extraction)');
    expect(HOWTO).not.toContain('AI Receipt Scanning');
  });
});

describe('Phase 1U-A — B. Recruiter limit and settlement truth', () => {
  it('recruiter marketing no longer claims unlimited standard posting', () => {
    expect(RECRUITER_FAQ).not.toContain('unlimited standard opportunities');
    expect(RECRUITER_FAQ).not.toContain('unlimited standard opportunity posts');
    expect(RECRUITER_GUIDE).not.toContain('Post unlimited standard opportunities');
    expect(RECRUITER_FEATURES_PAGE).not.toContain('unlimited standard opportunity posting');
  });

  it('recruiter FAQ states the canonical 1/5/15/25 limits and unlimited drafts', () => {
    expect(RECRUITER_FAQ).toContain('1 active opportunity at a time with unlimited drafts');
    expect(RECRUITER_FAQ).toContain('up to 5 active opportunities');
    expect(RECRUITER_FAQ).toContain('up to 15 active opportunities');
    expect(RECRUITER_FAQ).toContain('up to 25 active opportunities');
    expect(RECRUITER_FAQ).toContain('new standalone Fleet checkout is unavailable');
  });

  it('driver FAQ recruiter answers match the canonical limits', () => {
    expect(FAQ).toContain('Recruiter Standard allows 1 active opportunity at a time');
    expect(FAQ).toContain('Starter ($19/month) allows up to 5 active opportunities');
    expect(FAQ).toContain('Growth ($49/month) allows up to 15 active opportunities');
    expect(FAQ).toContain('Fleet ($149/month) allows up to 25 active opportunities');
  });

  it('recruiter feature sheet documents settlement issuance as paid and recordkeeping only', () => {
    expect(RECRUITER_FEATURES).toContain('Settlement Statements (Paid Plans)');
    expect(RECRUITER_FEATURES).toContain('standalone paid recruiter/carrier entitlement');
    expect(RECRUITER_FEATURES).toContain('active paid agency plan');
    expect(RECRUITER_FEATURES).toContain('does not pay, hold, transfer, escrow, verify, or guarantee any settlement amount');
  });

  it('recruiter guide adds a settlement step gated to paid plans', () => {
    expect(RECRUITER_GUIDE).toContain('Issue settlement statements on a standalone paid plan');
  });
});

describe('Phase 1U-A — C. Contact disclosure requires driver approval', () => {
  it('driver FAQ, recruiter FAQ, Terms and Privacy all require approval before phone/email release', () => {
    expect(FAQ).toContain('after the driver approves a separate contact request');
    expect(RECRUITER_FAQ).toContain('only after the driver approves a separate contact request');
    expect(TERMS).toContain('only after you approve a separate contact request');
    expect(PRIVACY).toContain('only after the driver approves a separate contact request');
  });

  it('drops the old automatic contact-snapshot claim', () => {
    expect(PRIVACY).not.toContain('This contact snapshot is taken at the moment of the request');
    expect(RECRUITER_FAQ).not.toContain('you receive a contact snapshot (name, email, and phone if provided) at the moment of the request');
  });
});

describe('Phase 1U-A — D. Agency settlement preparation truth', () => {
  it('agency plans expose settlement preparation and a recordkeeping disclaimer', () => {
    expect(AGENCY_PLANS).toContain('Prepare settlement statements for delegated driver clients');
    expect(AGENCY_PLANS).toContain('AGENCY_SETTLEMENT_RECORDKEEPING_DISCLAIMER');
    expect(AGENCY_PLANS).toContain('does not pay, hold, transfer, verify, or guarantee any settlement amount');
  });

  it('Pricing renders the agency settlement recordkeeping disclaimer', () => {
    expect(PRICING).toContain('AGENCY_SETTLEMENT_RECORDKEEPING_DISCLAIMER');
  });

  it('assistants & agencies page states settlement prep and the no-money-movement boundary', () => {
    expect(ASSISTANTS).toContain('Paid agency plans can prepare settlement statements for approved driver clients (recordkeeping only)');
    expect(ASSISTANTS).toContain('settlement statements are recordkeeping only');
  });
});

describe('Phase 1U-A — E. Legal pages cover settlement records', () => {
  it('Terms adds an unnumbered settlement section with the recordkeeping boundary', () => {
    expect(TERMS).toContain('Settlement Statements &amp; Reconciliation (Recordkeeping Only)');
    expect(TERMS).toContain('does <span className="font-semibold text-foreground">not</span> pay, hold, transfer, escrow, collect, verify, audit, or guarantee any settlement amount');
    expect(TERMS).toContain('30. Contact Information');
  });

  it('Privacy adds an unnumbered settlement data section', () => {
    expect(PRIVACY).toContain('Settlement Statement Data');
    expect(PRIVACY).toContain('does not collect bank account or payout information for settlements');
    expect(PRIVACY).toContain('21. Contact Information');
  });
});

describe('Phase 1U-A — F. Settlement docs article', () => {
  it('registry exposes the live settlement article route', () => {
    expect(DOCS_REGISTRY).toContain('settlement-statements-reconciliation');
    expect(DOCS_REGISTRY).toContain('/docs/settlement-statements-reconciliation');
  });

  it('article exists, is registered, and keeps the frozen literal reviewed date', () => {
    expect(DOCS_ARTICLES).toContain('ARTICLE_SETTLEMENTS');
    expect(DOCS_ARTICLES).toContain("slug: 'settlement-statements-reconciliation'");
    expect(DOCS_ARTICLES).toContain('reviewedForProductAccuracy: REVIEWED');
    expect(DOCS_ARTICLES).toContain("const REVIEWED = '2026-08-10' as const;");
    expect(DOCS_ARTICLES).not.toMatch(/new Date\(|Date\.now\(/);
  });

  it('article states plan boundaries and the recordkeeping-only limitation', () => {
    expect(DOCS_ARTICLES).toContain('standalone paid recruiter/carrier entitlement');
    expect(DOCS_ARTICLES).toContain('active paid agency plan');
    expect(DOCS_ARTICLES).toContain('does not pay, hold, transfer, escrow, collect, verify, audit, or guarantee any settlement amount');
    expect(DOCS_ARTICLES).toContain('Not financial, tax, or legal advice');
  });
});

// ---------------------------------------------------------------------------
// Phase 1U-A-R2 acceptance
// ---------------------------------------------------------------------------

const POLICY_REGISTRY = read('src/lib/legal/policyRegistry.ts');
const DOCS_PAGE = read('src/pages/Docs.tsx');

describe('Phase 1U-A-R2 — A. Pricing Fleet preview availability is muted', () => {
  it('availability line color is conditional on previewOnly and muted, not green', () => {
    expect(PRICING).toContain(
      "style={{ color: p.previewOnly ? 'hsl(220, 10%, 55%)' : 'hsl(152, 60%, 52%)' }}",
    );
    expect(PRICING).toContain("{p.previewOnly ? 'Existing / Included Access' : 'Available Now'}");
    expect(PRICING).toContain('PREVIEW ONLY');
  });
});

describe('Phase 1U-A-R2 — B. Terms recruiter truth', () => {
  it('coverage note adds assistants, agencies, delegation and settlements', () => {
    expect(TERMS).toContain('These terms now cover both driver/owner-operator accounts and recruiter/carrier accounts, including verification, anti-harassment, anti-scam, and billing terms.');
    expect(TERMS).toContain('They also cover driver assistants, agencies, delegated access, and settlement statement recordkeeping and reconciliation.');
  });

  it('§10 states canonical readiness and drops the verification posting gate', () => {
    expect(TERMS).toContain('Standard opportunity posting readiness requires a recruiter name, a company name, a valid recruiter email, a company type, acceptance of the current posting terms, and a non-suspended account.');
    expect(TERMS).toContain("A DOT or MC number is required only when the account's company type is Carrier / Motor Carrier.");
    expect(TERMS).toContain('The Verified Recruiter badge is a separate review and does not gate standard posting.');
    expect(TERMS).not.toContain('Recruiter accounts are subject to verification before opportunities can be posted.');
    expect(TERMS).toContain('only after the driver approves a separate contact request');
  });

  it('§11 drops approval language and states 1/5/15/25 with unlimited drafts', () => {
    expect(TERMS).not.toContain('Recruiter access requires approval.');
    expect(TERMS).toContain('Recruiter Standard 1 active opportunity, Starter 5 active opportunities, Growth 15 active opportunities, and Fleet 25 active opportunities');
    expect(TERMS).toContain('Drafts are unlimited on every tier.');
    expect(TERMS).toContain('New standalone Fleet checkout is currently unavailable');
  });

  it('§21 drops the universal USDOT/MC requirement', () => {
    expect(TERMS).not.toContain('with an active USDOT/MC number');
    expect(TERMS).toContain('Accounts whose company type is Carrier / Motor Carrier must provide a DOT or MC number.');
    expect(TERMS).toContain('may use recruiter access without a DOT or MC number for standard posting');
    expect(TERMS).toContain('HaulTrackerPro may reject, suspend, or revoke recruiter access at any time');
  });

  it('§23 allows own-listing application data and preserves anti-scrape rules', () => {
    expect(TERMS).toContain('Recruiters may use the application and profile information a driver submitted to their own listing');
    expect(TERMS).toContain("A driver's private phone number and email address are released to a recruiter only after the driver approves a separate contact request.");
    expect(TERMS).toContain('may not scrape or off-platform-solicit drivers sourced through HaulTrackerPro');
  });

  it('settlement section keeps the informational, non-blocking comparison rule', () => {
    expect(TERMS).toContain('it does not by itself prove underpayment or overpayment and does not block finalization');
  });
});

describe('Phase 1U-A-R2 — C. Privacy data truth', () => {
  it('coverage note adds delegation, settlement and AI/OCR scope', () => {
    expect(PRIVACY).toContain('This policy now describes data collected from recruiter and carrier accounts, what drivers see, and how Stripe handles billing data.');
    expect(PRIVACY).toContain('It also describes data from driver assistants, agencies and delegated access, settlement statements and reconciliation, and AI, OCR and automated extraction features.');
  });

  it('§1 lists fuel/operational, delegation, settlement and AI/OCR inputs', () => {
    expect(PRIVACY).toContain('Fuel and operational data');
    expect(PRIVACY).toContain('Driver assistant, agency, and delegation records');
    expect(PRIVACY).toContain('Settlement and reconciliation records');
    expect(PRIVACY).toContain('AI, OCR, and automated extraction inputs');
    expect(PRIVACY).toContain('Your private phone number and email address are not shared merely because you applied or requested information');
  });

  it('§2 covers subscription billing across contexts plus delegation and settlements', () => {
    expect(PRIVACY).not.toContain('Process recruiter subscriptions through Stripe');
    expect(PRIVACY).toContain('Process subscription billing through Stripe across driver, recruiter, and agency contexts');
    expect(PRIVACY).toContain('Operate delegated workflows between drivers and their approved assistants or agencies');
    expect(PRIVACY).toContain('Provide settlement statement recordkeeping and reconciliation');
  });

  it('§4 Stripe parenthetical is subscription billing generally', () => {
    expect(PRIVACY).toContain('and Stripe for subscription billing');
    expect(PRIVACY).not.toContain('and Stripe for recruiter billing');
  });

  it('§7 no longer implies contact info was already shared', () => {
    expect(PRIVACY).not.toContain('contact information already shared with the recruiter cannot be retroactively recalled');
    expect(PRIVACY).toContain('application and profile data you already submitted may already have been shared with the recruiter for that listing');
  });

  it('unnumbered sections carry the exact renamed headings', () => {
    expect(PRIVACY).toContain('Driver Assistants, Agencies &amp; Delegated Access Data');
    expect(PRIVACY).toContain('Settlement &amp; Reconciliation Data');
    expect(PRIVACY).toContain('AI, OCR &amp; Automated Extraction Data');
    expect(PRIVACY).not.toContain('>Settlement Statement Data<');
    expect(PRIVACY).not.toContain('>Assistant &amp; Agency Access Data<');
  });

  it('delegated section enumerates the delegation record categories', () => {
    for (const s of ['memberships', 'client requests', 'delegation records', 'permission grants', 'work items', 'service packages', 'audit activity']) {
      expect(PRIVACY).toContain(s);
    }
  });

  it('settlement section states provenance, snapshots, lifecycle and no payout collection', () => {
    expect(PRIVACY).toContain('statement source and provenance');
    expect(PRIVACY).toContain('period, reference and payer snapshots');
    expect(PRIVACY).toContain('including deductions and withholdings');
    expect(PRIVACY).toContain('load matches and reconciliation results');
    expect(PRIVACY).toContain('no bank payout instructions are collected for settlement payroll because the feature does not pay drivers');
  });

  it('AI/OCR section lists the extraction inputs and the paste non-persistence rule', () => {
    for (const s of ['pasted load text', 'pasted opportunity text', 'rate confirmations', 'receipt and screenshot scanning', 'clause and contract text']) {
      expect(PRIVACY).toContain(s);
    }
    expect(PRIVACY).toContain('The opportunity paste extractor does not save the pasted text as an opportunity until you submit the form.');
  });

  it('§14 qualifies DOT/MC collection to carrier profiles without new retention promises', () => {
    expect(PRIVACY).toContain('USDOT and MC numbers are collected where applicable to Carrier / Motor Carrier recruiter profiles.');
    expect(PRIVACY).toContain('retained while active and for up to 24 months after closure');
  });
});

describe('Phase 1U-A-R2 — D/E. Docs registry and settlement article metadata', () => {
  it('registry entry uses accounts_roles_data with all four audiences and pay-statement keywords', () => {
    expect(DOCS_REGISTRY).toContain(
      "        category: 'accounts_roles_data',\n        audiences: ['driver', 'recruiter', 'driver_assistant', 'agency'],",
    );
    expect(DOCS_REGISTRY).toContain("'pay statement'");
    expect(DOCS_REGISTRY).toContain("'pay-statement'");
    expect(DOCS_REGISTRY).toContain("'reconciliation'");
  });

  it('article metadata matches the registry entry', () => {
    expect(DOCS_ARTICLES).toContain(
      "  category: 'accounts_roles_data',\n  audiences: ['driver', 'recruiter', 'driver_assistant', 'agency'],",
    );
  });

  it('article removes the internal server-authority sentence', () => {
    expect(DOCS_ARTICLES).not.toContain('The server-side rules are the authority');
    expect(DOCS_ARTICLES).toContain('Plan gating in the interface is presentation only.');
  });

  it('article keeps driver Free basic vs Pro advanced/import truth', () => {
    expect(DOCS_ARTICLES).toContain('use basic reconciliation to confirm or clear the load match on a line');
    expect(DOCS_ARTICLES).toContain('Driver Pro: advanced reconciliation');
  });

  it('article states the informational, non-blocking comparison', () => {
    expect(DOCS_ARTICLES).toContain('It does not by itself prove underpayment or overpayment, and it does not block finalization of the statement.');
  });

  it('article documents CSV export, browser print, lifecycle history and independent verification', () => {
    expect(DOCS_ARTICLES).toContain('export settlement data to CSV');
    expect(DOCS_ARTICLES).toContain('browser print function');
    expect(DOCS_ARTICLES).toContain('creates a correction draft that supersedes the earlier version');
    expect(DOCS_ARTICLES).toContain('Finalize, void, correction and supersede events are recorded');
    expect(DOCS_ARTICLES).toContain('verify a statement independently against the original source statement');
  });

  it('article keeps the no-payroll / no-ACH boundary and authority rules', () => {
    expect(DOCS_ARTICLES).toContain('does not process payroll, send ACH or direct deposit');
    expect(DOCS_ARTICLES).toContain('an agency-included recruiter entitlement is a recruiting entitlement only');
    expect(DOCS_ARTICLES).toContain('settlement view permission to view, settlement-management permission to prepare or modify, and settlement-finalize permission to finalize');
  });
});

describe('Phase 1U-A-R2 — F. Docs landing page', () => {
  it('mentions settlement statements and reconciliation as documented functionality', () => {
    expect(DOCS_PAGE).toContain('settlement statements and reconciliation');
  });

  it('states the no-payroll, recordkeeping-only boundary', () => {
    expect(DOCS_PAGE).toContain('HaulTrackerPro does not process payroll or settlement payments');
    expect(DOCS_PAGE).toContain('recordkeeping and reconciliation only');
  });
});

describe('Phase 1U-A-R2 — G. Driver how-to settlement guidance', () => {
  it('adds a visible settlement guidance block with the five required points', () => {
    expect(HOWTO).toContain('Working a settlement statement');
    expect(HOWTO).toContain('Compare the statement lines against your own load records');
    expect(HOWTO).toContain('is informational');
    expect(HOWTO).toContain('A mismatch alone is not proof of underpayment or overpayment, and it does not block finalization.');
    expect(HOWTO).toContain("CSV export and your browser's print function are available");
    expect(HOWTO).toContain('HaulTrackerPro does not process payroll and does not pay drivers');
  });

  it('does not imply every driver receives a settlement statement', () => {
    expect(HOWTO).toContain('Not every driver receives a settlement statement.');
  });
});

describe('Phase 1U-A-R2 — H. Assistants & agencies page', () => {
  it('states agency software subscriptions are live and only service payments are outside', () => {
    expect(ASSISTANTS).toContain('Agency software subscriptions are already live and billed through Stripe.');
    expect(ASSISTANTS).toContain('Only service payments between drivers and assistants or agencies remain outside HaulTracker Pro.');
    expect(ASSISTANTS).not.toContain('Future agency billing features may come later');
    expect(ASSISTANTS).not.toContain('does NOT do yet');
  });

  it('states direct-assistant settlement permission truth', () => {
    expect(ASSISTANTS).toContain('Settlement view permission is required to view a statement, settlement-management permission is required to manage or prepare one, and settlement-finalize permission is required to finalize one.');
    expect(ASSISTANTS).toContain("Advanced reconciliation and imported outside settlements follow the recipient driver's own Pro entitlement, never the assistant's plan");
    expect(ASSISTANTS).toContain('assistant finalization also requires the recipient driver to be on Pro');
  });

  it('states paid-agency settlement permission truth', () => {
    expect(ASSISTANTS).toContain('when settlement-management permission has been granted');
    expect(ASSISTANTS).toContain('Finalizing additionally requires settlement-finalize permission.');
    expect(ASSISTANTS).toContain('The recipient driver being Free or Pro does not gate paid agency preparation.');
  });

  it('keeps the side-hustle and no-income-guarantee boundaries', () => {
    expect(ASSISTANTS).toContain('does not guarantee clients, customers, or income');
    expect(ASSISTANTS).toContain('back-office side hustle');
  });
});

describe('Phase 1U-A-R2 — I. Locked legal invariants', () => {
  it('Terms §30 and Privacy §21 Send Feedback sentences are unchanged', () => {
    expect(TERMS).toContain('30. Contact Information');
    expect(TERMS).toContain('For questions about these Terms of Service, sign in to your HaulTrackerPro account, open Settings, and select Send Feedback.');
    expect(PRIVACY).toContain('21. Contact Information');
    expect(PRIVACY).toContain('For questions about this Privacy Policy or your data, sign in to your HaulTrackerPro account, open Settings, and select Send Feedback.');
  });

  it('Terms and Privacy numbered heading order is unchanged', () => {
    const nums = (src: string) =>
      [...src.matchAll(/font-bold">(\d+)\./g)].map((m) => Number(m[1]));
    const termsNums = nums(TERMS);
    const privacyNums = nums(PRIVACY);
    expect(termsNums).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(privacyNums).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
  });

  it('policy metadata stays pending-driven and the registry is untouched', () => {
    expect(TERMS).toContain('POLICY_METADATA_PENDING_LABEL');
    expect(PRIVACY).toContain('POLICY_METADATA_PENDING_LABEL');
    expect(POLICY_REGISTRY).toContain('POLICY_METADATA_PENDING_LABEL');
  });
});

