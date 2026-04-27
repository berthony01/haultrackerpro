import { usePersonalIntelligence } from '@/hooks/usePersonalIntelligence';
import { useUserSettings } from '@/hooks/useUserSettings';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency } from '@/lib/loadUtils';
import { TrendingUp, TrendingDown, Building2, AlertTriangle, Lock, Crown, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

interface PersonalIntelligenceBlocksProps {
  isPro: boolean;
}

function SectionHeader({ icon: Icon, title, hint }: { icon: typeof TrendingUp; title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 bg-primary/5">
      <Icon className="h-3.5 w-3.5 text-primary" />
      <span className="text-[11px] font-bold uppercase tracking-wider text-primary">{title}</span>
      {hint && <span className="text-[10px] text-muted-foreground ml-auto">{hint}</span>}
    </div>
  );
}

export function PersonalIntelligenceBlocks({ isPro }: PersonalIntelligenceBlocksProps) {
  const navigate = useNavigate();
  const { lanes, brokers, operatingMetrics, isLoading } = usePersonalIntelligence();
  const { settings } = useUserSettings();
  const hasAccess = isPro;

  if (isLoading) return null;

  const hasAnyData = lanes.length > 0 || brokers.length > 0 || !!operatingMetrics;
  if (!hasAnyData) return null;

  // Lock for free users — show one teaser card
  if (!hasAccess) {
    return (
      <Card className="shadow-card overflow-hidden">
        <CardContent className="p-0">
          <SectionHeader icon={Sparkles} title="Personal Intelligence" />
          <div className="p-4 text-center space-y-3">
            <Lock className="h-8 w-8 text-muted-foreground/20 mx-auto" />
            <div>
              <p className="text-sm font-bold">Your private profit insights are ready</p>
              <p className="text-xs text-muted-foreground mt-1">
                Best & weakest lanes, broker reliability, and margin leaks — built from your own load history.
              </p>
            </div>
            <Button size="sm" className="rounded-xl font-bold gap-1.5" onClick={() => navigate('/pricing')}>
              <Crown className="h-3.5 w-3.5" /> Unlock Insights
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Sort lanes by net profit (need >=2 loads to be meaningful)
  const meaningfulLanes = lanes.filter(l => l.load_count >= 2);
  const lanesByNet = [...meaningfulLanes].sort((a, b) => Number(b.avg_net_profit) - Number(a.avg_net_profit));
  const bestLanes = lanesByNet.slice(0, 3);
  const weakestLanes = lanesByNet.slice(-3).reverse().filter(l => !bestLanes.find(b => b.id === l.id));

  // Sort brokers by reliability
  const meaningfulBrokers = brokers.filter(b => b.load_count >= 2);
  const brokersByRel = [...meaningfulBrokers].sort((a, b) => Number(b.reliability_score ?? 0) - Number(a.reliability_score ?? 0));
  const bestBrokers = brokersByRel.slice(0, 3);
  const slowBrokers = brokersByRel.filter(b => Number(b.reliability_score ?? 100) < 70 || Number(b.days_to_pay_avg ?? 0) > 35).slice(0, 3);
  const unpaidExposure = brokers.reduce((sum, b) => sum + Number(b.unpaid_count ?? 0) * Number(b.avg_estimated_pay ?? 0), 0);

  // Margin leaks
  const leaks: { icon: typeof AlertTriangle; label: string; detail: string; tone: 'warn' | 'danger' }[] = [];
  if (operatingMetrics) {
    const dh = Number(operatingMetrics.rolling_deadhead_pct ?? 0);
    const margin = Number(operatingMetrics.rolling_margin_pct ?? 0);
    const targetDh = settings?.target_deadhead_pct ? Number(settings.target_deadhead_pct) : 20;
    const targetMargin = settings?.target_margin_pct ? Number(settings.target_margin_pct) : 25;
    if (dh > targetDh) {
      leaks.push({
        icon: TrendingDown,
        label: 'Deadhead drag',
        detail: `${dh.toFixed(0)}% deadhead over the last 90 days (target ${targetDh.toFixed(0)}%).`,
        tone: dh > targetDh * 1.5 ? 'danger' : 'warn',
      });
    }
    if (margin < targetMargin && margin > 0) {
      leaks.push({
        icon: TrendingDown,
        label: 'Margin below target',
        detail: `Rolling margin is ${margin.toFixed(0)}% (target ${targetMargin.toFixed(0)}%).`,
        tone: margin < targetMargin * 0.6 ? 'danger' : 'warn',
      });
    }
  }
  const repeatedWeak = weakestLanes.filter(l => Number(l.avg_net_profit) < 0).slice(0, 1);
  if (repeatedWeak.length > 0) {
    const l = repeatedWeak[0];
    leaks.push({
      icon: AlertTriangle,
      label: 'Repeated losing lane',
      detail: `${l.lane_key} averaged ${formatCurrency(Number(l.avg_net_profit))} net across ${l.load_count} loads.`,
      tone: 'danger',
    });
  }
  if (unpaidExposure > 0) {
    leaks.push({
      icon: AlertTriangle,
      label: 'Unpaid exposure',
      detail: `Roughly ${formatCurrency(unpaidExposure)} in outstanding broker invoices.`,
      tone: unpaidExposure > 5000 ? 'danger' : 'warn',
    });
  }

  // Don't render anything if literally nothing computed
  if (bestLanes.length === 0 && bestBrokers.length === 0 && leaks.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Best & Weakest Lanes */}
      {bestLanes.length > 0 && (
        <Card className="shadow-card overflow-hidden">
          <CardContent className="p-0">
            <SectionHeader icon={TrendingUp} title="Best & Weakest Lanes" hint={`${meaningfulLanes.length} lanes`} />
            <div className="p-4 space-y-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-success mb-1.5">Top by Net Profit</p>
                <ul className="space-y-1.5">
                  {bestLanes.map(l => (
                    <li key={l.id} className="flex items-center justify-between text-xs gap-2 py-1.5 border-b border-border/40 last:border-0">
                      <span className="truncate flex-1 font-medium">{l.lane_key}</span>
                      <span className="text-muted-foreground shrink-0">{l.load_count}x</span>
                      <span className="font-mono font-bold text-success shrink-0 w-20 text-right">{formatCurrency(Number(l.avg_net_profit))}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {weakestLanes.length > 0 && (
                <div className="pt-1 border-t border-border/40">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-destructive mb-1.5">Weakest by Net Profit</p>
                  <ul className="space-y-1.5">
                    {weakestLanes.map(l => (
                      <li key={l.id} className="flex items-center justify-between text-xs gap-2 py-1.5 border-b border-border/40 last:border-0">
                        <span className="truncate flex-1 font-medium">{l.lane_key}</span>
                        <span className="text-muted-foreground shrink-0">{l.load_count}x</span>
                        <span className={`font-mono font-bold shrink-0 w-20 text-right ${Number(l.avg_net_profit) < 0 ? 'text-destructive' : 'text-warning'}`}>
                          {formatCurrency(Number(l.avg_net_profit))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Broker Reliability */}
      {(bestBrokers.length > 0 || slowBrokers.length > 0) && (
        <Card className="shadow-card overflow-hidden">
          <CardContent className="p-0">
            <SectionHeader icon={Building2} title="Broker Reliability" hint={`${meaningfulBrokers.length} brokers`} />
            <div className="p-4 space-y-3">
              {bestBrokers.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-success mb-1.5">Best Payers</p>
                  <ul className="space-y-1.5">
                    {bestBrokers.map(b => (
                      <li key={b.id} className="flex items-center justify-between text-xs gap-2 py-1.5 border-b border-border/40 last:border-0">
                        <span className="truncate flex-1 font-medium">{b.broker_name}</span>
                        <span className="text-muted-foreground shrink-0">{b.load_count}x</span>
                        <span className="font-mono font-bold text-success shrink-0 w-12 text-right">
                          {b.reliability_score != null ? `${Number(b.reliability_score).toFixed(0)}` : '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {slowBrokers.length > 0 && (
                <div className="pt-1 border-t border-border/40">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-destructive mb-1.5">Watch List</p>
                  <ul className="space-y-1.5">
                    {slowBrokers.map(b => (
                      <li key={b.id} className="flex items-center justify-between text-xs gap-2 py-1.5 border-b border-border/40 last:border-0">
                        <div className="flex-1 min-w-0">
                          <p className="truncate font-medium">{b.broker_name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {b.days_to_pay_avg != null && Number(b.days_to_pay_avg) > 0 && `${Number(b.days_to_pay_avg).toFixed(0)}d to pay`}
                            {Number(b.short_pay_count) > 0 && ` · ${b.short_pay_count} short-pay`}
                            {Number(b.unpaid_count) > 0 && ` · ${b.unpaid_count} unpaid`}
                          </p>
                        </div>
                        <span className="font-mono font-bold text-destructive shrink-0 w-12 text-right">
                          {b.reliability_score != null ? Number(b.reliability_score).toFixed(0) : '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {unpaidExposure > 0 && (
                <div className="rounded-lg bg-warning/10 border border-warning/20 p-2.5 text-xs">
                  <span className="font-bold">Unpaid exposure: </span>
                  <span className="font-mono font-bold text-warning">{formatCurrency(unpaidExposure)}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Margin Leaks */}
      {leaks.length > 0 && (
        <Card className="shadow-card overflow-hidden">
          <CardContent className="p-0">
            <SectionHeader icon={AlertTriangle} title="Margin Leaks" />
            <div className="p-4 space-y-2">
              {leaks.map((leak, i) => {
                const Icon = leak.icon;
                const tone = leak.tone === 'danger' ? 'bg-destructive/5 text-destructive' : 'bg-warning/5 text-warning';
                return (
                  <div key={i} className={`rounded-lg p-3 ${tone}`}>
                    <div className="flex items-start gap-2">
                      <Icon className="h-4 w-4 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold">{leak.label}</p>
                        <p className="text-xs text-foreground/80 mt-0.5">{leak.detail}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
