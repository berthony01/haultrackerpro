import { useEffect, useState } from 'react';
import { useCostProfile, CostProfileUpdate, computeCostProfileCPM, CPM_BREAKDOWN_LABELS } from '@/hooks/useCostProfile';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Calculator, ChevronDown, Fuel, Wrench, Building2, Target, Info, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/loadUtils';

type FormState = Record<string, string>;

const FIELDS = [
  // fixed
  'truck_payment', 'trailer_payment', 'insurance_monthly',
  'permits_licensing_monthly', 'eld_software_monthly', 'other_fixed_monthly',
  // variable
  'avg_mpg', 'diesel_price_per_gallon',
  'maintenance_per_mile', 'tires_per_mile', 'tolls_per_mile',
  // per-day
  'meals_per_day', 'lodging_per_day',
  // targets
  'min_margin_pct', 'min_rpm', 'days_per_1000_miles', 'estimated_monthly_miles',
] as const;

function toFormState(profile: any): FormState {
  const s: FormState = {};
  for (const f of FIELDS) s[f] = profile?.[f] != null ? String(profile[f]) : '';
  return s;
}

function toUpdate(form: FormState): CostProfileUpdate {
  const u: any = {};
  for (const f of FIELDS) {
    const raw = form[f].trim();
    u[f] = raw === '' ? null : Number(raw);
  }
  return u;
}

