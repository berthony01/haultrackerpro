import { useState, useEffect, useRef } from 'react';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings, DollarSign, Calendar, Sparkles, Crown, Lock, ArrowLeft, Shield, Trash2, Download, MessageSquare, Bug, HelpCircle, Mail, FileText, ExternalLink, CheckCircle, Building2, Percent, CreditCard, AlertTriangle, BookOpen, BellOff, User, Bell, Database, LifeBuoy, Calculator, FileSpreadsheet, Users } from 'lucide-react';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { AssistantsPanel } from '@/components/assistants/AssistantsPanel';
import { DriverAssistantActivityLog } from '@/components/assistants/DriverAssistantActivityLog';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { DeleteAccountModal } from '@/components/DeleteAccountModal';
import { SendFeedbackModal } from '@/components/SendFeedbackModal';
import { TaxPlannerSettings } from '@/components/TaxPlannerSettings';
import { CostProfileSettings } from '@/components/CostProfileSettings';
import { NotificationPreferencesPanel } from '@/components/notifications/NotificationPreferencesPanel';
import { QuarterlyReminderSettings } from '@/components/QuarterlyReminderSettings';
import { CSVImport } from '@/components/CSVImport';
import { PublicProfileSection } from '@/components/PublicProfileSection';
import { TelegramConnectionSection } from '@/components/TelegramConnectionSection';

import { supabase } from '@/integrations/supabase/client';
import { useAdmin } from '@/hooks/useAdmin';
import { PAY_MODEL_VALUES, PAY_MODEL_LABELS, PAY_MODEL_DESCRIPTIONS, PayModel } from '@/lib/payModels';

interface SettingsViewProps {
  onBack: () => void;
}

const proFeatures = [
  { label: 'Smart Alerts 2.0', desc: 'Advanced alerts: profit drops, RPM dips, high expense ratio warnings' },
  { label: 'Driver Scorecard', desc: 'Performance grade across RPM, deadhead, expenses, profit trend & streak' },
  { label: 'Weekly Closeout', desc: 'Finalize weekly summaries with pay variance and deadhead tracking' },
  { label: 'Advanced Exports', desc: 'PDF exports and profit reports with expense breakdowns' },
  { label: 'Unlimited Paste Load Parser', desc: 'Unlimited auto-fill from pasted load details (free: 5/week)' },
  { label: 'Scan Rate Confirmations', desc: 'Upload rate con screenshots to auto-fill load details with OCR' },
];

const freePlanIncludes = [
  'Unlimited loads',
  'Unlimited expenses',
  'Standard exports',
  'Weekly summaries',
];

