/**
 * Phase 1T-D2 — Driver Settlements MVP + driver reconciliation and manual
 * outside-settlement import surface.

 *
 * Recordkeeping / reconciliation surface. This component NEVER talks to the
 * backend directly: every read and every mutation goes through the accepted
 * Phase 1T React Query orchestration layer. It performs no authorization,
 * plan, tier, or role logic — server RLS remains the sole authority.
 * Scoping performed here is PRESENTATION ONLY.
 */

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Download,
  Inbox,
  Loader2,
  Printer,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';


import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { useActingContext, useTargetUserId } from '@/hooks/useActingContext';
import { useLoads } from '@/hooks/useLoads';
import { useSubscription } from '@/hooks/useSubscription';
import {
  useAcceptMyCarrierDriverRelationship,
  useAssistantProSettlementManageAccess,
  useClearSettlementLoadMatch,
  useConfirmSettlementLoadMatch,
  useCreateDriverImportedSettlementDraft,
  useDeclineMyCarrierDriverRelationship,
  useRefreshSettlementLoadMatchSuggestions,
  useRejectSettlementLoadMatch,
  useVisibleCarrierDriverRelationships,
  useVisibleSettlementEvents,
  useVisibleSettlementItems,
  useVisibleSettlementMatches,
  useVisibleSettlements,
} from '@/hooks/settlements/useSettlementData';

import {
  downloadSettlementCsv,
  printSettlement,
  type SettlementExportItem,
  type SettlementExportStatement,
} from '@/lib/settlements/settlementExport';

/* ------------------------------------------------------------------ utils - */


function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  })} ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

