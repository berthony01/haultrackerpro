import { useState, useMemo } from 'react';
import { TrendingUp, AlertTriangle, CheckCircle2, Target } from 'lucide-react';

/**
 * Lightweight, marketing-only Profit Intelligence preview.
 * Pure client-side math — mirrors the in-app scoring shape (RPM, margin %, deadhead %, broker reliability)
 * without touching real lane_stats / broker_stats. For Landing page only.
 */
export default function ProfitIntelDemo() {
  const [rate, setRate] = useState(2000);
  const [loadedMiles, setLoadedMiles] = useState(800);
  const [deadheadMiles, setDeadheadMiles] = useState(120);
  const [fuelCost, setFuelCost] = useState(520);
  const [otherCost, setOtherCost] = useState(180);
  const [brokerOnTimePct, setBrokerOnTimePct] = useState(85);

  const result = useMemo(() => {
    const totalMiles = Math.max(1, loadedMiles + deadheadMiles);
    const totalCost = fuelCost + otherCost;
    const netProfit = rate - totalCost;
    const rpm = rate / Math.max(1, loadedMiles);
    const allInRpm = rate / totalMiles;
    const marginPct = (netProfit / Math.max(1, rate)) * 100;
    const deadheadPct = (deadheadMiles / totalMiles) * 100;

    // Scoring against simple "personal-history" benchmarks
    const TARGET_RPM = 2.2;
    const TARGET_MARGIN = 35;
    const TARGET_DEADHEAD = 15;
    const TARGET_BROKER = 90;

    const rpmScore = Math.max(0, Math.min(100, (rpm / TARGET_RPM) * 100));
    const marginScore = Math.max(0, Math.min(100, (marginPct / TARGET_MARGIN) * 100));
    const deadheadScore = Math.max(0, Math.min(100, 100 - ((deadheadPct - TARGET_DEADHEAD) * 4)));
    const brokerScore = Math.max(0, Math.min(100, (brokerOnTimePct / TARGET_BROKER) * 100));

    const overall = Math.round(rpmScore * 0.3 + marginScore * 0.35 + deadheadScore * 0.2 + brokerScore * 0.15);

    let verdict: 'take' | 'caution' | 'pass';
    let verdictLabel: string;
    if (overall >= 75) { verdict = 'take'; verdictLabel = 'Worth Taking'; }
    else if (overall >= 55) { verdict = 'caution'; verdictLabel = 'Proceed With Caution'; }
    else { verdict = 'pass'; verdictLabel = 'Likely Pass'; }

    const warnings: string[] = [];
    if (rpm < TARGET_RPM * 0.85) warnings.push(`RPM $${rpm.toFixed(2)} is below your $${TARGET_RPM.toFixed(2)} target`);
    if (marginPct < 20) warnings.push(`Margin ${marginPct.toFixed(0)}% is thin after fuel and expenses`);
    if (deadheadPct > 25) warnings.push(`Deadhead ${deadheadPct.toFixed(0)}% will eat your profit`);
    if (brokerOnTimePct < 80) warnings.push(`Broker pays slow — average ${brokerOnTimePct}% on-time`);
    if (netProfit < 0) warnings.push(`This load loses $${Math.abs(netProfit).toFixed(0)} after expenses`);

    return { netProfit, rpm, allInRpm, marginPct, deadheadPct, overall, verdict, verdictLabel, warnings };
  }, [rate, loadedMiles, deadheadMiles, fuelCost, otherCost, brokerOnTimePct]);

  const verdictColor =
    result.verdict === 'take' ? 'hsl(152, 60%, 45%)' :
    result.verdict === 'caution' ? 'hsl(38, 92%, 55%)' :
    'hsl(0, 72%, 55%)';

  const VerdictIcon =
    result.verdict === 'take' ? CheckCircle2 :
    result.verdict === 'caution' ? AlertTriangle :
    AlertTriangle;

  return (
    <div className="grid lg:grid-cols-2 gap-6 max-w-5xl mx-auto">
      {/* Inputs */}
      <div className="p-6 sm:p-7 rounded-2xl border" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 18%)' }}>
        <div className="flex items-center gap-2 mb-5">
          <Target className="h-4 w-4" style={{ color: 'hsl(25, 95%, 53%)' }} />
          <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'hsl(220, 10%, 70%)' }}>
            Try a Sample Load
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Load pays ($)', value: rate, set: setRate, step: 50, min: 0 },
            { label: 'Loaded miles', value: loadedMiles, set: setLoadedMiles, step: 25, min: 1 },
            { label: 'Deadhead miles', value: deadheadMiles, set: setDeadheadMiles, step: 10, min: 0 },
            { label: 'Fuel cost ($)', value: fuelCost, set: setFuelCost, step: 25, min: 0 },
            { label: 'Other expenses ($)', value: otherCost, set: setOtherCost, step: 25, min: 0 },
            { label: 'Broker on-time %', value: brokerOnTimePct, set: setBrokerOnTimePct, step: 5, min: 0, max: 100 },
          ].map((f) => (
            <div key={f.label}>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'hsl(220, 10%, 60%)' }}>
                {f.label}
              </label>
              <input
                type="number"
                value={f.value}
                min={f.min}
                max={(f as any).max}
                step={f.step}
                onChange={(e) => f.set(Math.max(f.min ?? 0, Math.min((f as any).max ?? 999999, Number(e.target.value) || 0)))}
                className="w-full px-3 py-2 rounded-lg text-sm font-bold tabular-nums focus:outline-none focus:ring-2"
                style={{
                  background: 'hsl(220, 20%, 7%)',
                  border: '1px solid hsl(220, 16%, 20%)',
                  color: 'hsl(0, 0%, 100%)',
                }}
              />
            </div>
          ))}
        </div>
        <p className="text-[11px] mt-4 leading-relaxed" style={{ color: 'hsl(220, 10%, 45%)' }}>
          Demo only. Inside the app, scoring uses your real lane history, broker reliability, and rolling cost-per-mile — not generic targets.
        </p>
      </div>

      {/* Output */}
      <div className="p-6 sm:p-7 rounded-2xl border relative overflow-hidden" style={{
        background: 'hsl(220, 20%, 10%)',
        borderColor: `${verdictColor.replace(')', ', 0.4)')}`,
        boxShadow: `0 0 30px -10px ${verdictColor.replace(')', ', 0.25)')}`
      }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <VerdictIcon className="h-4 w-4" style={{ color: verdictColor }} />
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: verdictColor }}>
              {result.verdictLabel}
            </span>
          </div>
          <div className="text-right">
            <div className="text-3xl font-black tabular-nums" style={{ color: verdictColor }}>
              {result.overall}
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'hsl(220, 10%, 50%)' }}>
              Score / 100
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          {[
            { label: 'Net Profit', value: `$${result.netProfit.toFixed(0)}`, accent: result.netProfit >= 0 },
            { label: 'RPM (loaded)', value: `$${result.rpm.toFixed(2)}` },
            { label: 'Margin', value: `${result.marginPct.toFixed(0)}%` },
            { label: 'Deadhead', value: `${result.deadheadPct.toFixed(0)}%` },
          ].map((m) => (
            <div key={m.label} className="p-3 rounded-lg" style={{ background: 'hsl(220, 20%, 7%)' }}>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'hsl(220, 10%, 50%)' }}>
                {m.label}
              </div>
              <div className="text-base font-black tabular-nums" style={{
                color: m.accent === false ? 'hsl(0, 72%, 60%)' : 'hsl(0, 0%, 100%)'
              }}>
                {m.value}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'hsl(220, 10%, 50%)' }}>
            What the App Would Tell You
          </div>
          {result.warnings.length === 0 ? (
            <div className="flex items-start gap-2 p-3 rounded-lg" style={{ background: 'hsl(152, 60%, 45%, 0.08)' }}>
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'hsl(152, 60%, 45%)' }} />
              <p className="text-xs leading-relaxed" style={{ color: 'hsl(220, 10%, 80%)' }}>
                Numbers look healthy against your targets. Lane, margin, and deadhead are all in range.
              </p>
            </div>
          ) : (
            result.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2 p-3 rounded-lg" style={{ background: 'hsl(0, 72%, 55%, 0.08)' }}>
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: 'hsl(0, 72%, 60%)' }} />
                <p className="text-xs leading-relaxed" style={{ color: 'hsl(220, 10%, 80%)' }}>{w}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