function AdminDashboardLink() {
  const { isAdmin } = useAdmin();
  const navigate = useNavigate();
  if (!isAdmin) return null;
  return (
    <Button variant="outline" className="w-full h-11 rounded-xl font-bold gap-2 justify-start" onClick={() => navigate('/admin')}>
      <Shield className="h-4 w-4 text-primary" /> Admin Dashboard
    </Button>
  );
}

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
  const [defaultDhPayStatus, setDefaultDhPayStatus] = useState<'unpaid' | 'same' | 'custom'>('unpaid');
  const [defaultDhPayRate, setDefaultDhPayRate] = useState('');
  const [defaultPayModel, setDefaultPayModel] = useState<string>('loaded_miles_only');
  const [lifecycleEmailsOptIn, setLifecycleEmailsOptIn] = useState(true);
  const [savingEmailPref, setSavingEmailPref] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const publicProfileRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll + focus Public Profile when arriving via "Customize handle" link
  useEffect(() => {
    let flag: string | null = null;
    try { flag = sessionStorage.getItem('settings.focusSection'); } catch {}
    if (flag !== 'public-profile') return;
    try { sessionStorage.removeItem('settings.focusSection'); } catch {}
    const raf = window.requestAnimationFrame(() => {
      const el = publicProfileRef.current;
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Brief highlight + focus for clear affordance
      el.classList.add('ring-2', 'ring-primary', 'rounded-xl', 'transition-shadow');
      try { el.focus({ preventScroll: true }); } catch {}
      window.setTimeout(() => {
        el.classList.remove('ring-2', 'ring-primary');
      }, 1600);
      toast.success('Customization options opened');
    });
    return () => window.cancelAnimationFrame(raf);
  }, []);
  const { isAdmin, isLoading: isAdminLoading } = useAdmin();
  const subscription = useSubscription();
  const isPro = subscription.isPro;

  // Sync from loaded settings once. Runs in an effect (NOT during render)
  // to avoid React's "setState during render" warning. Guarded by
  // `initialized` so the user's in-progress edits are never overwritten on
  // a settings refetch.
  useEffect(() => {
    if (!settings || initialized) return;
    setRatePerMile(settings.default_rate_per_mile?.toString() ?? '');
    setOtherFees(settings.default_other_fees?.toString() ?? '');
    setWeekStart(settings.week_start_day ?? 'sunday');
    setCurrency(settings.currency ?? 'USD');
    setCompanyName(settings.company_name ?? '');
    setPayType(settings.pay_type ?? 'cpm');
    setPayPercentage(settings.pay_percentage?.toString() ?? '');
    setCompanyStartDate(settings.company_start_date ? parseISO(settings.company_start_date) : undefined);
    setDefaultDhPayStatus(((settings as any).default_dh_pay_status ?? 'unpaid') as 'unpaid' | 'same' | 'custom');
    setDefaultDhPayRate((settings as any).default_dh_pay_rate?.toString() ?? '');
    setDefaultPayModel(((settings as any).default_pay_model as string) ?? 'loaded_miles_only');
    setLifecycleEmailsOptIn((settings as any).lifecycle_emails_opt_in ?? true);
    setInitialized(true);
  }, [settings, initialized]);

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
      default_dh_pay_status: defaultDhPayStatus,
      default_dh_pay_rate: defaultDhPayStatus === 'custom' && defaultDhPayRate ? Number(defaultDhPayRate) : null,
      default_pay_model: defaultPayModel,
    }, {
      onSuccess: () => toast.success('Settings saved!'),
      onError: (e) => toast.error(e.message),
    });
  };

  const handleExportData = async () => {
    if (!user) return;
    setExporting(true);
    try {
      // Full export: all user-owned tables. Derived tables (lane_stats,
      // broker_stats, operating_metrics) are intentionally excluded — they are
      // recomputed automatically from loads/expenses/fuel_logs and would be
      // redundant in a backup. Admin/system tables are also excluded.
      // Subscriptions exports plan/status only (no Stripe secrets are stored client-side).
      const [
        profile, settings, loads, stops, expenses, fuelLogs, brokers,
        recurring, snapshots, feedback, subscription, parseUsage,
        alerts, automationLogs, insights,
      ] = await Promise.all([
        supabase.from('profiles').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('user_settings').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('loads').select('*').eq('user_id', user.id),
        supabase.from('load_stops').select('*').eq('user_id', user.id),
        supabase.from('expenses').select('*').eq('user_id', user.id),
        supabase.from('fuel_logs').select('*').eq('user_id', user.id),
        supabase.from('brokers').select('*').eq('user_id', user.id),
        supabase.from('recurring_expense_templates').select('*').eq('user_id', user.id),
        supabase.from('weekly_snapshots').select('*').eq('user_id', user.id),
        supabase.from('feedback_responses').select('*').eq('user_id', user.id),
        supabase.from('subscriptions').select('*').eq('user_id', user.id),
        supabase.from('parse_usage').select('*').eq('user_id', user.id),
        supabase.from('user_alerts').select('*').eq('user_id', user.id),
        supabase.from('expense_automation_logs').select('*').eq('user_id', user.id),
        supabase.from('ai_insights').select('*').eq('user_id', user.id),
      ]);

      // Fail loudly if any query errored — prevents a silent partial "full" export.
      const results = {
        profile, settings, loads, stops, expenses, fuelLogs, brokers,
        recurring, snapshots, feedback, subscription, parseUsage,
        alerts, automationLogs, insights,
      };
      const failed = Object.entries(results).filter(([, r]) => r.error);
      if (failed.length > 0) {
        const names = failed.map(([k]) => k).join(', ');
        throw new Error(`Export incomplete — failed to load: ${names}`);
      }

      const exportData = {
        exported_at: new Date().toISOString(),
        export_version: 2,
        user_id: user.id,
        email: user.email,
        account: {
          profile: profile.data ?? null,
          user_settings: settings.data ?? null,
          subscription: subscription.data ?? [],
        },
        operations: {
          loads: loads.data ?? [],
          load_stops: stops.data ?? [],
          expenses: expenses.data ?? [],
          fuel_logs: fuelLogs.data ?? [],
          brokers: brokers.data ?? [],
          recurring_expense_templates: recurring.data ?? [],
        },
        history: {
          weekly_snapshots: snapshots.data ?? [],
          feedback_responses: feedback.data ?? [],
          parse_usage: parseUsage.data ?? [],
          user_alerts: alerts.data ?? [],
          expense_automation_logs: automationLogs.data ?? [],
          ai_insights: insights.data ?? [],
        },
        _excluded_derived: {
          note: 'lane_stats, broker_stats, and operating_metrics are excluded because they are auto-recomputed from loads/expenses/fuel_logs.',
        },
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

      <Accordion type="multiple" defaultValue={["account", "defaults"]} className="space-y-3">

      <AccordionItem value="account" className="border-none">
        <AccordionTrigger className="px-4 py-3 rounded-xl bg-card hover:no-underline data-[state=open]:rounded-b-none border border-border/60">
          <span className="flex items-center gap-2 text-sm font-bold"><User className="h-4 w-4 text-primary" /> Account & Plan</span>
        </AccordionTrigger>
        <AccordionContent className="pb-0 pt-3 space-y-3">

      {/* Account info */}
      <div className="premium-card p-4 space-y-3">
          <p className="text-label">Account</p>
          <div className="flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 text-muted-foreground/50" />
            <p className="text-sm font-medium truncate">{user?.email}</p>
          </div>
          <p className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
            <Shield className="h-3 w-3" /> Encrypted in transit
          </p>
          <div className="flex items-center gap-2 mt-1">
            {subscription.isLoading ? (
              <span className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Checking plan…
              </span>
            ) : (
              <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${isPro ? 'bg-warning/10 text-warning' : 'bg-primary/10 text-primary'}`}>
                {isPro ? <><Crown className="h-3 w-3" /> Pro Plan</> : 'Free Plan'}
              </span>
            )}
          </div>
          {!isPro && !subscription.isLoading && (
            <div className="pt-2 space-y-1">
              <p className="text-label">Free Plan Includes:</p>
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
          )}
          {isPro && !subscription.isLoading && (
            <div className="pt-2 space-y-1">
              <p className="text-label">Pro Plan Active</p>
              <p className="text-xs text-muted-foreground">All features unlocked including advanced alerts, scorecard, exports, and unlimited parsing.</p>
            </div>
          )}
      </div>

      {/* Public Profile (leaderboard handle) */}
      <div ref={publicProfileRef} tabIndex={-1} className="outline-none scroll-mt-20">
        <PublicProfileSection />
      </div>

      {/* Billing */}
      <div className="premium-card p-4 space-y-3">
          <p className="text-label flex items-center gap-1.5">
            <CreditCard className="h-3.5 w-3.5" /> Billing
          </p>
          {isAdmin ? (
            <p className="text-xs text-muted-foreground">Pro access granted via admin role. No billing required.</p>
          ) : isPro ? (
            <>
              <p className="text-xs text-muted-foreground">Manage your subscription, update payment method, or view invoices.</p>
              {subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd && (
                <div className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                  <p className="text-xs text-warning">
                    Your Pro access remains active until {format(parseISO(subscription.currentPeriodEnd), 'PPP')}.
                  </p>
                </div>
              )}
              {!subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd && (
                <p className="text-[10px] text-muted-foreground">
                  Renews: {format(parseISO(subscription.currentPeriodEnd), 'PPP')}
                </p>
              )}
              <Button
                variant="outline"
                className="w-full h-11 rounded-xl font-bold gap-2"
                disabled={portalLoading}
                onClick={async () => {
                  setPortalLoading(true);
                  try {
                    const { data, error } = await supabase.functions.invoke('customer-portal');
                    if (error) throw error;
                    if (data?.url) {
                      window.location.href = data.url;
                    } else {
                      throw new Error('No portal URL returned');
                    }
                  } catch (err: any) {
                    toast.error(err.message || 'Could not open billing portal');
                    setPortalLoading(false);
                  }
                }}
              >
                <CreditCard className="h-4 w-4" />
                {portalLoading ? 'Opening billing portal…' : 'Manage Subscription'}
              </Button>
            </>
          ) : !subscription.isLoading ? (
            <>
              <p className="text-xs text-muted-foreground">You're on the Free plan. Upgrade to unlock all Pro features.</p>
              <Button className="w-full h-11 rounded-xl font-bold gap-2" onClick={() => navigate('/pricing')}>
                <Crown className="h-4 w-4" /> Upgrade to Pro
              </Button>
            </>
          ) : null}
        </div>

        <TelegramConnectionSection />



        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="defaults" className="border-none">
        <AccordionTrigger className="px-4 py-3 rounded-xl bg-card hover:no-underline data-[state=open]:rounded-b-none border border-border/60">
          <span className="flex items-center gap-2 text-sm font-bold"><DollarSign className="h-4 w-4 text-primary" /> Pay & Calculation Defaults</span>
        </AccordionTrigger>
        <AccordionContent className="pb-0 pt-3 space-y-3">

      {/* Defaults */}
      <div className="premium-card p-4 space-y-4">
          <p className="text-label">Defaults</p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Default Rate/Mile</Label>
              <div className="relative">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input type="number" step="0.01" placeholder="0.00" value={ratePerMile} onChange={e => setRatePerMile(e.target.value)} className="h-10 pl-8 text-sm rounded-xl" />
              </div>
              <p className="text-[10px] text-muted-foreground leading-snug">
                This is your default <span className="font-semibold text-foreground">contract rate</span>. Effective RPM may be lower when deadhead miles are included — your contract rate doesn't change.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Default Other Fees</Label>
              <div className="relative">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input type="number" step="0.01" placeholder="0.00" value={otherFees} onChange={e => setOtherFees(e.target.value)} className="h-10 pl-8 text-sm rounded-xl" />
              </div>
            </div>
          </div>

          {/* Deadhead Pay default — applied to new loads automatically */}
          <div className="space-y-2 rounded-xl border border-border/60 p-3 bg-muted/30">
            <Label className="text-xs font-semibold">Do you get paid for Deadhead miles?</Label>
            <Select value={defaultDhPayStatus} onValueChange={(v) => setDefaultDhPayStatus(v as 'unpaid' | 'same' | 'custom')}>
              <SelectTrigger data-testid="settings-default-dh-pay-status" className="h-10 text-sm rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unpaid" data-testid="settings-dh-status-unpaid">No — deadhead is unpaid</SelectItem>
                <SelectItem value="same" data-testid="settings-dh-status-same">Yes — same rate as loaded miles</SelectItem>
                <SelectItem value="custom" data-testid="settings-dh-status-custom">Yes — custom rate per mile</SelectItem>
              </SelectContent>
            </Select>

            {defaultDhPayStatus === 'custom' && (
              <div className="relative">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 0.85"
                  value={defaultDhPayRate}
                  onChange={e => setDefaultDhPayRate(e.target.value)}
                  className="h-10 pl-8 text-sm rounded-xl"
                />
              </div>
            )}
            <p className="text-[10px] text-muted-foreground leading-snug">
              New loads use this by default. You can override per load. If deadhead is unpaid, HaulTrackerPro still includes those miles in <span className="font-semibold text-foreground">Effective RPM</span> so you can see the load's true value.
            </p>
          </div>

          {/* Default Pay Model — applied to new loads automatically */}
          <div className="space-y-2 rounded-xl border border-border/60 p-3 bg-muted/30">
            <Label className="text-xs font-semibold">Default Pay Model</Label>
            <Select value={defaultPayModel} onValueChange={setDefaultPayModel}>
              <SelectTrigger data-testid="settings-default-pay-model" className="h-10 text-sm rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAY_MODEL_VALUES.map(m => (
                  <SelectItem key={m} value={m} data-testid={`settings-pay-model-option-${m}`}>{PAY_MODEL_LABELS[m]}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <p className="text-[10px] text-muted-foreground">
              {PAY_MODEL_DESCRIPTIONS[defaultPayModel as PayModel] ?? ''} You can override per load.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Week Starts On</Label>
              <Select value={weekStart} onValueChange={setWeekStart}>
                <SelectTrigger data-testid="settings-week-start" className="h-10 text-sm rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sunday" data-testid="settings-week-start-sunday">Sunday</SelectItem>
                  <SelectItem value="monday" data-testid="settings-week-start-monday">Monday</SelectItem>
                  <SelectItem value="saturday" data-testid="settings-week-start-saturday">Saturday</SelectItem>
                </SelectContent>
              </Select>

              <p className="text-[10px] text-muted-foreground leading-snug">Controls how weekly dashboard and report totals are grouped.</p>
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

          <Button data-testid="settings-save-pay-defaults" className="w-full h-11 rounded-xl font-bold active:scale-[0.98] transition-transform" onClick={handleSave} disabled={updateSettings.isPending || isLoading}>

            {updateSettings.isPending ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>

      {/* Company & Pay */}
      <div className="premium-card p-4 space-y-4">
          <p className="text-label flex items-center gap-1.5">
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
        </div>

      {/* Cost Profile - drives Pre-Load Profit Check */}
      <CostProfileSettings />

        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="taxes" className="border-none">
        <AccordionTrigger className="px-4 py-3 rounded-xl bg-card hover:no-underline data-[state=open]:rounded-b-none border border-border/60">
          <span className="flex items-center gap-2 text-sm font-bold"><Calculator className="h-4 w-4 text-primary" /> Reports & Taxes</span>
        </AccordionTrigger>
        <AccordionContent className="pb-0 pt-3 space-y-3">

      {/* Tax Set-Aside Planner */}
      <TaxPlannerSettings
        settings={settings}
        onSave={(updates) => {
          updateSettings.mutate(updates, {
            onSuccess: () => toast.success('Tax settings saved!'),
            onError: (e) => toast.error(e.message),
          });
        }}
        isPending={updateSettings.isPending}
        isPro={isPro ?? false}
      />

      {/* Quarterly Tax Reminders */}
      <QuarterlyReminderSettings
        settings={settings}
        onSave={(updates) => {
          updateSettings.mutate(updates as any, {
            onSuccess: () => toast.success('Reminder settings saved!'),
            onError: (e) => toast.error(e.message),
          });
        }}
        isPending={updateSettings.isPending}
        isPro={isPro ?? false}
      />

        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="data" className="border-none">
        <AccordionTrigger className="px-4 py-3 rounded-xl bg-card hover:no-underline data-[state=open]:rounded-b-none border border-border/60">
          <span className="flex items-center gap-2 text-sm font-bold"><Database className="h-4 w-4 text-primary" /> Data & Import</span>
        </AccordionTrigger>
        <AccordionContent className="pb-0 pt-3 space-y-3">

      {/* CSV Import */}
      <CSVImport isPro={isPro ?? false} />

      {/* Data Management */}
      <div className="premium-card p-4 space-y-3">
          <p className="text-label">Data</p>
          <Button variant="outline" className="w-full h-11 rounded-xl font-bold gap-2" onClick={handleExportData} disabled={exporting}>
            <Download className="h-4 w-4" />
            {exporting ? 'Exporting...' : 'Export All My Data'}
          </Button>
          <Button variant="outline" className="w-full h-11 rounded-xl font-bold gap-2 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => setShowDeleteModal(true)}>
            <Trash2 className="h-4 w-4" />
            Delete Account
          </Button>
        </div>

        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="notifications" className="border-none">
        <AccordionTrigger className="px-4 py-3 rounded-xl bg-card hover:no-underline data-[state=open]:rounded-b-none border border-border/60">
          <span className="flex items-center gap-2 text-sm font-bold"><Bell className="h-4 w-4 text-primary" /> Notifications & Emails</span>
        </AccordionTrigger>
        <AccordionContent className="pb-0 pt-3 space-y-3">

      {/* Email Preferences */}
      <div className="premium-card p-4 space-y-3">
          <p className="text-label flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5" /> Email Preferences
          </p>
          <div className="flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-muted/30 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <BellOff className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-sm font-semibold">Lifecycle reminder emails</p>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                Occasional helper emails (Day 2 / Day 7) if you haven't logged a load yet. Account-critical emails like password resets and receipts are always sent.
              </p>
            </div>
            <Switch
              checked={lifecycleEmailsOptIn}
              disabled={savingEmailPref || isLoading}
              onCheckedChange={(checked) => {
                const next = checked;
                setLifecycleEmailsOptIn(next);
                setSavingEmailPref(true);
                updateSettings.mutate(
                  { lifecycle_emails_opt_in: next } as any,
                  {
                    onSuccess: () => {
                      toast.success(next ? 'Lifecycle emails turned on' : 'Lifecycle emails turned off');
                      setSavingEmailPref(false);
                    },
                    onError: (e) => {
                      setLifecycleEmailsOptIn(!next);
                      toast.error(e.message || 'Failed to update preference');
                      setSavingEmailPref(false);
                    },
                  },
                );
              }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground/60">
            You can change this anytime. Unsubscribe links in our emails will also flip this off.
          </p>
        </div>

      <NotificationPreferencesPanel />

        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="support" className="border-none">
        <AccordionTrigger className="px-4 py-3 rounded-xl bg-card hover:no-underline data-[state=open]:rounded-b-none border border-border/60">
          <span className="flex items-center gap-2 text-sm font-bold"><LifeBuoy className="h-4 w-4 text-primary" /> Support & Legal</span>
        </AccordionTrigger>
        <AccordionContent className="pb-0 pt-3 space-y-3">

      {/* Support */}
      <div className="premium-card p-4 space-y-3">
          <p className="text-label">Support</p>
          <Button variant="outline" className="w-full h-11 rounded-xl font-bold gap-2 justify-start" onClick={() => setShowFeedbackModal(true)}>
            <MessageSquare className="h-4 w-4 text-primary" /> Send Feedback
          </Button>
          <Button variant="outline" className="w-full h-11 rounded-xl font-bold gap-2 justify-start" onClick={() => setShowFeedbackModal(true)}>
            <Bug className="h-4 w-4 text-destructive" /> Report a Bug
          </Button>
          <Button variant="outline" className="w-full h-11 rounded-xl font-bold gap-2 justify-start" onClick={() => navigate('/faq')}>
            <HelpCircle className="h-4 w-4 text-warning" /> FAQ
          </Button>
          <Button variant="outline" className="w-full h-11 rounded-xl font-bold gap-2 justify-start" onClick={() => navigate('/features')}>
            <Sparkles className="h-4 w-4 text-primary" /> View All Features
          </Button>
          <Button variant="outline" className="w-full h-11 rounded-xl font-bold gap-2 justify-start" onClick={() => navigate('/how-to-use-haultrackerpro')}>
            <BookOpen className="h-4 w-4 text-primary" /> User Guide
          </Button>
          <Button variant="outline" className="w-full h-11 rounded-xl font-bold gap-2 justify-start" onClick={() => navigate('/docs')}>
            <LifeBuoy className="h-4 w-4 text-primary" /> Help Center
          </Button>
          <Button variant="outline" className="w-full h-11 rounded-xl font-bold gap-2 justify-start" onClick={() => navigate('/updates')}>
            <Sparkles className="h-4 w-4 text-primary" /> What's New
          </Button>

          <AdminDashboardLink />
          <div className="flex items-center gap-2 pt-1">
            <Mail className="h-3.5 w-3.5 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">support@haultrackerpro.app</p>
          </div>
        </div>

      {/* Legal */}
      <div className="premium-card p-4 space-y-3">
          <p className="text-label">Legal</p>
          <Button variant="ghost" className="w-full h-10 rounded-xl font-semibold gap-2 justify-between text-sm" onClick={() => navigate('/terms')}>
            <span className="flex items-center gap-2"><FileText className="h-4 w-4" /> Terms of Service</span>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/50" />
          </Button>
          <Button variant="ghost" className="w-full h-10 rounded-xl font-semibold gap-2 justify-between text-sm" onClick={() => navigate('/privacy')}>
            <span className="flex items-center gap-2"><Shield className="h-4 w-4" /> Privacy Policy</span>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/50" />
          </Button>
          <Button variant="ghost" className="w-full h-10 rounded-xl font-semibold gap-2 justify-between text-sm" onClick={() => navigate('/legal')}>
            <span className="flex items-center gap-2"><FileText className="h-4 w-4" /> Legal Center</span>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/50" />
          </Button>

          <p className="text-[10px] text-muted-foreground/50 pt-1">
            HaulTrackerPro provides tracking tools only. Always verify financial and tax information with qualified professionals.
          </p>
        </div>

        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="assistants" className="border-none">
        <AccordionTrigger className="px-4 py-3 rounded-xl bg-card hover:no-underline data-[state=open]:rounded-b-none border border-border/60">
          <span className="flex items-center gap-2 text-sm font-bold"><Users className="h-4 w-4 text-primary" /> Driver Assistants</span>
        </AccordionTrigger>
        <AccordionContent className="pb-0 pt-3">
          <div className="premium-card p-4">
            <AssistantsPanel />
          </div>
          <div className="premium-card p-4 mt-3 space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Assistant activity log</h3>
              <p className="text-xs text-muted-foreground">
                Every action your assistants take on your account is recorded here.
              </p>
            </div>
            <DriverAssistantActivityLog />
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="pro" className="border-none">
        <AccordionTrigger className="px-4 py-3 rounded-xl bg-card hover:no-underline data-[state=open]:rounded-b-none border border-border/60">
          <span className="flex items-center gap-2 text-sm font-bold"><Crown className="h-4 w-4 text-primary" /> Pro Plan Features</span>
        </AccordionTrigger>
        <AccordionContent className="pb-0 pt-3 space-y-3">

      {/* Pro Plan Features */}
      <div className="premium-card overflow-hidden">
        <div className="bg-gradient-to-r from-primary/10 to-primary/5 px-4 py-3 border-b border-border/40">
          <div className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-primary" />
            <p className="text-label text-primary">Pro Plan Features</p>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Unlock AI-powered insights for <span className="font-mono">$19.99</span>/month or <span className="font-mono">$179.88</span>/year.
          </p>
        </div>
        <div className="p-4 space-y-2">
          {proFeatures.map((f, i) => (
            <div key={i} className="flex items-start gap-3 rounded-xl bg-secondary/40 ring-1 ring-border/40 px-3 py-2.5">
              <div className="rounded-lg bg-primary/10 ring-1 ring-primary/20 p-1.5 shrink-0 mt-0.5">
                <Lock className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground">{f.label}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
          <div className="pt-2">
            <Button className="w-full h-11 rounded-xl font-bold gap-2" onClick={() => navigate('/pricing')}>
              <Crown className="h-4 w-4" /> View Pricing & Upgrade
            </Button>
          </div>
        </div>
      </div>

        </AccordionContent>
      </AccordionItem>

      </Accordion>

      {/* Modals */}
      <DeleteAccountModal open={showDeleteModal} onOpenChange={setShowDeleteModal} />
      <SendFeedbackModal open={showFeedbackModal} onOpenChange={setShowFeedbackModal} />
    </div>
  );
}
