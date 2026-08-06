import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');

const DASHBOARD = read('src/components/opportunities/RecruiterApplicationsDashboard.tsx');
const RECRUITER_FEATURES = read('src/lib/recruiterFeatureList.ts');
const AGENCY_PLANS = read('src/lib/agencyPlans.ts');
const PRICING = read('src/pages/Pricing.tsx');
const FEATURE_LIST = read('src/lib/featureList.ts');
const AI_INSIGHT = read('supabase/functions/ai-insight/index.ts');

describe('Phase 1S-A1 — A. Recruiter applications access follows canonical readiness', () => {
  it('destructures and gates on canPost', () => {
    expect(DASHBOARD).toContain('canPost');
    expect(DASHBOARD).toContain('if (!canPost)');
  });

  it('does not gate on isApproved', () => {
    expect(DASHBOARD).not.toContain('if (!isApproved)');
    expect(DASHBOARD).not.toContain('isApproved');
  });

  it('removes the badge-approval copy', () => {
    expect(DASHBOARD).not.toContain('Awaiting Approval');
    expect(DASHBOARD).not.toContain(
      'Your recruiter profile must be approved before you can view applications.',
    );
  });

  it('shows controlled profile-completion copy', () => {
    expect(DASHBOARD).toContain('Complete Your Recruiter Profile');
    expect(DASHBOARD).toContain(
      'Complete the required recruiter profile fields and accept the current posting terms before managing applications.',
    );
  });

  it('keeps the suspended recruiter block', () => {
    expect(DASHBOARD).toContain('if (isSuspended)');
    expect(DASHBOARD).toContain('Recruiter Access Suspended');
  });
});

describe('Phase 1S-A1 — B. Recruiter feature-sheet limit truth', () => {
  it('drops the obsolete unlimited-standard-post claim', () => {
    expect(RECRUITER_FEATURES).not.toContain('Unlimited Standard Posts');
    expect(RECRUITER_FEATURES).not.toContain('post unlimited standard opportunities');
  });

  it('states 1/5/15/25 active limits and unlimited drafts', () => {
    expect(RECRUITER_FEATURES).toContain('Recruiter Standard includes 1 active opportunity');
    expect(RECRUITER_FEATURES).toContain('Starter includes 5 active opportunities');
    expect(RECRUITER_FEATURES).toContain('Growth includes 15');
    expect(RECRUITER_FEATURES).toContain('Fleet includes 25 active opportunities');
    expect(RECRUITER_FEATURES).toContain('unlimited drafts');
  });

  it('states Fleet standalone checkout is unavailable', () => {
    expect(RECRUITER_FEATURES).toContain('new standalone Fleet checkout is unavailable');
  });

  it('does not claim Starter, Growth and Fleet are all newly available via Stripe', () => {
    expect(RECRUITER_FEATURES).not.toContain(
      'Starter, Growth, and Fleet plans billed monthly through Stripe',
    );
    expect(RECRUITER_FEATURES).toContain(
      'Starter and Growth standalone recruiter subscriptions are available through Stripe',
    );
    expect(RECRUITER_FEATURES).toContain(
      'Fleet remains preview-only for new standalone subscriptions',
    );
  });

  it('preserves badge, contracts, referrals, moderation, and sheet download', () => {
    expect(RECRUITER_FEATURES).toContain('Verified Recruiter Badge Review');
    expect(RECRUITER_FEATURES).toContain('Contract Protection');
    expect(RECRUITER_FEATURES).toContain('Driver-to-Driver Referrals');
    expect(RECRUITER_FEATURES).toContain('Trust & Moderation');
    expect(RECRUITER_FEATURES).toContain('downloadRecruiterFeatureSheet');
  });
});

describe('Phase 1S-A1 — C. Agency Growth wording', () => {
  it('uses the accurate shared work queue capability', () => {
    expect(AGENCY_PLANS).toContain('Shared work queue and notifications');
    expect(AGENCY_PLANS).not.toContain('Advanced work queue');
  });
});

describe('Phase 1S-A1 — D. Receipt scanning marketing truth', () => {
  it('Pricing uses OCR receipt wording', () => {
    expect(PRICING).toContain('Snap a receipt — OCR fills in the expense details');
    expect(PRICING).not.toContain('Snap a receipt, AI fills in the expense');
  });

  it('Pricing comparison label says OCR', () => {
    expect(PRICING).toContain('Receipt scanning (OCR)');
    expect(PRICING).not.toContain('Receipt scanning (AI)');
  });

  it('Pricing drops the vague Starter bullet but keeps concrete Starter benefits', () => {
    expect(PRICING).not.toContain('Enhanced applicant tracking');
    expect(PRICING).toContain('Everything in Recruiter Standard');
    expect(PRICING).toContain('Up to 5 active opportunities at a time');
    expect(PRICING).toContain('Unlimited drafts');
    expect(PRICING).toContain('Applicant status history');
    expect(PRICING).toContain('Basic referral tracking view');
  });

  it('featureList uses OCR wording and does not claim AI receipt extraction', () => {
    expect(FEATURE_LIST).toContain('Receipt & Screenshot OCR Scanning');
    expect(FEATURE_LIST).not.toContain('AI Receipt & Screenshot Scanning');
    expect(FEATURE_LIST).toContain('using OCR text extraction');
  });
});

describe('Phase 1S-A1 — E. ai-insight Pro gate coverage', () => {
  it('PRO_TYPES includes parse_expense and parse_ratecon plus prior types', () => {
    const m = AI_INSIGHT.match(/const PRO_TYPES = new Set\(\[([^\]]*)\]\)/);
    expect(m).toBeTruthy();
    const list = m![1];
    for (const t of ['lane_advice', 'weekly_report', 'tax_tips', 'parse_expense', 'parse_ratecon']) {
      expect(list).toContain(`"${t}"`);
    }
    expect(list).not.toContain('parse_opportunity');
  });

  it('Pro gate runs before any AI gateway call', () => {
    const gate = AI_INSIGHT.indexOf('const PRO_TYPES = new Set(');
    const call = AI_INSIGHT.indexOf('await callAI(');
    expect(gate).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(call);
  });

  it('keeps auth, admin override, caching, CORS, and safe errors', () => {
    expect(AI_INSIGHT).toContain('supabase.auth.getUser(token)');
    expect(AI_INSIGHT).toContain('admin_users');
    expect(AI_INSIGHT).toContain('cacheableTypes');
    expect(AI_INSIGHT).toContain('corsHeaders');
    expect(AI_INSIGHT).toContain('"Pro required"');
  });
});

describe('Phase 1S-A1 — F. Unchanged canonical pricing facts', () => {
  it('recruiter tier limits and Fleet preview state remain in Pricing', () => {
    expect(PRICING).toContain('Up to 5 active opportunities');
    expect(PRICING).toContain('Up to 15 active opportunities');
    expect(PRICING).toContain('$19');
    expect(PRICING).toContain('$49');
  });

  it('agency plan economics untouched', () => {
    expect(AGENCY_PLANS).toContain('included_recruiter_tier');
  });
});
