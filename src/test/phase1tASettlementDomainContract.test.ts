/**
 * Phase 1T-A — Settlement domain contract acceptance tests.
 * Pure module proofs only: no DB, no network, no snapshots.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
  SETTLEMENT_SOURCES,
  SETTLEMENT_STATUSES,
  SETTLEMENT_ITEM_TYPES,
  SETTLEMENT_PAY_METHODS,
  SETTLEMENT_DELEGATION_PERMISSIONS,
  SETTLEMENT_NEVER_RESPONSIBILITIES,
  validateSettlementIdentity,
  resolveSettlementCapabilities,
  type SettlementIdentity,
  type SettlementCapabilityInput,
  type SettlementDelegationPermission,
} from '@/lib/settlements/settlementDomain';

const SOURCE_PATH = resolve(process.cwd(), 'src/lib/settlements/settlementDomain.ts');

function identity(overrides: Partial<SettlementIdentity> = {}): SettlementIdentity {
  return {
    driverUserId: 'driver-user-1',
    source: 'driver_imported',
    createdByUserId: 'actor-user-1',
    carrierRecruiterProfileId: null,
    agencyId: null,
    ...overrides,
  };
}

function capInput(
  overrides: Partial<SettlementCapabilityInput> = {},
): SettlementCapabilityInput {
  return {
    actor: 'driver',
    driverPlan: 'free',
    driverSubscriptionActive: false,
    isRecipientDriver: true,
    businessEntitlement: {
      state: 'resolved',
      effectiveRecruiterTier: 'free_verified',
      effectiveAgencyPlan: null,
      entitlementSource: 'none',
    },
    hasActiveCarrierDriverRelationship: false,
    hasActiveDriverDelegation: false,
    delegatedPermissions: [],
    ...overrides,
  };
}

describe('Phase 1T-A — vocabularies', () => {
  it('1. locks the exact vocabularies', () => {
    expect([...SETTLEMENT_SOURCES]).toEqual([
      'carrier_issued',
      'agency_prepared',
      'driver_imported',
    ]);
    expect([...SETTLEMENT_STATUSES]).toEqual([
      'draft',
      'finalized',
      'voided',
      'superseded',
    ]);
    expect([...SETTLEMENT_ITEM_TYPES]).toEqual([
      'load_pay',
      'earning',
      'reimbursement',
      'deduction',
      'withholding',
    ]);
    expect([...SETTLEMENT_PAY_METHODS]).toEqual([
      'per_mile',
      'percentage',
      'flat_rate',
      'manual',
    ]);
    expect([...SETTLEMENT_PAY_METHODS]).not.toContain('mixed');
    expect([...SETTLEMENT_DELEGATION_PERMISSIONS]).toEqual([
      'settlements_view',
      'settlements_manage',
      'settlements_finalize',
    ]);
  });

  it('2. locks the exact NEVER responsibilities', () => {
    expect([...SETTLEMENT_NEVER_RESPONSIBILITIES]).toEqual([
      'process_payroll',
      'send_ach_or_direct_deposit',
      'calculate_or_remit_employer_payroll_taxes',
      'issue_or_file_tax_forms',
      'determine_worker_classification',
      'determine_deduction_legality',
    ]);
  });
});

describe('Phase 1T-A — identity validation', () => {
  it('3. carrier_issued is valid with recruiter profile id and no agency id', () => {
    expect(
      validateSettlementIdentity(
        identity({
          source: 'carrier_issued',
          carrierRecruiterProfileId: 'recruiter-profile-1',
          agencyId: null,
        }),
      ),
    ).toEqual({ valid: true });
  });

  it('4. carrier_issued fails without recruiter profile id', () => {
    expect(
      validateSettlementIdentity(
        identity({ source: 'carrier_issued', carrierRecruiterProfileId: null }),
      ),
    ).toEqual({
      valid: false,
      reason: 'carrier_issued_requires_carrier_recruiter_profile_id',
    });
  });

  it('5. carrier_issued fails when an agency id is also present', () => {
    expect(
      validateSettlementIdentity(
        identity({
          source: 'carrier_issued',
          carrierRecruiterProfileId: 'recruiter-profile-1',
          agencyId: 'agency-1',
        }),
      ),
    ).toEqual({ valid: false, reason: 'carrier_issued_forbids_agency_id' });
  });

  it('6. agency_prepared requires agency id and forbids carrier recruiter profile id', () => {
    expect(
      validateSettlementIdentity(
        identity({ source: 'agency_prepared', agencyId: 'agency-1' }),
      ),
    ).toEqual({ valid: true });
    expect(
      validateSettlementIdentity(identity({ source: 'agency_prepared' })),
    ).toEqual({ valid: false, reason: 'agency_prepared_requires_agency_id' });
    expect(
      validateSettlementIdentity(
        identity({
          source: 'agency_prepared',
          agencyId: 'agency-1',
          carrierRecruiterProfileId: 'recruiter-profile-1',
        }),
      ),
    ).toEqual({
      valid: false,
      reason: 'agency_prepared_forbids_carrier_recruiter_profile_id',
    });
  });

  it('7. driver_imported rejects either business identity', () => {
    expect(validateSettlementIdentity(identity())).toEqual({ valid: true });
    expect(
      validateSettlementIdentity(
        identity({ carrierRecruiterProfileId: 'recruiter-profile-1' }),
      ),
    ).toEqual({
      valid: false,
      reason: 'driver_imported_forbids_business_identity',
    });
    expect(validateSettlementIdentity(identity({ agencyId: 'agency-1' }))).toEqual({
      valid: false,
      reason: 'driver_imported_forbids_business_identity',
    });
  });

  it('8. blank recipient or actor ids fail closed', () => {
    expect(validateSettlementIdentity(identity({ driverUserId: '   ' }))).toEqual({
      valid: false,
      reason: 'missing_driver_user_id',
    });
    expect(validateSettlementIdentity(identity({ createdByUserId: '' }))).toEqual({
      valid: false,
      reason: 'missing_created_by_user_id',
    });
  });

  it('9. an unknown runtime source fails closed', () => {
    const malformed = identity({
      source: 'payroll_run' as unknown as SettlementIdentity['source'],
    });
    expect(validateSettlementIdentity(malformed)).toEqual({
      valid: false,
      reason: 'unknown_source',
    });
  });
});

describe('Phase 1T-A — driver capabilities', () => {
  it('10. recipient Free driver views + basic reconciles only', () => {
    const caps = resolveSettlementCapabilities(capInput());
    expect(caps.canViewDeliveredSettlement).toBe(true);
    expect(caps.canUseBasicReconciliation).toBe(true);
    expect(caps.canUseAdvancedReconciliation).toBe(false);
    expect(caps.canCreateDriverImportedSettlement).toBe(false);
  });

  it('11. active Pro driver gets view/basic + advanced + import', () => {
    const caps = resolveSettlementCapabilities(
      capInput({ driverPlan: 'pro_monthly', driverSubscriptionActive: true }),
    );
    expect(caps.canViewDeliveredSettlement).toBe(true);
    expect(caps.canUseBasicReconciliation).toBe(true);
    expect(caps.canUseAdvancedReconciliation).toBe(true);
    expect(caps.canCreateDriverImportedSettlement).toBe(true);
  });

  it('12. inactive Pro plan behaves like Free for advanced/import', () => {
    const caps = resolveSettlementCapabilities(
      capInput({ driverPlan: 'pro_yearly', driverSubscriptionActive: false }),
    );
    expect(caps.canViewDeliveredSettlement).toBe(true);
    expect(caps.canUseBasicReconciliation).toBe(true);
    expect(caps.canUseAdvancedReconciliation).toBe(false);
    expect(caps.canCreateDriverImportedSettlement).toBe(false);
  });
});

describe('Phase 1T-A — assistant capabilities', () => {
  const assistant = (
    permissions: SettlementDelegationPermission[],
    pro: boolean,
    delegation = true,
  ) =>
    resolveSettlementCapabilities(
      capInput({
        actor: 'assistant',
        isRecipientDriver: false,
        driverPlan: pro ? 'pro_monthly' : 'free',
        driverSubscriptionActive: pro,
        hasActiveDriverDelegation: delegation,
        delegatedPermissions: permissions,
      }),
    );

  it('13. delegated assistant views/basic reconciles for a Free driver', () => {
    const caps = assistant(['settlements_view'], false);
    expect(caps.canViewDeliveredSettlement).toBe(true);
    expect(caps.canUseBasicReconciliation).toBe(true);
  });

  it('14. delegated assistant cannot advanced/import for a Free driver', () => {
    const caps = assistant(['settlements_view', 'settlements_manage'], false);
    expect(caps.canUseAdvancedReconciliation).toBe(false);
    expect(caps.canCreateDriverImportedSettlement).toBe(false);
  });

  it('15. assistant with active Driver Pro + settlements_manage gets advanced/import', () => {
    const caps = assistant(['settlements_view', 'settlements_manage'], true);
    expect(caps.canUseAdvancedReconciliation).toBe(true);
    expect(caps.canCreateDriverImportedSettlement).toBe(true);
  });

  it('16. assistant finalization requires settlements_finalize + active Driver Pro', () => {
    expect(
      assistant(['settlements_manage'], true).canFinalizeManagedSettlement,
    ).toBe(false);
    expect(
      assistant(['settlements_finalize'], false).canFinalizeManagedSettlement,
    ).toBe(false);
    expect(
      assistant(['settlements_finalize'], true).canFinalizeManagedSettlement,
    ).toBe(true);
    expect(
      assistant(['settlements_finalize'], true, false).canFinalizeManagedSettlement,
    ).toBe(false);
  });
});

describe('Phase 1T-A — carrier capabilities', () => {
  const carrier = (
    over: Partial<SettlementCapabilityInput['businessEntitlement']>,
    relationship: boolean,
  ) =>
    resolveSettlementCapabilities(
      capInput({
        actor: 'carrier',
        isRecipientDriver: false,
        hasActiveCarrierDriverRelationship: relationship,
        businessEntitlement: {
          state: 'resolved',
          effectiveRecruiterTier: 'growth',
          effectiveAgencyPlan: null,
          entitlementSource: 'recruiter_subscription',
          ...over,
        },
      }),
    );

  it('17. standalone paid recruiter_subscription + active relationship issues/finalizes', () => {
    const caps = carrier({}, true);
    expect(caps.canIssueCarrierSettlement).toBe(true);
    expect(caps.canFinalizeManagedSettlement).toBe(true);
  });

  it('18. recruiter_subscription with free_verified does not issue', () => {
    expect(
      carrier({ effectiveRecruiterTier: 'free_verified' }, true)
        .canIssueCarrierSettlement,
    ).toBe(false);
  });

  it('19. paid recruiter_subscription without active relationship does not issue', () => {
    const caps = carrier({}, false);
    expect(caps.canIssueCarrierSettlement).toBe(false);
    expect(caps.canFinalizeManagedSettlement).toBe(false);
  });

  it('20. agency_included premium NEVER grants carrier issuance', () => {
    for (const tier of ['starter', 'growth', 'fleet'] as const) {
      const caps = carrier(
        { entitlementSource: 'agency_included', effectiveRecruiterTier: tier },
        true,
      );
      expect(caps.canIssueCarrierSettlement).toBe(false);
      expect(caps.canFinalizeManagedSettlement).toBe(false);
    }
  });

  it('21. loading, error, and conflict business states fail closed', () => {
    for (const state of ['loading', 'error', 'conflict'] as const) {
      expect(carrier({ state }, true).canIssueCarrierSettlement).toBe(false);
    }
    expect(
      carrier(
        { state: 'sideways' as unknown as 'resolved' },
        true,
      ).canIssueCarrierSettlement,
    ).toBe(false);
  });
});

describe('Phase 1T-A — agency capabilities', () => {
  const agency = (
    permissions: SettlementDelegationPermission[],
    delegation: boolean,
    plan: 'agency_starter' | null = 'agency_starter',
  ) =>
    resolveSettlementCapabilities(
      capInput({
        actor: 'agency',
        isRecipientDriver: false,
        driverPlan: 'free',
        driverSubscriptionActive: false,
        hasActiveDriverDelegation: delegation,
        delegatedPermissions: permissions,
        businessEntitlement: {
          state: 'resolved',
          effectiveRecruiterTier: 'free_verified',
          effectiveAgencyPlan: plan,
          entitlementSource: 'none',
        },
      }),
    );

  it('22. paid agency + delegation + settlements_manage prepares even for a Free driver', () => {
    expect(agency(['settlements_manage'], true).canPrepareAgencySettlement).toBe(
      true,
    );
  });

  it('23. agency preparation fails without delegation', () => {
    expect(agency(['settlements_manage'], false).canPrepareAgencySettlement).toBe(
      false,
    );
  });

  it('24. agency preparation fails without settlements_manage', () => {
    expect(agency(['settlements_view'], true).canPrepareAgencySettlement).toBe(
      false,
    );
    expect(agency([], true, null).canPrepareAgencySettlement).toBe(false);
  });

  it('25. agency finalization requires settlements_finalize', () => {
    expect(
      agency(['settlements_manage'], true).canFinalizeManagedSettlement,
    ).toBe(false);
    expect(
      agency(['settlements_manage', 'settlements_finalize'], true)
        .canFinalizeManagedSettlement,
    ).toBe(true);
  });
});

describe('Phase 1T-A — purity and source contract', () => {
  it('26. resolver does not mutate input', () => {
    const input = capInput({
      actor: 'assistant',
      hasActiveDriverDelegation: true,
      delegatedPermissions: ['settlements_view'],
    });
    const before = JSON.parse(JSON.stringify(input));
    resolveSettlementCapabilities(input);
    expect(JSON.parse(JSON.stringify(input))).toEqual(before);
  });

  it('27. source declares no email or auth-user carrier ownership fields', () => {
    const raw = readFileSync(SOURCE_PATH, 'utf8');
    // Strip comments so prose about forbidden fields cannot trip the check.
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    for (const forbidden of [
      'email',
      'carrierEmail',
      'recruiterEmail',
      'carrierUserId',
    ]) {
      // property declaration, object key, or property access
      const declaration = new RegExp(`(^|[^A-Za-z0-9_$])${forbidden}\\s*[?:]`, 'm');
      const access = new RegExp(`\\.${forbidden}\\b`);
      expect(declaration.test(code), `${forbidden} declared`).toBe(false);
      expect(access.test(code), `${forbidden} accessed`).toBe(false);
    }
  });
});
