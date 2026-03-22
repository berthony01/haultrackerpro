import { useState, useMemo, useEffect } from 'react';
import SEOHead from '@/components/SEOHead';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Fuel, DollarSign, Truck, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '@/lib/loadUtils';
import { trackCalculatorUsed } from '@/lib/analytics';

export default function FuelCostPerMileCalculator() {
  const navigate = useNavigate();
  const [fuelPrice, setFuelPrice] = useState('');
  const [mpg, setMpg] = useState('');
  const [miles, setMiles] = useState('');

  const results = useMemo(() => {
    const fp = parseFloat(fuelPrice) || 0;
    const mpgVal = parseFloat(mpg) || 1;
    const m = parseFloat(miles) || 0;

    const costPerMile = fp / mpgVal;
    const totalCost = costPerMile * m;

    return { costPerMile, totalCost };
  }, [fuelPrice, mpg, miles]);

  const hasInput = parseFloat(fuelPrice) > 0 && parseFloat(mpg) > 0;

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Fuel Cost Per Mile Calculator for Truckers | HaulTrackerPro"
        description="Calculate your fuel cost per mile and per load. Free trucking fuel cost calculator for owner operators."
        path="/tools/fuel-cost-per-mile"
      />

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center rounded-2xl bg-warning/10 p-4 mb-2">
            <Fuel className="h-8 w-8 text-warning" />
          </div>
          <h1 className="text-3xl font-black font-heading">Fuel Cost Per Mile Calculator</h1>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Quickly calculate your fuel cost per mile and per load based on current fuel prices and your truck's MPG.
          </p>
        </div>

        <Card className="shadow-card">
          <CardContent className="p-5 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1"><Fuel className="h-3 w-3" /> Fuel Price Per Gallon</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input type="number" step="0.01" placeholder="3.50" value={fuelPrice} onChange={e => setFuelPrice(e.target.value)} className="h-12 pl-9 rounded-xl text-lg" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Truck MPG</Label>
              <Input type="number" step="0.1" placeholder="6.5" value={mpg} onChange={e => setMpg(e.target.value)} className="h-12 rounded-xl text-lg" />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Miles Per Load (optional)</Label>
              <Input type="number" placeholder="500" value={miles} onChange={e => setMiles(e.target.value)} className="h-12 rounded-xl text-lg" />
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        {hasInput && (
          <Card className="shadow-card border-primary/20">
            <CardContent className="p-5 space-y-4">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Results</p>

              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-4 rounded-xl bg-primary/5 border border-primary/10">
                  <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Fuel Cost/Mile</p>
                  <p className="text-2xl font-black font-mono text-primary mt-1">${results.costPerMile.toFixed(3)}</p>
                </div>
                {parseFloat(miles) > 0 && (
                  <div className="text-center p-4 rounded-xl bg-warning/5 border border-warning/10">
                    <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Fuel Cost/Load</p>
                    <p className="text-2xl font-black font-mono text-warning mt-1">{formatCurrency(results.totalCost)}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* CTA */}
        <Card className="shadow-card bg-warning/5 border-warning/20">
          <CardContent className="p-5 text-center space-y-3">
            <Truck className="h-8 w-8 text-warning mx-auto" />
            <p className="font-bold text-lg">Track fuel automatically</p>
            <p className="text-sm text-muted-foreground">
              Log fuel purchases, track cost per mile trends, and see how fuel impacts your profit inside HaulTrackerPro.
            </p>
            <Button className="gap-2 rounded-xl font-bold" onClick={() => navigate('/auth')}>
              Get Started Free <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
