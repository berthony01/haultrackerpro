import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  Gift,
  Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  useRecruiterProfile,
  formatRecruiterProfileError,
  type RecruiterProfile,
  type RecruiterProfileUpsert,
} from '@/hooks/opportunities/useRecruiterProfile';
import {
  POSTING_TERMS_VERSION,
  hasAcceptedPostingTerms,
  getRecruiterTrustView,
} from '@/lib/opportunities/recruiterEligibility';
import {
  COMPANY_TYPE_LABELS,
  RECRUITER_AGREEMENT_STATEMENTS,
  type CompanyType,
} from '@/lib/opportunities/resolveRecruiterReadiness';
import {
  useRecruiterReferralSettings,
  PAYMENT_TRIGGER_LABELS,
  DEFAULT_EXTERNAL_PAYMENT_DISCLAIMER,
  type PaymentTrigger,
  type ReferralDecision,
} from '@/hooks/opportunities/useRecruiterReferralSettings';

interface Props {
  onBack: () => void;
}


type FormState = {
  recruiter_name: string;
  recruiter_email: string;
  recruiter_phone: string;
  company_name: string;
  company_type: CompanyType | '';
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
  company_type: '',
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
  const {
    profile,
    isLoading,
    isSuspended,
    saveRecruiterProfile,
    refetchProfile,
  } = useRecruiterProfile();

  const queryClient = useQueryClient();

  // Phase 1R-D2-B6-A-R3 — single local submission/transition guard. The ref
  // is the synchronous authority (blocks a second click in the same tick);
  // the state mirror drives the disabled attribute.
  const transitionRef = useRef(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const beginTransition = () => {
    transitionRef.current = true;
    setIsTransitioning(true);
  };
  const releaseTransition = () => {
    transitionRef.current = false;
    setIsTransitioning(false);
  };



  const [form, setForm] = useState<FormState>(EMPTY);
  const [agree1, setAgree1] = useState(false);
  const [agree2, setAgree2] = useState(false);
  const [agree3, setAgree3] = useState(false);

  // Phase 1Q-A — driver referral bonus decision.
  const [referralDecision, setReferralDecision] = useState<ReferralDecision>('later');
  const [refAmount, setRefAmount] = useState('');
  // Phase 1Q-A-R1 — local sentinel `none` means "no payment_trigger
  // chosen"; it is never sent to the database.
  const [refTrigger, setRefTrigger] = useState<PaymentTrigger | 'none'>('none');
  const [refWaitingDays, setRefWaitingDays] = useState('');
  const [refTerms, setRefTerms] = useState('');

  const referralSettings = useRecruiterReferralSettings(profile?.id ?? null);
  const referralHydratedRef = useRef(false);

  useEffect(() => {
    if (!profile) return;
    if (referralSettings.isLoading) return;
    if (referralHydratedRef.current) return;
    referralHydratedRef.current = true;
    const s = referralSettings.settings;
    if (!s) {
      setReferralDecision('later');
      return;
    }
    if (s.referral_bonus_enabled) {
      setReferralDecision('yes');
      setRefAmount(s.bonus_amount != null ? String(s.bonus_amount) : '');
      setRefTrigger(
        s.payment_trigger ? (s.payment_trigger as PaymentTrigger) : 'none',
      );
      setRefWaitingDays(
        s.waiting_period_days != null ? String(s.waiting_period_days) : '',
      );
      setRefTerms(s.bonus_terms ?? '');
    } else {
      setReferralDecision('no');
    }
  }, [profile, referralSettings.isLoading, referralSettings.settings]);

  useEffect(() => {
    if (profile) {
      const anyP = profile as unknown as Record<string, unknown>;
      const legacyType = anyP.company_type;
      setForm({
        recruiter_name: profile.recruiter_name ?? '',
        recruiter_email: profile.recruiter_email ?? '',
        recruiter_phone: profile.recruiter_phone ?? '',
        company_name: profile.company_name ?? '',
        company_type:
          legacyType === 'carrier' ||
          legacyType === 'third_party_recruiter' ||
          legacyType === 'staffing_agency' ||
          legacyType === 'independent_recruiter'
            ? (legacyType as CompanyType)
            : '',
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


  const validate = (): string | null => {
    if (!form.recruiter_name.trim()) return 'Recruiter name is required.';
    if (!form.company_name.trim()) return 'Company name is required.';
    if (!form.recruiter_email.trim()) return 'Recruiter email is required.';
    if (!isEmail(form.recruiter_email)) return 'Please enter a valid recruiter email.';
    if (!form.company_type) return 'Please choose a company type.';
    if (form.company_type === 'carrier' && !form.dot_number.trim() && !form.mc_number.trim())
      return 'Carriers must provide at least a DOT or MC number.';
    if (form.company_website && !isUrlish(form.company_website))
      return 'Please enter a valid company website.';
    if (!allAgreed) return 'Please confirm all agreements before submitting.';
    return null;
  };

  const handleSave = () => {
    // Phase 1R-D2-B6-A-R3 — ignore repeated Save calls while a previously
    // accepted submission is still completing (ref is synchronous so a
    // double-click in the same tick is also ignored).
    if (transitionRef.current) return;
    if (isSuspended) {
      toast.error('Recruiter access suspended. Please contact support.');
      return;
    }
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    const payload: RecruiterProfileUpsert = {
      recruiter_name: form.recruiter_name.trim(),
      recruiter_email: form.recruiter_email.trim() || null,
      recruiter_phone: form.recruiter_phone.trim() || null,
      company_name: form.company_name.trim(),
      company_type: form.company_type || null,
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
    beginTransition();
    saveRecruiterProfile.mutate(payload, {
      onSuccess: async () => {
        if (isRejected && profile) {
          const { error } = await supabase.rpc('resubmit_recruiter_profile', { profile_id: profile.id });
          if (error) {
            toast.error(error.message);
            // Rejected-resubmit RPC failure keeps the user on the form:
            // no capability refresh, no navigation, guard released.
            releaseTransition();
            return;
          }
          toast.success('Recruiter profile resubmitted for Verified Recruiter badge review.');
        } else {
          toast.success(isEditMode ? 'Recruiter profile updated' : 'Recruiter profile submitted');
        }

        // Phase 1Q-A-R1 — persist the referral-bonus decision AFTER a
        // successful profile save + posting-terms stamp. Force a fresh
        // refetch and REQUIRE a valid, non-empty id from that refetch.
        // Never fall back to the pre-save `profile?.id`.
        const partialSaveWarning =
          'Recruiter profile saved, but your referral preference could not be saved. Please retry or update it later in Driver Referrals.';
        try {
          let freshProfileId: string | null = null;
          try {
            const fresh = await refetchProfile();
            const candidate =
              typeof fresh?.id === 'string' ? fresh.id.trim() : '';
            if (candidate) freshProfileId = candidate;
          } catch {
            freshProfileId = null;
          }
          if (!freshProfileId) {
            toast.error(partialSaveWarning);
            return;
          }
          try {
            await referralSettings.saveDecision.mutateAsync({
              recruiterId: freshProfileId,
              decision: referralDecision,
              details: {
                referral_bonus_enabled: referralDecision === 'yes',
                bonus_amount:
                  referralDecision === 'yes' && refAmount.trim()
                    ? Number(refAmount)
                    : null,
                payment_trigger:
                  referralDecision === 'yes' && refTrigger && refTrigger !== 'none'
                    ? (refTrigger as PaymentTrigger)
                    : null,
                waiting_period_days:
                  referralDecision === 'yes' && refWaitingDays.trim()
                    ? Number(refWaitingDays)
                    : null,
                bonus_terms:
                  referralDecision === 'yes' ? (refTerms.trim() || null) : null,
              },
            });
          } catch {
            toast.error(partialSaveWarning);
          }
        } finally {
          // Phase 1R-D2-B6-A-R3 — the recruiter profile itself saved, so the
          // active user-capabilities query must be refreshed immediately
          // (staleTime 30s would otherwise strand the user on onboarding).
          // A refresh failure must never trap a saved user: navigate anyway.
          try {
            await queryClient.invalidateQueries({ queryKey: ['user-capabilities'] });
          } catch {
            /* capability refresh failure must not block navigation */
          }
          onBack();
        }
      },

      // Phase 1P-A1: surface Error.cause so recruiters see the true
      // reason (RPC DETAIL, RLS mismatch, persistence verification) rather
      // than the generic combined-mutation label.
      // Phase 1P-A4: unified safe formatter — surfaces the true
      // underlying reason (RPC DETAIL, RLS mismatch, persistence
      // verification) without leaking raw objects, SQL, or credentials.
      onError: (e: Error) => {
        toast.error(formatRecruiterProfileError(e));
        // Ordinary profile-save failure keeps the user on the form:
        // no capability refresh, no navigation, guard released.
        releaseTransition();
      },
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

      {/* Status state card (only when profile exists) — canonical
          RecruiterOnboardingStatusCard is the single production surface. */}
      {profile && <RecruiterOnboardingStatusCard profile={profile} />}


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
            <Field label="Company Type *">
              <Select
                value={form.company_type || undefined}
                onValueChange={(v) => set('company_type', v as CompanyType)}
              >
                <SelectTrigger data-testid="recruiter-company-type">
                  <SelectValue placeholder="Choose company type" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(COMPANY_TYPE_LABELS) as Array<[CompanyType, string]>).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
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
            <Field label={form.company_type === 'carrier' ? 'DOT Number *' : 'DOT Number'}>
              <Input value={form.dot_number} onChange={(e) => set('dot_number', e.target.value)} />
            </Field>
            <Field label={form.company_type === 'carrier' ? 'MC Number *' : 'MC Number'}>
              <Input value={form.mc_number} onChange={(e) => set('mc_number', e.target.value)} />
            </Field>
            <p
              className="text-xs text-muted-foreground sm:col-span-2"
              data-testid="verification-info-copy"
            >
              {form.company_type === 'carrier'
                ? 'Carriers must provide at least one DOT or MC number to complete their recruiter profile. It is also used for Verified Recruiter badge review. Standard posting unlocks when the required profile fields and posting terms are complete; badge approval is separate.'
                : 'DOT or MC numbers are optional for third-party recruiters, staffing agencies, and independent recruiters. Provide them if you have them — they help with Verified Recruiter badge review. Standard posting unlocks when the required profile fields and posting terms are complete.'}
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

          {/* D2. Driver Referral Bonus — Phase 1Q-A */}
          <Section icon={Gift} title="Driver Referral Bonus">
            <div className="sm:col-span-2 space-y-4">
              <div>
                <Label className="text-sm font-semibold text-foreground">
                  Are you willing to pay a driver for referring another driver who gets hired?
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  This preference does not affect recruiter approval, standard posting
                  eligibility, or Verified Recruiter status. You can update it later in
                  Driver Referrals.
                </p>
              </div>

              <RadioGroup
                value={referralDecision}
                onValueChange={(v) => setReferralDecision(v as ReferralDecision)}
                aria-label="Driver referral bonus decision"
                data-testid="referral-decision-group"
              >
                <label className="flex items-start gap-3 cursor-pointer">
                  <RadioGroupItem
                    value="yes"
                    id="referral-yes"
                    data-testid="referral-decision-yes"
                    className="mt-0.5"
                  />
                  <span className="text-sm text-foreground">
                    Yes, I offer an external referral bonus
                  </span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <RadioGroupItem
                    value="no"
                    id="referral-no"
                    data-testid="referral-decision-no"
                    className="mt-0.5"
                  />
                  <span className="text-sm text-foreground">No, not currently</span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <RadioGroupItem
                    value="later"
                    id="referral-later"
                    data-testid="referral-decision-later"
                    className="mt-0.5"
                  />
                  <span className="text-sm text-foreground">I'll decide later</span>
                </label>
              </RadioGroup>

              {referralDecision === 'yes' && (
                <div
                  className="space-y-4 rounded-lg border border-border/60 p-4"
                  data-testid="referral-details-panel"
                >
                  <div>
                    <Label htmlFor="ref-bonus-amount" className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                      Bonus amount
                    </Label>
                    <Input
                      id="ref-bonus-amount"
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      placeholder="Example: 500"
                      value={refAmount}
                      onChange={(e) => setRefAmount(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="ref-trigger" className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                      Payment trigger
                    </Label>
                    <Select
                      value={refTrigger}
                      onValueChange={(v) => setRefTrigger(v as PaymentTrigger | 'none')}
                    >
                      <SelectTrigger id="ref-trigger" className="mt-1" data-testid="ref-trigger">
                        <SelectValue placeholder="Select trigger…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none" data-testid="ref-trigger-none">
                          Not specified
                        </SelectItem>
                        {(Object.keys(PAYMENT_TRIGGER_LABELS) as PaymentTrigger[]).map((k) => (
                          <SelectItem key={k} value={k}>
                            {PAYMENT_TRIGGER_LABELS[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="ref-waiting-days" className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                      Waiting period (days)
                    </Label>
                    <Input
                      id="ref-waiting-days"
                      type="number"
                      min={0}
                      step="1"
                      inputMode="numeric"
                      placeholder="Example: 30"
                      value={refWaitingDays}
                      onChange={(e) => setRefWaitingDays(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="ref-terms" className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                      Referral bonus terms
                    </Label>
                    <Textarea
                      id="ref-terms"
                      rows={3}
                      maxLength={1000}
                      placeholder="$500 paid externally after the referred driver completes 30 days and remains in good standing."
                      value={refTerms}
                      onChange={(e) => setRefTerms(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-start gap-2 rounded-lg bg-primary/10 border border-primary/30 p-3 text-xs text-foreground">
                <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <span data-testid="referral-disclaimer">
                  {DEFAULT_EXTERNAL_PAYMENT_DISCLAIMER}
                </span>
              </div>
            </div>
          </Section>

          {/* E. Agreements */}
          <Card className="p-5 border-border/60 space-y-3">
            <h3 className="text-sm font-bold text-foreground">Agreements</h3>
            <Agreement checked={agree1} onChange={setAgree1} text={RECRUITER_AGREEMENT_STATEMENTS[0]} />
            <Agreement checked={agree2} onChange={setAgree2} text={RECRUITER_AGREEMENT_STATEMENTS[1]} />
            <Agreement checked={agree3} onChange={setAgree3} text={RECRUITER_AGREEMENT_STATEMENTS[2]} />
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
                    data-testid="recruiter-onboarding-submit"
                    disabled={
                      saveRecruiterProfile.isPending ||
                      referralSettings.saveDecision.isPending ||
                      isTransitioning ||
                      (!!profile && referralSettings.isLoading) ||
                      isSuspended
                    }
                  >
                    <Save className="h-4 w-4" />
                    {isSuspended
                      ? 'Access Suspended'
                      : isRejected
                      ? 'Resubmit for Badge Review'
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

/* -------- Phase 1F-A.2.2-R1A.1 canonical onboarding status card --------
 *
 * SINGLE production surface for the onboarding status card. Consumed both
 * by `RecruiterOnboarding` above and by the rendered component tests.
 * There is no parallel `statusCfg` implementation — that path was removed
 * in Phase 1F-A.2.2-R1A.1. All copy is derived from the canonical
 * `getRecruiterTrustView()` helper; wording literals are held here so that
 * source-integrity checks continue to hold against this file.
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

  // Titles: eligibility-first — incomplete NEVER claims "Standard Posting
  // Enabled"; complete+approved surfaces "Verified Recruiter — Standard
  // Posting Enabled"; complete+rejected surfaces "Standard Posting Enabled
  // — Verification Not Approved".
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

  // Full body copy — preserves the exact wording that the R1A source-
  // integrity suite locks in.
  const body =
    view.state === 'suspended'
      ? 'Please contact support regarding your recruiter account. Standard posting is disabled until this is resolved.'
      : view.state === 'missing_profile' || view.state === 'incomplete_profile'
      ? 'Standard posting is not enabled yet. Add your recruiter name, company name, a valid recruiter email, your company type, and accept the posting terms. Carrier accounts also need a DOT or MC number. Verification review runs separately.'
      : view.state === 'verified'
      ? 'Standard posting is enabled and drivers see a Verified Recruiter badge on your opportunities.'
      : profile?.verification_status === 'rejected'
      ? 'Standard posting is enabled. The Verified Recruiter badge was not approved — update your profile and resubmit to earn the badge. Standard posting stays enabled unless your account is suspended.'
      : 'Your opportunities go live to drivers immediately. Verification review runs separately — a Verified Recruiter badge is added later once an admin reviews your profile.';

  // Badge label preserves the "Unverified" / "Pending Verification" /
  // "Verified" / "Suspended" terminology the source-integrity suite
  // expects to see in this file.
  const badgeLabel =
    view.state === 'suspended'
      ? 'Suspended'
      : view.state === 'missing_profile' || view.state === 'incomplete_profile'
      ? profile?.verification_status === 'approved'
        ? 'Verified'
        : profile?.verification_status === 'rejected'
        ? 'Not Approved'
        : 'Pending Verification'
      : view.state === 'verified'
      ? 'Verified'
      : profile?.verification_status === 'rejected'
      ? 'Unverified'
      : 'Pending Verification';

  const badgeVariant =
    view.state === 'suspended'
      ? ('destructive' as const)
      : view.state === 'verified'
      ? ('default' as const)
      : view.state === 'incomplete_profile' || view.state === 'missing_profile'
      ? ('secondary' as const)
      : profile?.verification_status === 'rejected'
      ? ('secondary' as const)
      : ('outline' as const);

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
            <h3
              className="text-base font-bold text-foreground"
              data-testid="onboarding-status-title"
            >
              {title}
            </h3>
            <Badge variant={badgeVariant} data-testid="onboarding-verification-label">
              {badgeLabel}
            </Badge>
            {view.showVerifiedBadge && (
              <Badge variant="default" data-testid="onboarding-verified-badge">
                Verified Recruiter
              </Badge>
            )}
          </div>
          <p
            className="text-sm text-muted-foreground"
            data-testid="onboarding-status-body"
          >
            {body}
          </p>
        </div>
      </div>
    </Card>
  );
}


