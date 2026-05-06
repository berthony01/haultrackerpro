import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calculator, AlertTriangle, Crown, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import type { UserSettings, UserSettingsUpdate } from '@/hooks/useUserSettings';

interface TaxPlannerSettingsProps {
  settings: UserSettings | null;
  onSave: (updates: UserSettingsUpdate) => void;
  isPending: boolean;
  isPro?: boolean;
}

export function TaxPlannerSettings({ settings, onSave, isPending, isPro = false }: TaxPlannerSettingsProps) {
  const navigate = useNavigate();
  const [enabled, setEnabled] = useState(settings?.tax_estimator_enabled ?? false);
  const [federal, setFederal] = useState(settings?.federal_tax_percent?.toString() ?? '');
  const [state, setState] = useState(settings?.state_tax_percent?.toString() ?? '');
  const [includeSe, setIncludeSe] = useState(settings?.include_se_tax ?? false);
  const [sePercent, setSePercent] = useState(settings?.se_tax_percent?.toString() ?? '15.3');
  const [buffer, setBuffer] = useState(settings?.buffer_percent?.toString() ?? '');
  const [baseType, setBaseType] = useState(settings?.tax_base_type ?? 'net');
  const [initialized, setInitialized] = useState(false);

  // Sync once when settings load
  if (settings && !initialized) {
    setEnabled(settings.tax_estimator_enabled ?? false);
    setFederal(settings.federal_tax_percent?.toString() ?? '');
    setState(settings.state_tax_percent?.toString() ?? '');
    setIncludeSe(settings.include_se_tax ?? false);
    setSePercent(settings.se_tax_percent?.toString() ?? '15.3');
    setBuffer(settings.buffer_percent?.toString() ?? '');
    setBaseType(settings.tax_base_type ?? 'net');
    setInitialized(true);
  }

  const handleSave = () => {
    const f = Number(federal);
    const s = Number(state);
    const se = Number(sePercent);
    const b = Number(buffer);

    if (federal && (f < 0 || f > 50)) {
      toast.error('Federal % must be 0–50');
      return;
    }
    if (state && (s < 0 || s > 20)) {
      toast.error('State % must be 0–20');
      return;
    }
    if (includeSe && sePercent && (se < 0 || se > 20)) {
      toast.error('SE tax % must be 0–20');
      return;
    }
    if (buffer && (b < 0 || b > 20)) {
      toast.error('Buffer % must be 0–20');
      return;
    }

    onSave({
      tax_estimator_enabled: enabled,
      federal_tax_percent: federal ? f : null,
      state_tax_percent: state ? s : null,
      include_se_tax: includeSe,
      se_tax_percent: includeSe && sePercent ? se : null,
      buffer_percent: buffer ? b : null,
      tax_base_type: baseType,
    });
  };

  return (
    <div className="premium-card p-4 space-y-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold flex items-center gap-1.5">
          <Calculator className="h-3.5 w-3.5" /> Tax Set-Aside Planner (Optional)
        </p>

        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">Enable Tax Set-Aside Estimate</Label>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        {enabled && (
          <div className="space-y-4 animate-fade-in">
            {/* Federal & State — visible to all */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Federal Set-Aside (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="50"
                  placeholder="12"
                  value={federal}
                  onChange={e => setFederal(e.target.value)}
                  className="h-10 text-sm rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">State Set-Aside (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="20"
                  placeholder="5"
                  value={state}
                  onChange={e => setState(e.target.value)}
                  className="h-10 text-sm rounded-xl"
                />
              </div>
            </div>

            {isPro ? (
              <>
                {/* SE Tax — Pro only */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold">Include Self-Employment Tax</Label>
                    <Switch checked={includeSe} onCheckedChange={setIncludeSe} />
                  </div>
                  {includeSe && (
                    <div className="space-y-1.5 animate-fade-in">
                      <Label className="text-xs font-semibold">SE Tax Rate (%)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        min="0"
                        max="20"
                        placeholder="15.3"
                        value={sePercent}
                        onChange={e => setSePercent(e.target.value)}
                        className="h-10 text-sm rounded-xl"
                      />
                    </div>
                  )}
                </div>

                {/* Buffer — Pro only */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Extra Buffer (%)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    max="20"
                    placeholder="2"
                    value={buffer}
                    onChange={e => setBuffer(e.target.value)}
                    className="h-10 text-sm rounded-xl"
                  />
                  <p className="text-[10px] text-muted-foreground">Safety cushion added to estimate</p>
                </div>

                {/* Calculation Base — Pro only */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Calculation Base</Label>
                  <Select value={baseType} onValueChange={setBaseType}>
                    <SelectTrigger className="h-10 text-sm rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="net">Net Profit</SelectItem>
                      <SelectItem value="gross">Gross Income</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              /* Locked overlay for free users */
              <div className="relative rounded-xl border border-primary/20 bg-muted/30 p-4 text-center space-y-2">
                <Lock className="h-5 w-5 text-muted-foreground mx-auto" />
                <p className="text-sm font-semibold">Unlock full tax planning & quarterly breakdown with Pro.</p>
                <p className="text-xs text-muted-foreground">SE tax, buffer, calculation base, and quarterly reminders.</p>
                <Button size="sm" className="rounded-xl font-bold gap-1.5 mt-1" onClick={() => navigate('/pricing')}>
                  <Crown className="h-3.5 w-3.5" /> Upgrade to Pro
                </Button>
              </div>
            )}

            <Button
              className="w-full h-11 rounded-xl font-bold active:scale-[0.98] transition-transform"
              onClick={handleSave}
              disabled={isPending}
            >
              {isPending ? 'Saving...' : 'Save Tax Settings'}
            </Button>

            <div className="flex items-start gap-2 rounded-xl bg-muted/50 p-3">
              <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                This is a savings estimate for planning purposes only. Actual taxes depend on deductions, filing status, and other factors. Consider consulting a tax professional.
              </p>
            </div>
          </div>
        )}
      </div>
  );
}
