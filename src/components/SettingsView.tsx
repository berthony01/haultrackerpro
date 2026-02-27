import { useState } from 'react';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings, DollarSign, Calendar, Sparkles, Crown, Lock, ArrowLeft, Shield, Trash2, Download, MessageSquare, Bug, HelpCircle, Mail, FileText, ExternalLink, CheckCircle, Building2, Percent } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { DeleteAccountModal } from '@/components/DeleteAccountModal';
import { SendFeedbackModal } from '@/components/SendFeedbackModal';
import { supabase } from '@/integrations/supabase/client';

interface SettingsViewProps {
  onBack: () => void;
}

const proFeatures = [
  { label: 'Tax Mode', desc: 'Quarterly estimates, deductions summary, mileage reports' },
  { label: 'Receipt Vault', desc: 'Upload receipts, auto-categorize, attach to loads/expenses' },
  { label: 'Smart Alerts 2.0', desc: 'Late pay reminders, low rate warnings, high deadhead warnings' },
  { label: 'Lane Intelligence', desc: 'Best-paying lanes, avg $/mile by lane, seasonal trends' },
  { label: 'Driver Scorecard', desc: 'Weekly performance grade, profit per mile, deadhead targets' },
  { label: 'Advanced Exports', desc: 'Branded PDF, dispute packet, custom fields' },
  { label: 'Integrations', desc: 'QuickBooks export, fuel card CSV import' },
  { label: 'Multi-Truck / Team Mode', desc: 'Track multiple trucks/drivers under one account' },
];

const freePlanIncludes = [
  'Unlimited loads',
  'Unlimited expenses',
  'Standard exports',
  'Weekly summaries',
];

