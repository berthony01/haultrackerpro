import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft,
  User,
  IdCard,
  Compass,
  DollarSign,
  ShieldCheck,
  Save,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useDriverOpportunityProfile,
  type DriverOpportunityProfileUpsert,
} from '@/hooks/opportunities/useDriverOpportunityProfile';
import { useAuth } from '@/hooks/useAuth';

interface Props {
  onBack: () => void;
  onSaveSuccess?: (result: { completed: boolean }) => void;
}


const DRIVER_TYPES = ['Company Driver', 'Owner Operator', 'Lease Purchase', 'Team'];
const ROUTE_TYPES = ['OTR', 'Regional', 'Local', 'Dedicated'];
const HOME_TIMES = ['Daily', 'Weekly', 'Bi-weekly', '2-3 weeks out'];
const CDL_CLASSES = ['A', 'B', 'C'];
const ENDORSEMENTS = ['H (Hazmat)', 'N (Tanker)', 'X (Hazmat+Tanker)', 'T (Doubles/Triples)', 'P (Passenger)'];
const TRAILERS = ['Dry Van', 'Reefer', 'Flatbed', 'Step Deck', 'Tanker', 'Power Only', 'Car Hauler', 'Hopper'];
const VISIBILITY: Array<{ value: 'private' | 'apply_only' | 'verified_recruiters'; label: string }> = [
  { value: 'private', label: 'Private — only I can see it' },
  { value: 'apply_only', label: 'Application only — shared when I request info' },
  { value: 'verified_recruiters', label: 'Approved recruiters — allow recruiters approved by HaulTrackerPro to contact me' },
];
const CONTACT: Array<{ value: 'in_app' | 'phone' | 'email'; label: string }> = [
  { value: 'in_app', label: 'In-app message' },
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
];

type FormState = {
  full_name: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  cdl_class: string;
  years_experience: string;
  endorsements: string[];
  trailer_experience: string[];
  preferred_driver_type: string;
  preferred_route_type: string;
  preferred_home_time: string;
  preferred_states: string;
  available_start_date: string;
  willing_to_relocate: boolean;
  min_weekly_gross: string;
  min_weekly_net: string;
  min_effective_rpm: string;
  visibility: 'private' | 'apply_only' | 'verified_recruiters';
  allow_verified_recruiter_contact: boolean;
  contact_preference: 'in_app' | 'phone' | 'email';
};

const EMPTY: FormState = {
  full_name: '',
  phone: '',
  email: '',
  city: '',
  state: '',
  cdl_class: '',
  years_experience: '',
  endorsements: [],
  trailer_experience: [],
  preferred_driver_type: '',
  preferred_route_type: '',
  preferred_home_time: '',
  preferred_states: '',
  available_start_date: '',
  willing_to_relocate: false,
  min_weekly_gross: '',
  min_weekly_net: '',
  min_effective_rpm: '',
  visibility: 'private',
  allow_verified_recruiter_contact: false,
  contact_preference: 'in_app',
};

function isComplete(f: FormState) {
  return Boolean(
    f.full_name.trim() &&
      (f.phone.trim() || f.email.trim()) &&
      f.city.trim() &&
      f.state.trim() &&
      f.cdl_class &&
      f.preferred_driver_type &&
      f.preferred_route_type &&
      (Number(f.min_weekly_gross) > 0 || Number(f.min_weekly_net) > 0)
  );
}

