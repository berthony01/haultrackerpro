/**
 * Phase 1T-D2 — Driver Settlements MVP (read + invitation response only).
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
  Inbox,
  Loader2,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import {
  useAcceptMyCarrierDriverRelationship,
  useDeclineMyCarrierDriverRelationship,
  useVisibleCarrierDriverRelationships,
  useVisibleSettlementEvents,
  useVisibleSettlementItems,
  useVisibleSettlementMatches,
  useVisibleSettlements,
} from '@/hooks/settlements/useSettlementData';

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
}: {
  settlement: SettlementRowView;
  onBack: () => void;
}) {
  const settlementId = settlement.id;
  const itemsQuery = useVisibleSettlementItems(settlementId);
  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const itemIds = useMemo(() => items.map((i) => i.id), [items]);
  const matchesQuery = useVisibleSettlementMatches(itemIds);
  const eventsQuery = useVisibleSettlementEvents(settlementId);

  const matchesByItem = useMemo(() => {
    const rows = matchesQuery.data ?? [];
    const map = new Map<string, typeof rows>();
    for (const m of rows) {
      map.set(m.settlement_item_id, [...(map.get(m.settlement_item_id) ?? []), m]);
    }
    return map;
  }, [matchesQuery.data]);

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
                  <div className="mt-2 flex flex-wrap gap-2 border-t border-border/50 pt-2">
                    {itemMatches.map((m) => (
                      <Badge
                        key={m.id}
                        variant="outline"
                        data-testid="settlement-match-chip"
                        className="text-[11px] font-medium"
                      >
                        Matched load · {humanizeToken(m.match_state)}
                        {m.confidence !== null && m.confidence !== undefined
                          ? ` · ${Math.round(m.confidence * 100)}%`
                          : ''}
                      </Badge>
                    ))}
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
  const currentUserId = user?.id ?? null;
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

  const pendingInvites = useMemo(
    () =>
      (relationshipsQuery.data ?? []).filter(
        (r) =>
          !!currentUserId &&
          r.driver_user_id === currentUserId &&
          r.status === 'pending',
      ),
    [relationshipsQuery.data, currentUserId],
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

      {selected ? (
        <SettlementDetail
          settlementId={selected.id}
          onBack={() => setSelectedSettlementId(null)}
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
