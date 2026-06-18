import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft, Briefcase, Send, ChevronDown, ChevronUp, Sparkles, Wand2, Info, DollarSign,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useRecruiterOpportunities,
  type OpportunityInsert,
} from '@/hooks/opportunities/useRecruiterOpportunities';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { joinBenefits } from '@/lib/opportunities/benefitsFormat';
import { PasteOpportunityDialog, type ExtractedOpportunity } from './PasteOpportunityDialog';

const HIRING_TYPES = [
  { value: 'company', label: 'Company Driver' },
  { value: 'owner_operator', label: 'Owner Operator' },
  { value: 'lease_purchase', label: 'Lease Purchase' },
  { value: '1099', label: '1099 Contractor' },
  { value: 'team', label: 'Team Driver' },
];
const ROUTE_TYPES = ['Local', 'Regional', 'OTR', 'Dedicated', 'Semi-Dedicated'];
const TRAILER_TYPES = ['Dry Van', 'Reefer', 'Flatbed', 'Tanker', 'Car Hauler', 'Intermodal', 'Other'];
const PAY_MODELS = [
  { value: 'cpm', label: 'CPM (per-mile)' },
  { value: 'percentage', label: 'Percentage' },
  { value: 'flat_weekly', label: 'Flat Weekly' },
  { value: 'salary', label: 'Salary' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'other', label: 'Other' },
];

interface QuickFormState {
  title: string;
  company_name: string;
  driver_type: string;
  route_type: string;
  trailer_type: string;
  hiring_city: string;
  hiring_state: string;
  pay_model: string;
  cpm: string;
  percentage_pay: string;
  flat_weekly_pay: string;
  estimated_weekly_gross: string;
  estimated_weekly_miles: string;
  home_time: string;
  description: string;
  typical_lanes: string;
  requirements: string;
  confirmed: boolean;
}

const EMPTY: QuickFormState = {
  title: '', company_name: '', driver_type: '', route_type: '', trailer_type: '',
  hiring_city: '', hiring_state: '',
  pay_model: '', cpm: '', percentage_pay: '', flat_weekly_pay: '',
  estimated_weekly_gross: '', estimated_weekly_miles: '',
  home_time: '', description: '', typical_lanes: '', requirements: '',
  confirmed: false,
};