export function CostProfileSettings() {
  const { profile, isLoading, upsertProfile, hasUsableData } = useCostProfile();
  const [form, setForm] = useState<FormState>(() => toFormState(profile));
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!isLoading && !initialized) {
      setForm(toFormState(profile));
      setInitialized(true);
    }
  }, [profile, isLoading, initialized]);

  const set = (k: string, v: string) =>
    setForm((s) => ({ ...s, [k]: v.replace(/[^0-9.]/g, '') }));

  const handleSave = () => {
    upsertProfile.mutate(toUpdate(form), {
      onSuccess: () => toast.success('Cost profile saved'),
      onError: (e: any) => toast.error(e.message ?? 'Failed to save'),
    });
  };

  // Live preview using a 500-mile sample load
  const sampleMiles = 500;
  const previewProfile: any = {};
  for (const f of FIELDS) previewProfile[f] = form[f] === '' ? null : Number(form[f]);
  const { cpm, breakdown, warnings } = computeCostProfileCPM(previewProfile, sampleMiles);
  const fixedMissingMiles = warnings.includes('fixed_missing_monthly_miles');

  // Inputs that look like per-mile entries instead of monthly bills
  const FIXED_KEYS = ['truck_payment', 'trailer_payment', 'insurance_monthly', 'permits_licensing_monthly', 'eld_software_monthly', 'other_fixed_monthly'] as const;
  const lowMonthlyHint = (key: string): boolean => {
    const v = Number(form[key]);
    return Number.isFinite(v) && v > 0 && v < 20;
  };

  return (
    <div className="premium-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-primary" />
          <h3 className="text-base font-bold">My Cost Profile</h3>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Tell us your real operating costs. The Profit Check uses these numbers to tell you if a load is profitable
          <span className="font-bold text-foreground"> before you accept it</span> — even on day one.
        </p>

        {/* Live CPM preview */}
        {cpm > 0 && (
          <div className="rounded-xl bg-primary/5 border border-primary/15 p-3 flex items-start gap-2">
            <Info className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Estimated cost per mile</p>
              <p className="text-lg font-mono font-black text-primary">{formatCurrency(cpm)}/mi</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {Object.entries(breakdown)
                  .map(([k, v]) => `${CPM_BREAKDOWN_LABELS[k as keyof typeof CPM_BREAKDOWN_LABELS] ?? k}: ${formatCurrency(v)}`)
                  .join(' · ')}
              </p>
            </div>
          </div>
        )}

        {fixedMissingMiles && (
          <div className="rounded-xl bg-warning/10 border border-warning/30 p-3 flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
            <div className="flex-1 text-xs leading-relaxed">
              <p className="font-bold text-warning">Your fixed monthly costs aren't being applied.</p>
              <p className="text-muted-foreground mt-0.5">
                Enter your <span className="font-semibold text-foreground">Estimated monthly miles</span> below so we can spread truck, trailer, insurance, etc. across each trip.
              </p>
            </div>
          </div>
        )}

        {/* Fuel */}
        <Collapsible defaultOpen>
          <CollapsibleTrigger className="w-full flex items-center justify-between py-2 text-left">
            <span className="flex items-center gap-2 text-sm font-bold">
              <Fuel className="h-3.5 w-3.5 text-primary" /> Fuel
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold">Average MPG</Label>
                <Input inputMode="decimal" placeholder="6.5" value={form.avg_mpg} onChange={(e) => set('avg_mpg', e.target.value)} />
              </div>
              <div>
                <Label className="text-xs font-semibold">Diesel $/gal</Label>
                <Input inputMode="decimal" placeholder="3.80" value={form.diesel_price_per_gallon} onChange={(e) => set('diesel_price_per_gallon', e.target.value)} />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Variable per-mile */}
        <Collapsible>
          <CollapsibleTrigger className="w-full flex items-center justify-between py-2 text-left">
            <span className="flex items-center gap-2 text-sm font-bold">
              <Wrench className="h-3.5 w-3.5 text-primary" /> Variable costs (per mile)
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold">Maintenance $/mi</Label>
                <Input inputMode="decimal" placeholder="0.10" value={form.maintenance_per_mile} onChange={(e) => set('maintenance_per_mile', e.target.value)} />
              </div>
              <div>
                <Label className="text-xs font-semibold">Tires $/mi</Label>
                <Input inputMode="decimal" placeholder="0.03" value={form.tires_per_mile} onChange={(e) => set('tires_per_mile', e.target.value)} />
              </div>
              <div>
                <Label className="text-xs font-semibold">Tolls $/mi</Label>
                <Input inputMode="decimal" placeholder="0.02" value={form.tolls_per_mile} onChange={(e) => set('tolls_per_mile', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold">Meals $/day</Label>
                <Input inputMode="decimal" placeholder="50" value={form.meals_per_day} onChange={(e) => set('meals_per_day', e.target.value)} />
              </div>
              <div>
                <Label className="text-xs font-semibold">Lodging $/day</Label>
                <Input inputMode="decimal" placeholder="0" value={form.lodging_per_day} onChange={(e) => set('lodging_per_day', e.target.value)} />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Fixed monthly */}
        <Collapsible>
          <CollapsibleTrigger className="w-full flex items-center justify-between py-2 text-left">
            <span className="flex items-center gap-2 text-sm font-bold">
              <Building2 className="h-3.5 w-3.5 text-primary" /> Fixed monthly costs
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold">Truck payment</Label>
                <Input inputMode="decimal" placeholder="1800" value={form.truck_payment} onChange={(e) => set('truck_payment', e.target.value)} />
              </div>
              <div>
                <Label className="text-xs font-semibold">Trailer payment</Label>
                <Input inputMode="decimal" placeholder="0" value={form.trailer_payment} onChange={(e) => set('trailer_payment', e.target.value)} />
              </div>
              <div>
                <Label className="text-xs font-semibold">Insurance</Label>
                <Input inputMode="decimal" placeholder="600" value={form.insurance_monthly} onChange={(e) => set('insurance_monthly', e.target.value)} />
              </div>
              <div>
                <Label className="text-xs font-semibold">Permits/licensing</Label>
                <Input inputMode="decimal" placeholder="100" value={form.permits_licensing_monthly} onChange={(e) => set('permits_licensing_monthly', e.target.value)} />
              </div>
              <div>
                <Label className="text-xs font-semibold">ELD/software/phone</Label>
                <Input inputMode="decimal" placeholder="80" value={form.eld_software_monthly} onChange={(e) => set('eld_software_monthly', e.target.value)} />
              </div>
              <div>
                <Label className="text-xs font-semibold">Other fixed</Label>
                <Input inputMode="decimal" placeholder="0" value={form.other_fixed_monthly} onChange={(e) => set('other_fixed_monthly', e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs font-semibold">Estimated monthly miles</Label>
              <Input inputMode="decimal" placeholder="10000" value={form.estimated_monthly_miles} onChange={(e) => set('estimated_monthly_miles', e.target.value)} />
              <p className="text-[10px] text-muted-foreground mt-1">Used to spread fixed costs across miles you actually drive.</p>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Targets */}
        <Collapsible>
          <CollapsibleTrigger className="w-full flex items-center justify-between py-2 text-left">
            <span className="flex items-center gap-2 text-sm font-bold">
              <Target className="h-3.5 w-3.5 text-primary" /> My targets
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold">Min profit margin %</Label>
                <Input inputMode="decimal" placeholder="20" value={form.min_margin_pct} onChange={(e) => set('min_margin_pct', e.target.value)} />
              </div>
              <div>
                <Label className="text-xs font-semibold">Min $/mile</Label>
                <Input inputMode="decimal" placeholder="2.00" value={form.min_rpm} onChange={(e) => set('min_rpm', e.target.value)} />
              </div>
              <div>
                <Label className="text-xs font-semibold">Days per 1,000 mi</Label>
                <Input inputMode="decimal" placeholder="2.5" value={form.days_per_1000_miles} onChange={(e) => set('days_per_1000_miles', e.target.value)} />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Loads below your minimum margin or $/mile will show a clear warning before you accept.
            </p>
          </CollapsibleContent>
        </Collapsible>

        <Button
          className="w-full h-11 rounded-xl font-bold active:scale-[0.98] transition-transform"
          onClick={handleSave}
          disabled={upsertProfile.isPending}
        >
          {upsertProfile.isPending ? 'Saving...' : hasUsableData ? 'Update Cost Profile' : 'Save Cost Profile'}
        </Button>
      </div>
  );
}
