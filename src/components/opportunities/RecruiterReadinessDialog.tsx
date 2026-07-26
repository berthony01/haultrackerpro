/**
 * Phase 1P-A4 — Inline recruiter readiness repair dialog.
 *
 * Legacy recruiter accounts (created before company_type and the current
 * posting terms) can be missing recruiter name, company name, a valid
 * recruiter email, company type, DOT/MC (for carriers), and/or accepted
 * posting terms. This dialog surfaces exactly what is missing and lets the
 * recruiter correct those items in place, then resumes the interrupted
 * action (post/create/publish) via `onReady`.
 *
 * Contract:
 *   - Only currently missing controls render.
 *   - Company type is always required; DOT/MC is required ONLY for the
 *     `carrier` type.
 *   - Terms are re-accepted only when actually missing; a legitimately
 *     grandfathered/accepted account is never re-prompted.
 *   - Client payloads NEVER include protected consent/grandfathering
 *     columns — the terms RPC is the sole consent-stamping path.
 *   - Suspended accounts show the suspension reason with no save action.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useRecruiterProfile,
  formatRecruiterProfileError,
  type RecruiterProfileUpsert,
} from '@/hooks/opportunities/useRecruiterProfile';
import type { RecruiterProfile } from '@/lib/opportunities/recruiterEligibility';
import {
  COMPANY_TYPE_LABELS,
  DIALOG_MISSING_LABELS,
  RECRUITER_AGREEMENT_STATEMENTS,
  READINESS_MESSAGES,
  coerceCompanyType,
  resolveRecruiterReadiness,
  type CompanyType,
  type ReadinessToken,
} from '@/lib/opportunities/resolveRecruiterReadiness';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires exactly once after a successful save when the refreshed profile is ready. */
  onReady?: () => void;
  /** Optional context label rendered in the description ("Post an Opportunity", "Publish"). */
  actionLabel?: string;
  /**
   * Optional profile prop. When provided the dialog uses it for the initial
   * readiness snapshot; save + refetch always run through `useRecruiterProfile`.
   */
  profile?: RecruiterProfile | null;
}

type LocalForm = {
  recruiter_name: string;
  company_name: string;
  recruiter_email: string;
  company_type: CompanyType | '';
  dot_number: string;
  mc_number: string;
  agree1: boolean;
  agree2: boolean;
  agree3: boolean;
};

const CANONICAL_ORDER: ReadinessToken[] = [
  'suspended',
  'recruiter_name',
  'company_name',
  'recruiter_email_missing',
  'recruiter_email_invalid',
  'company_type',
  'dot_or_mc',
  'posting_terms',
];

function orderTokens(tokens: ReadinessToken[]): ReadinessToken[] {
  return [...tokens].sort(
    (a, b) => CANONICAL_ORDER.indexOf(a) - CANONICAL_ORDER.indexOf(b),
  );
}

function initialFromProfile(profile: RecruiterProfile | null): LocalForm {
  const anyP = (profile ?? {}) as Record<string, unknown>;
  return {
    recruiter_name: (profile?.recruiter_name ?? '') as string,
    company_name: (profile?.company_name ?? '') as string,
    recruiter_email: (profile?.recruiter_email ?? '') as string,
    company_type: coerceCompanyType(anyP.company_type) ?? '',
    dot_number: (profile?.dot_number ?? '') as string,
    mc_number: (profile?.mc_number ?? '') as string,
    agree1: false,
    agree2: false,
    agree3: false,
  };
}

