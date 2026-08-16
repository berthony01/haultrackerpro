/**
 * Phase 1T-E1 — Shared business settlement manager (carrier + agency).
 *
 * Recordkeeping / reconciliation editor for BUSINESS surfaces. This component
 * NEVER talks to the backend directly: every read and every mutation goes
 * through the accepted Phase 1T React Query orchestration layer
 * (`@/hooks/settlements/useSettlementData`). It performs no authorization,
 * entitlement, delegation, role, or plan logic — PostgreSQL remains the sole
 * authority. Everything computed here is PRESENTATION ONLY.
 *
 * Argument construction notes (accepted backend contract, do not "fix"):
 *  - Optional RPC arguments are generated as `_x?: T` (PostgreSQL
 *    `DEFAULT NULL`). A blank optional is therefore passed as `undefined`,
 *    which the accepted RPC resolves to SQL NULL. We never invent a value.
 *  - `_category` and `_description` are required positional text arguments the
 *    accepted RPC normalises with `nullif(btrim(coalesce(...,'')),'')`, so a
 *    blank field is passed as `''` and stored as NULL by the server.
 *  - `expected_amount_snapshot` is server/reconciliation data and is NOT an
 *    accepted RPC argument — it is never authored here.
 */

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Download,
  FilePlus2,
  Inbox,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Printer,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { SettlementReconciliationSummary } from '@/components/settlements/SettlementReconciliationSummary';
import {
  downloadSettlementCsv,
  printSettlement,
  type SettlementExportItem,
  type SettlementExportStatement,
} from '@/lib/settlements/settlementExport';


import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  useAddSettlementDraftItem,
  useCreateAgencySettlementDraft,
  useCreateCarrierSettlementDraft,
  useCreateSettlementCorrectionDraft,
  useDeleteSettlementDraftItem,
  useFinalizeSettlementDraft,
  useUpdateSettlementDraftHeader,
  useUpdateSettlementDraftItem,
  useVisibleSettlementEvents,
  useVisibleSettlementItems,
  useVisibleSettlements,
  useVoidFinalizedSettlement,
} from '@/hooks/settlements/useSettlementData';

/* ------------------------------------------------------------ vocabulary - */

/** Exact accepted backend item vocabulary. */
export const SETTLEMENT_ITEM_TYPES = [
  'load_pay',
  'earning',
  'reimbursement',
  'deduction',
  'withholding',
] as const;

/** Exact accepted backend pay-method vocabulary (optional field). */
export const SETTLEMENT_PAY_METHODS = [
  'per_mile',
  'percentage',
  'flat_rate',
  'manual',
] as const;

export const SETTLEMENT_ITEM_TYPE_LABELS: Record<string, string> = {
  load_pay: 'Load pay',
  earning: 'Earning',
  reimbursement: 'Reimbursement',
  deduction: 'Deduction',
  withholding: 'Withholding',
};

export const SETTLEMENT_PAY_METHOD_LABELS: Record<string, string> = {
  per_mile: 'Per mile',
  percentage: 'Percentage',
  flat_rate: 'Flat rate',
  manual: 'Manual',
};

const SETTLEMENT_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  finalized: 'Finalized',
  voided: 'Voided',
  superseded: 'Superseded',
};

/* --------------------------------------------------------------- helpers - */

export type BusinessSettlementMode = 'carrier' | 'agency';

/** Minimal settlement shape this presentation layer reads. */
export interface BusinessSettlementLike {
  id: string;
  source: string;
  status: string;
  driver_user_id: string;
  agency_id: string | null;
  carrier_recruiter_profile_id: string | null;
  carrier_driver_relationship_id: string | null;
  period_start: string;
  period_end: string;
  pay_date: string | null;
  statement_reference: string | null;
  payer_name_snapshot: string | null;
  source_display_name_snapshot: string | null;
  reported_gross_amount: number | null;
  reported_net_amount: number | null;
  notes: string | null;
  version_number: number;
  created_at: string;
}

export interface BusinessDriverOption {
  driverUserId: string;
  label: string;
  /** Required in carrier mode: the exact ACTIVE relationship row id. */
  relationshipId?: string;
}

/**
 * Presentation-only provenance filter. Carrier statements are owned by the
 * recruiter profile; agency statements by the agency. Nothing here grants
 * access — RLS already decided what is visible.
 */
export function filterBusinessSettlements<T extends BusinessSettlementLike>(
  rows: readonly T[] | null | undefined,
  mode: BusinessSettlementMode,
  businessId: string,
): T[] {
  if (!rows || !businessId) return [];
  if (mode === 'carrier') {
    return rows.filter(
      (r) =>
        r.source === 'carrier_issued' &&
        r.carrier_recruiter_profile_id === businessId,
    );
  }
  return rows.filter(
    (r) => r.source === 'agency_prepared' && r.agency_id === businessId,
  );
}

/** Only drafts are editable. Finalized rows are never edited in place. */
export function canEditSettlementStatus(status: string | null | undefined): boolean {
  return status === 'draft';
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });
}

/** Blank text becomes `undefined` so the accepted RPC applies its NULL default. */
export function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Blank numeric becomes `undefined`; non-finite input is rejected upstream. */
export function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function isBlankOrNonNegativeFinite(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return true;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0;
}

/**
 * Form-integrity only: blank is allowed, a non-blank value must parse to a
 * finite number. Sign and business bounds for reported amounts are decided by
 * PostgreSQL (a negative reported net is legitimate), so the client never
 * duplicates those server rules.
 */
export function isBlankOrFinite(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return true;
  return Number.isFinite(Number(trimmed));
}

/* ------------------------------------------------ safe identity resolution */

/** Minimal identity shape used by the safe source/payer label helpers. */
export interface BusinessSettlementIdentityLike {
  source: string;
  source_display_name_snapshot: string | null;
  payer_name_snapshot: string | null;
}

const SOURCE_FALLBACK_LABELS: Record<string, string> = {
  carrier_issued: 'Carrier statement',
  agency_prepared: 'Agency-prepared statement',
  driver_imported: 'Driver-imported statement',
};

function trimmedOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Server-captured source identity, else a source-specific safe fallback.
 * NEVER falls back to any identifier (settlement, business, driver, relation).
 */
export function resolveBusinessSourceLabel(
  row: BusinessSettlementIdentityLike,
): string {
  return (
    trimmedOrNull(row.source_display_name_snapshot) ??
    SOURCE_FALLBACK_LABELS[row.source] ??
    'Settlement statement'
  );
}

/**
 * Server-captured payer identity. For carrier-issued statements the canonical
 * carrier identity is the payer, so the safe source label is used. Otherwise a
 * missing payer is stated plainly — never substituted with an identifier.
 */
export function resolveBusinessPayerLabel(
  row: BusinessSettlementIdentityLike,
): string {
  const payer = trimmedOrNull(row.payer_name_snapshot);
  if (payer) return payer;
  if (row.source === 'carrier_issued') return resolveBusinessSourceLabel(row);
  return 'Payer not listed';
}


/**
 * Safe, human-readable rendering of backend-controlled settlement errors.
 * Unknown failures degrade to a neutral message: no SQL, stack, or object dump
 * ever reaches the DOM.
 */
const SETTLEMENT_ERROR_MESSAGES: Record<string, string> = {
  settlement_carrier_not_authorized:
    'Your account is not authorized to issue carrier settlement statements right now.',
  settlement_agency_not_authorized:
    'This action was declined. The driver may not have delegated settlement permission to your agency, or your agency plan may not cover it.',
  settlement_relationship_not_authorized:
    'You are not authorized to manage this driver relationship.',
  settlement_relationship_not_found: 'That driver relationship no longer exists.',
  settlement_relationship_invalid_state:
    'That driver relationship is not in a state that allows this action.',
  settlement_carrier_name_unavailable:
    'Your recruiter company name is missing. Complete your recruiter profile first.',
  settlement_agency_name_unavailable:
    'Your agency name is missing. Complete your agency profile first.',
  settlement_driver_not_found: 'That driver could not be found.',
  settlement_not_found: 'That settlement statement could not be found.',
  settlement_not_editable: 'This statement is no longer editable.',
  settlement_not_finalizable: 'This statement cannot be finalized in its current state.',
  settlement_not_voidable: 'Only a finalized statement can be voided.',
  settlement_not_correctable: 'Only a finalized statement can be corrected.',
  settlement_item_not_found: 'That statement line no longer exists.',
  settlement_invalid_period: 'The statement period is not valid.',
  settlement_invalid_amount: 'One of the reported amounts is not valid.',
  settlement_invalid_item_amount: 'The line amount is not valid.',
  settlement_invalid_item_numeric: 'One of the line quantities is not valid.',
  settlement_invalid_item_dates: 'The line pickup or delivery date is not valid.',
  settlement_invalid_item_type: 'That line type is not supported.',
  settlement_invalid_pay_method: 'That pay method is not supported.',
  settlement_invalid_sort_order: 'The line order value is not valid.',
  settlement_item_text_too_long: 'A line text field is too long.',
  settlement_text_too_long: 'One of the text fields is too long.',
};

export function describeSettlementError(error: unknown): string {
  const raw =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : '';
  for (const token of Object.keys(SETTLEMENT_ERROR_MESSAGES)) {
    if (raw.includes(token)) return SETTLEMENT_ERROR_MESSAGES[token];
  }
  return 'That action could not be completed. Please review the details and try again.';
}

/* ------------------------------------------------------- draft form model - */

export interface BusinessDraftFormValues {
  driverUserId: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  statementReference: string;
  payerName: string;
  reportedGross: string;
  reportedNet: string;
  notes: string;
}

export const EMPTY_DRAFT_FORM: BusinessDraftFormValues = {
  driverUserId: '',
  periodStart: '',
  periodEnd: '',
  payDate: '',
  statementReference: '',
  payerName: '',
  reportedGross: '',
  reportedNet: '',
  notes: '',
};

/** Form-integrity validation ONLY. This is never an authorization decision. */
export function validateDraftForm(values: BusinessDraftFormValues): string | null {
  if (!values.driverUserId) return 'Select a driver.';
  if (!values.periodStart || !values.periodEnd) return 'Enter the statement period.';
  if (values.periodEnd < values.periodStart)
    return 'The period end must be on or after the period start.';
  if (!isBlankOrFinite(values.reportedGross))
    return 'Reported gross must be a number.';
  if (!isBlankOrFinite(values.reportedNet))
    return 'Reported net must be a number.';
  return null;
}

export function buildCarrierDraftArgs(
  businessId: string,
  relationshipId: string,
  values: BusinessDraftFormValues,
) {
  return {
    _recruiter_id: businessId,
    _relationship_id: relationshipId,
    _driver_user_id: values.driverUserId,
    _period_start: values.periodStart,
    _period_end: values.periodEnd,
    _pay_date: optionalText(values.payDate),
    _statement_reference: optionalText(values.statementReference),
    _reported_gross_amount: optionalNumber(values.reportedGross),
    _reported_net_amount: optionalNumber(values.reportedNet),
    _notes: optionalText(values.notes),
  };
}

export function buildAgencyDraftArgs(
  businessId: string,
  values: BusinessDraftFormValues,
) {
  return {
    _agency_id: businessId,
    _driver_user_id: values.driverUserId,
    _period_start: values.periodStart,
    _period_end: values.periodEnd,
    _pay_date: optionalText(values.payDate),
    _statement_reference: optionalText(values.statementReference),
    _payer_name_snapshot: optionalText(values.payerName),
    _reported_gross_amount: optionalNumber(values.reportedGross),
    _reported_net_amount: optionalNumber(values.reportedNet),
    _notes: optionalText(values.notes),
  };
}

/**
 * Header update carries ONLY the accepted mutable header fields. Provenance,
 * business ownership, driver, source and version are never sent.
 */
