/**
 * Phase 1T-A — Settlement domain, identity, and capability contract.
 *
 * This module is intentionally PURE and runtime-neutral:
 *  - no React, Supabase, Stripe SDK, network, storage, timers, randomness,
 *    environment access, database calls, or writes of any kind;
 *  - deterministic: same input → deeply equal output;
 *  - never mutates caller input.
 *
 * PRODUCT BOUNDARY (locked):
 * This is settlement *viewing and reconciliation* software. It is NOT payroll
 * processing software. See SETTLEMENT_NEVER_RESPONSIBILITIES — those are
 * permanently out of scope and no capability here may imply them.
 *
 * IDENTITY SEPARATION (locked):
 *  - driverUserId           — the recipient / data subject of the settlement.
 *  - createdByUserId        — the actual auth actor, recorded for audit only.
 *                             It is NEVER an authorization substitute.
 *  - carrierRecruiterProfileId — the carrier/recruiter BUSINESS identity, which
 *                             is canonically `recruiter_profiles.id`. It is
 *                             never an auth `user.id` and never an email.
 *  - agencyId               — the agency BUSINESS identity, canonically
 *                             `agency_profiles.id`.
 * Source semantics stay separate: carrier_issued, agency_prepared, and
 * driver_imported records are distinct records with distinct provenance and
 * must never be collapsed into one another.
 */

import type { PlanKey } from '@/lib/billing/plans';
import type { EffectiveBusinessEntitlement } from '@/lib/billing/effectiveBusinessEntitlement';

/** Provenance of a settlement record. */
export const SETTLEMENT_SOURCES = [
  'carrier_issued',
  'agency_prepared',
  'driver_imported',
] as const;
export type SettlementSource = (typeof SETTLEMENT_SOURCES)[number];

/** Lifecycle state of a settlement record. */
export const SETTLEMENT_STATUSES = [
  'draft',
  'finalized',
  'voided',
  'superseded',
] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

/** Kind of a settlement line item. */
export const SETTLEMENT_ITEM_TYPES = [
  'load_pay',
  'earning',
  'reimbursement',
  'deduction',
  'withholding',
] as const;
export type SettlementItemType = (typeof SETTLEMENT_ITEM_TYPES)[number];

/**
 * Pay method of a single line item.
 * There is deliberately no `mixed` method: a mixed settlement is represented
 * by MULTIPLE line items each using one canonical method.
 */
export const SETTLEMENT_PAY_METHODS = [
  'per_mile',
  'percentage',
  'flat_rate',
  'manual',
] as const;
export type SettlementPayMethod = (typeof SETTLEMENT_PAY_METHODS)[number];

/** Delegation permissions that can be granted on a driver's settlements. */
export const SETTLEMENT_DELEGATION_PERMISSIONS = [
  'settlements_view',
  'settlements_manage',
  'settlements_finalize',
] as const;
export type SettlementDelegationPermission =
  (typeof SETTLEMENT_DELEGATION_PERMISSIONS)[number];

/**
 * Permanently out-of-scope responsibilities. Nothing in this product performs
 * these; no capability may be interpreted as granting them.
 */
export const SETTLEMENT_NEVER_RESPONSIBILITIES = [
  'process_payroll',
  'send_ach_or_direct_deposit',
  'calculate_or_remit_employer_payroll_taxes',
  'issue_or_file_tax_forms',
  'determine_worker_classification',
  'determine_deduction_legality',
] as const;
export type SettlementNeverResponsibility =
  (typeof SETTLEMENT_NEVER_RESPONSIBILITIES)[number];

/** Who is acting on the settlement surface. */
export type SettlementActorKind = 'driver' | 'assistant' | 'agency' | 'carrier';

/**
 * Identity envelope of a settlement record. No email field exists here by
 * design — email is never an ownership or authorization key.
 */
export interface SettlementIdentity {
  /** Recipient / data subject (auth user id of the driver). */
  driverUserId: string;
  /** Provenance of the record. */
  source: SettlementSource;
  /** Actual auth actor who created the record — audit only. */
  createdByUserId: string;
  /** Canonical `recruiter_profiles.id` ONLY. Never an auth user id. */
  carrierRecruiterProfileId: string | null;
  /** Canonical `agency_profiles.id` ONLY. */
  agencyId: string | null;
}

