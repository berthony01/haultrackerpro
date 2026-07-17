import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ArrowLeft,
  Building2,
  ShieldCheck,
  User,
  Truck,
  Save,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Ban,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useRecruiterProfile, type RecruiterProfile, type RecruiterProfileUpsert } from '@/hooks/opportunities/useRecruiterProfile';
import {
  POSTING_TERMS_VERSION,
  hasAcceptedPostingTerms,
  getRecruiterTrustView,
} from '@/lib/opportunities/recruiterEligibility';

interface Props {
  onBack: () => void;
}


type FormState = {
  recruiter_name: string;
  recruiter_email: string;
  recruiter_phone: string;
  company_name: string;
  company_website: string;
  company_phone: string;
  company_address: string;
  company_city: string;
  company_state: string;
  dot_number: string;
  mc_number: string;
  hiring_states: string;
  equipment_types: string;
  driver_types_hired: string;
};

const EMPTY: FormState = {
  recruiter_name: '',
  recruiter_email: '',
  recruiter_phone: '',
  company_name: '',
  company_website: '',
  company_phone: '',
  company_address: '',
  company_city: '',
  company_state: '',
  dot_number: '',
  mc_number: '',
  hiring_states: '',
  equipment_types: '',
  driver_types_hired: '',
};

const splitList = (s: string): string[] =>
  s.split(',').map((p) => p.trim()).filter(Boolean);

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const isUrlish = (v: string) => {
  if (!v.trim()) return true;
  try {
    const u = v.includes('://') ? v : `https://${v}`;
    new URL(u);
    return true;
  } catch {
    return false;
  }
};

