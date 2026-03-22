import { useState, useMemo } from 'react';
import { Load } from '@/hooks/useLoads';
import { useWeeklySnapshots } from '@/hooks/useWeeklySnapshots';
import { useUserSettings } from '@/hooks/useUserSettings';
import { formatCurrency, formatNumber, getCurrentWeekLoads, weekStartDayToNumber } from '@/lib/loadUtils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { DollarSign, Truck, AlertTriangle, CheckCircle2, ArrowLeft, Route, MapPin, Lock, Zap, Sparkles } from 'lucide-react';
import { startOfWeek, endOfWeek, format } from 'date-fns';
import { generateWeeklySummary } from '@/lib/generateWeeklySummary';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

interface WeeklyCloseoutProps {
  loads: Load[];
  onNavigate: (page: string, options?: { filter?: string }) => void;
  onBack: () => void;
  isPro?: boolean;
}

export function WeeklyCloseout({ loads, onNavigate, onBack, isPro = false }: WeeklyCloseoutProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [finalized, setFinalized] = useState(false);
  const navigate = useNavigate();
  const { saveSnapshot } = useWeeklySnapshots();
  const { settings } = useUserSettings();
  const weekStartsOn = weekStartDayToNumber(settings?.week_start_day);
  const weekLoads = useMemo(() => getCurrentWeekLoads(loads, weekStartsOn), [loads, weekStartsOn]);

  if (!isPro) {
    return (
      <div className="space-y-5 animate-fade-in">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-black font-heading">Weekly Closeout</h1>
            <p className="text-sm text-muted-foreground">Finalize your weekly summary</p>
          </div>
        </div>
        <Card className="shadow-card">
          <CardContent className="py-12 text-center">
            <Lock className="h-12 w-12 text-muted-foreground/20 mx-auto mb-4" />
            <p className="text-lg font-bold">Unlock Weekly Closeout</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
              Finalize your week with pay variance tracking, deadhead analysis, and snapshot history.
            </p>
            <Button size="sm" className="mt-5 rounded-xl" onClick={() => navigate('/pricing')}>
              Upgrade to Pro
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }


  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn });
  const weekEnd = endOfWeek(now, { weekStartsOn });

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
        toast.success('Weekly summary finalized!');
      },
      onError: (e) => toast.error(e.message),
    });
  };

  if (finalized) {
    return (
      <div className="space-y-6 animate-fade-in text-center py-8">
        <div className="inline-flex items-center justify-center rounded-full bg-success/10 p-6 mb-2">
          <CheckCircle2 className="h-16 w-16 text-success animate-check-bounce" />
        </div>
        <h2 className="text-2xl font-black font-heading">Week Finalized!</h2>
        <p className="text-muted-foreground leading-relaxed">
          {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}
        </p>
        <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto">
          <Card className="card-premium"><CardContent className="p-3 text-center">
            <p className="text-label">Loads</p>
            <p className="text-value-lg">{weekLoads.length}</p>
          </CardContent></Card>
          <Card className="card-premium"><CardContent className="p-3 text-center">
            <p className="text-label">Estimated</p>
            <p className="text-value-lg text-primary">{formatCurrency(estimated)}</p>
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
          <h1 className="text-2xl font-black font-heading">Finalize Weekly Summary</h1>
          <p className="text-sm text-muted-foreground">
            {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}
          </p>
        </div>
      </div>

      {weekLoads.length === 0 ? (
        <Card className="border-dashed border-2 border-muted-foreground/20">
          <CardContent className="py-14 text-center">
            <div className="inline-flex items-center justify-center rounded-2xl bg-muted p-5 mb-5">
              <Truck className="h-12 w-12 text-muted-foreground/30" />
            </div>
            <p className="font-bold text-lg">No loads this week</p>
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">Log some loads to finalize your weekly summary.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary Metrics */}
          <div className="grid grid-cols-2 gap-3">
            <Card className="card-premium">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="h-4 w-4 text-primary" />
                  <p className="text-label">Est. Earnings</p>
                </div>
                <p className="text-value-lg">{formatCurrency(estimated)}</p>
              </CardContent>
            </Card>
            <Card className="card-premium">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="h-4 w-4 text-success" />
                  <p className="text-label">Actual Earnings</p>
                </div>
                <p className="text-value-lg">{formatCurrency(actual)}</p>
                <p className="text-[11px] text-muted-foreground">{paidLoads.length} paid</p>
              </CardContent>
            </Card>
            <Card className="card-premium">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Truck className="h-4 w-4 text-primary" />
                  <p className="text-label">Total Loads</p>
                </div>
                <p className="text-value-lg">{weekLoads.length}</p>
              </CardContent>
            </Card>
            <Card className="card-premium">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Route className="h-4 w-4 text-primary" />
                  <p className="text-label">Known Diff</p>
                </div>
                <p className={`text-value-lg ${knownDifference >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {knownDifference >= 0 ? '+' : ''}{formatCurrency(knownDifference)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Week in Review */}
          {weekLoads.length >= 2 && (() => {
            const loadsWithRPM = weekLoads.map(l => ({
              load: l,
              rpm: Number(l.loaded_miles) > 0 ? Number(l.estimated_pay ?? 0) / Number(l.loaded_miles) : 0,
              dhPct: (Number(l.loaded_miles) + Number(l.deadhead_miles)) > 0
                ? (Number(l.deadhead_miles) / (Number(l.loaded_miles) + Number(l.deadhead_miles))) * 100 : 0,
            }));
            const best = loadsWithRPM.reduce((a, b) => b.rpm > a.rpm ? b : a);
            const worst = loadsWithRPM.reduce((a, b) => b.rpm < a.rpm && b.rpm > 0 ? b : a);
            const highDH = loadsWithRPM.filter(l => l.dhPct > 30);
            const unpaid = weekLoads.filter(l => l.actual_pay_received == null && l.status !== 'cancelled');
            const insights: { color: string; text: string }[] = [];
            if (best.rpm > 0) insights.push({ color: 'text-success', text: `Best load: ${best.load.pickup_location} → ${best.load.dropoff_location} at $${best.rpm.toFixed(2)}/mi` });
            if (worst.rpm > 0 && worst.load.id !== best.load.id) insights.push({ color: 'text-destructive', text: `Lowest RPM: ${worst.load.pickup_location} → ${worst.load.dropoff_location} at $${worst.rpm.toFixed(2)}/mi` });
            if (highDH.length > 0) insights.push({ color: 'text-warning', text: `${highDH.length} load${highDH.length > 1 ? 's' : ''} had >30% deadhead` });
            if (unpaid.length > 0) insights.push({ color: 'text-muted-foreground', text: `${unpaid.length} load${unpaid.length > 1 ? 's' : ''} still awaiting payment` });
            if (insights.length === 0) return null;
            return (
              <Card className="shadow-card">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Zap className="h-4 w-4 text-primary" />
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Week in Review</p>
                  </div>
                  <div className="space-y-2">
                    {insights.map((ins, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <div className={`h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${ins.color === 'text-success' ? 'bg-success' : ins.color === 'text-destructive' ? 'bg-destructive' : ins.color === 'text-warning' ? 'bg-warning' : 'bg-muted-foreground'}`} />
                        <p className={`text-xs ${ins.color}`}>{ins.text}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* AI Weekly Summary */}
          {weekLoads.length > 0 && (() => {
            const summaryLines = generateWeeklySummary({ weekLoads, allLoads: loads, weekStartsOn });
            if (summaryLines.length === 0) return null;
            return (
              <Card className="shadow-card overflow-hidden">
                <CardContent className="p-0">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-primary/5">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-primary">AI Weekly Summary</span>
                  </div>
                  <div className="p-4 space-y-2">
                    {summaryLines.map((line, i) => (
                      <p key={i} className="text-xs leading-relaxed text-muted-foreground">{line}</p>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* Deadhead */}
          <Card className="card-premium">
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
                      {unpaidLoads.length} load{unpaidLoads.length > 1 ? 's' : ''} pending payment entry.
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
                      Review Pending Loads
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
                <label htmlFor="confirm-closeout" className="text-sm cursor-pointer leading-relaxed">
                  I have entered all known actual payments.
                </label>
              </div>
              <Button
                className="w-full h-12 text-base font-bold rounded-xl shadow-primary active:scale-95 transition-all duration-200"
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
