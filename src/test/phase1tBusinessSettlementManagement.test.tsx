/**
 * Phase 1T-E1 — Business settlement management acceptance suite.
 *
 * Proves the presentation contract for carrier (standalone paid recruiter) and
 * agency settlement management:
 *  - provenance and ownership filtering are exact;
 *  - no raw identifier ever reaches a user-visible label;
 *  - only accepted hooks/services are used (no direct backend transport);
 *  - lifecycle editability, argument construction and error translation follow
 *    the accepted backend contract;
 *  - workspace integration mounts each panel in the correct workspace only.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import {
  buildAgencyDraftArgs,
  buildCarrierDraftArgs,
  buildHeaderArgs,
  buildItemFields,
  canEditSettlementStatus,
  describeSettlementError,
  EMPTY_DRAFT_FORM,
  EMPTY_ITEM_FORM,
  filterBusinessSettlements,
  formatMoney,
  isBlankOrFinite,
  isBlankOrNonNegativeFinite,
  optionalNumber,
  optionalText,
  resolveBusinessPayerLabel,
  resolveBusinessSourceLabel,
  validateDraftForm,
  validateItemForm,
  BusinessSettlementManager,
  type BusinessSettlementLike,
} from '@/components/settlements/BusinessSettlementManager';
import {
  buildCarrierDriverOptions,
  CARRIER_RELATIONSHIP_STATUS_LABELS,
  deriveCarrierDriverCandidates,
  filterCarrierRelationships,
  type CarrierDriverRelationshipLike,
} from '@/components/settlements/CarrierSettlementsPanel';
import {
  buildAgencyDriverOptions,
  canAgencyManageSettlementsPresentation,
} from '@/components/settlements/AgencySettlementsPanel';

/* Hook boundary is mocked: these acceptance proofs exercise the presentation
 * contract only. Authorization stays with PostgreSQL in production. */
const hookState = {
  settlements: [] as BusinessSettlementLike[],
  createdRow: null as unknown,
};
const createCarrierMutate = vi.fn(async () => hookState.createdRow);