export function RecruiterOnboarding({ onBack }: Props) {
  const { profile, isLoading, isSuspended, saveRecruiterProfile } = useRecruiterProfile();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [agree1, setAgree1] = useState(false);
  const [agree2, setAgree2] = useState(false);
  const [agree3, setAgree3] = useState(false);

  useEffect(() => {
    if (profile) {
      setForm({
        recruiter_name: profile.recruiter_name ?? '',
        recruiter_email: profile.recruiter_email ?? '',
        recruiter_phone: profile.recruiter_phone ?? '',
        company_name: profile.company_name ?? '',
        company_website: profile.company_website ?? '',
        company_phone: profile.company_phone ?? '',
        company_address: profile.company_address ?? '',
        company_city: profile.company_city ?? '',
        company_state: profile.company_state ?? '',
        dot_number: profile.dot_number ?? '',
        mc_number: profile.mc_number ?? '',
        hiring_states: (profile.hiring_states ?? []).join(', '),
        equipment_types: (profile.equipment_types ?? []).join(', '),
        driver_types_hired: (profile.driver_types_hired ?? []).join(', '),
      });
      // Only auto-check the agreement boxes if the recruiter has previously
      // accepted (or been grandfathered). New/legacy-unconsented rows must
      // explicitly re-confirm before we stamp posting_terms_accepted_at.
      const alreadyAccepted = hasAcceptedPostingTerms(profile);
      setAgree1(alreadyAccepted);
      setAgree2(alreadyAccepted);
      setAgree3(alreadyAccepted);
    }
  }, [profile]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const isEditMode = !!profile;
  const isRejected = profile?.verification_status === 'rejected';
  const allAgreed = agree1 && agree2 && agree3;

  // Phase 1F-A.2.2: derive status presentation from the canonical
  // eligibility helper FIRST, then layer verification as a trust
  // distinction. Incomplete/suspended profiles must NEVER be told
  // standard posting is enabled — no matter their verification status.
  const statusCfg = useMemo(() => {
    if (!profile) return null;
    const eligibility = describeRecruiterEligibility(profile, {});
    const v = profile.verification_status;

    if (eligibility.state === 'suspended') {
      return {
        title: 'Recruiter Access Suspended',
        text: 'Please contact support regarding your recruiter account. Standard posting is disabled until this is resolved.',
        badge: 'Suspended',
        variant: 'destructive' as const,
        Icon: Ban,
      };
    }

    if (eligibility.state === 'incomplete_profile') {
      // Incomplete profile: verification badge is irrelevant — posting is NOT enabled.
      const verificationLabel =
        v === 'approved' ? 'Verified' :
        v === 'rejected' ? 'Not Approved' :
        'Pending Verification';
      return {
        title: 'Finish your recruiter profile',
        text: 'Standard posting is not enabled yet. Add your recruiter name, company name, a valid recruiter email, at least one of DOT or MC number, and accept the posting terms. Verification review runs separately.',
        badge: verificationLabel,
        variant: 'secondary' as const,
        Icon: AlertTriangle,
      };
    }

    // Complete + not suspended → standard posting is enabled.
    if (v === 'approved') {
      return {
        title: 'Verified Recruiter — Standard Posting Enabled',
        text: 'Standard posting is enabled and drivers see a Verified Recruiter badge on your opportunities.',
        badge: 'Verified',
        variant: 'default' as const,
        Icon: CheckCircle2,
      };
    }
    if (v === 'rejected') {
      return {
        title: 'Standard Posting Enabled — Verification Not Approved',
        text: 'Standard posting is enabled. The Verified Recruiter badge was not approved — update your profile and resubmit to earn the badge. Standard posting stays enabled unless your account is suspended.',
        badge: 'Unverified',
        variant: 'secondary' as const,
        Icon: AlertTriangle,
      };
    }
    return {
      title: 'Standard Posting Enabled',
      text: 'Your opportunities go live to drivers immediately. Verification review runs separately — a Verified Recruiter badge is added later once an admin reviews your profile.',
      badge: 'Pending Verification',
      variant: 'outline' as const,
      Icon: Clock,
    };
  }, [profile]);

  const validate = (): string | null => {
    if (!form.recruiter_name.trim()) return 'Recruiter name is required.';
    if (!form.company_name.trim()) return 'Company name is required.';
    if (!form.recruiter_email.trim()) return 'Recruiter email is required.';
    if (!isEmail(form.recruiter_email)) return 'Please enter a valid recruiter email.';
    if (!form.dot_number.trim() && !form.mc_number.trim())
      return 'Please provide at least a DOT or MC number.';
    if (form.company_website && !isUrlish(form.company_website))
      return 'Please enter a valid company website.';
    if (!allAgreed) return 'Please confirm all agreements before submitting.';
    return null;
  };

  const handleSave = () => {
    if (isSuspended) {
      toast.error('Recruiter access suspended. Please contact support.');
      return;
    }
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    // Phase 1F-A.2.1A: the browser never stamps consent. We send only
    // ordinary profile fields, then call the SECURITY DEFINER RPC via the
    // combined mutation to stamp posting_terms_* server-side.
    const payload: RecruiterProfileUpsert = {
      recruiter_name: form.recruiter_name.trim(),
      recruiter_email: form.recruiter_email.trim() || null,
      recruiter_phone: form.recruiter_phone.trim() || null,
      company_name: form.company_name.trim(),
      company_website: form.company_website.trim() || null,
      company_phone: form.company_phone.trim() || null,
      company_address: form.company_address.trim() || null,
      company_city: form.company_city.trim() || null,
      company_state: form.company_state.trim() || null,
      dot_number: form.dot_number.trim() || null,
      mc_number: form.mc_number.trim() || null,
      hiring_states: splitList(form.hiring_states),
      equipment_types: splitList(form.equipment_types),
      driver_types_hired: splitList(form.driver_types_hired),
    };
    saveRecruiterProfile.mutate(payload, {
      onSuccess: async () => {
        if (isRejected && profile) {
          const { error } = await supabase.rpc('resubmit_recruiter_profile', { profile_id: profile.id });
          if (error) {
            toast.error(error.message);
            return;
          }
          toast.success('Recruiter profile resubmitted for review.');
        } else {
          toast.success(isEditMode ? 'Recruiter profile updated' : 'Recruiter profile submitted');
        }
      },
      onError: (e: Error) => toast.error(e.message),
    });
  };

  return (
    <div className="space-y-6 animate-fade-in pb-32">
      {/* Header */}
      <Card className="p-6 border-border/60 bg-gradient-to-br from-card via-card to-primary/5">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="rounded-2xl bg-primary p-3 shadow-primary shrink-0">
            <Building2 className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground mb-1">
              Recruiter & Carrier Access
            </h1>
            <p className="text-sm text-muted-foreground">
              Connect with financially serious drivers through HaulTrackerPro.
            </p>
          </div>
        </div>
      </Card>

      {/* Status state card (only when profile exists) */}
      {statusCfg && (
        <Card className="p-5 border-border/60">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-primary/15 p-3 shrink-0">
              <statusCfg.Icon className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h3 className="text-base font-bold text-foreground">{statusCfg.title}</h3>
                <Badge variant={statusCfg.variant}>{statusCfg.badge}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{statusCfg.text}</p>
            </div>
          </div>
        </Card>
      )}

      {isLoading && !profile ? (
        <Card className="p-6 border-border/60">
          <p className="text-sm text-muted-foreground">Loading recruiter profile…</p>
        </Card>
      ) : (
        <>
          {/* A. Recruiter Information */}
          <Section icon={User} title="Recruiter Information">
            <Field label="Recruiter Name *">
              <Input value={form.recruiter_name} onChange={(e) => set('recruiter_name', e.target.value)} />
            </Field>
            <Field label="Recruiter Email *">
              <Input type="email" value={form.recruiter_email} onChange={(e) => set('recruiter_email', e.target.value)} />
            </Field>
            <Field label="Recruiter Phone">
              <Input value={form.recruiter_phone} onChange={(e) => set('recruiter_phone', e.target.value)} />
            </Field>
          </Section>

          {/* B. Company Information */}
          <Section icon={Building2} title="Company Information">
            <Field label="Company Name *">
              <Input value={form.company_name} onChange={(e) => set('company_name', e.target.value)} />
            </Field>
            <Field label="Company Website">
              <Input placeholder="https://" value={form.company_website} onChange={(e) => set('company_website', e.target.value)} />
            </Field>
            <Field label="Company Phone">
              <Input value={form.company_phone} onChange={(e) => set('company_phone', e.target.value)} />
            </Field>
            <Field label="Company Address" full>
              <Input value={form.company_address} onChange={(e) => set('company_address', e.target.value)} />
            </Field>
            <Field label="City">
              <Input value={form.company_city} onChange={(e) => set('company_city', e.target.value)} />
            </Field>
            <Field label="State">
              <Input value={form.company_state} onChange={(e) => set('company_state', e.target.value)} />
            </Field>
          </Section>

          {/* C. Verification Information */}
          <Section icon={ShieldCheck} title="Verification Information">
            <Field label="DOT Number">
              <Input value={form.dot_number} onChange={(e) => set('dot_number', e.target.value)} />
            </Field>
            <Field label="MC Number">
              <Input value={form.mc_number} onChange={(e) => set('mc_number', e.target.value)} />
            </Field>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Provide at least one of DOT or MC number. We use this to verify your authority before approval.
            </p>
          </Section>

          {/* D. Hiring Information */}
          <Section icon={Truck} title="Hiring Information">
            <Field label="Hiring States" full>
              <Textarea
                rows={2}
                placeholder="e.g. TX, OK, AR, LA"
                value={form.hiring_states}
                onChange={(e) => set('hiring_states', e.target.value)}
              />
            </Field>
            <Field label="Equipment Types" full>
              <Textarea
                rows={2}
                placeholder="e.g. Dry Van, Reefer, Flatbed"
                value={form.equipment_types}
                onChange={(e) => set('equipment_types', e.target.value)}
              />
            </Field>
            <Field label="Driver Types Hired" full>
              <Textarea
                rows={2}
                placeholder="e.g. Company Driver, Owner Operator, Lease Purchase"
                value={form.driver_types_hired}
                onChange={(e) => set('driver_types_hired', e.target.value)}
              />
            </Field>
          </Section>

          {/* E. Agreements */}
          <Card className="p-5 border-border/60 space-y-3">
            <h3 className="text-sm font-bold text-foreground">Agreements</h3>
            <Agreement checked={agree1} onChange={setAgree1} text="I confirm that my company information is accurate." />
            <Agreement checked={agree2} onChange={setAgree2} text="I understand misleading opportunities may be removed." />
            <Agreement checked={agree3} onChange={setAgree3} text="I understand HaulTrackerPro may suspend misleading recruiter accounts." />
          </Card>

          {/* Sticky save */}
          <div className="fixed bottom-20 lg:bottom-6 inset-x-0 z-30 px-4">
            <div className="max-w-4xl mx-auto">
              <Card className="p-3 border-border/60 bg-card/95 backdrop-blur shadow-lg flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground hidden sm:block">
                  {isEditMode
                    ? 'Update your recruiter profile. Standard posting eligibility and Verified Recruiter review are separate.'
                    : 'Save your recruiter profile to unlock standard posting. Verification review for the Verified Recruiter badge runs separately.'}
                </p>
                <div className="flex gap-2 ml-auto">
                  <Button variant="outline" onClick={onBack}>Cancel</Button>
                  <Button
                    onClick={handleSave}
                    disabled={saveRecruiterProfile.isPending || isSuspended}
                  >
                    <Save className="h-4 w-4" />
                    {isSuspended
                      ? 'Access Suspended'
                      : isRejected
                      ? 'Resubmit for Review'
                      : isEditMode
                      ? 'Save Changes'
                      : 'Submit Recruiter Profile'}
                  </Button>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof User;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5 border-border/60">
      <div className="flex items-center gap-2 mb-4">
        <div className="rounded-lg bg-primary/10 p-1.5">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">{title}</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>
    </Card>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={full ? 'sm:col-span-2 space-y-1.5' : 'space-y-1.5'}>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{label}</Label>
      {children}
    </div>
  );
}

function Agreement({
  checked,
  onChange,
  text,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  text: string;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} className="mt-0.5" />
      <span className="text-sm text-foreground">{text}</span>
    </label>
  );
}

/* -------- Phase 1F-A.2.2-R1A exported onboarding status card -------- */

/**
 * Pure presentation card summarising posting eligibility + verification
 * trust state for the onboarding view. Derives everything from the
 * canonical `getRecruiterTrustView()` helper — no local completeness rule,
 * no approval-gates-posting logic. Used directly by rendered tests.
 */
export function RecruiterOnboardingStatusCard({ profile }: { profile: RecruiterProfile | null }) {
  const view = getRecruiterTrustView(profile, {});
  const Icon =
    view.state === 'suspended'
      ? Ban
      : view.state === 'incomplete_profile' || view.state === 'missing_profile'
      ? AlertTriangle
      : view.state === 'verified'
      ? CheckCircle2
      : Clock;

  // Titles chosen to match the eligibility-first rule tested by the
  // Phase 1F-A.2.2 source-integrity suite: incomplete never claims
  // "Standard Posting Enabled"; complete+approved surfaces "Verified
  // Recruiter — Standard Posting Enabled"; complete+rejected surfaces
  // "Standard Posting Enabled — Verification Not Approved".
  const title =
    view.state === 'suspended'
      ? 'Recruiter Access Suspended'
      : view.state === 'missing_profile'
      ? 'Finish your recruiter setup'
      : view.state === 'incomplete_profile'
      ? 'Finish your recruiter profile'
      : view.state === 'verified'
      ? 'Verified Recruiter — Standard Posting Enabled'
      : profile?.verification_status === 'rejected'
      ? 'Standard Posting Enabled — Verification Not Approved'
      : 'Standard Posting Enabled';

  return (
    <Card
      className="p-5 border-border/60"
      data-testid="recruiter-onboarding-status"
      data-state={view.state}
      data-can-post={view.canPost ? 'true' : 'false'}
      data-verified={view.isVerified ? 'true' : 'false'}
    >
      <div className="flex items-start gap-4">
        <div className="rounded-2xl bg-primary/15 p-3 shrink-0">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="text-base font-bold text-foreground">{title}</h3>
            <Badge
              variant={view.verificationBadgeVariant}
              data-testid="onboarding-verification-label"
            >
              {view.verificationLabel}
            </Badge>
            {view.showVerifiedBadge && (
              <Badge variant="default" data-testid="onboarding-verified-badge">
                Verified Recruiter
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground" data-testid="onboarding-posting-label">
            {view.postingLabel}
          </p>
        </div>
      </div>
    </Card>
  );
}

