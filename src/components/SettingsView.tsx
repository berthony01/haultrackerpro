import { useState } from 'react';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings, DollarSign, Calendar, Sparkles, Crown, BarChart3, Bell, Shield, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

interface SettingsViewProps {
  onBack: () => void;
}

const proFeatures = [
  { icon: BarChart3, label: 'Advanced Analytics', desc: 'Detailed charts and trend analysis' },
  { icon: Bell, label: 'Smart Alerts', desc: 'Get notified on missing payments' },
  { icon: Shield, label: 'Priority Support', desc: 'Direct help when you need it' },
  { icon: Crown, label: 'Unlimited Exports', desc: 'PDF reports with custom branding' },
];

export function SettingsView({ onBack }: SettingsViewProps) {
  const { settings, isLoading, updateSettings } = useUserSettings();
  const { user } = useAuth();

  const [ratePerMile, setRatePerMile] = useState('');
  const [otherFees, setOtherFees] = useState('');
  const [weekStart, setWeekStart] = useState('');
  const [currency, setCurrency] = useState('');
  const [initialized, setInitialized] = useState(false);

  // Sync from loaded settings once
  if (settings && !initialized) {
    setRatePerMile(settings.default_rate_per_mile?.toString() ?? '');
    setOtherFees(settings.default_other_fees?.toString() ?? '');
    setWeekStart(settings.week_start_day ?? 'sunday');
    setCurrency(settings.currency ?? 'USD');
    setInitialized(true);
  }

  const handleSave = () => {
    updateSettings.mutate({
      default_rate_per_mile: ratePerMile ? Number(ratePerMile) : null,
      default_other_fees: otherFees ? Number(otherFees) : null,
      week_start_day: weekStart,
      currency,
    }, {
      onSuccess: () => toast.success('Settings saved!'),
      onError: (e) => toast.error(e.message),
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-black font-heading">Settings</h1>
          <p className="text-sm text-muted-foreground">Customize your experience</p>
        </div>
      </div>

      {/* Account info */}
      <Card className="shadow-card">
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold mb-2">Account</p>
          <p className="text-sm font-medium truncate">{user?.email}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary uppercase tracking-wider">
              Free Plan
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Defaults */}
      <Card className="shadow-card">
        <CardContent className="p-4 space-y-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Defaults</p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Default Rate/Mile</Label>
              <div className="relative">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={ratePerMile}
                  onChange={e => setRatePerMile(e.target.value)}
                  className="h-10 pl-8 text-sm rounded-xl"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Default Other Fees</Label>
              <div className="relative">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={otherFees}
                  onChange={e => setOtherFees(e.target.value)}
                  className="h-10 pl-8 text-sm rounded-xl"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Week Starts On</Label>
              <Select value={weekStart} onValueChange={setWeekStart}>
                <SelectTrigger className="h-10 text-sm rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sunday">Sunday</SelectItem>
                  <SelectItem value="monday">Monday</SelectItem>
                  <SelectItem value="saturday">Saturday</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="h-10 text-sm rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD ($)</SelectItem>
                  <SelectItem value="CAD">CAD (C$)</SelectItem>
                  <SelectItem value="EUR">EUR (€)</SelectItem>
                  <SelectItem value="GBP">GBP (£)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            className="w-full h-11 rounded-xl font-bold active:scale-[0.98] transition-transform"
            onClick={handleSave}
            disabled={updateSettings.isPending || isLoading}
          >
            {updateSettings.isPending ? 'Saving...' : 'Save Settings'}
          </Button>
        </CardContent>
      </Card>

      {/* Pro Features Coming Soon */}
      <Card className="shadow-card border-primary/20 overflow-hidden">
        <div className="bg-gradient-to-r from-primary/10 to-warning/10 px-4 py-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <p className="text-xs font-bold uppercase tracking-wider text-primary">Pro Features Coming Soon</p>
        </div>
        <CardContent className="p-4 space-y-3">
          {proFeatures.map((f, i) => (
            <div key={i} className="flex items-center gap-3 opacity-70">
              <div className="rounded-xl bg-muted p-2.5 shrink-0">
                <f.icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold">{f.label}</p>
                <p className="text-xs text-muted-foreground">{f.desc}</p>
              </div>
            </div>
          ))}
          <div className="pt-2">
            <Button variant="outline" className="w-full h-11 rounded-xl font-bold gap-2" disabled>
              <Crown className="h-4 w-4" /> Upgrade to Pro — Coming Soon
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
