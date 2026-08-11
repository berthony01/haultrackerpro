/**
 * Phase 1U-A-R1 — public truth repair acceptance.
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
const FAQ = read('src/pages/FAQ.tsx');
const TERMS = read('src/pages/Terms.tsx');
const PRIVACY = read('src/pages/Privacy.tsx');
const DOCS_ARTICLES = read('src/lib/docs/docsArticles.ts');
const HOWTO = read('src/pages/HowToUseHaulTrackerPro.tsx');
const RECRUITER_FEATURES = read('src/lib/recruiterFeatureList.ts');
const RECRUITER_FAQ = read('src/pages/recruiter/RecruiterFAQ.tsx');
const RECRUITER_GUIDE = read('src/pages/recruiter/RecruiterGuide.tsx');

describe('Phase 1U-A-R1 — recruiter readiness truth', () => {
  it('recruiter guide states DOT/MC is carrier-only for standard posting', () => {
    expect(RECRUITER_GUIDE).toContain('required only when your company type is Carrier / Motor Carrier');
    expect(RECRUITER_GUIDE).toContain('do not need DOT or MC for standard posting');
  });

  it('recruiter FAQ states canonical readiness fields without address/states/equipment gating', () => {
    expect(RECRUITER_FAQ).toContain('recruiter name, company name, a valid recruiter email, and company type');
    expect(RECRUITER_FAQ).not.toContain('address, hiring states, equipment types');
  });

  it('driver FAQ repeats the carrier-only DOT/MC rule and the non-gating badge rule', () => {
    expect(FAQ).toContain('required only when the company type is Carrier / Motor Carrier');
    expect(FAQ).toContain('not gated on Verified Recruiter badge approval');
  });

  it('recruiter guide and pricing keep the badge separate from posting', () => {
    expect(RECRUITER_GUIDE).toContain('does not gate standard posting');
    expect(PRICING).toContain('it does not gate standard posting');
  });
});

describe('Phase 1U-A-R1 — recruiter paste-to-autofill truth', () => {
  it('recruiter feature list documents paste-to-autofill with review before submit', () => {
    expect(RECRUITER_FEATURES).toContain('Paste Opportunity to Auto-Fill');
    expect(RECRUITER_FEATURES).toContain('nothing is saved as an opportunity until you submit the form');
  });

  it('driver feature list documents recruiter paste-to-autofill', () => {
    expect(FEATURE_LIST).toContain('Recruiter Paste Opportunity to Auto-Fill');
  });

  it('recruiter FAQ and driver FAQ both document paste-to-autofill', () => {
    expect(RECRUITER_FAQ).toContain('Can I paste an existing job post instead of typing the form?');
    expect(FAQ).toContain('recruiter-paste-autofill');
  });

  it('recruiter guide step 04 mentions pasting a job post', () => {
    expect(RECRUITER_GUIDE).toContain('paste an existing job post, recruiter pitch, or rate sheet');
  });
});

describe('Phase 1U-A-R1 — plan limits and Fleet availability', () => {
  it('Fleet preview-only recruiter card is labeled existing/included access', () => {
    expect(PRICING).toContain("p.previewOnly ? 'Existing / Included Access' : 'Available Now'");
  });

  it('canonical 1/5/15/25 active limits remain documented', () => {
    expect(RECRUITER_FAQ).toContain('up to 5 active opportunities');
    expect(RECRUITER_FAQ).toContain('up to 15 active opportunities');
    expect(RECRUITER_FAQ).toContain('up to 25 active opportunities');
    expect(RECRUITER_GUIDE).toContain('1 active opportunity at a time');
  });

  it('recruiter FAQ points to Stripe as the billing source of truth', () => {
    expect(RECRUITER_FAQ).toContain('the Stripe portal is the source of truth');
    expect(RECRUITER_FAQ).not.toContain('Cancellations take effect at the end of the current period.');
  });
});

describe('Phase 1U-A-R1 — settlement authority truth', () => {
  it('carrier issuance requires standalone paid entitlement plus relationship', () => {
    for (const src of [RECRUITER_FEATURES, RECRUITER_GUIDE, FEATURE_LIST, TERMS, DOCS_ARTICLES]) {
      expect(src).toContain('standalone paid recruiter/carrier entitlement');
    }
  });

  it('agency-included recruiter entitlement is excluded from carrier issuance', () => {
    for (const src of [RECRUITER_FEATURES, RECRUITER_GUIDE, FEATURE_LIST, TERMS, DOCS_ARTICLES, RECRUITER_FAQ, FAQ]) {
      expect(src).toMatch(/agency-included recruiter entitlement/i);
    }
  });

  it('agency preparation and finalization require the matching delegated permissions', () => {
    for (const src of [AGENCY_PLANS, FEATURE_LIST, TERMS, DOCS_ARTICLES, FAQ]) {
      expect(src).toContain('settlement-finalize permission');
    }
    expect(AGENCY_PLANS).toContain('settlement-management permission');
  });

  it('recipient-driver Pro inheritance is stated for assistants and agencies', () => {
    expect(AGENCY_PLANS).toContain("recipient driver's Pro entitlement");
    expect(TERMS).toContain("recipient driver's own Driver Pro entitlement");
    expect(FAQ).toContain('does not gate paid agency preparation');
  });

  it('assistant settlement permission scopes are distinguished in Terms and Privacy', () => {
    expect(TERMS).toContain('settlement view permission allows viewing statements');
    expect(PRIVACY).toContain('settlement view, settlement-management, or settlement-finalize permission granted');
  });
});

describe('Phase 1U-A-R1 — settlement boundary truth', () => {
  const boundary = /does not process payroll|not process payroll/i;

  it('no-payroll/no-ACH boundary appears in the public truth layer', () => {
    for (const src of [FEATURE_LIST, RECRUITER_FEATURES, TERMS, DOCS_ARTICLES, HOWTO, FAQ]) {
      expect(src).toMatch(boundary);
    }
  });

  it('employer tax form and classification boundaries are stated', () => {
    expect(TERMS).toContain('issue or file employer tax forms');
    expect(TERMS).toContain('determine worker classification');
    expect(PRIVACY).toContain('does not issue or file employer tax forms');
  });

  it('driver Free vs Pro reconciliation split remains documented', () => {
    expect(FAQ).toContain('Driver Free covers delivered statements and basic reconciliation');
    expect(HOWTO).toContain('Basic reconciliation is on every driver plan');
  });

  it('line-total vs reported-net difference is framed as informational', () => {
    expect(FAQ).toContain('does not by itself prove underpayment or overpayment');
  });
});

describe('Phase 1U-A-R1 — agency billing and docs freshness', () => {
  it('agency subscriptions are described as live with service payments outside', () => {
    expect(PRICING).toContain('Agency subscriptions are live and billed through Stripe');
    expect(PRICING).toContain('does not\n            process service payments between an agency and its driver clients.');
  });

  it('docs articles carry the refreshed product-accuracy review date', () => {
    expect(DOCS_ARTICLES).toContain("const REVIEWED = '2026-08-10' as const;");
    expect(DOCS_ARTICLES).not.toContain('2026-07-24');
  });

  it('docs articles route support contact through Settings → Send Feedback', () => {
    expect(DOCS_ARTICLES).not.toContain('support@haultrackerpro.com');
    expect(DOCS_ARTICLES).toContain('Settings → Send Feedback');
  });
});

describe('Phase 1U-A-R1 — locked legal contact sentences preserved', () => {
  it('Terms contact sentence is unchanged', () => {
    expect(TERMS).toContain('For questions about these Terms of Service, sign in to your HaulTrackerPro account, open Settings, and select Send Feedback.');
  });

  it('Privacy contact sentence is unchanged', () => {
    expect(PRIVACY).toContain('For questions about this Privacy Policy or your data, sign in to your HaulTrackerPro account, open Settings, and select Send Feedback.');
  });
});