export function buildHeaderArgs(
  settlementId: string,
  values: BusinessDraftFormValues,
) {
  return {
    _settlement_id: settlementId,
    _period_start: values.periodStart,
    _period_end: values.periodEnd,
    _pay_date: optionalText(values.payDate),
    _statement_reference: optionalText(values.statementReference),
    _payer_name_snapshot: optionalText(values.payerName),
    _reported_gross_amount: optionalNumber(values.reportedGross),
    _reported_net_amount: optionalNumber(values.reportedNet),
    _notes: optionalText(values.notes),
  };
}

/* -------------------------------------------------------- item form model - */

export interface SettlementItemFormValues {
  itemType: string;
  category: string;
  description: string;
  amount: string;
  payMethod: string;
  quantity: string;
  rate: string;
  unitLabel: string;
  loadReference: string;
  pickupDate: string;
  deliveryDate: string;
  origin: string;
  destination: string;
  loadedMiles: string;
  deadheadMiles: string;
  payableMiles: string;
  eligibleRevenue: string;
  sortOrder: string;
}

export const EMPTY_ITEM_FORM: SettlementItemFormValues = {
  itemType: 'load_pay',
  category: '',
  description: '',
  amount: '',
  payMethod: '',
  quantity: '',
  rate: '',
  unitLabel: '',
  loadReference: '',
  pickupDate: '',
  deliveryDate: '',
  origin: '',
  destination: '',
  loadedMiles: '',
  deadheadMiles: '',
  payableMiles: '',
  eligibleRevenue: '',
  sortOrder: '0',
};

const ITEM_NUMERIC_FIELDS: (keyof SettlementItemFormValues)[] = [
  'quantity',
  'rate',
  'loadedMiles',
  'deadheadMiles',
  'payableMiles',
  'eligibleRevenue',
];

/** Form-integrity validation ONLY. Never an authorization decision. */
export function validateItemForm(values: SettlementItemFormValues): string | null {
  if (!SETTLEMENT_ITEM_TYPES.some((t) => t === values.itemType))
    return 'Select a line type.';
  if (
    values.payMethod !== '' &&
    !SETTLEMENT_PAY_METHODS.some((m) => m === values.payMethod)
  )
    return 'Select a supported pay method.';
  const amount = Number(values.amount.trim());
  if (values.amount.trim() === '' || !Number.isFinite(amount) || amount < 0)
    return 'Enter a non-negative amount.';
  for (const field of ITEM_NUMERIC_FIELDS) {
    if (!isBlankOrNonNegativeFinite(values[field]))
      return 'Numeric line values must be non-negative numbers.';
  }
  const sortOrder = Number(values.sortOrder.trim() === '' ? '0' : values.sortOrder);
  if (!Number.isFinite(sortOrder) || sortOrder < 0 || !Number.isInteger(sortOrder))
    return 'Line order must be a non-negative whole number.';
  return null;
}

/**
 * Accepted line fields. `_category` / `_description` are required text args
 * the server normalises to NULL when blank; every other optional is omitted as
 * `undefined` so PostgreSQL applies its accepted DEFAULT NULL.
 */
export function buildItemFields(values: SettlementItemFormValues) {
  return {
    _item_type: values.itemType,
    _category: values.category.trim(),
    _description: values.description.trim(),
    _amount: Number(values.amount.trim()),
    _pay_method: optionalText(values.payMethod),
    _quantity: optionalNumber(values.quantity),
    _rate: optionalNumber(values.rate),
    _unit_label: optionalText(values.unitLabel),
    _load_reference_snapshot: optionalText(values.loadReference),
    _pickup_date_snapshot: optionalText(values.pickupDate),
    _delivery_date_snapshot: optionalText(values.deliveryDate),
    _origin_snapshot: optionalText(values.origin),
    _destination_snapshot: optionalText(values.destination),
    _loaded_miles_snapshot: optionalNumber(values.loadedMiles),
    _deadhead_miles_snapshot: optionalNumber(values.deadheadMiles),
    _payable_miles_snapshot: optionalNumber(values.payableMiles),
    _eligible_revenue_snapshot: optionalNumber(values.eligibleRevenue),
    _sort_order: Number(values.sortOrder.trim() === '' ? '0' : values.sortOrder),
  };
}

/* ------------------------------------------------------------- component - */

export interface BusinessSettlementManagerProps {
  mode: BusinessSettlementMode;
  businessId: string;
  driverOptions: readonly BusinessDriverOption[];
  /** Presentation-only signal from the canonical billing/entitlement consumer. */
  canManage: boolean;
  blockedReason?: string;
  /**
   * Phase RC-1I — OPTIONAL granular presentation gates for recruiter STAFF.
   * Omitted (owner surfaces) => unchanged behaviour: both follow `canManage`.
   * These narrow the UI only; PostgreSQL remains the sole authority.
   */
  canPrepare?: boolean;
  canFinalize?: boolean;
}