const isValidEmail = (e: string) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export function DriverOpportunityProfile({ onBack, onSaveSuccess }: Props) {
  const { profile, isLoading, upsertProfile } = useDriverOpportunityProfile();

  const { user } = useAuth();
  const [form, setForm] = useState<FormState>(EMPTY);

  useEffect(() => {
    if (profile) {
      setForm({
        full_name: profile.full_name ?? '',
        phone: profile.phone ?? '',
        email: profile.email ?? '',
        city: profile.city ?? '',
        state: profile.state ?? '',
        cdl_class: profile.cdl_class ?? '',
        years_experience: profile.years_experience != null ? String(profile.years_experience) : '',
        endorsements: profile.endorsements ?? [],
        trailer_experience: profile.trailer_experience ?? [],
        preferred_driver_type: profile.preferred_driver_type ?? '',
        preferred_route_type: profile.preferred_route_type ?? '',
        preferred_home_time: profile.preferred_home_time ?? '',
        preferred_states: (profile.preferred_states ?? []).join(', '),
        available_start_date: profile.available_start_date ?? '',
        willing_to_relocate: !!profile.willing_to_relocate,
        min_weekly_gross: profile.min_weekly_gross != null ? String(profile.min_weekly_gross) : '',
        min_weekly_net: profile.min_weekly_net != null ? String(profile.min_weekly_net) : '',
        min_effective_rpm: profile.min_effective_rpm != null ? String(profile.min_effective_rpm) : '',
        visibility: (profile.visibility as FormState['visibility']) ?? 'private',
        allow_verified_recruiter_contact: !!profile.allow_verified_recruiter_contact,
        contact_preference: (profile.contact_preference as FormState['contact_preference']) ?? 'in_app',
      });
    } else if (user) {
      // No saved row yet — prefill blank fields from the HaulTrackerPro account
      // so the form feels like an extension of the driver's existing identity.
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
      const pickStr = (k: string) => (typeof meta[k] === 'string' ? (meta[k] as string) : '');
      const displayName = pickStr('display_name') || pickStr('full_name') || pickStr('name');
      setForm((p) => ({
        ...p,
        full_name: p.full_name || displayName,
        email: p.email || user.email || '',
        phone: p.phone || pickStr('phone'),
      }));
    }
  }, [profile, user]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const toggleArr = (k: 'endorsements' | 'trailer_experience', value: string) =>
    setForm((p) => ({
      ...p,
      [k]: p[k].includes(value) ? p[k].filter((x) => x !== value) : [...p[k], value],
    }));

  const handleSave = () => {
    // Validation
    if (Number(form.years_experience) < 0) return toast.error('Years of experience cannot be negative');
    if (Number(form.min_weekly_gross) < 0 || Number(form.min_weekly_net) < 0 || Number(form.min_effective_rpm) < 0)
      return toast.error('Pay goals cannot be negative');
    if (!isValidEmail(form.email.trim())) return toast.error('Please enter a valid email');

    const completed = isComplete(form);

    const payload: DriverOpportunityProfileUpsert = {
      full_name: form.full_name.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      cdl_class: form.cdl_class || null,
      years_experience: form.years_experience ? Number(form.years_experience) : null,
      endorsements: form.endorsements,
      trailer_experience: form.trailer_experience,
      preferred_driver_type: form.preferred_driver_type || null,
      preferred_route_type: form.preferred_route_type || null,
      preferred_home_time: form.preferred_home_time || null,
      preferred_states: form.preferred_states
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
      available_start_date: form.available_start_date || null,
      willing_to_relocate: form.willing_to_relocate,
      min_weekly_gross: form.min_weekly_gross ? Number(form.min_weekly_gross) : null,
      min_weekly_net: form.min_weekly_net ? Number(form.min_weekly_net) : null,
      min_effective_rpm: form.min_effective_rpm ? Number(form.min_effective_rpm) : null,
      visibility: form.visibility,
      allow_verified_recruiter_contact: form.allow_verified_recruiter_contact,
      contact_preference: form.contact_preference,
      profile_completed: completed,
    };

    upsertProfile.mutate(payload, {
      onSuccess: () => {
        if (completed) toast.success('Your Opportunity Preferences are ready.');
        else
          toast.success('Preferences saved. Add a few more details later to improve your match quality.');
        onSaveSuccess?.({ completed });
      },
      onError: (e: Error) => toast.error(e.message),
    });
  };


  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <Button variant="ghost" onClick={onBack} className="text-muted-foreground hover:text-foreground -ml-2">
        <ArrowLeft className="h-4 w-4" /> Back to Opportunities
      </Button>

      <Card className="p-6 border-border/60 bg-gradient-to-br from-card via-card to-primary/5">
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground mb-1">
          Opportunity Preferences
        </h1>
        <p className="text-sm text-muted-foreground">
          Help HaulTrackerPro match you with opportunities that fit your pay goals, route style, experience, and home-time needs.
        </p>
        <p className="text-xs text-muted-foreground/80 mt-2">
          Your main HaulTrackerPro account stays the same. These preferences only improve opportunity matches and show approved recruiters the information you choose to share when you request info.
        </p>
      </Card>

      <Section icon={User} title="Basic Contact Info">
        <p className="text-xs text-muted-foreground -mt-1">
          Pulled from your HaulTrackerPro account when available.
        </p>
        <Grid>
          <Field label="Full name">
            <Input value={form.full_name} onChange={(e) => set('full_name', e.target.value)} placeholder="John Doe" />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="(555) 555-5555" />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="you@example.com" />
          </Field>
          <Field label="City">
            <Input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Dallas" />
          </Field>
          <Field label="State">
            <Input value={form.state} onChange={(e) => set('state', e.target.value.toUpperCase().slice(0, 2))} placeholder="TX" maxLength={2} />
          </Field>
        </Grid>
      </Section>

      <Section icon={Compass} title="What You’re Looking For">
        <Grid>
          <Field label="Preferred driver type">
            <SelectField value={form.preferred_driver_type} onChange={(v) => set('preferred_driver_type', v)} options={DRIVER_TYPES} placeholder="Select" />
          </Field>
          <Field label="Preferred route type">
            <SelectField value={form.preferred_route_type} onChange={(v) => set('preferred_route_type', v)} options={ROUTE_TYPES} placeholder="Select" />
          </Field>
          <Field label="Preferred home time">
            <SelectField value={form.preferred_home_time} onChange={(v) => set('preferred_home_time', v)} options={HOME_TIMES} placeholder="Select" />
          </Field>
          <Field label="Available start date">
            <Input type="date" value={form.available_start_date} onChange={(e) => set('available_start_date', e.target.value)} />
          </Field>
          <Field label="Preferred states (comma separated)">
            <Input
              value={form.preferred_states}
              onChange={(e) => set('preferred_states', e.target.value)}
              placeholder="TX, OK, AR"
            />
          </Field>
        </Grid>
        <ToggleRow
          label="Willing to relocate"
          checked={form.willing_to_relocate}
          onChange={(v) => set('willing_to_relocate', v)}
        />
      </Section>

      <Section icon={IdCard} title="Experience & Equipment">
        <Grid>
          <Field label="CDL Class">
            <SelectField value={form.cdl_class} onChange={(v) => set('cdl_class', v)} options={CDL_CLASSES} placeholder="Select" />
          </Field>
          <Field label="Years of experience">
            <Input
              type="number"
              min={0}
              value={form.years_experience}
              onChange={(e) => set('years_experience', e.target.value)}
              placeholder="0"
            />
          </Field>
        </Grid>
        <ChipGroup label="Endorsements" options={ENDORSEMENTS} selected={form.endorsements} onToggle={(v) => toggleArr('endorsements', v)} />
        <ChipGroup label="Trailer experience" options={TRAILERS} selected={form.trailer_experience} onToggle={(v) => toggleArr('trailer_experience', v)} />
      </Section>

      <Section icon={DollarSign} title="Pay Goals">
        <Grid>
          <Field label="Min weekly gross ($)">
            <Input
              type="number"
              min={0}
              value={form.min_weekly_gross}
              onChange={(e) => set('min_weekly_gross', e.target.value)}
              placeholder="0"
            />
          </Field>
          <Field label="Min weekly net ($)">
            <Input
              type="number"
              min={0}
              value={form.min_weekly_net}
              onChange={(e) => set('min_weekly_net', e.target.value)}
              placeholder="0"
            />
          </Field>
          <Field label="Min effective RPM ($/mi)">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.min_effective_rpm}
              onChange={(e) => set('min_effective_rpm', e.target.value)}
              placeholder="0.00"
            />
          </Field>
        </Grid>
      </Section>

      <Section icon={ShieldCheck} title="Privacy & Recruiter Contact">
        <Field label="Preferences visibility">
          <Select value={form.visibility} onValueChange={(v) => set('visibility', v as FormState['visibility'])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {VISIBILITY.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Preferred contact method">
          <Select value={form.contact_preference} onValueChange={(v) => set('contact_preference', v as FormState['contact_preference'])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CONTACT.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <ToggleRow
          label="Allow approved recruiters to contact me"
          checked={form.allow_verified_recruiter_contact}
          onChange={(v) => set('allow_verified_recruiter_contact', v)}
        />
      </Section>

      {/* Spacer so fixed mobile action bar doesn't cover content */}
      <div aria-hidden className="h-24 lg:hidden" />

      <div className="fixed lg:sticky left-0 right-0 lg:left-auto lg:right-auto bottom-[calc(72px+env(safe-area-inset-bottom))] lg:bottom-4 px-3 lg:px-0 z-30">
        <div className="flex flex-col sm:flex-row gap-3 bg-card/90 backdrop-blur-md p-3 rounded-xl border border-border/60 shadow-lg">
          <Button variant="outline" onClick={onBack} className="flex-1">Cancel</Button>
          <Button onClick={handleSave} disabled={upsertProfile.isPending} className="flex-1">
            <Save className="h-4 w-4" />
            {upsertProfile.isPending ? 'Saving…' : 'Save Preferences'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof User; title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5 border-border/60 space-y-4">
      <div className="flex items-center gap-2">
        <div className="rounded-lg bg-primary/10 p-1.5"><Icon className="h-4 w-4 text-primary" /></div>
        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">{title}</h3>
      </div>
      {children}
    </Card>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</Label>
      {children}
    </div>
  );
}

function SelectField({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>{o}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ChipGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</Label>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const active = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => onToggle(o)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted/30 text-muted-foreground border-border/60 hover:bg-muted/50'
              }`}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted/20 border border-border/60 p-3">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