export function SettingsView({ onBack }: SettingsViewProps) {
  const { settings, isLoading, updateSettings } = useUserSettings();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [ratePerMile, setRatePerMile] = useState('');
  const [otherFees, setOtherFees] = useState('');
  const [weekStart, setWeekStart] = useState('');
  const [currency, setCurrency] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [payType, setPayType] = useState('cpm');
  const [payPercentage, setPayPercentage] = useState('');
  const [companyStartDate, setCompanyStartDate] = useState<Date | undefined>(undefined);
  const [initialized, setInitialized] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Sync from loaded settings once
  if (settings && !initialized) {
    setRatePerMile(settings.default_rate_per_mile?.toString() ?? '');
    setOtherFees(settings.default_other_fees?.toString() ?? '');
    setWeekStart(settings.week_start_day ?? 'sunday');
    setCurrency(settings.currency ?? 'USD');
    setCompanyName(settings.company_name ?? '');
    setPayType(settings.pay_type ?? 'cpm');
    setPayPercentage(settings.pay_percentage?.toString() ?? '');
    setCompanyStartDate(settings.company_start_date ? parseISO(settings.company_start_date) : undefined);
    setInitialized(true);
  }

  const handleSave = () => {
    if (payType === 'percentage' && payPercentage) {
      const pct = Number(payPercentage);
      if (pct < 0 || pct > 100) {
        toast.error('Pay percentage must be between 0 and 100');
        return;
      }
    }
    updateSettings.mutate({
      default_rate_per_mile: ratePerMile ? Number(ratePerMile) : null,
      default_other_fees: otherFees ? Number(otherFees) : null,
      week_start_day: weekStart,
      currency,
      company_name: companyName.trim() || null,
      pay_type: payType,
      pay_percentage: payType === 'percentage' && payPercentage ? Number(payPercentage) : null,
      company_start_date: companyStartDate ? format(companyStartDate, 'yyyy-MM-dd') : null,
    }, {
      onSuccess: () => toast.success('Settings saved!'),
      onError: (e) => toast.error(e.message),
    });
  };

  const handleExportData = async () => {
    if (!user) return;
    setExporting(true);
    try {
      const [loads, expenses, stops, snapshots, feedback, profile] = await Promise.all([
        supabase.from('loads').select('*').eq('user_id', user.id),
        supabase.from('expenses').select('*').eq('user_id', user.id),
        supabase.from('load_stops').select('*').eq('user_id', user.id),
        supabase.from('weekly_snapshots').select('*').eq('user_id', user.id),
        supabase.from('feedback_responses').select('*').eq('user_id', user.id),
        supabase.from('profiles').select('*').eq('user_id', user.id).single(),
      ]);

      const exportData = {
        exported_at: new Date().toISOString(),
        profile: profile.data,
        loads: loads.data ?? [],
        expenses: expenses.data ?? [],
        load_stops: stops.data ?? [],
        weekly_snapshots: snapshots.data ?? [],
        feedback_responses: feedback.data ?? [],
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().split('T')[0];
      a.href = url;
      a.download = `haultrackerpro_full_export_${dateStr}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Data exported successfully!');
    } catch (err: any) {
      toast.error(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
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
        <CardContent className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Account</p>
          <div className="flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 text-muted-foreground/50" />
            <p className="text-sm font-medium truncate">{user?.email}</p>
          </div>
          <p className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
            <Shield className="h-3 w-3" /> Encrypted in transit
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary uppercase tracking-wider">
              Free Plan
            </span>
          </div>
          <div className="pt-2 space-y-1">
            <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Free Plan Includes:</p>
            {freePlanIncludes.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <CheckCircle className="h-3 w-3 text-success" />
                <p className="text-xs text-muted-foreground">{item}</p>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground/60 pt-1">
              Pro will unlock advanced analytics, tax tools, and integrations.
            </p>
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
                <Input type="number" step="0.01" placeholder="0.00" value={ratePerMile} onChange={e => setRatePerMile(e.target.value)} className="h-10 pl-8 text-sm rounded-xl" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Default Other Fees</Label>
              <div className="relative">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input type="number" step="0.01" placeholder="0.00" value={otherFees} onChange={e => setOtherFees(e.target.value)} className="h-10 pl-8 text-sm rounded-xl" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Week Starts On</Label>
              <Select value={weekStart} onValueChange={setWeekStart}>
                <SelectTrigger className="h-10 text-sm rounded-xl"><SelectValue /></SelectTrigger>
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
                <SelectTrigger className="h-10 text-sm rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD ($)</SelectItem>
                  <SelectItem value="CAD">CAD (C$)</SelectItem>
                  <SelectItem value="EUR">EUR (€)</SelectItem>
                  <SelectItem value="GBP">GBP (£)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button className="w-full h-11 rounded-xl font-bold active:scale-[0.98] transition-transform" onClick={handleSave} disabled={updateSettings.isPending || isLoading}>
            {updateSettings.isPending ? 'Saving...' : 'Save Settings'}
          </Button>
        </CardContent>
      </Card>

      {/* Company & Pay */}
      <Card className="shadow-card">
        <CardContent className="p-4 space-y-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5" /> Company & Pay
          </p>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Company Name</Label>
            <Input placeholder="Example: ABC Logistics" value={companyName} onChange={e => setCompanyName(e.target.value)} className="h-10 text-sm rounded-xl" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Pay Type</Label>
              <Select value={payType} onValueChange={setPayType}>
                <SelectTrigger className="h-10 text-sm rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cpm">Rate per Mile (CPM)</SelectItem>
                  <SelectItem value="percentage">Percentage (%)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {payType === 'percentage' && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Driver Pay Percentage (%)</Label>
                <div className="relative">
                  <Percent className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input type="number" step="1" min="0" max="100" placeholder="e.g. 30" value={payPercentage} onChange={e => setPayPercentage(e.target.value)} className="h-10 pl-8 text-sm rounded-xl" />
                </div>
                <p className="text-[10px] text-muted-foreground">Example: 30 for 30%</p>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Company Start Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("w-full h-10 justify-start text-left font-normal rounded-xl text-sm", !companyStartDate && "text-muted-foreground")}>
                  <Calendar className="mr-2 h-4 w-4" />
                  {companyStartDate ? format(companyStartDate, 'PPP') : 'Optional'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarComponent mode="single" selected={companyStartDate} onSelect={setCompanyStartDate} initialFocus className={cn("p-3 pointer-events-auto")} />
              </PopoverContent>
            </Popover>
          </div>

          <Button className="w-full h-11 rounded-xl font-bold active:scale-[0.98] transition-transform" onClick={handleSave} disabled={updateSettings.isPending || isLoading}>
            {updateSettings.isPending ? 'Saving...' : 'Save Settings'}
          </Button>
        </CardContent>
      </Card>

      {/* Data Management */}
      <Card className="shadow-card">
        <CardContent className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Data</p>
          <Button variant="outline" className="w-full h-11 rounded-xl font-bold gap-2" onClick={handleExportData} disabled={exporting}>
            <Download className="h-4 w-4" />
            {exporting ? 'Exporting...' : 'Export All My Data'}
          </Button>
          <Button variant="outline" className="w-full h-11 rounded-xl font-bold gap-2 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => setShowDeleteModal(true)}>
            <Trash2 className="h-4 w-4" />
            Delete Account
          </Button>
        </CardContent>
      </Card>

      {/* Support */}
      <Card className="shadow-card">
        <CardContent className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Support</p>
          <Button variant="outline" className="w-full h-11 rounded-xl font-bold gap-2 justify-start" onClick={() => setShowFeedbackModal(true)}>
            <MessageSquare className="h-4 w-4 text-primary" /> Send Feedback
          </Button>
          <Button variant="outline" className="w-full h-11 rounded-xl font-bold gap-2 justify-start" onClick={() => setShowFeedbackModal(true)}>
            <Bug className="h-4 w-4 text-destructive" /> Report a Bug
          </Button>
          <Button variant="outline" className="w-full h-11 rounded-xl font-bold gap-2 justify-start" onClick={() => navigate('/faq')}>
            <HelpCircle className="h-4 w-4 text-warning" /> FAQ
          </Button>
          <div className="flex items-center gap-2 pt-1">
            <Mail className="h-3.5 w-3.5 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">support@haultrackerpro.app</p>
          </div>
        </CardContent>
      </Card>

      {/* Legal */}
      <Card className="shadow-card">
        <CardContent className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Legal</p>
          <Button variant="ghost" className="w-full h-10 rounded-xl font-semibold gap-2 justify-between text-sm" onClick={() => navigate('/terms')}>
            <span className="flex items-center gap-2"><FileText className="h-4 w-4" /> Terms of Service</span>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/50" />
          </Button>
          <Button variant="ghost" className="w-full h-10 rounded-xl font-semibold gap-2 justify-between text-sm" onClick={() => navigate('/privacy')}>
            <span className="flex items-center gap-2"><Shield className="h-4 w-4" /> Privacy Policy</span>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/50" />
          </Button>
          <p className="text-[10px] text-muted-foreground/50 pt-1">
            HaulTrackerPro provides tracking tools only. Always verify financial and tax information with qualified professionals.
          </p>
        </CardContent>
      </Card>

      {/* Pro Features Coming Soon */}
      <Card className="shadow-card border-primary/20 overflow-hidden">
        <div className="bg-gradient-to-r from-primary/10 to-warning/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <p className="text-xs font-bold uppercase tracking-wider text-primary">Pro Features Coming Soon</p>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            We're building Pro in public. These features are planned and will roll out in phases.
          </p>
        </div>
        <CardContent className="p-4 space-y-2">
          {proFeatures.map((f, i) => (
            <div key={i} className="flex items-start gap-3 rounded-xl bg-muted/50 px-3 py-2.5">
              <div className="rounded-lg bg-muted p-1.5 shrink-0 mt-0.5">
                <Lock className="h-3.5 w-3.5 text-muted-foreground/60" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{f.label}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
          <div className="pt-2">
            <Button variant="outline" className="w-full h-11 rounded-xl font-bold gap-2 opacity-60 cursor-not-allowed" disabled>
              <Crown className="h-4 w-4" /> Upgrade to Pro — Coming Soon
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Modals */}
      <DeleteAccountModal open={showDeleteModal} onOpenChange={setShowDeleteModal} />
      <SendFeedbackModal open={showFeedbackModal} onOpenChange={setShowFeedbackModal} />
    </div>
  );
}