export type SettlementIdentityInvalidReason =
  | 'missing_driver_user_id'
  | 'missing_created_by_user_id'
  | 'unknown_source'
  | 'carrier_issued_requires_carrier_recruiter_profile_id'
  | 'carrier_issued_forbids_agency_id'
  | 'agency_prepared_requires_agency_id'
  | 'agency_prepared_forbids_carrier_recruiter_profile_id'
  | 'driver_imported_forbids_business_identity';

export type SettlementIdentityValidation =
  | { valid: true }
  | { valid: false; reason: SettlementIdentityInvalidReason };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Explicit-null semantics: a business id that does not apply to the record's
 * source MUST be exactly `null`. `undefined` (or any other value) is malformed
 * and fails closed — absent and explicitly-not-applicable are not the same.
 */
function isExactlyNull(value: unknown): boolean {
  return value === null;
}

/**
 * Validate the identity envelope. Fails closed on anything malformed, even
 * when TypeScript types would suggest a value is impossible.
 *
 * Note: `carrierRecruiterProfileId` is deliberately NEVER compared to
 * `createdByUserId` — they are different identity spaces.
 */
export function validateSettlementIdentity(
  identity: SettlementIdentity,
): SettlementIdentityValidation {
  const value = identity as unknown as Partial<SettlementIdentity> | null | undefined;
  if (!value || typeof value !== 'object') {
    return { valid: false, reason: 'unknown_source' };
  }

  if (!isNonEmptyString(value.driverUserId)) {
    return { valid: false, reason: 'missing_driver_user_id' };
  }
  if (!isNonEmptyString(value.createdByUserId)) {
    return { valid: false, reason: 'missing_created_by_user_id' };
  }

  const source = value.source as unknown;
  if (
    typeof source !== 'string' ||
    !(SETTLEMENT_SOURCES as readonly string[]).includes(source)
  ) {
    return { valid: false, reason: 'unknown_source' };
  }

  const carrierId = value.carrierRecruiterProfileId as unknown;
  const agencyId = value.agencyId as unknown;
  const hasCarrierId = isNonEmptyString(carrierId);
  const hasAgencyId = isNonEmptyString(agencyId);

  if (source === 'carrier_issued') {
    if (!hasCarrierId) {
      return {
        valid: false,
        reason: 'carrier_issued_requires_carrier_recruiter_profile_id',
      };
    }
    if (!isExactlyNull(agencyId)) {
      return { valid: false, reason: 'carrier_issued_forbids_agency_id' };
    }
    return { valid: true };
  }

  if (source === 'agency_prepared') {
    if (!hasAgencyId) {
      return { valid: false, reason: 'agency_prepared_requires_agency_id' };
    }
    if (!isExactlyNull(carrierId)) {
      return {
        valid: false,
        reason: 'agency_prepared_forbids_carrier_recruiter_profile_id',
      };
    }
    return { valid: true };
  }

  // driver_imported
  if (!isExactlyNull(carrierId) || !isExactlyNull(agencyId)) {
    return { valid: false, reason: 'driver_imported_forbids_business_identity' };
  }
  return { valid: true };
}

export interface SettlementCapabilityInput {
  actor: SettlementActorKind;
  /** The RECIPIENT driver's canonical plan key. */
  driverPlan: PlanKey;
  /** Whether the recipient driver's subscription is currently active. */
  driverSubscriptionActive: boolean;
  /** Whether the acting driver is the recipient of this settlement. */
  isRecipientDriver: boolean;
  businessEntitlement: Pick<
    EffectiveBusinessEntitlement,
    'state' | 'effectiveRecruiterTier' | 'effectiveAgencyPlan' | 'entitlementSource'
  >;
  /** Carrier ⇄ driver relationship is active (Phase 1T-B supplies the fact). */
  hasActiveCarrierDriverRelationship: boolean;
  /** Driver delegation (assistant/agency) is active. */
  hasActiveDriverDelegation: boolean;
  delegatedPermissions: readonly SettlementDelegationPermission[];
}

export interface SettlementCapabilities {
  canViewDeliveredSettlement: boolean;
  canUseBasicReconciliation: boolean;
  canUseAdvancedReconciliation: boolean;
  canCreateDriverImportedSettlement: boolean;
  canIssueCarrierSettlement: boolean;
  canPrepareAgencySettlement: boolean;
  canFinalizeManagedSettlement: boolean;
}

const PRO_PLAN_KEYS: readonly string[] = ['pro_monthly', 'pro_yearly'];
const PAID_RECRUITER_TIERS: readonly string[] = ['starter', 'growth', 'fleet'];
/**
 * Exact allowlist of resolved paid agency plan keys. Any other runtime value —
 * forged, misspelled, whitespace-padded, or differently cased — fails closed.
 */