export function RecruiterReadinessDialog({
  open,
  onOpenChange,
  onReady,
  actionLabel,
  profile: profileProp,
}: Props) {
  const {
    profile: hookProfile,
    upsertProfile,
    saveRecruiterProfile,
    refetchProfile,
  } = useRecruiterProfile();

  const profile = profileProp !== undefined ? profileProp : hookProfile;
  const readiness = useMemo(
    () => resolveRecruiterReadiness(profile),
    [profile],
  );

  const [form, setForm] = useState<LocalForm>(() => initialFromProfile(profile));
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const readyFiredRef = useRef(false);

  // Re-hydrate local form whenever the dialog re-opens or the profile
  // identity changes, so a subsequent open always starts from the newest
  // stored values and never leaks stale edits.
  useEffect(() => {
    if (open) {
      setForm(initialFromProfile(profile));
      setErrorText(null);
      readyFiredRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profile?.id]);

  const suspended = readiness.suspended;
  const missingSet = new Set(readiness.missing);
  const orderedMissing = orderTokens(readiness.missing);
  const termsMissing = missingSet.has('posting_terms');

  // Which company type is currently in play (form override wins so the user
  // sees DOT/MC appear immediately when they pick Carrier from the dialog).
  const effectiveType: CompanyType | '' = form.company_type || readiness.companyType || '';
  const needsCompanyTypeField = missingSet.has('company_type') || !effectiveType;
  const carrierSelected = effectiveType === 'carrier';
  const carrierNeedsAuthority =
    carrierSelected &&
    !((form.dot_number || profile?.dot_number || '').trim()) &&
    !((form.mc_number || profile?.mc_number || '').trim());
  const needsAuthorityField = missingSet.has('dot_or_mc') || carrierNeedsAuthority;
  const needsRecruiterName = missingSet.has('recruiter_name');
  const needsCompanyName = missingSet.has('company_name');
  const needsEmailField =
    missingSet.has('recruiter_email_missing') ||
    missingSet.has('recruiter_email_invalid');

  const allAgreementsChecked = form.agree1 && form.agree2 && form.agree3;

  const canSubmit =
    !suspended &&
    !saving &&
    (!termsMissing || allAgreementsChecked) &&
    !readiness.ready; // ready case is handled by useEffect below

  // If the profile transitions to ready while the dialog is open (e.g.
  // realtime invalidation from another tab), auto-resume once.
  useEffect(() => {
    if (open && readiness.ready && !suspended && !readyFiredRef.current) {
      readyFiredRef.current = true;
      onOpenChange(false);
      onReady?.();
    }
  }, [open, readiness.ready, suspended, onOpenChange, onReady]);

  const handleCancel = () => {
    if (saving) return;
    onOpenChange(false);
  };

  const buildPayload = (): RecruiterProfileUpsert => {
    // Preserve all unrelated stored profile values by starting from what
    // we have on the profile row and only overriding fields the dialog
    // actually edits.
    const base: RecruiterProfileUpsert = {
      recruiter_name: profile?.recruiter_name ?? '',
      company_name: profile?.company_name ?? '',
      recruiter_email: profile?.recruiter_email ?? null,
      recruiter_phone: profile?.recruiter_phone ?? null,
      company_website: profile?.company_website ?? null,
      company_phone: profile?.company_phone ?? null,
      company_address: profile?.company_address ?? null,
      company_city: profile?.company_city ?? null,
      company_state: profile?.company_state ?? null,
      dot_number: profile?.dot_number ?? null,
      mc_number: profile?.mc_number ?? null,
      hiring_states: profile?.hiring_states ?? [],
      equipment_types: profile?.equipment_types ?? [],
      driver_types_hired: profile?.driver_types_hired ?? [],
      company_type: coerceCompanyType(
        (profile as unknown as Record<string, unknown> | null)?.company_type,
      ),
    };
    if (needsRecruiterName || form.recruiter_name.trim()) {
      base.recruiter_name = form.recruiter_name.trim() || base.recruiter_name;
    }
    if (needsCompanyName || form.company_name.trim()) {
      base.company_name = form.company_name.trim() || base.company_name;
    }
    if (needsEmailField || form.recruiter_email.trim()) {
      base.recruiter_email = form.recruiter_email.trim() || base.recruiter_email;
    }
    if (form.company_type) {
      base.company_type = form.company_type;
    }
    // DOT/MC — only overwrite when the user typed a new value. Never clear.
    if (form.dot_number.trim()) base.dot_number = form.dot_number.trim();
    if (form.mc_number.trim()) base.mc_number = form.mc_number.trim();
    return base;
  };

  const handleSave = async () => {
    if (suspended || saving) return;
    if (termsMissing && !allAgreementsChecked) {
      setErrorText('Please confirm all three agreements before continuing.');
      return;
    }
    setErrorText(null);
    setSaving(true);
    try {
      const payload = buildPayload();
      // Client-side sanity: never leak protected consent fields.
      const safe = payload as Record<string, unknown>;
      delete safe.posting_terms_accepted_at;
      delete safe.posting_terms_version;
      delete safe.legacy_terms_grandfathered_at;

      if (termsMissing) {
        // Combined path: ordinary save then server-authoritative terms RPC.
        await saveRecruiterProfile.mutateAsync(payload);
      } else {
        // Terms already accepted/grandfathered — ordinary save only, so we
        // never restamp consent.
        await upsertProfile.mutateAsync(payload);
      }
      const refreshed = await refetchProfile();
      const rr = resolveRecruiterReadiness(refreshed);
      if (rr.ready) {
        if (!readyFiredRef.current) {
          readyFiredRef.current = true;
          onOpenChange(false);
          onReady?.();
        }
        return;
      }
      // Still incomplete after refetch — keep the dialog open and surface
      // the first blocking reason (canonical order).
      const firstToken = rr.missing[0];
      setErrorText(
        firstToken
          ? READINESS_MESSAGES[firstToken]
          : 'Your recruiter setup is still incomplete. Please review the remaining items.',
      );
    } catch (err) {
      setErrorText(formatRecruiterProfileError(err));
    } finally {
      setSaving(false);
    }
  };

  const missingLabels = orderedMissing.map((t) => DIALOG_MISSING_LABELS[t]);

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : handleCancel())}>
      <DialogContent
        className="max-w-md sm:max-w-lg max-h-[85vh] overflow-y-auto overflow-x-hidden"
        data-testid="recruiter-readiness-dialog"
        data-state-suspended={suspended ? 'true' : 'false'}
        data-state-ready={readiness.ready ? 'true' : 'false'}
      >
        <DialogHeader>
          <DialogTitle data-testid="readiness-dialog-title">
            Complete Your Recruiter Setup
          </DialogTitle>
          <DialogDescription data-testid="readiness-dialog-subtitle">
            {suspended
              ? READINESS_MESSAGES.suspended
              : `Recruiter requirements were updated. Complete the items below before ${
                  actionLabel ? actionLabel.toLowerCase() : 'continuing'
                }.`}
          </DialogDescription>
        </DialogHeader>

        {/* Missing checklist */}
        {!suspended && !readiness.ready && (
          <ul
            className="space-y-2 my-2"
            data-testid="readiness-missing-list"
            role="list"
          >
            {orderedMissing.map((token) => (
              <li
                key={token}
                className="flex items-start gap-2 text-sm text-foreground"
                data-testid={`readiness-missing-${token}`}
              >
                <XCircle
                  className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground"
                  aria-hidden
                />
                <span>{DIALOG_MISSING_LABELS[token]}</span>
              </li>
            ))}
          </ul>
        )}

        {suspended && (
          <div
            className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 flex items-start gap-2 text-sm text-destructive"
            data-testid="readiness-suspended-notice"
          >
            <Ban className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <span>{READINESS_MESSAGES.suspended}</span>
          </div>
        )}

        {readiness.ready && !suspended && (
          <div className="flex items-start gap-2 text-sm text-foreground my-2">
            <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden />
            <span>Your recruiter setup is complete.</span>
          </div>
        )}

        {/* Inline repair fields */}
        {!suspended && !readiness.ready && (
          <div className="space-y-4">
            {needsRecruiterName && (
              <Field label="Recruiter Name" htmlFor="rr-recruiter-name">
                <Input
                  id="rr-recruiter-name"
                  data-testid="rr-recruiter-name"
                  value={form.recruiter_name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, recruiter_name: e.target.value }))
                  }
                />
              </Field>
            )}
            {needsCompanyName && (
              <Field label="Company Name" htmlFor="rr-company-name">
                <Input
                  id="rr-company-name"
                  data-testid="rr-company-name"
                  value={form.company_name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, company_name: e.target.value }))
                  }
                />
              </Field>
            )}
            {needsEmailField && (
              <Field label="Recruiter Email" htmlFor="rr-recruiter-email">
                <Input
                  id="rr-recruiter-email"
                  data-testid="rr-recruiter-email"
                  type="email"
                  value={form.recruiter_email}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, recruiter_email: e.target.value }))
                  }
                />
              </Field>
            )}
            {needsCompanyTypeField && (
              <Field label="Company Type" htmlFor="rr-company-type">
                <Select
                  value={form.company_type || undefined}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      company_type: v as CompanyType,
                      // Selecting a non-carrier type removes the authority
                      // blocker immediately; existing DOT/MC values are
                      // preserved on the underlying profile.
                    }))
                  }
                >
                  <SelectTrigger
                    id="rr-company-type"
                    data-testid="rr-company-type"
                  >
                    <SelectValue placeholder="Select your company type" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(COMPANY_TYPE_LABELS) as Array<
                      [CompanyType, string]
                    >).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {needsAuthorityField && carrierSelected && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="DOT Number" htmlFor="rr-dot">
                  <Input
                    id="rr-dot"
                    data-testid="rr-dot-number"
                    value={form.dot_number}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, dot_number: e.target.value }))
                    }
                  />
                </Field>
                <Field label="MC Number" htmlFor="rr-mc">
                  <Input
                    id="rr-mc"
                    data-testid="rr-mc-number"
                    value={form.mc_number}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, mc_number: e.target.value }))
                    }
                  />
                </Field>
              </div>
            )}
            {termsMissing && (
              <div
                className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2"
                data-testid="readiness-agreements"
              >
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Posting terms
                </p>
                <AgreementRow
                  testid="rr-agree-1"
                  checked={form.agree1}
                  onChange={(v) => setForm((f) => ({ ...f, agree1: v }))}
                  text={RECRUITER_AGREEMENT_STATEMENTS[0]}
                />
                <AgreementRow
                  testid="rr-agree-2"
                  checked={form.agree2}
                  onChange={(v) => setForm((f) => ({ ...f, agree2: v }))}
                  text={RECRUITER_AGREEMENT_STATEMENTS[1]}
                />
                <AgreementRow
                  testid="rr-agree-3"
                  checked={form.agree3}
                  onChange={(v) => setForm((f) => ({ ...f, agree3: v }))}
                  text={RECRUITER_AGREEMENT_STATEMENTS[2]}
                />
              </div>
            )}
          </div>
        )}

        {errorText && (
          <div
            className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 flex items-start gap-2 text-sm text-destructive mt-2"
            data-testid="readiness-error"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <span>{errorText}</span>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2 mt-4">
          <Button
            variant="ghost"
            onClick={handleCancel}
            disabled={saving}
            data-testid="readiness-dialog-close"
          >
            Cancel
          </Button>
          {!suspended && (
            <Button
              onClick={handleSave}
              disabled={!canSubmit}
              data-testid="readiness-dialog-primary"
            >
              {saving ? 'Saving…' : 'Save and Continue to Posting'}
            </Button>
          )}
        </DialogFooter>

        {/* Screen-reader-only aggregate string, used by tests and AT to
            read the ordered missing labels. */}
        <span className="sr-only" data-testid="readiness-missing-summary">
          {missingLabels.join(' | ')}
        </span>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={htmlFor}
        className="text-xs uppercase tracking-wider text-muted-foreground font-semibold"
      >
        {label}
      </Label>
      {children}
    </div>
  );
}

function AgreementRow({
  checked,
  onChange,
  text,
  testid,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  text: string;
  testid: string;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(!!v)}
        className="mt-0.5"
        data-testid={testid}
      />
      <span className="text-sm text-foreground">{text}</span>
    </label>
  );
}
