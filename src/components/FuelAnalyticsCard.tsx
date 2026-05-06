import { FuelLog, useFuelAnalytics } from '@/hooks/useFuelLogs';
import { Load } from '@/hooks/useLoads';
import { formatCurrency } from '@/lib/loadUtils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Fuel, Crown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface FuelAnalyticsCardProps {
  fuelLogs: FuelLog[];
  loads: Load[];
  isPro: boolean;
  onNavigate?: (page: string) => void;
}

export function FuelAnalyticsCard({ fuelLogs, loads, isPro, onNavigate }: FuelAnalyticsCardProps) {
  const navigate = useNavigate();
  const analytics = useFuelAnalytics(fuelLogs, loads);

  if (fuelLogs.length === 0) {
    return null;
  }

  // Free users see basic total
  if (!isPro) {
    return (
      <Card className="premium-card">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-primary/10 p-2 ring-1 ring-primary/20">
                <Fuel className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-bold">Fuel Costs</p>
                <p className="text-[10px] text-muted-foreground">Period total</p>
              </div>
            </div>
            <p className="text-xl font-mono font-black text-foreground">
              {formatCurrency(analytics.totalFuelCost)}
            </p>
          </div>
          <div className="relative">
            <div className="grid grid-cols-2 gap-3 blur-sm select-none">
              <div className="text-center p-2 rounded-lg bg-muted/40">
                <p className="text-label">Cost/Mile</p>
                <p className="text-sm font-mono font-black mt-1">$0.58</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/40">
                <p className="text-label">% of Revenue</p>
                <p className="text-sm font-mono font-black mt-1">24%</p>
              </div>
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <Button size="sm" className="gap-1.5 rounded-xl font-bold" onClick={() => navigate('/pricing')}>
                <Crown className="h-3.5 w-3.5" /> Unlock Analytics
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Pro users see full analytics
  return (
    <Card className="premium-card">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="rounded-lg bg-primary/10 p-2 ring-1 ring-primary/20">
            <Fuel className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-bold">Fuel Analytics</p>
            <p className="text-[10px] text-muted-foreground">Pro insights</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="text-center p-2.5 rounded-xl bg-primary/10 ring-1 ring-primary/20">
            <p className="text-label">Total</p>
            <p className="text-lg font-mono font-black text-primary mt-1">{formatCurrency(analytics.totalFuelCost)}</p>
          </div>
          <div className="text-center p-2.5 rounded-xl bg-muted/40">
            <p className="text-label">Cost/Mile</p>
            <p className="text-lg font-mono font-black mt-1">${analytics.fuelCostPerMile.toFixed(2)}</p>
          </div>
          <div className="text-center p-2.5 rounded-xl bg-muted/40">
            <p className="text-label">% Revenue</p>
            <p className="text-lg font-mono font-black mt-1">{analytics.fuelPercentOfRevenue.toFixed(1)}%</p>
          </div>
        </div>

        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
          <div className="text-xs text-muted-foreground font-mono">
            <span className="font-semibold text-foreground">{analytics.totalGallons.toFixed(1)}</span> gal @ avg{' '}
            <span className="font-semibold text-foreground">${analytics.avgPricePerGallon.toFixed(3)}</span>/gal
          </div>
          {onNavigate && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs font-semibold text-primary h-7 px-2"
              onClick={() => onNavigate('fuel')}
            >
              View All →
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
