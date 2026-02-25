import { useState, useMemo } from 'react';
import { Load } from '@/hooks/useLoads';
import { useWeeklySnapshots } from '@/hooks/useWeeklySnapshots';
import { formatCurrency, formatNumber, getCurrentWeekLoads } from '@/lib/loadUtils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { DollarSign, Truck, AlertTriangle, CheckCircle2, ArrowLeft, Route, MapPin } from 'lucide-react';
import { startOfWeek, endOfWeek, format } from 'date-fns';
import { toast } from 'sonner';

interface WeeklyCloseoutProps {
  loads: Load[];
  onNavigate: (page: string, options?: { filter?: string }) => void;
  onBack: () => void;
}

export function WeeklyCloseout({ loads, onNavigate, onBack }: WeeklyCloseoutProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [finalized, setFinalized] = useState(false);
  const { saveSnapshot } = useWeeklySnapshots();

  const weekLoads = useMemo(() => getCurrentWeekLoads(loads), [loads]);

  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });

  const estimated = weekLoads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
  const paidLoads = weekLoads.filter(l => l.actual_pay_received != null);
  const actual = paidLoads.reduce((s, l) => s + Number(l.actual_pay_received ?? 0), 0);
  const paidEstimated = paidLoads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
  const knownDifference = paidLoads.length > 0 ? actual - paidEstimated : 0;
  const unpaidLoads = weekLoads.filter(l => l.actual_pay_received == null && l.status !== 'cancelled');
  const unpaidEstimated = unpaidLoads.reduce((s, l) => s + Number(l.estimated_pay ?? 0), 0);
  const loadedMiles = weekLoads.reduce((s, l) => s + Number(l.loaded_miles), 0);
  const deadheadMiles = weekLoads.reduce((s, l) => s + Number(l.deadhead_miles), 0);
  const totalMiles = loadedMiles + deadheadMiles;
  const deadheadPct = totalMiles > 0 ? (deadheadMiles / totalMiles) * 100 : 0;

  const handleFinalize = () => {
    saveSnapshot.mutate({
      user_id: '',
      week_start: format(weekStart, 'yyyy-MM-dd'),
      week_end: format(weekEnd, 'yyyy-MM-dd'),
      total_loads: weekLoads.length,
      total_loaded_miles: loadedMiles,
      total_deadhead_miles: deadheadMiles,
      total_estimated_pay: estimated,
      total_actual_pay: actual,
      known_difference: knownDifference,
      unpaid_count: unpaidLoads.length,
      unpaid_estimated: unpaidEstimated,
      deadhead_percentage: Math.round(deadheadPct * 10) / 10,
    }, {
      onSuccess: () => {
        setFinalized(true);
        toast.success('Week finalized!');
      },
      onError: (e) => toast.error(e.message),
    });
  };

  if (finalized) {
    return (
      <div className="space-y-6 animate-fade-in text-center py-8">
        <div className="inline-flex items-center justify-center rounded-full bg-success/10 p-6 mb-2">
          <CheckCircle2 className="h-16 w-16 text-success animate-scale-in" />
        </div>
        <h2 className="text-2xl font-black font-heading">Week Closed Out!</h2>
        <p className="text-muted-foreground">
          {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}
        </p>
        <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto">
          <Card><CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Loads</p>
            <p className="text-xl font-black font-mono">{weekLoads.length}</p>
          </CardContent></Card>
          <Card><CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Estimated</p>
            <p className="text-xl font-black font-mono text-primary">{formatCurrency(estimated)}</p>
          </CardContent></Card>
        </div>
        <Button className="rounded-xl shadow-primary" onClick={onBack}>Back to Dashboard</Button>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="rounded-xl" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-black font-heading">Weekly Closeout</h1>
          <p className="text-sm text-muted-foreground">
            {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}
          </p>
        </div>
      </div>

      {weekLoads.length === 0 ? (
        <Card className="border-dashed border-2 border-muted-foreground/20">
          <CardContent className="py-12 text-center">
            <Truck className="h-10 w-10 text-muted-foreground/40 mx-auto mb-4" />
            <p className="font-bold text-lg">No loads this week</p>
            <p className="text-sm text-muted-foreground mt-1">Log some loads first</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary Metrics */}
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="h-4 w-4 text-primary" />
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Est. Earnings</p>
                </div>
                <p className="text-xl font-black font-mono">{formatCurrency(estimated)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="h-4 w-4 text-success" />
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Actual Earnings</p>
                </div>
                <p className="text-xl font-black font-mono">{formatCurrency(actual)}</p>
                <p className="text-[11px] text-muted-foreground">{paidLoads.length} paid</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Truck className="h-4 w-4 text-primary" />
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Total Loads</p>
                </div>
                <p className="text-xl font-black font-mono">{weekLoads.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Route className="h-4 w-4 text-primary" />
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Known Diff</p>
                </div>
                <p className={`text-xl font-black font-mono ${knownDifference >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {knownDifference >= 0 ? '+' : ''}{formatCurrency(knownDifference)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Deadhead */}
          <Card>
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Deadhead</span>
              </div>
              <Badge variant={deadheadPct < 15 ? 'default' : deadheadPct < 30 ? 'secondary' : 'destructive'}
                className={deadheadPct < 15 ? 'bg-success text-success-foreground' : deadheadPct < 30 ? 'bg-warning text-warning-foreground' : ''}>
                {deadheadPct.toFixed(1)}%
              </Badge>
            </CardContent>
          </Card>

          {/* Unpaid Warning */}
          {unpaidLoads.length > 0 && (
            <Card className="border-warning/30 bg-warning/5">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-bold text-sm">
                      You have {unpaidLoads.length} load{unpaidLoads.length > 1 ? 's' : ''} missing actual pay.
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Estimated total: {formatCurrency(unpaidEstimated)}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 text-xs rounded-xl"
                      onClick={() => onNavigate('loads', { filter: 'missing_pay' })}
                    >
                      Review Missing Loads
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Confirm & Finalize */}
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="confirm-closeout"
                  checked={confirmed}
                  onCheckedChange={(v) => setConfirmed(v === true)}
                  className="mt-0.5"
                />
                <label htmlFor="confirm-closeout" className="text-sm cursor-pointer leading-snug">
                  I have entered all known actual payments.
                </label>
              </div>
              <Button
                className="w-full h-12 text-base font-bold rounded-xl shadow-primary"
                disabled={!confirmed || saveSnapshot.isPending}
                onClick={handleFinalize}
              >
                {saveSnapshot.isPending ? 'Finalizing...' : 'Finalize Week'}
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