const numOrNull = (v: string): number | null => {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

interface Props {
  onBack: () => void;
  onSaved: () => void;
  /** Switch into the full detailed editor, carrying the typed values forward. */
  onSwitchToDetailed: (seed: Partial<OpportunityInsert>) => void;
}

export function RecruiterQuickPostForm({ onBack, onSaved, onSwitchToDetailed }: Props) {
  const { createOpportunity } = useRecruiterOpportunities();
  const { profile } = useRecruiterProfile();
  const [form, setForm] = useState<QuickFormState>(EMPTY);
  const [showMore, setShowMore] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);

  // Prefill company name from recruiter profile
  useEffect(() => {
    if (profile?.company_name) {
      setForm((f) => (f.company_name ? f : { ...f, company_name: profile.company_name ?? '' }));
    }
  }, [profile]);

  const set = <K extends keyof QuickFormState>(k: K, v: QuickFormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Live weekly-pay preview based on CPM × miles
  const cpmNum = numOrNull(form.cpm);
  const milesNum = numOrNull(form.estimated_weekly_miles);
  const weeklyFromCpm = cpmNum != null && milesNum != null && milesNum > 0
    ? Math.round(cpmNum * milesNum)
    : null;
  const cpmLooksLikeCents = cpmNum != null && cpmNum > 2;

  const showCpm = form.pay_model === 'cpm' || form.pay_model === 'mixed';
  const showPct = form.pay_model === 'percentage' || form.pay_model === 'mixed';
  const showFlat = form.pay_model === 'flat_weekly' || form.pay_model === 'salary' || form.pay_model === 'mixed';

  const validate = (): string | null => {
    if (!form.title.trim()) return 'Add an opportunity title.';
    if (!form.company_name.trim()) return 'Add the hiring company name.';
    if (!form.driver_type) return 'Pick a hiring type.';
    if (!form.route_type) return 'Pick a route type.';
    if (!form.trailer_type) return 'Pick a trailer type.';
    if (!form.pay_model) return 'Pick a pay model.';
    const hasPay = !!numOrNull(form.cpm) || !!numOrNull(form.percentage_pay)
      || !!numOrNull(form.flat_weekly_pay) || !!numOrNull(form.estimated_weekly_gross);
    if (!hasPay) return 'Add at least one pay value (CPM, %, flat weekly, or weekly gross).';
    if (!form.confirmed) return 'Confirm the listing is accurate before publishing.';
    return null;
  };

  const buildPayload = (): OpportunityInsert => ({
    title: form.title.trim(),
    company_name: form.company_name.trim(),
    driver_type: form.driver_type || null,
    route_type: form.route_type || null,
    trailer_type: form.trailer_type || null,
    hiring_city: form.hiring_city.trim() || null,
    hiring_state: form.hiring_state || null,
    hiring_states: form.hiring_state ? [form.hiring_state] : [],
    pay_model: form.pay_model || null,
    cpm: numOrNull(form.cpm),
    percentage_pay: numOrNull(form.percentage_pay),
    flat_weekly_pay: numOrNull(form.flat_weekly_pay),
    estimated_weekly_gross: numOrNull(form.estimated_weekly_gross),
    estimated_weekly_miles: numOrNull(form.estimated_weekly_miles),
    home_time: form.home_time.trim() || null,
    description: form.description.trim() || null,
    benefits: joinBenefits({
      typical_lanes: form.typical_lanes,
      requirements: form.requirements,
    }) || null,
    transparency_confirmed: form.confirmed,
    status: 'active',
  });

  const submit = () => {
    const err = validate();
    if (err) { toast.error(err); return; }
    createOpportunity.mutate(buildPayload(), {
      onSuccess: () => { toast.success('Opportunity submitted'); onSaved(); },
      onError: (e: Error) => toast.error(e.message),
    });
  };

  const handleSwitchDetailed = () => {
    onSwitchToDetailed(buildPayload());
  };

  const handleExtracted = (data: ExtractedOpportunity) => {
    setForm((f) => {
      const next = { ...f };
      const setStr = (k: keyof QuickFormState, v?: string) => {
        if (v && typeof v === 'string' && !(next[k] as string)) (next[k] as string) = v;
      };
      const setNum = (k: keyof QuickFormState, v?: number) => {
        if (typeof v === 'number' && Number.isFinite(v) && !(next[k] as string)) {
          (next[k] as string) = String(v);
        }
      };
      setStr('title', data.title);
      setStr('company_name', data.company_name);
      setStr('driver_type', data.driver_type);
      setStr('route_type', data.route_type);
      setStr('trailer_type', data.trailer_type);
      setStr('hiring_city', data.hiring_city);
      setStr('hiring_state', data.hiring_state);
      setStr('pay_model', data.pay_model);
      setNum('cpm', data.cpm);
      setNum('percentage_pay', data.percentage_pay);
      setNum('flat_weekly_pay', data.flat_weekly_pay);
      setNum('estimated_weekly_gross', data.estimated_weekly_gross);
      setNum('estimated_weekly_miles', data.estimated_weekly_miles);
      setStr('home_time', data.home_time);
      setStr('description', data.description);
      setStr('typical_lanes', data.typical_lanes);
      setStr('requirements', data.requirements ?? data.benefits);
      return next;
    });
    // Open the advanced section if extraction filled any of its fields
    if (data.description || data.typical_lanes || data.requirements || data.home_time
        || data.estimated_weekly_miles || data.hiring_city) {
      setShowMore(true);
    }
  };

  const pending = createOpportunity.isPending;

  return (
    <div className="space-y-5 animate-fade-in pb-32">
      {/* Header */}
      <Card className="p-5 sm:p-6 border-border/60 bg-gradient-to-br from-card via-card to-primary/5">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="rounded-2xl bg-primary p-3 shadow-primary shrink-0">
            <Briefcase className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground mb-1">
              Post Opportunity
            </h1>
            <p className="text-sm text-muted-foreground">
              Quick post — fill the essentials and publish in under a minute.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => setPasteOpen(true)}
            disabled={pending}
            className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 border border-primary shadow-sm"
          >
            <Sparkles className="h-4 w-4" /> Paste to auto-fill
          </Button>
        </div>
      </Card>

      <PasteOpportunityDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        onExtracted={handleExtracted}
      />

      {/* Basics */}
      <Card className="p-5 sm:p-6 border-border/60 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FieldBlock label="Opportunity Title" required>
            <Input
              value={form.title}
              onChange={(e) => set('title', e.target.value.slice(0, 100))}
              placeholder="Example: Regional Dry Van Driver Needed"
            />
          </FieldBlock>
          <FieldBlock label="Hiring Company" required>
            <Input
              value={form.company_name}
              onChange={(e) => set('company_name', e.target.value)}
              placeholder="ABC Logistics LLC"
            />
          </FieldBlock>
        </div>

        <FieldBlock label="Hiring Type" required>
          <ChipRow
            value={form.driver_type}
            onChange={(v) => set('driver_type', v)}
            options={HIRING_TYPES}
          />
        </FieldBlock>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FieldBlock label="Route Type" required>
            <Select value={form.route_type || 'unset'} onValueChange={(v) => set('route_type', v === 'unset' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Select route type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">Select…</SelectItem>
                {ROUTE_TYPES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </FieldBlock>
          <FieldBlock label="Trailer Type" required>
            <Select value={form.trailer_type || 'unset'} onValueChange={(v) => set('trailer_type', v === 'unset' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Select trailer type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">Select…</SelectItem>
                {TRAILER_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </FieldBlock>
        </div>
      </Card>

      {/* Pay */}
      <Card className="p-5 sm:p-6 border-border/60 space-y-5">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-amber-400" />
          <h2 className="text-base font-bold text-foreground">Pay</h2>
        </div>

        <FieldBlock label="Pay Model" required>
          <ChipRow
            value={form.pay_model}
            onChange={(v) => set('pay_model', v)}
            options={PAY_MODELS}
          />
        </FieldBlock>

        {!form.pay_model && (
          <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground flex items-start gap-2">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Pick a pay model above to enter the matching rate (CPM, %, flat, etc.).</span>
          </div>
        )}

        {form.pay_model && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {showCpm && (
              <FieldBlock
                label="CPM Rate ($/mi)"
                required
                helper={
                  cpmLooksLikeCents
                    ? `⚠️ ${cpmNum} looks like cents. Enter dollars per mile — example: 0.65 for 65¢/mi.`
                    : weeklyFromCpm != null
                      ? `≈ $${weeklyFromCpm.toLocaleString()}/week at ${milesNum!.toLocaleString()} miles`
                      : '$/mile — example: 0.65 for 65 cents per mile'
                }
              >
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min={0}
                    max={5}
                    value={form.cpm}
                    onChange={(e) => set('cpm', e.target.value)}
                    placeholder="0.65"
                    autoFocus
                    className={`pl-7 ${cpmLooksLikeCents ? 'border-amber-500/60 focus-visible:ring-amber-500/40' : ''}`}
                  />
                </div>
              </FieldBlock>
            )}
            {showPct && (
              <FieldBlock label="Percentage Pay (%)" required>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  value={form.percentage_pay}
                  onChange={(e) => set('percentage_pay', e.target.value)}
                  placeholder="72"
                  autoFocus={!showCpm}
                />
              </FieldBlock>
            )}
            {showFlat && (
              <FieldBlock label="Flat Weekly Pay ($)" required>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={form.flat_weekly_pay}
                  onChange={(e) => set('flat_weekly_pay', e.target.value)}
                  placeholder="1800"
                  autoFocus={!showCpm && !showPct}
                />
              </FieldBlock>
            )}
            <FieldBlock label="Est. Weekly Gross ($)" helper="Total a driver typically earns per week.">
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                value={form.estimated_weekly_gross}
                onChange={(e) => set('estimated_weekly_gross', e.target.value)}
                placeholder="1800"
              />
            </FieldBlock>
            <FieldBlock label="Est. Weekly Miles" helper="Used to estimate take-home pay.">
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={form.estimated_weekly_miles}
                onChange={(e) => set('estimated_weekly_miles', e.target.value)}
                placeholder="2800"
              />
            </FieldBlock>
          </div>
        )}
      </Card>

      {/* Advanced */}
      <Card className="border-border/60">
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-muted/20 rounded-lg transition-colors"
        >
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold text-foreground">Add more detail (optional)</span>
            <span className="text-xs text-muted-foreground hidden sm:inline">
              — location, miles, home time, description, lanes, requirements
            </span>
          </div>
          {showMore
            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>

        {showMore && (
          <div className="px-5 pb-5 space-y-4 border-t border-border/40 pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-[2fr_auto] gap-4">
              <FieldBlock label="Hiring City">
                <Input
                  value={form.hiring_city}
                  onChange={(e) => set('hiring_city', e.target.value)}
                  placeholder="Dallas"
                />
              </FieldBlock>
              <FieldBlock label="State">
                <Input
                  value={form.hiring_state}
                  onChange={(e) => set('hiring_state', e.target.value.toUpperCase().slice(0, 2))}
                  placeholder="TX"
                  className="w-24"
                />
              </FieldBlock>
            </div>
            <FieldBlock label="Home Time">
              <Input
                value={form.home_time}
                onChange={(e) => set('home_time', e.target.value)}
                placeholder="Home weekly, every 2 weeks, weekends home"
              />
            </FieldBlock>
            <FieldBlock label="Short Description" helper={`${form.description.length}/500`}>
              <Textarea
                rows={3}
                value={form.description}
                onChange={(e) => set('description', e.target.value.slice(0, 500))}
                placeholder="Briefly describe the opportunity and what drivers can expect."
              />
            </FieldBlock>
            <FieldBlock label="Typical Lanes" helper={'One per line — example: "Dallas, TX → Houston, TX"'}>
              <Textarea
                rows={2}
                value={form.typical_lanes}
                onChange={(e) => set('typical_lanes', e.target.value)}
                placeholder={'Dallas, TX → Houston, TX\nMidwest → Southeast'}
              />
            </FieldBlock>
            <FieldBlock label="Requirements" helper="Experience, CDL, endorsements, MVR, drug test, etc.">
              <Textarea
                rows={3}
                value={form.requirements}
                onChange={(e) => set('requirements', e.target.value)}
                placeholder={'• 1 year OTR experience\n• Class A CDL\n• Clean MVR last 3 years'}
              />
            </FieldBlock>
          </div>
        )}
      </Card>

      {/* Confirm + submit */}
      <Card className="p-5 border-border/60 bg-primary/5">
        <label className="flex items-start gap-3 cursor-pointer">
          <Checkbox
            checked={form.confirmed}
            onCheckedChange={(v) => set('confirmed', !!v)}
            className="mt-0.5"
          />
          <span className="text-sm text-foreground leading-relaxed">
            I confirm this listing is accurate. Drivers see the same pay, miles, and deductions
            shown above. Misleading opportunities may be removed.
          </span>
        </label>
      </Card>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={handleSwitchDetailed}
          className="text-xs font-semibold text-muted-foreground hover:text-primary underline-offset-2 hover:underline self-start"
          disabled={pending}
        >
          Need every field? Switch to detailed editor →
        </button>
        <Button onClick={submit} disabled={pending} size="lg">
          <Send className="h-4 w-4" />
          {pending ? 'Publishing…' : 'Publish Opportunity'}
        </Button>
      </div>
    </div>
  );
}

/* ───────────────────────── primitives ───────────────────────── */

function FieldBlock({
  label, required, helper, children,
}: { label: string; required?: boolean; helper?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-foreground">
        {label} {required && <span className="text-primary">*</span>}
      </Label>
      {children}
      {helper && <p className="text-[11px] text-muted-foreground">{helper}</p>}
    </div>
  );
}

function ChipRow({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors ${
              selected
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border/60 hover:border-primary/40 hover:text-foreground'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
