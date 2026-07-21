/**
 * Phase 1L-C — Canonical opportunity financial calculation regression tests.
 * Executes real exports from src/lib/opportunities/opportunityProfit.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  calculateCanonicalOpportunityFinancials,
  calculateOpportunityFinancials,
  normalizeRecurringAmountToWeekly,
  profitScoreLabel,
  type CanonicalOpportunityFinancialInput,
  type CanonicalEmploymentModel,
  type CanonicalPayModel,
  type Disclosure,
  type CanonicalRecurringAmount,
  type CanonicalMixedPayComponent,
  type CanonicalOneTimeIncentive,
} from '@/lib/opportunities/opportunityProfit';

const provided = <T>(value: T): Disclosure<T> => ({ state: 'provided', value });
const notDisclosed = <T>(): Disclosure<T> => ({ state: 'not_disclosed' });
const notApplicable = <T>(): Disclosure<T> => ({ state: 'not_applicable' });

function buildInput(
  overrides: Partial<CanonicalOpportunityFinancialInput> = {},
): CanonicalOpportunityFinancialInput {
  return {
    employmentModel: 'unknown' as CanonicalEmploymentModel,
    payModel: 'unknown' as CanonicalPayModel,
    cpm: notDisclosed<number>(),
    percentage: notDisclosed<{ rate: number; weeklyRevenueBasis: number | null; basisLabel: string | null }>(),
    flatWeeklyPay: notDisclosed<number>(),
    salary: notDisclosed<CanonicalRecurringAmount>(),
    mixedComponents: [] as CanonicalMixedPayComponent[],
    otherWeeklyGross: notDisclosed<number>(),
    recruiterProvidedWeeklyGross: notDisclosed<number>(),
    totalWeeklyMiles: notDisclosed<number>(),
    loadedWeeklyMiles: notDisclosed<number>(),
    deadheadWeeklyMiles: notDisclosed<number>(),
    deadheadPaid: notDisclosed<boolean>(),
    costs: {
      insurance: notDisclosed<CanonicalRecurringAmount>(),
      maintenance: notDisclosed<CanonicalRecurringAmount>(),
      other: notDisclosed<CanonicalRecurringAmount>(),
      lease: notDisclosed<CanonicalRecurringAmount>(),
      escrowRequired: notDisclosed<boolean>(),
      escrowAmount: notDisclosed<CanonicalRecurringAmount>(),
    },
    oneTimeIncentives: [] as CanonicalOneTimeIncentive[],
    ...overrides,
  };
}

const naCosts = () => ({
  insurance: notApplicable<CanonicalRecurringAmount>(),
  maintenance: notApplicable<CanonicalRecurringAmount>(),
  other: notApplicable<CanonicalRecurringAmount>(),
  lease: notApplicable<CanonicalRecurringAmount>(),
  escrowRequired: notApplicable<boolean>(),
  escrowAmount: notApplicable<CanonicalRecurringAmount>(),
});

describe('normalizeRecurringAmountToWeekly', () => {
  it('normalizes weekly, biweekly, monthly, annual (1)', () => {
    expect(normalizeRecurringAmountToWeekly({ amount: 100, frequency: 'weekly' })).toBe(100);
    expect(normalizeRecurringAmountToWeekly({ amount: 200, frequency: 'biweekly' })).toBe(100);
    expect(normalizeRecurringAmountToWeekly({ amount: 520, frequency: 'monthly' })).toBeCloseTo((520 * 12) / 52, 10);
    expect(normalizeRecurringAmountToWeekly({ amount: 5200, frequency: 'annual' })).toBe(100);
  });
  it('returns null when frequency is null (2)', () => {
    expect(normalizeRecurringAmountToWeekly({ amount: 100, frequency: null })).toBeNull();
  });
  it('preserves zero as zero (3)', () => {
    expect(normalizeRecurringAmountToWeekly({ amount: 0, frequency: 'weekly' })).toBe(0);
    expect(normalizeRecurringAmountToWeekly({ amount: 0, frequency: 'monthly' })).toBe(0);
  });
  it('returns null for negative or non-finite amounts (4)', () => {
    expect(normalizeRecurringAmountToWeekly({ amount: -10, frequency: 'weekly' })).toBeNull();
    expect(normalizeRecurringAmountToWeekly({ amount: Number.NaN, frequency: 'monthly' })).toBeNull();
    expect(normalizeRecurringAmountToWeekly({ amount: Infinity, frequency: 'annual' })).toBeNull();
  });
});

describe('CPM gross semantics', () => {
  it('uses loaded miles, not total miles (5)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'company_driver',
        payModel: 'cpm',
        cpm: provided(0.60),
        loadedWeeklyMiles: provided(2000),
        totalWeeklyMiles: provided(2500),
      }),
    );
    expect(r.recurringWeeklyGross).toBe(1200);
    expect(r.grossSource).toBe('derived');
    expect(r.effectiveRpm).toBeCloseTo(1200 / 2500, 10);
  });
  it('loaded miles zero is invalid (6)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'company_driver',
        payModel: 'cpm',
        cpm: provided(0.60),
        loadedWeeklyMiles: provided(0),
      }),
    );
    expect(r.recurringWeeklyGross).toBeNull();
    expect(r.invalidInputs).toContain('loadedWeeklyMiles');
    expect(r.status).toBe('incomplete');
  });
});

describe('Percentage gross', () => {
  it('requires rate, weekly basis, and basis label (7)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'contractor_1099',
        payModel: 'percentage',
        percentage: provided({ rate: 25, weeklyRevenueBasis: 8000, basisLabel: 'linehaul' }),
        costs: naCosts(),
      }),
    );
    expect(r.recurringWeeklyGross).toBe(2000);
    expect(r.grossSource).toBe('derived');

    const missingLabel = calculateCanonicalOpportunityFinancials(
      buildInput({
        payModel: 'percentage',
        percentage: provided({ rate: 25, weeklyRevenueBasis: 8000, basisLabel: '' }),
      }),
    );
    expect(missingLabel.recurringWeeklyGross).toBeNull();
    expect(missingLabel.missingInputs).toContain('percentageBasisLabel');

    const missingBasis = calculateCanonicalOpportunityFinancials(
      buildInput({
        payModel: 'percentage',
        percentage: provided({ rate: 25, weeklyRevenueBasis: null, basisLabel: 'linehaul' }),
      }),
    );
    expect(missingBasis.recurringWeeklyGross).toBeNull();
    expect(missingBasis.missingInputs).toContain('percentageWeeklyRevenueBasis');
  });
});

describe('Flat weekly & salary & mixed & other', () => {
  it('flat weekly gross (8)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({ payModel: 'flat_weekly', flatWeeklyPay: provided(1500) }),
    );
    expect(r.recurringWeeklyGross).toBe(1500);
    expect(r.grossSource).toBe('derived');
  });
  it('salary normalization (9)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        payModel: 'salary',
        salary: provided({ amount: 78000, frequency: 'annual' }),
      }),
    );
    expect(r.recurringWeeklyGross).toBe(1500);
  });
  it('mixed pay sums at least two components (10)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        payModel: 'mixed',
        mixedComponents: [
          { label: 'Base', amount: provided({ amount: 1000, frequency: 'weekly' }) },
          { label: 'Stipend', amount: provided({ amount: 400, frequency: 'biweekly' }) },
        ],
      }),
    );
    expect(r.recurringWeeklyGross).toBe(1200);
    expect(r.grossSource).toBe('derived');
  });
  it('mixed with fewer than two components is incomplete (11)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        payModel: 'mixed',
        mixedComponents: [{ label: 'Base', amount: provided({ amount: 1000, frequency: 'weekly' }) }],
      }),
    );
    expect(r.recurringWeeklyGross).toBeNull();
    expect(r.status).toBe('incomplete');
    expect(r.missingInputs).toContain('mixedComponents');
  });
  it('other weekly gross (12)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({ payModel: 'other', otherWeeklyGross: provided(2200) }),
    );
    expect(r.recurringWeeklyGross).toBe(2200);
  });
});

describe('One-time incentives', () => {
  it('sign-on bonus excluded from recurring gross, summed separately (13)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        payModel: 'flat_weekly',
        flatWeeklyPay: provided(1500),
        oneTimeIncentives: [
          { label: 'Sign-on', amount: provided(5000) },
          { label: 'Referral', amount: provided(500) },
        ],
      }),
    );
    expect(r.recurringWeeklyGross).toBe(1500);
    expect(r.oneTimeIncentiveTotal).toBe(5500);
  });
  it('invalid incentive excluded and diagnosed (33)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        payModel: 'flat_weekly',
        flatWeeklyPay: provided(1500),
        oneTimeIncentives: [
          { label: 'Bad', amount: provided(-100) },
          { label: 'Good', amount: provided(200) },
        ],
      }),
    );
    expect(r.oneTimeIncentiveTotal).toBe(200);
    expect(r.invalidInputs).toContain('oneTimeIncentive[0]');
  });
});

describe('Recruiter-provided gross conflict handling', () => {
  it('conflict when >10% difference (14)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'company_driver',
        payModel: 'flat_weekly',
        flatWeeklyPay: provided(1000),
        recruiterProvidedWeeklyGross: provided(1200),
      }),
    );
    expect(r.status).toBe('conflict');
    expect(r.recurringWeeklyGross).toBe(1000);
    expect(r.grossSource).toBe('derived');
    expect(r.conflicts.length).toBe(1);
  });
  it('exactly 10% difference is not a conflict (15)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'company_driver',
        payModel: 'flat_weekly',
        flatWeeklyPay: provided(1000),
        recruiterProvidedWeeklyGross: provided(1100),
      }),
    );
    expect(r.status).not.toBe('conflict');
    expect(r.conflicts).toEqual([]);
  });
  it('recruiter fallback exposed but status stays incomplete (16)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'company_driver',
        payModel: 'cpm',
        cpm: provided(0.55),
        recruiterProvidedWeeklyGross: provided(1400),
      }),
    );
    expect(r.recurringWeeklyGross).toBe(1400);
    expect(r.grossSource).toBe('recruiter_provided');
    expect(r.status).toBe('incomplete');
  });
});

describe('Mileage semantics', () => {
  it('total miles zero preserved as invalid (17)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'company_driver',
        payModel: 'flat_weekly',
        flatWeeklyPay: provided(1200),
        totalWeeklyMiles: provided(0),
      }),
    );
    expect(r.effectiveRpm).toBeNull();
    expect(r.invalidInputs).toContain('totalWeeklyMiles');
    expect(r.status).toBe('incomplete');
  });
  it('effective RPM and deadhead % from explicit total miles (18)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'company_driver',
        payModel: 'flat_weekly',
        flatWeeklyPay: provided(2500),
        totalWeeklyMiles: provided(2500),
        deadheadWeeklyMiles: provided(500),
      }),
    );
    expect(r.effectiveRpm).toBe(1);
    expect(r.deadheadPercentage).toBe(20);
  });
});

describe('Employment-model costs and net', () => {
  it('company-driver net not applicable even with cost values (19)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'company_driver',
        payModel: 'flat_weekly',
        flatWeeklyPay: provided(1500),
        costs: {
          insurance: provided({ amount: 200, frequency: 'weekly' }),
          maintenance: provided({ amount: 100, frequency: 'weekly' }),
          other: provided({ amount: 50, frequency: 'weekly' }),
          lease: notApplicable<CanonicalRecurringAmount>(),
          escrowRequired: provided(false),
          escrowAmount: notApplicable<CanonicalRecurringAmount>(),
        },
      }),
    );
    expect(r.netStatus).toBe('not_applicable');
    expect(r.estimatedWeeklyNet).toBeNull();
    expect(r.totalKnownWeeklyCosts).toBeNull();
    expect(r.status).toBe('available');
  });
  it('owner-operator weekly costs and before-tax net (20)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'owner_operator',
        payModel: 'flat_weekly',
        flatWeeklyPay: provided(5000),
        costs: {
          insurance: provided({ amount: 300, frequency: 'weekly' }),
          maintenance: provided({ amount: 200, frequency: 'weekly' }),
          other: provided({ amount: 100, frequency: 'weekly' }),
          lease: notApplicable<CanonicalRecurringAmount>(),
          escrowRequired: provided(false),
          escrowAmount: notApplicable<CanonicalRecurringAmount>(),
        },
      }),
    );
    expect(r.totalKnownWeeklyCosts).toBe(600);
    expect(r.estimatedWeeklyNet).toBe(4400);
    expect(r.netStatus).toBe('available');
    expect(r.assumptions).toContain('Net is before taxes.');
  });
  it('monthly/biweekly/annual cost normalization (21)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'owner_operator',
        payModel: 'flat_weekly',
        flatWeeklyPay: provided(3000),
        costs: {
          insurance: provided({ amount: 520, frequency: 'monthly' }),
          maintenance: provided({ amount: 200, frequency: 'biweekly' }),
          other: provided({ amount: 5200, frequency: 'annual' }),
          lease: notApplicable<CanonicalRecurringAmount>(),
          escrowRequired: provided(false),
          escrowAmount: notApplicable<CanonicalRecurringAmount>(),
        },
      }),
    );
    // 520*12/52 = 120, 200/2 = 100, 5200/52 = 100
    expect(r.totalKnownWeeklyCosts).toBeCloseTo(320, 10);
    expect(r.estimatedWeeklyNet).toBeCloseTo(2680, 10);
  });
  it('relevant not-disclosed cost prevents net (22)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'owner_operator',
        payModel: 'flat_weekly',
        flatWeeklyPay: provided(3000),
        costs: {
          insurance: notDisclosed<CanonicalRecurringAmount>(),
          maintenance: provided({ amount: 200, frequency: 'weekly' }),
          other: provided({ amount: 100, frequency: 'weekly' }),
          lease: notApplicable<CanonicalRecurringAmount>(),
          escrowRequired: provided(false),
          escrowAmount: notApplicable<CanonicalRecurringAmount>(),
        },
      }),
    );
    expect(r.netStatus).toBe('incomplete');
    expect(r.estimatedWeeklyNet).toBeNull();
    expect(r.missingInputs).toContain('insurance');
  });
  it('relevant cost missing frequency prevents net (23)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'owner_operator',
        payModel: 'flat_weekly',
        flatWeeklyPay: provided(3000),
        costs: {
          insurance: provided({ amount: 200, frequency: null }),
          maintenance: provided({ amount: 200, frequency: 'weekly' }),
          other: provided({ amount: 100, frequency: 'weekly' }),
          lease: notApplicable<CanonicalRecurringAmount>(),
          escrowRequired: provided(false),
          escrowAmount: notApplicable<CanonicalRecurringAmount>(),
        },
      }),
    );
    expect(r.netStatus).toBe('incomplete');
    expect(r.missingInputs).toContain('insuranceFrequency');
  });
  it('lease ignored for owner-operator (24)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'owner_operator',
        payModel: 'flat_weekly',
        flatWeeklyPay: provided(4000),
        costs: {
          insurance: provided({ amount: 100, frequency: 'weekly' }),
          maintenance: provided({ amount: 100, frequency: 'weekly' }),
          other: provided({ amount: 100, frequency: 'weekly' }),
          lease: provided({ amount: 999, frequency: 'weekly' }),
          escrowRequired: provided(false),
          escrowAmount: notApplicable<CanonicalRecurringAmount>(),
        },
      }),
    );
    expect(r.totalKnownWeeklyCosts).toBe(300);
    expect(r.estimatedWeeklyNet).toBe(3700);
  });
  it('lease required for lease-purchase (25)', () => {
    const missingLease = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'lease_purchase',
        payModel: 'flat_weekly',
        flatWeeklyPay: provided(4000),
        costs: {
          insurance: provided({ amount: 100, frequency: 'weekly' }),
          maintenance: provided({ amount: 100, frequency: 'weekly' }),
          other: provided({ amount: 100, frequency: 'weekly' }),
          lease: notDisclosed<CanonicalRecurringAmount>(),
          escrowRequired: provided(false),
          escrowAmount: notApplicable<CanonicalRecurringAmount>(),
        },
      }),
    );
    expect(missingLease.netStatus).toBe('incomplete');
    expect(missingLease.missingInputs).toContain('lease payment');

    const withLease = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'lease_purchase',
        payModel: 'flat_weekly',
        flatWeeklyPay: provided(4000),
        costs: {
          insurance: provided({ amount: 100, frequency: 'weekly' }),
          maintenance: provided({ amount: 100, frequency: 'weekly' }),
          other: provided({ amount: 100, frequency: 'weekly' }),
          lease: provided({ amount: 500, frequency: 'weekly' }),
          escrowRequired: provided(false),
          escrowAmount: notApplicable<CanonicalRecurringAmount>(),
        },
      }),
    );
    expect(withLease.totalKnownWeeklyCosts).toBe(800);
    expect(withLease.estimatedWeeklyNet).toBe(3200);
  });
  it('escrow false ignores blank amount (26)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'owner_operator',
        payModel: 'flat_weekly',
        flatWeeklyPay: provided(3000),
        costs: {
          insurance: provided({ amount: 100, frequency: 'weekly' }),
          maintenance: provided({ amount: 100, frequency: 'weekly' }),
          other: provided({ amount: 100, frequency: 'weekly' }),
          lease: notApplicable<CanonicalRecurringAmount>(),
          escrowRequired: provided(false),
          escrowAmount: provided({ amount: 0, frequency: 'weekly' }),
        },
      }),
    );
    expect(r.status).toBe('available');
    expect(r.totalKnownWeeklyCosts).toBe(300);
  });
  it('escrow false with positive amount creates conflict (27)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'owner_operator',
        payModel: 'flat_weekly',
        flatWeeklyPay: provided(3000),
        costs: {
          insurance: provided({ amount: 100, frequency: 'weekly' }),
          maintenance: provided({ amount: 100, frequency: 'weekly' }),
          other: provided({ amount: 100, frequency: 'weekly' }),
          lease: notApplicable<CanonicalRecurringAmount>(),
          escrowRequired: provided(false),
          escrowAmount: provided({ amount: 50, frequency: 'weekly' }),
        },
      }),
    );
    expect(r.status).toBe('conflict');
    expect(r.conflicts.some((c) => c.toLowerCase().includes('escrow'))).toBe(true);
    // Escrow amount NOT counted
    expect(r.totalKnownWeeklyCosts).toBe(300);
  });
  it('escrow true counts valid recurring amount (28)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'owner_operator',
        payModel: 'flat_weekly',
        flatWeeklyPay: provided(3000),
        costs: {
          insurance: provided({ amount: 100, frequency: 'weekly' }),
          maintenance: provided({ amount: 100, frequency: 'weekly' }),
          other: provided({ amount: 100, frequency: 'weekly' }),
          lease: notApplicable<CanonicalRecurringAmount>(),
          escrowRequired: provided(true),
          escrowAmount: provided({ amount: 50, frequency: 'weekly' }),
        },
      }),
    );
    expect(r.totalKnownWeeklyCosts).toBe(350);
    expect(r.estimatedWeeklyNet).toBe(2650);
  });
  it('escrow true with missing amount prevents net (29)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'owner_operator',
        payModel: 'flat_weekly',
        flatWeeklyPay: provided(3000),
        costs: {
          insurance: provided({ amount: 100, frequency: 'weekly' }),
          maintenance: provided({ amount: 100, frequency: 'weekly' }),
          other: provided({ amount: 100, frequency: 'weekly' }),
          lease: notApplicable<CanonicalRecurringAmount>(),
          escrowRequired: provided(true),
          escrowAmount: notDisclosed<CanonicalRecurringAmount>(),
        },
      }),
    );
    expect(r.netStatus).toBe('incomplete');
    expect(r.missingInputs).toContain('escrowAmount');
  });
  it('negative net preserved (30)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'owner_operator',
        payModel: 'flat_weekly',
        flatWeeklyPay: provided(1000),
        costs: {
          insurance: provided({ amount: 500, frequency: 'weekly' }),
          maintenance: provided({ amount: 500, frequency: 'weekly' }),
          other: provided({ amount: 500, frequency: 'weekly' }),
          lease: notApplicable<CanonicalRecurringAmount>(),
          escrowRequired: provided(false),
          escrowAmount: notApplicable<CanonicalRecurringAmount>(),
        },
      }),
    );
    expect(r.estimatedWeeklyNet).toBe(-500);
    expect(r.netStatus).toBe('available');
  });
  it('unknown employment model prevents net (31)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'unknown',
        payModel: 'flat_weekly',
        flatWeeklyPay: provided(1500),
      }),
    );
    expect(r.netStatus).toBe('incomplete');
    expect(r.missingInputs).toContain('employmentModel');
    expect(r.status).toBe('incomplete');
  });
});

describe('Overall status special cases', () => {
  it('entire estimate not applicable only when fully NA (32)', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'company_driver',
        payModel: 'unknown',
        cpm: notApplicable<number>(),
        percentage: notApplicable<{ rate: number; weeklyRevenueBasis: number | null; basisLabel: string | null }>(),
        flatWeeklyPay: notApplicable<number>(),
        salary: notApplicable<CanonicalRecurringAmount>(),
        otherWeeklyGross: notApplicable<number>(),
        recruiterProvidedWeeklyGross: notApplicable<number>(),
        mixedComponents: [],
      }),
    );
    expect(r.status).toBe('not_applicable');
  });
});

describe('Legacy calculateOpportunityFinancials regression (34)', () => {
  it('preserves gross precedence: weekly_gross > flat_weekly > cpm*loaded', () => {
    const r = calculateOpportunityFinancials({
      estimated_weekly_gross: 2000,
      flat_weekly_pay: 1500,
      cpm: 0.5,
      percentage_pay: null,
      estimated_weekly_miles: 2500,
      estimated_loaded_miles: 2000,
      estimated_deadhead_miles: 500,
      deadhead_paid: true,
      insurance_deductions: 100,
      escrow_amount: 0,
      escrow_required: null,
      lease_payment: 0,
      maintenance_deductions: 0,
      other_deductions: 0,
    } as Parameters<typeof calculateOpportunityFinancials>[0]);
    expect(r.estimatedGross).toBe(2000);
    expect(r.totalKnownDeductions).toBe(100);
    expect(r.estimatedNet).toBe(1900);
    expect(r.grossPerMile).toBe(1);
    expect(r.effectiveRpm).toBeCloseTo(2000 / 2500, 10);
    expect(r.deadheadPercentage).toBe(20);
  });
  it('preserves zero-mile fallback: totalMiles uses (loaded+deadhead) when weekly miles missing', () => {
    const r = calculateOpportunityFinancials({
      estimated_weekly_gross: null,
      flat_weekly_pay: 1000,
      cpm: null,
      percentage_pay: null,
      estimated_weekly_miles: null,
      estimated_loaded_miles: 800,
      estimated_deadhead_miles: 200,
      deadhead_paid: false,
      insurance_deductions: null,
      escrow_amount: null,
      escrow_required: null,
      lease_payment: null,
      maintenance_deductions: null,
      other_deductions: null,
    } as Parameters<typeof calculateOpportunityFinancials>[0]);
    expect(r.estimatedGross).toBe(1000);
    expect(r.effectiveRpm).toBeCloseTo(1000 / 1000, 10);
    expect(r.deadheadPercentage).toBe(20);
    expect(r.hasUnpaidDeadhead).toBe(true);
  });
  it('preserves profit score bounds and label mapping', () => {
    expect(profitScoreLabel(90)).toEqual({ label: 'Strong', tone: 'success' });
    expect(profitScoreLabel(70)).toEqual({ label: 'Solid', tone: 'primary' });
    expect(profitScoreLabel(50)).toEqual({ label: 'Mixed', tone: 'warn' });
    expect(profitScoreLabel(10)).toEqual({ label: 'Risky', tone: 'destructive' });
  });
  it('preserves deduction coercion (nulls -> 0, sum)', () => {
    const r = calculateOpportunityFinancials({
      estimated_weekly_gross: 3000,
      flat_weekly_pay: null,
      cpm: null,
      percentage_pay: null,
      estimated_weekly_miles: null,
      estimated_loaded_miles: null,
      estimated_deadhead_miles: null,
      deadhead_paid: null,
      insurance_deductions: 100,
      escrow_amount: 50,
      escrow_required: null,
      lease_payment: 200,
      maintenance_deductions: null,
      other_deductions: null,
    } as Parameters<typeof calculateOpportunityFinancials>[0]);
    expect(r.totalKnownDeductions).toBe(350);
    expect(r.estimatedNet).toBe(2650);
    expect(r.hasLeaseRisk).toBe(true);
  });
});

describe('Phase 1L-C remediation — semantic gap fixes', () => {
  it('Fix 1: invalid incentive is diagnosed but does NOT reduce availability', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'company_driver',
        payModel: 'flat_weekly',
        flatWeeklyPay: provided(1500),
        totalWeeklyMiles: provided(2000),
        oneTimeIncentives: [
          { label: 'Bad', amount: provided(-100) },
          { label: 'Good', amount: provided(250) },
        ],
      }),
    );
    expect(r.status).toBe('available');
    expect(r.recurringWeeklyGross).toBe(1500);
    expect(r.oneTimeIncentiveTotal).toBe(250);
    expect(r.invalidInputs).toContain('oneTimeIncentive[0]');
  });

  it('Fix 2: unknown pay model with recruiter gross stays incomplete', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'company_driver',
        payModel: 'unknown',
        recruiterProvidedWeeklyGross: provided(1800),
        totalWeeklyMiles: provided(2500),
      }),
    );
    expect(r.recurringWeeklyGross).toBe(1800);
    expect(r.grossSource).toBe('recruiter_provided');
    expect(r.status).toBe('incomplete');
    expect(r.missingInputs).toContain('payModel');
  });

  it('Fix 3a: negative deadhead miles are diagnosed and force incomplete', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'company_driver',
        payModel: 'flat_weekly',
        flatWeeklyPay: provided(1500),
        totalWeeklyMiles: provided(2000),
        deadheadWeeklyMiles: provided(-50),
      }),
    );
    expect(r.deadheadPercentage).toBeNull();
    expect(r.invalidInputs).toContain('deadheadWeeklyMiles');
    expect(r.status).toBe('incomplete');
  });

  it('Fix 3b: non-finite deadhead miles diagnosed', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'company_driver',
        payModel: 'flat_weekly',
        flatWeeklyPay: provided(1500),
        totalWeeklyMiles: provided(2000),
        deadheadWeeklyMiles: provided(Number.NaN),
      }),
    );
    expect(r.deadheadPercentage).toBeNull();
    expect(r.invalidInputs).toContain('deadheadWeeklyMiles');
    expect(r.status).toBe('incomplete');
  });

  it('Fix 3c: zero deadhead miles remains valid and yields 0%', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'company_driver',
        payModel: 'flat_weekly',
        flatWeeklyPay: provided(1500),
        totalWeeklyMiles: provided(2000),
        deadheadWeeklyMiles: provided(0),
      }),
    );
    expect(r.deadheadPercentage).toBe(0);
    expect(r.invalidInputs).not.toContain('deadheadWeeklyMiles');
    expect(r.status).toBe('available');
  });

  it('Fix 4a: complete CPM (with positive total miles) is available; company-driver net_not_applicable', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'company_driver',
        payModel: 'cpm',
        cpm: provided(0.60),
        loadedWeeklyMiles: provided(2000),
        totalWeeklyMiles: provided(2500),
      }),
    );
    expect(r.status).toBe('available');
    expect(r.netStatus).toBe('not_applicable');
    expect(r.recurringWeeklyGross).toBe(1200);
    expect(r.effectiveRpm).toBeCloseTo(1200 / 2500, 10);
  });

  it('Fix 4b: CPM with missing total miles is incomplete and diagnoses totalWeeklyMiles', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'company_driver',
        payModel: 'cpm',
        cpm: provided(0.60),
        loadedWeeklyMiles: provided(2000),
        // totalWeeklyMiles intentionally not disclosed
      }),
    );
    expect(r.status).toBe('incomplete');
    expect(r.missingInputs).toContain('totalWeeklyMiles');
    expect(r.recurringWeeklyGross).toBe(1200);
    expect(r.effectiveRpm).toBeNull();
  });

  it('Fix 4c: CPM does NOT infer total from loaded+deadhead', () => {
    const r = calculateCanonicalOpportunityFinancials(
      buildInput({
        employmentModel: 'company_driver',
        payModel: 'cpm',
        cpm: provided(0.60),
        loadedWeeklyMiles: provided(2000),
        deadheadWeeklyMiles: provided(500),
        // totalWeeklyMiles NOT provided
      }),
    );
    expect(r.effectiveRpm).toBeNull();
    expect(r.deadheadPercentage).toBeNull();
    expect(r.status).toBe('incomplete');
  });
});

