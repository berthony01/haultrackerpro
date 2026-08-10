// Deterministic fake carrier QA data. No real user data, no network.
export const RECRUITER_ID = 'rec-0000-1111-2222-3333';

export const LONG_DRIVER_A =
  'Bartholomew Maximilian Featherstonehaugh-Wintersgill the Third of Springfield';
export const LONG_DRIVER_B =
  'Anastasia Konstantinovna Vasilievska-Przybylska-Oyelaran Longhaul Operations';

export const DRIVER_A = 'drv-aaaa-1111-2222-3333';
export const DRIVER_B = 'drv-bbbb-4444-5555-6666';

export const applications = [
  {
    id: 'app-1',
    driver_user_id: DRIVER_A,
    driver_profile: { full_name: LONG_DRIVER_A },
    opportunities: { title: 'Dedicated Midwest Reefer Regional Running Lanes Position' },
  },
  {
    id: 'app-2',
    driver_user_id: DRIVER_B,
    driver_profile: { full_name: LONG_DRIVER_B },
    opportunities: { title: 'Over-the-road Flatbed Owner Operator Long Distance Route' },
  },
];

export const relationships = [
  {
    id: 'rel-active-1',
    recruiter_id: RECRUITER_ID,
    driver_user_id: DRIVER_A,
    status: 'active',
    invited_at: '2026-06-01T10:00:00Z',
    accepted_at: '2026-06-03T10:00:00Z',
    ended_at: null,
  },
  {
    id: 'rel-invited-1',
    recruiter_id: RECRUITER_ID,
    driver_user_id: DRIVER_B,
    status: 'invited',
    invited_at: '2026-07-15T10:00:00Z',
    accepted_at: null,
    ended_at: null,
  },
];

const LONG_NOTES =
  'Reconciliation note: escrow adjustment applied for the detention dispute raised on the Kansas City to Indianapolis reefer run, pending broker confirmation of the accessorial paperwork and the corrected bill of lading reference numbers supplied by dispatch.';

export const settlements = [
  {
    id: 'stl-draft-1',
    source: 'carrier_issued',
    status: 'draft',
    driver_user_id: DRIVER_A,
    agency_id: null,
    carrier_recruiter_profile_id: RECRUITER_ID,
    carrier_driver_relationship_id: 'rel-active-1',
    period_start: '2026-07-06',
    period_end: '2026-07-12',
    pay_date: '2026-07-18',
    statement_reference: 'CARRIER-STATEMENT-2026-07-12-WEEKLY-RECONCILIATION-000148821',
    payer_name_snapshot: 'Continental Interstate Logistics & Freight Solutions LLC',
    source_display_name_snapshot: 'Continental Interstate Logistics & Freight Solutions LLC',
    reported_gross_amount: 7421.55,
    reported_net_amount: 5980.25,
    notes: LONG_NOTES,
    version_number: 1,
    created_at: '2026-07-13T09:00:00Z',
  },
  {
    id: 'stl-final-1',
    source: 'carrier_issued',
    status: 'finalized',
    driver_user_id: DRIVER_B,
    agency_id: null,
    carrier_recruiter_profile_id: RECRUITER_ID,
    carrier_driver_relationship_id: 'rel-active-1',
    period_start: '2026-06-29',
    period_end: '2026-07-05',
    pay_date: '2026-07-11',
    statement_reference: 'CARRIER-STATEMENT-2026-07-05-WEEKLY-RECONCILIATION-000148772',
    payer_name_snapshot: 'Continental Interstate Logistics & Freight Solutions LLC',
    source_display_name_snapshot: 'Continental Interstate Logistics & Freight Solutions LLC',
    reported_gross_amount: 8110.0,
    reported_net_amount: 6402.75,
    notes: LONG_NOTES,
    version_number: 2,
    created_at: '2026-07-06T09:00:00Z',
  },
];

const mkItem = (
  id: string,
  item_type: string,
  description: string,
  amount: number,
  sort_order: number,
) => ({
  id,
  item_type,
  category: 'weekly',
  description,
  amount,
  pay_method: 'per_mile',
  quantity: 1120,
  rate: 0.62,
  unit_label: 'miles',
  load_reference_snapshot: 'LOAD-REFERENCE-SNAPSHOT-KC-TO-INDIANAPOLIS-0000998812',
  pickup_date_snapshot: '2026-07-07',
  delivery_date_snapshot: '2026-07-09',
  origin_snapshot: 'Kansas City, MO',
  destination_snapshot: 'Indianapolis, IN',
  loaded_miles_snapshot: 1120,
  deadhead_miles_snapshot: 84,
  payable_miles_snapshot: 1204,
  eligible_revenue_snapshot: 4200,
  sort_order,
});

export const itemsBySettlement: Record<string, unknown[]> = {
  'stl-draft-1': [
    mkItem('itm-1', 'load_pay', 'Kansas City MO to Indianapolis IN reefer linehaul settlement line', 4210.4, 1),
    mkItem('itm-2', 'reimbursement', 'Prepaid lumper receipt reimbursement for consignee unloading service', 320.15, 2),
    mkItem('itm-3', 'deduction', 'Occupational accident insurance weekly deduction installment amount', -410.3, 3),
    mkItem('itm-4', 'withholding', 'Escrow maintenance reserve withholding for trailer damage claim', -140.0, 4),
  ],
  'stl-final-1': [
    mkItem('itm-5', 'load_pay', 'Dallas TX to Denver CO flatbed linehaul settlement statement line', 5120.0, 1),
    mkItem('itm-6', 'earning', 'Detention and layover accessorial earning approved by dispatch team', 480.5, 2),
    mkItem('itm-7', 'deduction', 'Fuel advance repayment deduction applied against this pay period', -690.25, 3),
  ],
};

export const eventsBySettlement: Record<string, unknown[]> = {
  'stl-final-1': [
    { id: 'evt-1', event_type: 'finalized', created_at: '2026-07-06T12:00:00Z', notes: null },
  ],
};