/** Turn a snake_case machine token into readable label text. */
export function humanizeToken(token: string | null | undefined): string {
  if (!token) return 'Update';
  const cleaned = token.replace(/[_-]+/g, ' ').trim();
  if (!cleaned) return 'Update';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Variance is only meaningful when the statement line carries an expected
 * snapshot. A missing snapshot is "not applicable" and must never be
 * conflated with zero.
 */
export function computeItemDifference(
  amount: number | null | undefined,
  expectedAmountSnapshot: number | null | undefined,
): number | null {
  if (expectedAmountSnapshot === null || expectedAmountSnapshot === undefined) return null;
  if (amount === null || amount === undefined) return null;
  if (!Number.isFinite(amount) || !Number.isFinite(expectedAmountSnapshot)) return null;
  return amount - expectedAmountSnapshot;
}

/**
 * Privacy-safe payer label. Snapshot names take precedence; when both are
 * blank the label degrades to a neutral source-specific description. It never
 * falls back to a raw identifier.
 */
export function resolvePayerLabel(
  sourceDisplayNameSnapshot: string | null | undefined,
  payerNameSnapshot: string | null | undefined,
  source?: string | null,
): string {
  const display = sourceDisplayNameSnapshot?.trim();
  if (display) return display;
  const payer = payerNameSnapshot?.trim();
  if (payer) return payer;
  switch (source?.trim()) {
    case 'carrier_issued':
      return 'Carrier statement';
    case 'agency_prepared':
      return 'Agency-prepared statement';
    case 'driver_imported':
      return 'Driver-imported statement';
    default:
      return 'Settlement statement';
  }
}

/** Compact pay-basis description for a statement line. Never interprets payroll. */
export function describeItemBasis(item: {
  quantity?: number | null;
  rate?: number | null;
  unit_label?: string | null;
  pay_method?: string | null;
}): string | null {
  const parts: string[] = [];
  const qty = item.quantity;
  const unit = item.unit_label?.trim();
  if (qty !== null && qty !== undefined && Number.isFinite(qty)) {
    parts.push(unit ? `${qty} ${unit}` : `${qty}`);
  } else if (unit) {
    parts.push(unit);
  }
  const rate = item.rate;
  if (rate !== null && rate !== undefined && Number.isFinite(rate)) {
    parts.push(`Rate ${formatMoney(rate)}`);
  }
  const method = item.pay_method?.trim();
  if (method) parts.push(humanizeToken(method));
  return parts.length > 0 ? parts.join(' · ') : null;
}

/* ------------------------------------------------ reconciliation constants - */

/** Match states the backend already treats as an accepted link. */
const ACCEPTED_MATCH_STATES = new Set(['exact', 'confirmed']);
/** Match states the backend produced as a suggestion awaiting a human answer. */
const SUGGESTION_MATCH_STATES = new Set(['likely', 'possible']);
/** Lifecycle states where no reconciliation control may ever be rendered. */
const NON_ACTIONABLE_STATUSES = new Set(['voided', 'superseded']);
/** The only statement line type that can be matched to a logged load. */
const MATCHABLE_ITEM_TYPE = 'load_pay';

/**
 * Safe, user-facing failure text. Raw error objects, SQL, stacks, and database
 * identifiers are never surfaced. The backend remains the authority; the UI
 * only reports that the action did not complete.
 */
function reportFailure(message: string): void {
  toast.error(message);
}

/** Human-readable label for a logged load. The identifier is never shown. */
export function describeLoadOption(load: {
  load_date: string;
  dropoff_date?: string | null;
  pickup_location?: string | null;
  dropoff_location?: string | null;
  estimated_pay?: number | null;
}): string {
  const when = formatDate(load.dropoff_date ?? load.load_date);
  const from = load.pickup_location?.trim() || 'Unknown origin';
  const to = load.dropoff_location?.trim() || 'Unknown destination';
  const pay =
    load.estimated_pay !== null &&
    load.estimated_pay !== undefined &&
    Number.isFinite(load.estimated_pay)
      ? ` · ${formatMoney(load.estimated_pay)}`
      : '';
  return `${when} · ${from} → ${to}${pay}`;
}

/** Blank text becomes null; anything else keeps its trimmed value. */
export function toNullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Blank numeric input is null. Non-blank must parse to a finite number. */
export function isBlankOrFinite(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  return Number.isFinite(Number(trimmed));
}

/** Blank numeric input becomes null; otherwise the finite parsed number. */
export function toNullableAmount(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}


function StatusBadge({ status }: { status: string | null | undefined }) {
  const label = humanizeToken(status);
  const tone =
    status === 'finalized'
      ? 'bg-primary/15 text-primary border-primary/30'
      : status === 'voided'
        ? 'bg-destructive/15 text-destructive border-destructive/30'
        : 'bg-muted text-muted-foreground border-border';
  return (
    <Badge variant="outline" className={`text-[11px] font-semibold ${tone}`}>
      {label}
    </Badge>
  );
}

/* ------------------------------------------------------------- detail view - */

type SettlementRowView = NonNullable<ReturnType<typeof useVisibleSettlements>['data']>[number];

function SettlementDetail({
  settlement,
  onBack,
  advancedToolsVisible,
  basicReconcileVisible,
}: {
  settlement: SettlementRowView;
  onBack: () => void;
  advancedToolsVisible: boolean;
  basicReconcileVisible: boolean;
}) {
  const settlementId = settlement.id;
  const itemsQuery = useVisibleSettlementItems(settlementId);
  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const itemIds = useMemo(() => items.map((i) => i.id), [items]);
  const matchesQuery = useVisibleSettlementMatches(itemIds);
  const eventsQuery = useVisibleSettlementEvents(settlementId);

  // Only the selected statement period is requested — unrelated history is not
  // loaded into this reconciliation surface.
  const { loads: allLoads } = useLoads({
    from: settlement.period_start ?? undefined,
    to: settlement.period_end ?? undefined,
  });

  // Only completed loads are reconciliation candidates.
  const loads = useMemo(
    () => allLoads.filter((load) => load.status === 'completed'),
    [allLoads],
  );

  const confirmMatch = useConfirmSettlementLoadMatch();
  const clearMatch = useClearSettlementLoadMatch();
  const refreshSuggestions = useRefreshSettlementLoadMatchSuggestions();
  const rejectSuggestion = useRejectSettlementLoadMatch();

  const [selectedLoadByItem, setSelectedLoadByItem] = useState<Record<string, string>>({});

  const actionable = !NON_ACTIONABLE_STATUSES.has((settlement.status ?? '').trim());
  const busy =
    confirmMatch.isPending ||
    clearMatch.isPending ||
    refreshSuggestions.isPending ||
    rejectSuggestion.isPending;

  const handleConfirm = (itemId: string) => {
    const driverLoadId = selectedLoadByItem[itemId];
    if (!driverLoadId) {
      reportFailure('Choose one of your logged loads first.');
      return;
    }
    confirmMatch.mutate(
      { _settlement_item_id: itemId, _driver_load_id: driverLoadId },
      {
        onSuccess: () => toast.success('Load matched to this statement line'),
        onError: () => reportFailure('We couldn’t match that load. Please try again.'),
      },
    );
  };

  const handleClear = (itemId: string) => {
    clearMatch.mutate(
      { _settlement_item_id: itemId },
      {
        onSuccess: () => toast.success('Match cleared'),
        onError: () => reportFailure('We couldn’t clear that match. Please try again.'),
      },
    );
  };

  const handleRefresh = (itemId: string) => {
    refreshSuggestions.mutate(
      { _settlement_item_id: itemId },
      {
        onSuccess: () => toast.success('Suggestions refreshed'),
        onError: () => reportFailure('We couldn’t refresh suggestions. Please try again.'),
      },
    );
  };

  const handleReject = (itemId: string, driverLoadId: string) => {
    rejectSuggestion.mutate(
      { _settlement_item_id: itemId, _driver_load_id: driverLoadId },
      {
        onSuccess: () => toast.success('Suggestion rejected'),
        onError: () => reportFailure('We couldn’t reject that suggestion. Please try again.'),
      },
    );
  };


  const matchesByItem = useMemo(() => {
    const rows = matchesQuery.data ?? [];
    const map = new Map<string, typeof rows>();
    for (const m of rows) {
      map.set(m.settlement_item_id, [...(map.get(m.settlement_item_id) ?? []), m]);
    }
    return map;
  }, [matchesQuery.data]);

  /**
   * Presentation-safe export payload. Read capability only: exporting a record
   * the caller can already see is never gated by Pro, manage, or finalize.
   * No raw identifier of any kind is copied into the export model.
   */
  const exportStatement: SettlementExportStatement = useMemo(
    () => ({
      sourceLabel: resolvePayerLabel(
        settlement.source_display_name_snapshot,
        null,
        settlement.source,
      ),
      payerLabel: resolvePayerLabel(
        settlement.source_display_name_snapshot,
        settlement.payer_name_snapshot,
        settlement.source,
      ),
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
    [settlement],
  );

  const exportItems: SettlementExportItem[] = useMemo(
    () =>
      items.map((item) => ({
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
        expectedAmount: item.expected_amount_snapshot ?? null,
      })),
    [items],
  );

  const handleExportCsv = () => {
    try {
      downloadSettlementCsv(exportStatement, exportItems);
    } catch {
      reportFailure('We couldn’t export this statement. Please try again.');
    }
  };

  const handlePrint = () => {
    try {
      printSettlement(exportStatement, exportItems);
    } catch {
      reportFailure('We couldn’t open the print view. Please try again.');
    }
  };


  return (
    <div className="space-y-4" data-testid="settlement-detail">
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-2 px-2">
        <ArrowLeft className="h-4 w-4" />
        Back to settlements
      </Button>

      <Card data-testid="settlement-detail-summary">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-base">
                {resolvePayerLabel(
                  settlement.source_display_name_snapshot,
                  settlement.payer_name_snapshot,
                  settlement.source,
                )}
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDate(settlement.period_start)} – {formatDate(settlement.period_end)}
                {settlement.pay_date ? ` · Paid ${formatDate(settlement.pay_date)}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={settlement.status} />
              {settlement.version_number > 1 && (
                <Badge variant="outline" className="text-[11px]">
                  Version {settlement.version_number}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Reported net
              </p>
              <p className="text-2xl font-black text-foreground">
                {formatMoney(settlement.reported_net_amount)}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              Gross {formatMoney(settlement.reported_gross_amount)}
            </p>
          </div>
          {settlement.statement_reference && (
            <p className="text-xs text-muted-foreground">
              Statement {settlement.statement_reference}
            </p>
          )}
          {settlement.notes?.trim() && (
            <p className="rounded-lg border border-border/50 bg-muted/20 p-3 text-sm text-foreground">
              {settlement.notes}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              data-testid="settlement-export-csv"
              onClick={handleExportCsv}
            >
              <Download className="h-4 w-4" />
              Download CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              data-testid="settlement-print"
              onClick={handlePrint}
            >
              <Printer className="h-4 w-4" />
              Print
            </Button>
          </div>

        </CardContent>
      </Card>


      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Statement lines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {itemsQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Loading statement lines…</p>
          )}
          {itemsQuery.isError && (
            <p className="text-sm text-destructive">
              We couldn&apos;t load these statement lines.
            </p>
          )}
          {!itemsQuery.isLoading && !itemsQuery.isError && items.length === 0 && (
            <p className="text-sm text-muted-foreground">
              This settlement has no statement lines yet.
            </p>
          )}
          {items.map((item) => {
            const difference = computeItemDifference(
              item.amount,
              item.expected_amount_snapshot,
            );
            const itemMatches = matchesByItem.get(item.id) ?? [];
            const acceptedMatch = itemMatches.find((m) =>
              ACCEPTED_MATCH_STATES.has((m.match_state ?? '').trim()),
            );
            const suggestions = itemMatches.filter((m) =>
              SUGGESTION_MATCH_STATES.has((m.match_state ?? '').trim()),
            );
            const reconcilable =
              actionable && (item.item_type ?? '').trim() === MATCHABLE_ITEM_TYPE;
            return (

              <div
                key={item.id}
                data-testid="settlement-item-row"
                className="rounded-xl border border-border/60 bg-card/40 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {item.description?.trim() || humanizeToken(item.item_type)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {humanizeToken(item.item_type)}
                      {item.category ? ` · ${humanizeToken(item.category)}` : ''}
                      {item.load_reference_snapshot
                        ? ` · Ref ${item.load_reference_snapshot}`
                        : ''}
                    </p>
                    {(item.origin_snapshot || item.destination_snapshot) && (
                      <p className="text-xs text-muted-foreground">
                        {item.origin_snapshot ?? '—'} → {item.destination_snapshot ?? '—'}
                      </p>
                    )}
                    {describeItemBasis(item) && (
                      <p
                        data-testid="settlement-item-basis"
                        className="mt-1 text-xs text-muted-foreground"
                      >
                        {describeItemBasis(item)}
                      </p>
                    )}
                  </div>

                  <div className="text-right">
                    <p className="text-sm font-bold text-foreground">
                      {formatMoney(item.amount)}
                    </p>
                    {item.expected_amount_snapshot !== null && (
                      <p className="text-xs text-muted-foreground">
                        Expected {formatMoney(item.expected_amount_snapshot)}
                      </p>
                    )}
                    {difference !== null && (
                      <p
                        data-testid="settlement-item-difference"
                        className={`text-xs font-semibold ${
                          difference < 0 ? 'text-destructive' : 'text-primary'
                        }`}
                      >
                        Difference {formatMoney(difference)}
                      </p>
                    )}
                  </div>
                </div>

                {itemMatches.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/50 pt-2">
                    {itemMatches.map((m) => (
                      <span key={m.id} className="flex items-center gap-1">
                        <Badge
                          variant="outline"
                          data-testid="settlement-match-chip"
                          className="text-[11px] font-medium"
                        >
                          Matched load · {humanizeToken(m.match_state)}
                          {m.confidence !== null && m.confidence !== undefined
                            ? ` · ${Math.round(m.confidence * 100)}%`
                            : ''}
                        </Badge>
                        {reconcilable &&
                          advancedToolsVisible &&
                          SUGGESTION_MATCH_STATES.has((m.match_state ?? '').trim()) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              data-testid="settlement-reject-suggestion"
                              className="h-7 px-2 text-xs"
                              onClick={() => handleReject(item.id, m.driver_load_id)}
                            >
                              Reject suggestion
                            </Button>
                          )}
                      </span>
                    ))}
                  </div>
                )}

                {reconcilable && basicReconcileVisible && (
                  <div
                    data-testid="settlement-reconcile-controls"
                    className="mt-2 flex flex-wrap items-end gap-2 border-t border-border/50 pt-2"
                  >
                    {acceptedMatch ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        data-testid="settlement-clear-match"
                        onClick={() => handleClear(item.id)}
                      >
                        Clear match
                      </Button>
                    ) : (
                      <>
                        <div className="min-w-[14rem] flex-1">
                          <label
                            className="text-[11px] font-medium text-muted-foreground"
                            htmlFor={`match-load-${item.id}`}
                          >
                            Match to one of your logged loads
                          </label>
                          <select
                            id={`match-load-${item.id}`}
                            data-testid="settlement-match-load-select"
                            className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
                            value={selectedLoadByItem[item.id] ?? ''}
                            onChange={(e) =>
                              setSelectedLoadByItem((prev) => ({
                                ...prev,
                                [item.id]: e.target.value,
                              }))
                            }
                          >
                            <option value="">Select a load…</option>
                            {loads.map((load) => (
                              <option key={load.id} value={load.id}>
                                {describeLoadOption(load)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <Button
                          size="sm"
                          disabled={busy}
                          data-testid="settlement-confirm-match"
                          onClick={() => handleConfirm(item.id)}
                        >
                          Confirm match
                        </Button>
                      </>
                    )}
                    {advancedToolsVisible && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        data-testid="settlement-find-suggestions"
                        onClick={() => handleRefresh(item.id)}
                      >
                        Find suggestions
                      </Button>
                    )}
                    {suggestions.length > 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        {suggestions.length} suggestion
                        {suggestions.length === 1 ? '' : 's'} awaiting your review
                      </span>
                    )}
                  </div>
                )}

              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {eventsQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Loading activity…</p>
          )}
          {eventsQuery.isError && (
            <p className="text-sm text-destructive">We couldn&apos;t load this activity.</p>
          )}
          {!eventsQuery.isLoading &&
            !eventsQuery.isError &&
            (eventsQuery.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
            )}
          {(eventsQuery.data ?? []).map((ev) => (
            <div
              key={ev.id}
              data-testid="settlement-event-row"
              className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2"
            >
              <span className="text-sm text-foreground">{humanizeToken(ev.event_type)}</span>
              <span className="text-xs text-muted-foreground">
                {formatDateTime(ev.created_at)}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/* --------------------------------------------------------------- main view - */

export function DriverSettlementsView({ onBack }: { onBack?: () => void }) {
  const { user } = useAuth();
  // Acting context is the sole source of the effective settlement driver.
  const targetUserId = useTargetUserId();
  const { isActingAsAssistant, permissions: actingPermissions } = useActingContext();
  const currentUserId = targetUserId ?? user?.id ?? null;
  const [selectedSettlementId, setSelectedSettlementId] = useState<string | null>(null);

  const settlementsQuery = useVisibleSettlements();
  const relationshipsQuery = useVisibleCarrierDriverRelationships();
  const acceptInvite = useAcceptMyCarrierDriverRelationship();
  const declineInvite = useDeclineMyCarrierDriverRelationship();

  const settlements = useMemo(
    () =>
      (settlementsQuery.data ?? []).filter(
        (s) => !!currentUserId && s.driver_user_id === currentUserId,
      ),
    [settlementsQuery.data, currentUserId],
  );

  // Accepting or declining a sharing request is a driver-self action: an
  // acting assistant never sees those invitations.
  const pendingInvites = useMemo(
    () =>
      isActingAsAssistant
        ? []
        : (relationshipsQuery.data ?? []).filter(
            (r) =>
              !!currentUserId &&
              r.driver_user_id === currentUserId &&
              r.status === 'pending',
          ),
    [relationshipsQuery.data, currentUserId, isActingAsAssistant],
  );

  const selected = settlements.find((s) => s.id === selectedSettlementId) ?? null;

  const handleAccept = (relationshipId: string) => {
    acceptInvite.mutate(
      { _relationship_id: relationshipId },
      {
        onSuccess: () => toast.success('Carrier connection accepted'),
        onError: (error: unknown) =>
          toast.error(
            error instanceof Error ? error.message : 'Could not accept this invitation',
          ),
      },
    );
  };

  const handleDecline = (relationshipId: string) => {
    declineInvite.mutate(
      { _relationship_id: relationshipId },
      {
        onSuccess: () => toast.success('Invitation declined'),
        onError: (error: unknown) =>
          toast.error(
            error instanceof Error ? error.message : 'Could not decline this invitation',
          ),
      },
    );
  };

  const busy = acceptInvite.isPending || declineInvite.isPending;

  /* -------------------------------------------- manual outside-settlement -- */
  // Presentation gating only. The backend RPC remains the sole authority on who
  // may create a driver-imported settlement.
  const { isPro, isLoading: isSubscriptionLoading } = useSubscription();
  // An acting assistant NEVER inherits its own plan: the server helper answers
  // delegation + settlements_manage + the TARGET driver's active Pro.
  const assistantManageAccess = useAssistantProSettlementManageAccess(
    targetUserId,
    isActingAsAssistant,
  );
  const advancedToolsVisible = isActingAsAssistant
    ? assistantManageAccess.data === true
    : !isSubscriptionLoading && isPro === true;
  // Basic confirm/clear requires settlements_manage while acting.
  const basicReconcileVisible = isActingAsAssistant
    ? actingPermissions?.settlements_manage === true
    : true;

  const createImportedDraft = useCreateDriverImportedSettlementDraft();
  const [importOpen, setImportOpen] = useState(false);
  const [importForm, setImportForm] = useState({
    payer: '',
    periodStart: '',
    periodEnd: '',
    payDate: '',
    reference: '',
    gross: '',
    net: '',
    notes: '',
  });

  const handleImportSubmit = () => {
    if (!currentUserId) {
      reportFailure('We couldn’t confirm your account. Please try again.');
      return;
    }
    if (!importForm.periodStart.trim() || !importForm.periodEnd.trim()) {
      reportFailure('Enter both a period start and a period end date.');
      return;
    }
    if (importForm.periodEnd.trim() < importForm.periodStart.trim()) {
      reportFailure('Period end cannot be before period start.');
      return;
    }
    if (!isBlankOrFinite(importForm.gross) || !isBlankOrFinite(importForm.net)) {
      reportFailure('Reported amounts must be valid numbers.');
      return;
    }
    createImportedDraft.mutate(
      {
        _driver_user_id: currentUserId,
        _period_start: importForm.periodStart.trim(),
        _period_end: importForm.periodEnd.trim(),
        _pay_date: toNullableText(importForm.payDate),
        _payer_name_snapshot: toNullableText(importForm.payer),
        _statement_reference: toNullableText(importForm.reference),
        _reported_gross_amount: toNullableAmount(importForm.gross),
        _reported_net_amount: toNullableAmount(importForm.net),
        _notes: toNullableText(importForm.notes),
      },
      {
        onSuccess: () => {
          toast.success('Outside settlement imported');
          setImportOpen(false);
          setImportForm({
            payer: '',
            periodStart: '',
            periodEnd: '',
            payDate: '',
            reference: '',
            gross: '',
            net: '',
            notes: '',
          });
        },
        onError: () =>
          reportFailure('We couldn’t import that settlement. Please try again.'),
      },
    );
  };


  return (
    <div className="space-y-5" data-testid="driver-settlements-view">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-primary/15 p-2">
              <ReceiptText className="h-5 w-5 text-primary" />
            </div>
            <h2 className="text-xl font-black tracking-tight text-foreground sm:text-2xl">
              Settlements
            </h2>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Your settlement statements, kept for your own records and reconciled against
            the loads you logged. HaulTrackerPro is a recordkeeping and reconciliation
            tool — it does not pay you, issue funds, or replace your carrier&apos;s
            official statement.
          </p>
        </div>
        {onBack && (
          <Button variant="outline" size="sm" onClick={onBack} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        )}
      </header>

      {pendingInvites.length > 0 && (
        <Card data-testid="pending-invitations">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Pending connection requests
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              A carrier or recruiter has asked to share settlement statements with you.
              Accepting lets them post statements to your account. You can decline
              without giving any reason.
            </p>
            {pendingInvites.map((invite) => (
              <div
                key={invite.id}
                data-testid="pending-invite-row"
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/40 p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    Settlement sharing request
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Requested {formatDate(invite.invited_at)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => handleAccept(invite.id)}
                    className="gap-2"
                  >
                    {acceptInvite.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => handleDecline(invite.id)}
                  >
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {advancedToolsVisible && !selected && (
        <Card data-testid="settlement-import-card">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Import an outside settlement
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Recording a statement you received outside HaulTrackerPro keeps your own
              records complete. It does not notify the payer or change what they owe.
            </p>
            {!importOpen ? (
              <Button
                size="sm"
                data-testid="settlement-import-open"
                onClick={() => setImportOpen(true)}
              >
                Import outside settlement
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="import-payer">Payer name</Label>
                    <Input
                      id="import-payer"
                      value={importForm.payer}
                      onChange={(e) =>
                        setImportForm((p) => ({ ...p, payer: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="import-reference">Statement reference</Label>
                    <Input
                      id="import-reference"
                      value={importForm.reference}
                      onChange={(e) =>
                        setImportForm((p) => ({ ...p, reference: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="import-period-start">Period start</Label>
                    <Input
                      id="import-period-start"
                      type="date"
                      value={importForm.periodStart}
                      onChange={(e) =>
                        setImportForm((p) => ({ ...p, periodStart: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="import-period-end">Period end</Label>
                    <Input
                      id="import-period-end"
                      type="date"
                      value={importForm.periodEnd}
                      onChange={(e) =>
                        setImportForm((p) => ({ ...p, periodEnd: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="import-pay-date">Pay date</Label>
                    <Input
                      id="import-pay-date"
                      type="date"
                      value={importForm.payDate}
                      onChange={(e) =>
                        setImportForm((p) => ({ ...p, payDate: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="import-gross">Reported gross</Label>
                    <Input
                      id="import-gross"
                      inputMode="decimal"
                      value={importForm.gross}
                      onChange={(e) =>
                        setImportForm((p) => ({ ...p, gross: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="import-net">Reported net</Label>
                    <Input
                      id="import-net"
                      inputMode="decimal"
                      value={importForm.net}
                      onChange={(e) =>
                        setImportForm((p) => ({ ...p, net: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="import-notes">Notes</Label>
                  <Textarea
                    id="import-notes"
                    rows={2}
                    value={importForm.notes}
                    onChange={(e) =>
                      setImportForm((p) => ({ ...p, notes: e.target.value }))
                    }
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={createImportedDraft.isPending}
                    data-testid="settlement-import-submit"
                    onClick={handleImportSubmit}
                  >
                    Save imported settlement
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="settlement-import-cancel"
                    onClick={() => setImportOpen(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {selected ? (
        <SettlementDetail
          settlement={selected}
          onBack={() => setSelectedSettlementId(null)}
          advancedToolsVisible={advancedToolsVisible}
          basicReconcileVisible={basicReconcileVisible}
        />
      ) : (

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Settlement history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {settlementsQuery.isLoading && (
              <p className="text-sm text-muted-foreground" data-testid="settlements-loading">
                Loading your settlements…
              </p>
            )}

            {settlementsQuery.isError && (
              <div
                data-testid="settlements-error"
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3"
              >
                <span className="flex items-center gap-2 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  We couldn&apos;t load your settlements.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  onClick={() => settlementsQuery.refetch()}
                >
                  <RefreshCw className="h-4 w-4" />
                  Try again
                </Button>
              </div>
            )}

            {!settlementsQuery.isLoading &&
              !settlementsQuery.isError &&
              settlements.length === 0 && (
                <div
                  data-testid="settlements-empty"
                  className="rounded-xl border border-border/60 bg-muted/20 p-6 text-center"
                >
                  <Inbox className="mx-auto h-6 w-6 text-muted-foreground" />
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    No settlements yet
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Once a connected carrier posts a statement, it shows up here for
                    reconciliation against your logged loads.
                  </p>
                </div>
              )}

            {settlements.map((s) => (
              <button
                key={s.id}
                type="button"
                data-testid="settlement-card"
                onClick={() => setSelectedSettlementId(s.id)}
                className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/40 p-4 text-left transition-colors hover:border-primary/40"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-foreground">
                      {resolvePayerLabel(
                        s.source_display_name_snapshot,
                        s.payer_name_snapshot,
                        s.source,
                      )}

                    </p>
                    <StatusBadge status={s.status} />
                    {s.version_number > 1 && (
                      <Badge variant="outline" className="text-[11px]">
                        Version {s.version_number}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDate(s.period_start)} – {formatDate(s.period_end)}
                    {s.pay_date ? ` · Paid ${formatDate(s.pay_date)}` : ''}
                  </p>
                  {s.statement_reference && (
                    <p className="text-xs text-muted-foreground">
                      Statement {s.statement_reference}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm font-bold text-foreground">
                      {formatMoney(s.reported_net_amount)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Gross {formatMoney(s.reported_gross_amount)}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default DriverSettlementsView;