const PAID_AGENCY_PLAN_KEYS: readonly string[] = Object.freeze([
  'agency_starter',
  'agency_team',
  'agency_growth',
]);

function hasPermission(
  permissions: unknown,
  permission: SettlementDelegationPermission,
): boolean {
  if (!Array.isArray(permissions)) return false;
  return permissions.some((p) => typeof p === 'string' && p === permission);
}

function isActiveDriverPro(input: SettlementCapabilityInput): boolean {
  return (
    input.driverSubscriptionActive === true &&
    typeof input.driverPlan === 'string' &&
    PRO_PLAN_KEYS.includes(input.driverPlan)
  );
}

const NONE: SettlementCapabilities = Object.freeze({
  canViewDeliveredSettlement: false,
  canUseBasicReconciliation: false,
  canUseAdvancedReconciliation: false,
  canCreateDriverImportedSettlement: false,
  canIssueCarrierSettlement: false,
  canPrepareAgencySettlement: false,
  canFinalizeManagedSettlement: false,
});

/**
 * Resolve settlement capabilities. Pure, deterministic, non-mutating.
 * Every unknown or malformed runtime value fails closed.
 */
export function resolveSettlementCapabilities(
  input: SettlementCapabilityInput,
): SettlementCapabilities {
  if (!input || typeof input !== 'object') return { ...NONE };

  const actor = input.actor as unknown;
  const capabilities: SettlementCapabilities = { ...NONE };

  const driverPro = isActiveDriverPro(input);
  const delegationActive = input.hasActiveDriverDelegation === true;
  const canView = hasPermission(input.delegatedPermissions, 'settlements_view');
  const canManage = hasPermission(input.delegatedPermissions, 'settlements_manage');
  const canFinalize = hasPermission(
    input.delegatedPermissions,
    'settlements_finalize',
  );

  if (actor === 'driver') {
    // Company-issued settlements are visible to the recipient driver on BOTH
    // Free and Pro. Pro only adds ADVANCED reconciliation + manual import.
    if (input.isRecipientDriver === true) {
      capabilities.canViewDeliveredSettlement = true;
      capabilities.canUseBasicReconciliation = true;
      if (driverPro) {
        capabilities.canUseAdvancedReconciliation = true;
        capabilities.canCreateDriverImportedSettlement = true;
      }
    }
    return capabilities;
  }

  if (actor === 'assistant') {
    // Assistants operate under the driver's delegation AND inherit the
    // driver's own Free/Pro capability level — never their own.
    if (delegationActive && canView) {
      capabilities.canViewDeliveredSettlement = true;
      capabilities.canUseBasicReconciliation = true;
    }
    if (delegationActive && canManage && driverPro) {
      capabilities.canUseAdvancedReconciliation = true;
      capabilities.canCreateDriverImportedSettlement = true;
    }
    if (delegationActive && canFinalize && driverPro) {
      capabilities.canFinalizeManagedSettlement = true;
    }
    return capabilities;
  }

  if (actor === 'carrier') {
    const be = input.businessEntitlement;
    const resolved = !!be && be.state === 'resolved';
    // Agency-included recruiter premium MUST NEVER grant carrier issuance:
    // only a standalone recruiter subscription qualifies.
    const standalonePaidRecruiter =
      resolved &&
      be.entitlementSource === 'recruiter_subscription' &&
      typeof be.effectiveRecruiterTier === 'string' &&
      PAID_RECRUITER_TIERS.includes(be.effectiveRecruiterTier);
    const gate =
      standalonePaidRecruiter && input.hasActiveCarrierDriverRelationship === true;
    capabilities.canIssueCarrierSettlement = gate;
    capabilities.canFinalizeManagedSettlement = gate;
    return capabilities;
  }

  if (actor === 'agency') {
    const be = input.businessEntitlement;
    const paidAgency =
      !!be &&
      be.state === 'resolved' &&
      typeof be.effectiveAgencyPlan === 'string' &&
      PAID_AGENCY_PLAN_KEYS.includes(be.effectiveAgencyPlan);
    // Driver Free/Pro never gates a paid agency's preparation capability.
    const prepare = paidAgency && delegationActive && canManage;
    capabilities.canPrepareAgencySettlement = prepare;
    capabilities.canFinalizeManagedSettlement = prepare && canFinalize;
    return capabilities;
  }

  // Unknown actor — fail closed.
  return capabilities;
}
