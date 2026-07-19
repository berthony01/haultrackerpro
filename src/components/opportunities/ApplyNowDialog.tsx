import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { AlertCircle, ShieldCheck, UserCog } from 'lucide-react';
import type { DriverOpportunityProfile } from '@/hooks/opportunities/useDriverOpportunityProfile';
import { useOpportunityApplications } from '@/hooks/opportunities/useOpportunityApplications';
import { submissionErrorMessage } from '@/lib/opportunities/applicationSubmission';

type PreferredMethod = 'in_app' | 'email' | 'phone' | 'sms';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunityId: string;
  opportunityTitle: string;
  companyName: string;
  driverProfile: DriverOpportunityProfile | null | undefined;
  onEditProfile: () => void;
}

const MESSAGE_LIMIT = 4000;

export function ApplyNowDialog({
  open,
  onOpenChange,
  opportunityId,
  opportunityTitle,
  companyName,
  driverProfile,
  onEditProfile,
}: Props) {
  const { submitApplication } = useOpportunityApplications();

  const [message, setMessage] = useState('');
  const [availability, setAvailability] = useState(false);
  const [requirements, setRequirements] = useState(false);
  const [truth, setTruth] = useState(false);
  const [consent, setConsent] = useState(false);
  const [preferred, setPreferred] = useState<PreferredMethod>('in_app');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Stable idempotency key per open attempt. Reset on close.
  const keyRef = useRef<string | null>(null);
  if (open && keyRef.current === null) {
    keyRef.current = crypto.randomUUID();
  }

  const profileCompleted = !!driverProfile && !!driverProfile.profile_completed;
  const hasEmail = !!driverProfile?.email;
  const hasPhone = !!driverProfile?.phone;

  const resetForm = () => {
    setMessage('');
    setAvailability(false);
    setRequirements(false);
    setTruth(false);
    setConsent(false);
    setPreferred('in_app');
    setErrorMsg(null);
    keyRef.current = null;
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      resetForm();
    }
    onOpenChange(next);
  };

  // Auto-switch to in_app if consent removed and external method selected.
  useEffect(() => {
    if (!consent && preferred !== 'in_app') {
      setPreferred('in_app');
    }
  }, [consent, preferred]);

  const messageOver = message.length > MESSAGE_LIMIT;
  const externalMethod = preferred === 'email' || preferred === 'phone' || preferred === 'sms';
  const consentValid = !externalMethod || consent;
  const canSubmit =
    profileCompleted &&
    availability &&
    requirements &&
    truth &&
    consentValid &&
    !messageOver &&
    !submitApplication.isPending;

  const handleSubmit = async () => {
    if (!canSubmit || !keyRef.current) return;
    setErrorMsg(null);
    try {
      await submitApplication.mutateAsync({
        opportunity_id: opportunityId,
        idempotency_key: keyRef.current,
        message: message.trim() ? message.trim() : null,
        availability_confirmed: availability,
        requirements_confirmed: requirements,
        truth_attestation: truth,
        preferred_contact_method: preferred,
        contact_sharing_consent: consent,
      });
      toast.success('Application submitted', {
        description:
          'The Recruiter can now review your application and professional profile snapshot.',
      });
      resetForm();
      onOpenChange(false);
    } catch (err) {
      setErrorMsg(submissionErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Apply to {opportunityTitle}</DialogTitle>
          <DialogDescription>
            Submit a formal application to {companyName}. Your professional Opportunity Profile is
            included in the application snapshot. Email or phone is shared only when you explicitly
            consent.
          </DialogDescription>
        </DialogHeader>

        {!profileCompleted ? (
          <ProfileRequiredPanel onEditProfile={onEditProfile} hasAny={!!driverProfile} />
        ) : (
          <div className="space-y-5">
            <ProfileSummary profile={driverProfile!} onEditProfile={onEditProfile} />

            <div className="space-y-2">
              <Label htmlFor="apply-message">Message to recruiter (optional)</Label>
              <Textarea
                id="apply-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Add a short note about your interest or background."
                maxLength={MESSAGE_LIMIT}
                rows={4}
                aria-invalid={messageOver}
                aria-describedby="apply-message-help"
              />
              <p
                id="apply-message-help"
                className={`text-xs ${messageOver ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {message.length} / {MESSAGE_LIMIT} characters
              </p>
            </div>

            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-foreground">
                Confirm before submitting
              </legend>
              <AttestCheckbox
                id="apply-availability"
                checked={availability}
                onCheckedChange={setAvailability}
                label="I confirm that my availability and Opportunity Profile information are current."
              />
              <AttestCheckbox
                id="apply-requirements"
                checked={requirements}
                onCheckedChange={setRequirements}
                label="I reviewed this opportunity and believe I meet its stated requirements."
              />
              <AttestCheckbox
                id="apply-truth"
                checked={truth}
                onCheckedChange={setTruth}
                label="I confirm that the information in this application is accurate to the best of my knowledge."
              />
            </fieldset>

            <div className="space-y-3 rounded-lg border border-border/60 p-3">
              <div className="space-y-2">
                <Label htmlFor="apply-preferred">Preferred contact method</Label>
                <Select
                  value={preferred}
                  onValueChange={(v) => setPreferred(v as PreferredMethod)}
                >
                  <SelectTrigger id="apply-preferred" aria-label="Preferred contact method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in_app">In-app messaging</SelectItem>
                    <SelectItem value="email" disabled={!hasEmail}>
                      Email {hasEmail ? '' : '(not on profile)'}
                    </SelectItem>
                    <SelectItem value="phone" disabled={!hasPhone}>
                      Phone {hasPhone ? '' : '(not on profile)'}
                    </SelectItem>
                    <SelectItem value="sms" disabled={!hasPhone}>
                      SMS {hasPhone ? '' : '(no phone on profile)'}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <AttestCheckbox
                id="apply-consent"
                checked={consent}
                onCheckedChange={setConsent}
                label="I authorize HaulTracker Pro to share my selected contact details with this Recruiter for this application."
              />
              {externalMethod && !consent && (
                <p className="text-xs text-muted-foreground">
                  Enable contact sharing to use email or phone, or keep in-app messaging.
                </p>
              )}
            </div>

            <div
              role="status"
              aria-live="polite"
              className={errorMsg ? 'text-sm text-destructive flex items-start gap-2' : 'sr-only'}
            >
              {errorMsg && (
                <>
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
                  <span>{errorMsg}</span>
                </>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          {profileCompleted && (
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit}
              aria-disabled={!canSubmit}
            >
              {submitApplication.isPending ? 'Submitting…' : 'Submit Application'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AttestCheckbox({
  id,
  checked,
  onCheckedChange,
  label,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="mt-0.5"
      />
      <Label htmlFor={id} className="text-sm font-normal leading-snug cursor-pointer">
        {label}
      </Label>
    </div>
  );
}

function ProfileRequiredPanel({
  onEditProfile,
  hasAny,
}: {
  onEditProfile: () => void;
  hasAny: boolean;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start gap-2">
        <UserCog className="h-5 w-5 text-primary mt-0.5 shrink-0" aria-hidden />
        <div>
          <p className="text-sm font-semibold text-foreground">
            Complete your Opportunity Profile to apply
          </p>
          <p className="text-sm text-muted-foreground">
            Recruiters review your professional profile alongside every application. Add the
            required fields to unlock Apply Now.
          </p>
        </div>
      </div>
      <Button onClick={onEditProfile} className="w-full sm:w-auto">
        {hasAny ? 'Update Opportunity Profile' : 'Complete Opportunity Profile'}
      </Button>
    </div>
  );
}

function ProfileSummary({
  profile,
  onEditProfile,
}: {
  profile: DriverOpportunityProfile;
  onEditProfile: () => void;
}) {
  const rows = useMemo(
    () => [
      { label: 'Name', value: profile.full_name || '—' },
      {
        label: 'Location',
        value: [profile.city, profile.state].filter(Boolean).join(', ') || '—',
      },
      { label: 'CDL Class', value: profile.cdl_class || '—' },
      {
        label: 'Experience',
        value:
          profile.years_experience != null ? `${profile.years_experience} yrs` : '—',
      },
      { label: 'Email', value: profile.email || '—' },
      { label: 'Phone', value: profile.phone || '—' },
    ],
    [profile],
  );
  return (
    <div className="rounded-lg border border-border/60 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
          <p className="text-sm font-semibold text-foreground">
            Application snapshot (read-only)
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onEditProfile}>
          Edit Opportunity Profile
        </Button>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="rounded-md bg-muted/30 p-2">
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              {r.label}
            </dt>
            <dd className="text-sm text-foreground truncate">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