vi.mock('@/hooks/settlements/useSettlementData', () => {
  const idleMutation = (fn: (args: unknown) => Promise<unknown>) => () => ({
    mutateAsync: fn,
    isPending: false,
  });
  const emptyQuery = () => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  return {
    useVisibleSettlements: () => ({
      data: hookState.settlements,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useVisibleSettlementItems: emptyQuery,
    useVisibleSettlementEvents: emptyQuery,
    useCreateCarrierSettlementDraft: idleMutation(createCarrierMutate),
    useCreateAgencySettlementDraft: idleMutation(async () => null),
    useCreateSettlementCorrectionDraft: idleMutation(async () => null),
    useUpdateSettlementDraftHeader: idleMutation(async () => null),
    useFinalizeSettlementDraft: idleMutation(async () => null),
    useVoidFinalizedSettlement: idleMutation(async () => null),
    useAddSettlementDraftItem: idleMutation(async () => null),
    useUpdateSettlementDraftItem: idleMutation(async () => null),
    useDeleteSettlementDraftItem: idleMutation(async () => null),
  };
});


const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const MANAGER_PATH = 'src/components/settlements/BusinessSettlementManager.tsx';
const CARRIER_PATH = 'src/components/settlements/CarrierSettlementsPanel.tsx';
const AGENCY_PATH = 'src/components/settlements/AgencySettlementsPanel.tsx';
const RECRUITER_PAGE_PATH =
  'src/components/opportunities/recruiter/RecruiterAccessPage.tsx';
const AGENCY_PAGE_PATH = 'src/pages/AgencyDashboard.tsx';

const managerSrc = read(MANAGER_PATH);
const carrierSrc = read(CARRIER_PATH);
const agencySrc = read(AGENCY_PATH);
const recruiterPageSrc = read(RECRUITER_PAGE_PATH);
const agencyPageSrc = read(AGENCY_PAGE_PATH);

const RECRUITER_ID = 'rec-1';
const AGENCY_ID = 'ag-1';

function settlement(
  overrides: Partial<BusinessSettlementLike> = {},
): BusinessSettlementLike {
  return {
    id: 's-1',
    status: 'draft',
    source: 'carrier_issued',
    carrier_recruiter_profile_id: RECRUITER_ID,
    agency_id: null,
    driver_user_id: 'drv-1',
    ...overrides,
  } as BusinessSettlementLike;
}

/* ------------------------------------------------------ 1. transport rules */

describe('E1 · transport discipline', () => {
  it('no panel imports the backend client directly', () => {
    for (const src of [managerSrc, carrierSrc, agencySrc]) {
      expect(src).not.toMatch(/integrations\/supabase\/client/);
      expect(src).not.toMatch(/\.rpc\(/);
      expect(src).not.toMatch(/\.from\(/);
    }
  });

  it('settlement mutations flow only through accepted hooks', () => {
    expect(managerSrc).toMatch(/@\/hooks\/settlements\/useSettlementData/);
    expect(carrierSrc).toMatch(/@\/hooks\/settlements\/useSettlementData/);
  });

  it('panels never fabricate authorization decisions client-side', () => {
    for (const src of [carrierSrc, agencySrc]) {
      expect(src).not.toMatch(/auth\.uid|service_role|SECURITY DEFINER/);
    }
  });
});

/* --------------------------------------------- 2. provenance & ownership */

describe('E1 · provenance filtering', () => {
  it('carrier mode keeps only carrier-issued statements it owns', () => {
    const rows = [
      settlement({ id: 'a' }),
      settlement({ id: 'b', carrier_recruiter_profile_id: 'other' }),
      settlement({
        id: 'c',
        source: 'agency_prepared',
        carrier_recruiter_profile_id: null,
        agency_id: AGENCY_ID,
      }),
      settlement({ id: 'd', source: 'driver_imported', carrier_recruiter_profile_id: null }),
    ];
    expect(filterBusinessSettlements(rows, 'carrier', RECRUITER_ID).map((r) => r.id)).toEqual(
      ['a'],
    );
  });

  it('agency mode keeps only agency-prepared statements it owns', () => {
    const rows = [
      settlement({
        id: 'x',
        source: 'agency_prepared',
        carrier_recruiter_profile_id: null,
        agency_id: AGENCY_ID,
      }),
      settlement({
        id: 'y',
        source: 'agency_prepared',
        carrier_recruiter_profile_id: null,
        agency_id: 'other-agency',
      }),
      settlement({ id: 'z' }),
    ];
    expect(filterBusinessSettlements(rows, 'agency', AGENCY_ID).map((r) => r.id)).toEqual(['x']);
  });

  it('returns nothing when the business id is unknown', () => {
    expect(filterBusinessSettlements([settlement()], 'carrier', '')).toEqual([]);
    expect(filterBusinessSettlements(null, 'agency', AGENCY_ID)).toEqual([]);
  });
});

/* --------------------------------------------------------- 3. lifecycle */

describe('E1 · lifecycle editability', () => {
  it('only drafts are editable', () => {
    expect(canEditSettlementStatus('draft')).toBe(true);
    for (const s of ['finalized', 'superseded', 'voided', null, undefined, 'unknown']) {
      expect(canEditSettlementStatus(s)).toBe(false);
    }
  });

  it('exposes finalize, correction and void actions in the shared editor', () => {
    expect(managerSrc).toMatch(/useFinalizeSettlementDraft/);
    expect(managerSrc).toMatch(/useCreateSettlementCorrectionDraft/);
    expect(managerSrc).toMatch(/useVoidFinalizedSettlement/);
  });
});

/* -------------------------------------------------- 4. argument building */

describe('E1 · RPC argument construction', () => {
  const values = {
    ...EMPTY_DRAFT_FORM,
    driverUserId: 'drv-1',
    periodStart: '2026-08-03',
    periodEnd: '2026-08-09',
  };

  it('carrier draft args carry the exact relationship id and recruiter owner', () => {
    const args = buildCarrierDraftArgs(RECRUITER_ID, 'rel-1', values);
    expect(args._recruiter_id).toBe(RECRUITER_ID);
    expect(args._relationship_id).toBe('rel-1');
    expect(args).not.toHaveProperty('_agency_id');
    expect(args._pay_date).toBeUndefined();
  });

  it('agency draft args carry the agency owner and no relationship id', () => {
    const args = buildAgencyDraftArgs(AGENCY_ID, values);
    expect(args._agency_id).toBe(AGENCY_ID);
    expect(args).not.toHaveProperty('_relationship_id');
    expect(args).not.toHaveProperty('_recruiter_id');
  });

  it('header updates never send provenance, owner, driver or version', () => {
    const args = buildHeaderArgs('s-1', values) as Record<string, unknown>;
    for (const forbidden of [
      '_recruiter_id',
      '_agency_id',
      '_driver_user_id',
      '_source',
      '_version',
      '_status',
    ]) {
      expect(args).not.toHaveProperty(forbidden);
    }
    expect(args._settlement_id).toBe('s-1');
  });

  it('blank optionals are omitted rather than sent as empty values', () => {
    expect(optionalText('   ')).toBeUndefined();
    expect(optionalText(' ref ')).toBe('ref');
    expect(optionalNumber('')).toBeUndefined();
    expect(optionalNumber('12.5')).toBe(12.5);
  });
});

/* ------------------------------------------------------- 5. validation */

describe('E1 · form validation', () => {
  it('requires a driver and a coherent period', () => {
    expect(validateDraftForm(EMPTY_DRAFT_FORM)).toBeTruthy();
    expect(
      validateDraftForm({
        ...EMPTY_DRAFT_FORM,
        driverUserId: 'drv-1',
        periodStart: '2026-08-09',
        periodEnd: '2026-08-03',
      }),
    ).toBeTruthy();
    expect(
      validateDraftForm({
        ...EMPTY_DRAFT_FORM,
        driverUserId: 'drv-1',
        periodStart: '2026-08-03',
        periodEnd: '2026-08-09',
      }),
    ).toBeNull();
  });

  it('rejects non-finite numeric inputs but permits a negative reported net', () => {
    expect(isBlankOrNonNegativeFinite('')).toBe(true);
    expect(isBlankOrNonNegativeFinite('0')).toBe(true);
    expect(isBlankOrNonNegativeFinite('-1')).toBe(false);
    expect(isBlankOrNonNegativeFinite('abc')).toBe(false);

    // Reported amounts are bounded by PostgreSQL, not by the client: a
    // negative net (deductions exceeding earnings) must be submittable.
    expect(isBlankOrFinite('')).toBe(true);
    expect(isBlankOrFinite('-250.75')).toBe(true);
    expect(isBlankOrFinite('abc')).toBe(false);
    const base = {
      ...EMPTY_DRAFT_FORM,
      driverUserId: 'drv-1',
      periodStart: '2026-08-03',
      periodEnd: '2026-08-09',
    };
    expect(validateDraftForm({ ...base, reportedNet: '-250.75' })).toBeNull();
    expect(validateDraftForm({ ...base, reportedGross: '-10' })).toBeNull();
    expect(validateDraftForm({ ...base, reportedNet: 'abc' })).toBeTruthy();
  });


  it('item validation demands a type and an amount', () => {
    expect(validateItemForm(EMPTY_ITEM_FORM)).toBeTruthy();
    const ok = { ...EMPTY_ITEM_FORM, itemType: 'load_pay', amount: '100' };
    expect(validateItemForm(ok)).toBeNull();
    expect(buildItemFields(ok)._amount).toBe(100);
  });
});

/* ---------------------------------------------------- 6. error messaging */

describe('E1 · error translation', () => {
  it('maps backend tokens to plain language without leaking tokens', () => {
    const msg = describeSettlementError({ message: 'settlement_not_editable' });
    expect(msg).not.toMatch(/settlement_not_editable/);
    expect(msg.length).toBeGreaterThan(10);
  });

  it('falls back safely for unknown failures', () => {
    expect(describeSettlementError(null)).toMatch(/could not be completed/i);
  });
});

/* ------------------------------------------------ 7. carrier derivations */

describe('E1 · carrier driver candidates', () => {
  const applications = [
    {
      driver_user_id: 'drv-1',
      driver_profile: { full_name: 'Dana Hauler' },
      opportunities: { title: 'OTR Dry Van' },
    },
    { driver_user_id: 'drv-1', driver_profile: { full_name: 'Dana Hauler' } },
    { driver_user_id: 'drv-2', driver_profile: null, opportunities: { title: 'Regional Reefer' } },
    { driver_user_id: 'drv-3', driver_profile: null, opportunities: null },
    { driver_user_id: '', driver_profile: null },
    null,
  ];

  it('dedupes and labels candidates without raw identifiers', () => {
    const result = deriveCarrierDriverCandidates(applications);
    expect(result).toEqual([
      { driverUserId: 'drv-1', label: 'Dana Hauler' },
      { driverUserId: 'drv-2', label: 'Regional Reefer' },
      { driverUserId: 'drv-3', label: 'Driver applicant' },
    ]);
    for (const c of result) expect(c.label).not.toContain(c.driverUserId);
  });

  it('tolerates missing application data', () => {
    expect(deriveCarrierDriverCandidates(null)).toEqual([]);
    expect(deriveCarrierDriverCandidates([])).toEqual([]);
  });
});

describe('E1 · carrier relationships', () => {
  const rows: CarrierDriverRelationshipLike[] = [
    {
      id: 'rel-1',
      recruiter_id: RECRUITER_ID,
      driver_user_id: 'drv-1',
      status: 'active',
      invited_at: '2026-08-01',
      accepted_at: '2026-08-02',
      ended_at: null,
    },
    {
      id: 'rel-2',
      recruiter_id: RECRUITER_ID,
      driver_user_id: 'drv-2',
      status: 'invited',
      invited_at: '2026-08-03',
      accepted_at: null,
      ended_at: null,
    },
    {
      id: 'rel-3',
      recruiter_id: 'other',
      driver_user_id: 'drv-9',
      status: 'active',
      invited_at: '2026-08-01',
      accepted_at: '2026-08-02',
      ended_at: null,
    },
  ];

  it('keeps only rows owned by this recruiter profile', () => {
    expect(filterCarrierRelationships(rows, RECRUITER_ID).map((r) => r.id)).toEqual([
      'rel-1',
      'rel-2',
    ]);
    expect(filterCarrierRelationships(rows, '')).toEqual([]);
  });

  it('only ACTIVE relationships may issue statements, each with its exact id', () => {
    const options = buildCarrierDriverOptions(
      filterCarrierRelationships(rows, RECRUITER_ID),
      new Map([['drv-1', 'Dana Hauler']]),
    );
    expect(options).toEqual([
      { driverUserId: 'drv-1', relationshipId: 'rel-1', label: 'Dana Hauler' },
    ]);
  });

  it('labels every relationship status in plain language', () => {
    for (const status of ['invited', 'active', 'inactive', 'ended']) {
      expect(CARRIER_RELATIONSHIP_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it('requires a standalone paid recruiter subscription to manage statements', () => {
    expect(carrierSrc).toMatch(/isPaidRecruiterPlanActive/);
    expect(carrierSrc).toMatch(/recruiter_subscription/);
    expect(carrierSrc).toMatch(/agency_included/);
  });
});

/* ------------------------------------------------- 8. agency derivations */

describe('E1 · agency settlement preparation', () => {
  it('requires an active paid agency entitlement in presentation', () => {
    for (const s of ['active', 'trialing', 'manual_beta']) {
      expect(canAgencyManageSettlementsPresentation(s)).toBe(true);
    }
    for (const s of ['cancelled', 'past_due', 'none', null, undefined]) {
      expect(canAgencyManageSettlementsPresentation(s)).toBe(false);
    }
  });

  it('builds privacy-safe client options without raw identifiers', () => {
    const options = buildAgencyDriverOptions([
      { driver_user_id: 'drv-1', driver_name: 'Sam Road', driver_email: 'sam@example.com' },
      { driver_user_id: 'drv-1', driver_name: 'Sam Road', driver_email: null },
      { driver_user_id: 'drv-2', driver_name: null, driver_email: 'kim@example.com' },
      { driver_user_id: 'drv-3', driver_name: null, driver_email: null },
    ]);
    expect(options).toEqual([
      { driverUserId: 'drv-1', label: 'Sam Road' },
      { driverUserId: 'drv-2', label: 'kim@example.com' },
      { driverUserId: 'drv-3', label: 'Agency client' },
    ]);
  });

  it('never pre-empts per-driver delegation authorization', () => {
    expect(agencySrc).toMatch(/declined/i);
    expect(agencySrc).not.toMatch(/has_role|delegation_allowed\s*=/);
  });
});

/* ------------------------------------------------ 9. workspace integration */

describe('E1 · workspace integration', () => {
  it('mounts the carrier panel inside the recruiter workspace only', () => {
    expect(recruiterPageSrc).toMatch(/CarrierSettlementsPanel/);
    expect(recruiterPageSrc).toMatch(/Driver Settlements/);
    expect(recruiterPageSrc).not.toMatch(/AgencySettlementsPanel/);
  });

  it('mounts the agency panel inside a dedicated agency tab only', () => {
    expect(agencyPageSrc).toMatch(/AgencySettlementsPanel/);
    expect(agencyPageSrc).toMatch(/value: 'settlements', label: 'Settlements'/);
    expect(agencyPageSrc).not.toMatch(/CarrierSettlementsPanel/);
  });

  it('carrier settlements mount on demand rather than on every render', () => {
    expect(recruiterPageSrc).toMatch(/settlementsOpen &&\s*\(?\s*<CarrierSettlementsPanel/);
  });
});

/* -------------------------------------------------- 10. truthfulness guard */

describe('E1 · copy truthfulness', () => {
  it('never claims payroll, tax withholding or fund transfer', () => {
    for (const src of [managerSrc, carrierSrc, agencySrc]) {
      expect(src).not.toMatch(/we (pay|transfer|deposit)/i);
      expect(src).not.toMatch(/guaranteed pay/i);
    }
    expect(carrierSrc).toMatch(/does not issue payroll/);
    expect(agencySrc).toMatch(/does not issue payroll/);
  });

  it('formats money and never renders bare identifiers as labels', () => {
    expect(formatMoney(1234.5)).toMatch(/1,234\.50/);
    expect(formatMoney(null)).toBe('—');
    for (const src of [carrierSrc, agencySrc]) {
      expect(src).not.toMatch(/\{[a-zA-Z.]*driver_user_id\}/);
      expect(src).not.toMatch(/\{[a-zA-Z.]*\.id\}\s*</);
    }
  });
});
