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
    expect(DOCS_ARTICLES).not.toMatch(/new Date\(|Date\.now\(/);
  });

  it('article states plan boundaries and the recordkeeping-only limitation', () => {
    expect(DOCS_ARTICLES).toContain('standalone paid recruiter/carrier entitlement');
    expect(DOCS_ARTICLES).toContain('active paid agency plan');
    expect(DOCS_ARTICLES).toContain('does not pay, hold, transfer, escrow, collect, verify, audit, or guarantee any settlement amount');
    expect(DOCS_ARTICLES).toContain('Not financial, tax, or legal advice');
  });
});