export function BusinessSettlementManager({
  mode,
  businessId,
  driverOptions,
  canManage,
  blockedReason,
  canPrepare,
  canFinalize,
}: BusinessSettlementManagerProps) {
  const allowPrepare = canManage && (canPrepare ?? true);
  const allowFinalize = canManage && (canFinalize ?? true);
  const settlementsQuery = useVisibleSettlements();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Narrow, short-lived hold of the EXACT row an accepted RPC just returned, so
  // a freshly created draft opens immediately even while the list cache is
  // still being invalidated. Never optimistic: only real returned rows.
  const [returnedRow, setReturnedRow] = useState<BusinessSettlementLike | null>(
    null,
  );
  const [creating, setCreating] = useState(false);

  const rows = useMemo(
    () =>
      filterBusinessSettlements(
        settlementsQuery.data as BusinessSettlementLike[] | null | undefined,
        mode,
        businessId,
      ),
    [settlementsQuery.data, mode, businessId],
  );

  const driverLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const option of driverOptions) map[option.driverUserId] = option.label;
    return map;
  }, [driverOptions]);

  /** Only accept a returned row that satisfies this manager's exact filter. */
  const openReturned = (row: BusinessSettlementLike | null | undefined) => {
    if (!row?.id) return;
    if (filterBusinessSettlements([row], mode, businessId).length !== 1) return;
    setReturnedRow(row);
    setSelectedId(row.id);
  };

  const closeSelected = () => {
    setSelectedId(null);
    setReturnedRow(null);
  };

  // Fresh list data always wins; the returned row is only a stopgap.
  const selected =
    rows.find((r) => r.id === selectedId) ??
    (returnedRow && returnedRow.id === selectedId ? returnedRow : null);

  if (selected) {
    return (
      <BusinessSettlementDetail
        settlement={selected}
        driverLabel={driverLabels[selected.driver_user_id] ?? 'Driver'}
        mode={mode}
        canManage={canManage}
        allowPrepare={allowPrepare}
        allowFinalize={allowFinalize}
        onBack={closeSelected}
        onSelect={openReturned}
      />
    );
  }


  return (
    <div
      className="space-y-4 [&_button]:min-h-11 sm:[&_button]:min-h-0 [&_select]:min-h-11 sm:[&_select]:min-h-0 [&_input]:min-h-11 sm:[&_input]:min-h-0"
      data-testid="business-settlement-manager"
    >
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ReceiptText className="h-4 w-4 text-primary" />
              Settlement statements
            </CardTitle>
            {allowPrepare && (
              <Button
                size="sm"
                onClick={() => setCreating((v) => !v)}
                data-testid="business-settlement-new-toggle"
              >
                <FilePlus2 className="h-4 w-4" />
                {creating ? 'Close' : 'New statement'}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>
              Settlement statements are recordkeeping and reconciliation records.
              HaulTrackerPro does not issue payroll, withhold taxes, or transfer
              funds.
            </span>
          </p>
          {!canManage && (
            <p
              className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500"
              data-testid="business-settlement-blocked-reason"
            >
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {blockedReason ??
                  'Creating and managing settlement statements is not available on your current plan.'}
              </span>
            </p>
          )}
        </CardContent>
      </Card>

      {allowPrepare && creating && (
        <BusinessDraftForm
          mode={mode}
          businessId={businessId}
          driverOptions={driverOptions}
          onCreated={(row) => {
            setCreating(false);
            openReturned(row);
          }}

        />
      )}

      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Statement history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {settlementsQuery.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading statements…
            </p>
          ) : settlementsQuery.isError ? (
            <div className="space-y-2" data-testid="business-settlement-history-error">
              <p className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" /> Statements could not be loaded.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => settlementsQuery.refetch()}
              >
                <RefreshCw className="h-4 w-4" /> Retry
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Inbox className="h-4 w-4" /> No settlement statements yet.
            </p>
          ) : (
            <div className="divide-y rounded-md border border-border/60">
              {rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/40"
                  onClick={() => setSelectedId(row.id)}
                  data-testid="business-settlement-row"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 max-w-full truncate text-sm font-medium">
                        {driverLabels[row.driver_user_id] ?? 'Driver'}
                      </span>
                      <Badge variant="outline">
                        {SETTLEMENT_STATUS_LABELS[row.status] ?? 'Statement'}
                      </Badge>
                      {row.version_number > 1 && (
                        <Badge variant="secondary">v{row.version_number}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(row.period_start)} – {formatDate(row.period_end)} ·
                      Pay date {formatDate(row.pay_date)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Net {formatMoney(row.reported_net_amount)} · Gross{' '}
                      {formatMoney(row.reported_gross_amount)}
                      {row.statement_reference
                        ? ` · Ref ${row.statement_reference}`
                        : ''}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ draft form - */

function BusinessDraftForm({
  mode,
  businessId,
  driverOptions,
  onCreated,
}: {
  mode: BusinessSettlementMode;
  businessId: string;
  driverOptions: readonly BusinessDriverOption[];
  onCreated: (settlement: BusinessSettlementLike) => void;
}) {
  const [values, setValues] = useState<BusinessDraftFormValues>(EMPTY_DRAFT_FORM);
  const createCarrier = useCreateCarrierSettlementDraft();
  const createAgency = useCreateAgencySettlementDraft();

  const set = (patch: Partial<BusinessDraftFormValues>) =>
    setValues((prev) => ({ ...prev, ...patch }));

  const selectedOption =
    driverOptions.find((o) => o.driverUserId === values.driverUserId) ?? null;

  const submit = async () => {
    const problem = validateDraftForm(values);
    if (problem) {
      toast.error(problem);
      return;
    }
    try {
      if (mode === 'carrier') {
        const relationshipId = selectedOption?.relationshipId;
        if (!relationshipId) {
          toast.error('Select a connected driver.');
          return;
        }
        const created = await createCarrier.mutateAsync(
          buildCarrierDraftArgs(businessId, relationshipId, values),
        );
        toast.success('Draft statement created');
        setValues(EMPTY_DRAFT_FORM);
        if (created?.id) onCreated(created);

        return;
      }
      const created = await createAgency.mutateAsync(
        buildAgencyDraftArgs(businessId, values),
      );
      toast.success('Draft statement created');
      setValues(EMPTY_DRAFT_FORM);
      if (created?.id) onCreated(created);
    } catch (error) {
      toast.error(describeSettlementError(error));
    }
  };

  const pending = createCarrier.isPending || createAgency.isPending;

  return (
    <Card className="border-primary/30" data-testid="business-settlement-draft-form">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">New settlement statement</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="bsm-driver">Driver</Label>
          <select
            id="bsm-driver"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={values.driverUserId}
            onChange={(e) => set({ driverUserId: e.target.value })}
            data-testid="business-settlement-driver-select"
          >
            <option value="">Select a driver…</option>
            {driverOptions.map((option) => (
              <option key={option.driverUserId} value={option.driverUserId}>
                {option.label}
              </option>
            ))}
          </select>
          {driverOptions.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {mode === 'carrier'
                ? 'No active driver connections yet. Connect a driver first.'
                : 'No delegated client drivers are available yet.'}
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldInput
            id="bsm-start"
            label="Period start"
            type="date"
            value={values.periodStart}
            onChange={(v) => set({ periodStart: v })}
          />
          <FieldInput
            id="bsm-end"
            label="Period end"
            type="date"
            value={values.periodEnd}
            onChange={(v) => set({ periodEnd: v })}
          />
          <FieldInput
            id="bsm-pay"
            label="Pay date (optional)"
            type="date"
            value={values.payDate}
            onChange={(v) => set({ payDate: v })}
          />
          <FieldInput
            id="bsm-ref"
            label="Statement reference (optional)"
            value={values.statementReference}
            onChange={(v) => set({ statementReference: v })}
          />
          {mode === 'agency' && (
            <FieldInput
              id="bsm-payer"
              label="Payer / company name (optional)"
              value={values.payerName}
              onChange={(v) => set({ payerName: v })}
            />
          )}
          <FieldInput
            id="bsm-gross"
            label="Reported gross (optional)"
            type="number"
            value={values.reportedGross}
            onChange={(v) => set({ reportedGross: v })}
          />
          <FieldInput
            id="bsm-net"
            label="Reported net (optional)"
            type="number"
            value={values.reportedNet}
            onChange={(v) => set({ reportedNet: v })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="bsm-notes">Notes (optional)</Label>
          <Textarea
            id="bsm-notes"
            rows={3}
            value={values.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </div>

        <Button onClick={submit} disabled={pending} data-testid="business-settlement-create">
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Create draft statement
        </Button>
      </CardContent>
    </Card>
  );
}

function FieldInput({
  id,
  label,
  value,
  onChange,
  type,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- detail - */

function BusinessSettlementDetail({
  settlement,
  driverLabel,
  mode,
  canManage,
  allowPrepare,
  allowFinalize,
  onBack,
  onSelect,
}: {
  settlement: BusinessSettlementLike;
  driverLabel: string;
  mode: BusinessSettlementMode;
  canManage: boolean;
  allowPrepare: boolean;
  allowFinalize: boolean;
  onBack: () => void;
  onSelect: (settlement: BusinessSettlementLike) => void;
}) {
  const itemsQuery = useVisibleSettlementItems(settlement.id);
  const eventsQuery = useVisibleSettlementEvents(settlement.id);
  const updateHeader = useUpdateSettlementDraftHeader();
  const finalize = useFinalizeSettlementDraft();
  const correct = useCreateSettlementCorrectionDraft();
  const voidStatement = useVoidFinalizedSettlement();

  const isDraft = canEditSettlementStatus(settlement.status);
  const isFinalized = settlement.status === 'finalized';
  const editable = isDraft && allowPrepare;

  /**
   * Read-only export payload. Exporting is a READ capability: it stays
   * available even when `canManage` is false, and carries no raw identifiers.
   */
  const exportStatement: SettlementExportStatement = useMemo(
    () => ({
      sourceLabel: resolveBusinessSourceLabel(settlement),
      payerLabel: resolveBusinessPayerLabel(settlement),
      driverLabel,
      status: settlement.status ?? '',
      versionNumber: settlement.version_number,
      periodStart: settlement.period_start ?? null,
      periodEnd: settlement.period_end ?? null,
      payDate: settlement.pay_date ?? null,
      statementReference: settlement.statement_reference ?? null,
      reportedGrossAmount: settlement.reported_gross_amount ?? null,
      reportedNetAmount: settlement.reported_net_amount ?? null,
      notes: settlement.notes ?? null,
    }),
    [settlement, driverLabel],
  );

  const exportItems: SettlementExportItem[] = useMemo(() => {
    const rows = (itemsQuery.data as SettlementItemLike[] | null | undefined) ?? [];
    return rows.map((item) => ({
      itemType: item.item_type ?? null,
      category: item.category ?? null,
      description: item.description ?? null,
      amount: item.amount ?? null,
      payMethod: item.pay_method ?? null,
      quantity: item.quantity ?? null,
      rate: item.rate ?? null,
      unitLabel: item.unit_label ?? null,
      loadReference: item.load_reference_snapshot ?? null,
      pickupDate: item.pickup_date_snapshot ?? null,
      deliveryDate: item.delivery_date_snapshot ?? null,
      origin: item.origin_snapshot ?? null,
      destination: item.destination_snapshot ?? null,
      loadedMiles: item.loaded_miles_snapshot ?? null,
      deadheadMiles: item.deadhead_miles_snapshot ?? null,
      payableMiles: item.payable_miles_snapshot ?? null,
      eligibleRevenue: item.eligible_revenue_snapshot ?? null,
    }));
  }, [itemsQuery.data]);

  const handleExportCsv = () => {
    try {
      downloadSettlementCsv(exportStatement, exportItems);
    } catch {
      toast.error('We couldn’t export this statement. Please try again.');
    }
  };

  const handlePrint = () => {
    try {
      printSettlement(exportStatement, exportItems);
    } catch {
      toast.error('We couldn’t open the print view. Please try again.');
    }
  };


  const [header, setHeader] = useState<BusinessDraftFormValues>({
    driverUserId: settlement.driver_user_id,
    periodStart: settlement.period_start ?? '',
    periodEnd: settlement.period_end ?? '',
    payDate: settlement.pay_date ?? '',
    statementReference: settlement.statement_reference ?? '',
    payerName: settlement.payer_name_snapshot ?? '',
    reportedGross:
      settlement.reported_gross_amount === null ? '' : String(settlement.reported_gross_amount),
    reportedNet:
      settlement.reported_net_amount === null ? '' : String(settlement.reported_net_amount),
    notes: settlement.notes ?? '',
  });

  const set = (patch: Partial<BusinessDraftFormValues>) =>
    setHeader((prev) => ({ ...prev, ...patch }));

  const saveHeader = async () => {
    const problem = validateDraftForm(header);
    if (problem) {
      toast.error(problem);
      return;
    }
    try {
      await updateHeader.mutateAsync(buildHeaderArgs(settlement.id, header));
      toast.success('Statement details saved');
    } catch (error) {
      toast.error(describeSettlementError(error));
    }
  };

  const runFinalize = async () => {
    try {
      await finalize.mutateAsync({ _settlement_id: settlement.id });
      toast.success('Statement finalized');
    } catch (error) {
      toast.error(describeSettlementError(error));
    }
  };

  const runCorrection = async () => {
    try {
      const created = await correct.mutateAsync({ _settlement_id: settlement.id });
      toast.success('Correction draft created');
      if (created?.id) onSelect(created);
    } catch (error) {
      toast.error(describeSettlementError(error));
    }
  };

  const runVoid = async () => {
    try {
      await voidStatement.mutateAsync({ _settlement_id: settlement.id });
      toast.success('Statement voided');
    } catch (error) {
      toast.error(describeSettlementError(error));
    }
  };

  return (
    <div
      className="space-y-4 [&_button]:min-h-11 sm:[&_button]:min-h-0 [&_select]:min-h-11 sm:[&_select]:min-h-0 [&_input]:min-h-11 sm:[&_input]:min-h-0"
      data-testid="business-settlement-detail"
    >
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
        <ArrowLeft className="h-4 w-4" /> Back to statements
      </Button>

      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">{driverLabel}</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {SETTLEMENT_STATUS_LABELS[settlement.status] ?? 'Statement'}
              </Badge>
              {settlement.version_number > 1 && (
                <Badge variant="secondary">Revision v{settlement.version_number}</Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <SummaryLine label="Period">
            {formatDate(settlement.period_start)} – {formatDate(settlement.period_end)}
          </SummaryLine>
          <SummaryLine label="Pay date">{formatDate(settlement.pay_date)}</SummaryLine>
          <SummaryLine label="Reported gross">
            {formatMoney(settlement.reported_gross_amount)}
          </SummaryLine>
          <SummaryLine label="Reported net">
            {formatMoney(settlement.reported_net_amount)}
          </SummaryLine>
          <SummaryLine label="Statement reference">
            {settlement.statement_reference ?? '—'}
          </SummaryLine>
          <SummaryLine label="Statement source">
            <span data-testid="business-settlement-source-label">
              {resolveBusinessSourceLabel(settlement)}
            </span>
          </SummaryLine>
          <SummaryLine label="Payer">
            <span data-testid="business-settlement-payer-label">
              {resolveBusinessPayerLabel(settlement)}
            </span>
          </SummaryLine>
          <SummaryLine label="Notes">{settlement.notes ?? '—'}</SummaryLine>

        </CardContent>
        <CardContent className="flex flex-wrap gap-2 pt-0">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            data-testid="business-settlement-export-csv"
            onClick={handleExportCsv}
          >
            <Download className="h-4 w-4" />
            Download CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            data-testid="business-settlement-print"
            onClick={handlePrint}
          >
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </CardContent>

      </Card>

      <SettlementReconciliationSummary
        items={(itemsQuery.data as SettlementItemLike[] | null | undefined) ?? []}
        reportedNetAmount={settlement.reported_net_amount}
      />



      {!isDraft && (
        <p
          className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground"
          data-testid="business-settlement-readonly-note"
        >
          This statement is part of the permanent record and cannot be edited in
          place. {isFinalized ? 'Create a correction to issue a revised statement.' : ''}
        </p>
      )}

      {editable && (
        <Card className="border-border/60" data-testid="business-settlement-header-editor">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Pencil className="h-4 w-4" /> Statement details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldInput
                id="bsd-start"
                label="Period start"
                type="date"
                value={header.periodStart}
                onChange={(v) => set({ periodStart: v })}
              />
              <FieldInput
                id="bsd-end"
                label="Period end"
                type="date"
                value={header.periodEnd}
                onChange={(v) => set({ periodEnd: v })}
              />
              <FieldInput
                id="bsd-pay"
                label="Pay date"
                type="date"
                value={header.payDate}
                onChange={(v) => set({ payDate: v })}
              />
              <FieldInput
                id="bsd-ref"
                label="Statement reference"
                value={header.statementReference}
                onChange={(v) => set({ statementReference: v })}
              />
              {mode === 'agency' && (
                <FieldInput
                  id="bsd-payer"
                  label="Payer / company name"
                  value={header.payerName}
                  onChange={(v) => set({ payerName: v })}
                />
              )}
              <FieldInput
                id="bsd-gross"
                label="Reported gross"
                type="number"
                value={header.reportedGross}
                onChange={(v) => set({ reportedGross: v })}
              />
              <FieldInput
                id="bsd-net"
                label="Reported net"
                type="number"
                value={header.reportedNet}
                onChange={(v) => set({ reportedNet: v })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bsd-notes">Notes</Label>
              <Textarea
                id="bsd-notes"
                rows={3}
                value={header.notes}
                onChange={(e) => set({ notes: e.target.value })}
              />
            </div>
            <Button
              variant="outline"
              onClick={saveHeader}
              disabled={updateHeader.isPending}
              data-testid="business-settlement-save-header"
            >
              Save statement details
            </Button>
          </CardContent>
        </Card>
      )}

      <SettlementItemsSection
        settlementId={settlement.id}
        items={(itemsQuery.data as SettlementItemLike[] | null | undefined) ?? []}
        isLoading={itemsQuery.isLoading}
        isError={itemsQuery.isError}
        onRetry={() => itemsQuery.refetch()}
        editable={editable}
      />

      {(allowPrepare || allowFinalize) && (
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Statement lifecycle</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {isDraft && allowFinalize && (
              <ConfirmAction
                trigger={
                  <Button
                    disabled={finalize.isPending}
                    data-testid="business-settlement-finalize"
                  >
                    Finalize statement
                  </Button>
                }
                title="Finalize this statement?"
                description="Finalized statements become permanent records and can never be edited in place. You can still issue a correction afterwards."
                actionLabel="Finalize"
                onConfirm={runFinalize}
              />
            )}
            {isFinalized && (
              <>
                {allowPrepare && allowFinalize && (
                <ConfirmAction
                  trigger={
                    <Button
                      variant="outline"
                      disabled={correct.isPending}
                      data-testid="business-settlement-correct"
                    >
                      Create correction
                    </Button>
                  }
                  title="Create a correction draft?"
                  description="A new draft revision is created. The finalized statement stays in the permanent record."
                  actionLabel="Create correction"
                  onConfirm={runCorrection}
                />
                )}
                {allowFinalize && (
                <ConfirmAction
                  trigger={
                    <Button
                      variant="ghost"
                      className="text-destructive"
                      disabled={voidStatement.isPending}
                      data-testid="business-settlement-void"
                    >
                      Void statement
                    </Button>
                  }
                  title="Void this statement?"
                  description="Voiding marks the statement as no longer valid. It is never deleted and remains visible in the history."
                  actionLabel="Void statement"
                  destructive
                  onConfirm={runVoid}
                />
                )}
              </>
            )}
            {!isDraft && !isFinalized && (
              <p className="text-xs text-muted-foreground">
                No further actions are available for this statement.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          {eventsQuery.isLoading ? (
            <p>Loading history…</p>
          ) : eventsQuery.isError ? (
            <p className="text-destructive">History could not be loaded.</p>
          ) : (eventsQuery.data ?? []).length === 0 ? (
            <p>No recorded activity yet.</p>
          ) : (
            (eventsQuery.data ?? []).map((event) => (
              <p key={event.id}>
                {SETTLEMENT_EVENT_LABELS[event.event_type] ?? 'Statement updated'} ·{' '}
                {formatDate(event.created_at)}
              </p>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const SETTLEMENT_EVENT_LABELS: Record<string, string> = {
  created: 'Statement created',
  updated: 'Statement updated',
  finalized: 'Statement finalized',
  superseded: 'Statement superseded by a correction',
  voided: 'Statement voided',
  match_confirmed: 'Load match confirmed',
  exported: 'Statement exported',
};


function SummaryLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground">{children}</p>
    </div>
  );
}

/* ----------------------------------------------------------------- items - */

interface SettlementItemLike {
  id: string;
  item_type: string;
  category: string | null;
  description: string | null;
  amount: number;
  pay_method: string | null;
  quantity: number | null;
  rate: number | null;
  unit_label: string | null;
  load_reference_snapshot: string | null;
  pickup_date_snapshot: string | null;
  delivery_date_snapshot: string | null;
  origin_snapshot: string | null;
  destination_snapshot: string | null;
  loaded_miles_snapshot: number | null;
  deadhead_miles_snapshot: number | null;
  payable_miles_snapshot: number | null;
  eligible_revenue_snapshot: number | null;
  sort_order: number;
}

function itemToForm(item: SettlementItemLike): SettlementItemFormValues {
  const num = (v: number | null) => (v === null ? '' : String(v));
  return {
    itemType: item.item_type,
    category: item.category ?? '',
    description: item.description ?? '',
    amount: String(item.amount),
    payMethod: item.pay_method ?? '',
    quantity: num(item.quantity),
    rate: num(item.rate),
    unitLabel: item.unit_label ?? '',
    loadReference: item.load_reference_snapshot ?? '',
    pickupDate: item.pickup_date_snapshot ?? '',
    deliveryDate: item.delivery_date_snapshot ?? '',
    origin: item.origin_snapshot ?? '',
    destination: item.destination_snapshot ?? '',
    loadedMiles: num(item.loaded_miles_snapshot),
    deadheadMiles: num(item.deadhead_miles_snapshot),
    payableMiles: num(item.payable_miles_snapshot),
    eligibleRevenue: num(item.eligible_revenue_snapshot),
    sortOrder: String(item.sort_order),
  };
}

function SettlementItemsSection({
  settlementId,
  items,
  isLoading,
  isError,
  onRetry,
  editable,
}: {
  settlementId: string;
  items: readonly SettlementItemLike[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  editable: boolean;
}) {
  const addItem = useAddSettlementDraftItem();
  const updateItem = useUpdateSettlementDraftItem();
  const deleteItem = useDeleteSettlementDraftItem();

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const submitAdd = async (values: SettlementItemFormValues) => {
    const problem = validateItemForm(values);
    if (problem) {
      toast.error(problem);
      return false;
    }
    try {
      await addItem.mutateAsync({
        _settlement_id: settlementId,
        ...buildItemFields(values),
      });
      toast.success('Line added');
      return true;
    } catch (error) {
      toast.error(describeSettlementError(error));
      return false;
    }
  };

  const submitUpdate = async (itemId: string, values: SettlementItemFormValues) => {
    const problem = validateItemForm(values);
    if (problem) {
      toast.error(problem);
      return false;
    }
    try {
      await updateItem.mutateAsync({ _item_id: itemId, ...buildItemFields(values) });
      toast.success('Line updated');
      return true;
    } catch (error) {
      toast.error(describeSettlementError(error));
      return false;
    }
  };

  const runDelete = async (itemId: string) => {
    try {
      await deleteItem.mutateAsync({ _item_id: itemId });
      toast.success('Line removed');
    } catch (error) {
      toast.error(describeSettlementError(error));
    }
  };

  return (
    <Card className="border-border/60" data-testid="business-settlement-items">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Statement lines</CardTitle>
          {editable && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAdding((v) => !v)}
              data-testid="business-settlement-add-item-toggle"
            >
              <Plus className="h-4 w-4" /> {adding ? 'Close' : 'Add line'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {editable && adding && (
          <ItemForm
            testId="business-settlement-add-item-form"
            initial={EMPTY_ITEM_FORM}
            submitLabel="Add line"
            pending={addItem.isPending}
            onSubmit={async (values) => {
              const ok = await submitAdd(values);
              if (ok) setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        )}

        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading lines…
          </p>
        ) : isError ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">Statement lines could not be loaded.</p>
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No statement lines yet.</p>
        ) : (
          <div className="divide-y rounded-md border border-border/60">
            {items.map((item) =>
              editingId === item.id && editable ? (
                <div key={item.id} className="p-3">
                  <ItemForm
                    testId="business-settlement-edit-item-form"
                    initial={itemToForm(item)}
                    submitLabel="Save line"
                    pending={updateItem.isPending}
                    onSubmit={async (values) => {
                      const ok = await submitUpdate(item.id, values);
                      if (ok) setEditingId(null);
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                </div>
              ) : (
                <div
                  key={item.id}
                  className="flex flex-wrap items-start gap-3 p-3"
                  data-testid="business-settlement-item-row"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {SETTLEMENT_ITEM_TYPE_LABELS[item.item_type] ?? 'Line'}
                      </Badge>
                      <span className="text-sm font-medium">
                        {item.description ?? item.category ?? 'Statement line'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatMoney(item.amount)}
                      {item.pay_method
                        ? ` · ${SETTLEMENT_PAY_METHOD_LABELS[item.pay_method] ?? 'Manual'}`
                        : ''}
                      {item.quantity !== null ? ` · Qty ${item.quantity}` : ''}
                      {item.rate !== null ? ` · Rate ${item.rate}` : ''}
                      {item.unit_label ? ` ${item.unit_label}` : ''}
                    </p>
                  </div>
                  {editable && (
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingId(item.id)}
                        data-testid="business-settlement-edit-item"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <ConfirmAction
                        trigger={
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            data-testid="business-settlement-delete-item"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        }
                        title="Remove this line?"
                        description="The line is removed from this draft statement."
                        actionLabel="Remove line"
                        destructive
                        onConfirm={() => runDelete(item.id)}
                      />
                    </div>
                  )}
                </div>
              ),
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ItemForm({
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
  testId,
}: {
  initial: SettlementItemFormValues;
  submitLabel: string;
  pending: boolean;
  onSubmit: (values: SettlementItemFormValues) => void | Promise<void>;
  onCancel: () => void;
  testId: string;
}) {
  const [values, setValues] = useState<SettlementItemFormValues>(initial);
  const set = (patch: Partial<SettlementItemFormValues>) =>
    setValues((prev) => ({ ...prev, ...patch }));

  return (
    <div
      className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3"
      data-testid={testId}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${testId}-type`}>Line type</Label>
          <select
            id={`${testId}-type`}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={values.itemType}
            onChange={(e) => set({ itemType: e.target.value })}
          >
            {SETTLEMENT_ITEM_TYPES.map((type) => (
              <option key={type} value={type}>
                {SETTLEMENT_ITEM_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${testId}-method`}>Pay method (optional)</Label>
          <select
            id={`${testId}-method`}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={values.payMethod}
            onChange={(e) => set({ payMethod: e.target.value })}
          >
            <option value="">Not specified</option>
            {SETTLEMENT_PAY_METHODS.map((method) => (
              <option key={method} value={method}>
                {SETTLEMENT_PAY_METHOD_LABELS[method]}
              </option>
            ))}
          </select>
        </div>
        <FieldInput
          id={`${testId}-amount`}
          label="Amount"
          type="number"
          value={values.amount}
          onChange={(v) => set({ amount: v })}
        />
        <FieldInput
          id={`${testId}-category`}
          label="Category (optional)"
          value={values.category}
          onChange={(v) => set({ category: v })}
        />
        <FieldInput
          id={`${testId}-description`}
          label="Description (optional)"
          value={values.description}
          onChange={(v) => set({ description: v })}
        />
        <FieldInput
          id={`${testId}-quantity`}
          label="Quantity (optional)"
          type="number"
          value={values.quantity}
          onChange={(v) => set({ quantity: v })}
        />
        <FieldInput
          id={`${testId}-rate`}
          label="Rate (optional)"
          type="number"
          value={values.rate}
          onChange={(v) => set({ rate: v })}
        />
        <FieldInput
          id={`${testId}-unit`}
          label="Unit label (optional)"
          value={values.unitLabel}
          onChange={(v) => set({ unitLabel: v })}
        />
        <FieldInput
          id={`${testId}-loadref`}
          label="Load reference (optional)"
          value={values.loadReference}
          onChange={(v) => set({ loadReference: v })}
        />
        <FieldInput
          id={`${testId}-pickup`}
          label="Pickup date (optional)"
          type="date"
          value={values.pickupDate}
          onChange={(v) => set({ pickupDate: v })}
        />
        <FieldInput
          id={`${testId}-delivery`}
          label="Delivery date (optional)"
          type="date"
          value={values.deliveryDate}
          onChange={(v) => set({ deliveryDate: v })}
        />
        <FieldInput
          id={`${testId}-origin`}
          label="Origin (optional)"
          value={values.origin}
          onChange={(v) => set({ origin: v })}
        />
        <FieldInput
          id={`${testId}-destination`}
          label="Destination (optional)"
          value={values.destination}
          onChange={(v) => set({ destination: v })}
        />
        <FieldInput
          id={`${testId}-loaded`}
          label="Loaded miles (optional)"
          type="number"
          value={values.loadedMiles}
          onChange={(v) => set({ loadedMiles: v })}
        />
        <FieldInput
          id={`${testId}-deadhead`}
          label="Deadhead miles (optional)"
          type="number"
          value={values.deadheadMiles}
          onChange={(v) => set({ deadheadMiles: v })}
        />
        <FieldInput
          id={`${testId}-payable`}
          label="Payable miles (optional)"
          type="number"
          value={values.payableMiles}
          onChange={(v) => set({ payableMiles: v })}
        />
        <FieldInput
          id={`${testId}-revenue`}
          label="Eligible revenue (optional)"
          type="number"
          value={values.eligibleRevenue}
          onChange={(v) => set({ eligibleRevenue: v })}
        />
        <FieldInput
          id={`${testId}-sort`}
          label="Line order"
          type="number"
          value={values.sortOrder}
          onChange={(v) => set({ sortOrder: v })}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} onClick={() => onSubmit(values)}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- confirm - */

function ConfirmAction({
  trigger,
  title,
  description,
  actionLabel,
  onConfirm,
  destructive,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onConfirm: () => void | Promise<void>;
  destructive?: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11 sm:min-h-0">Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={
              destructive
                ? 'min-h-11 sm:min-h-0 bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'min-h-11 sm:min-h-0'
            }
            onClick={() => {
              void onConfirm();
            }}
          >
            {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default BusinessSettlementManager;
