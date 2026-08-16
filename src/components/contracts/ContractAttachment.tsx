import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { FileText, Upload, Eye, AlertCircle, Loader2, Sparkles, CheckCircle2, XCircle, ShieldAlert, ShieldCheck, ThumbsUp, ThumbsDown, MessageSquareWarning, PenLine, Check, Lock, Crown } from 'lucide-react';
import { toast } from 'sonner';
import { useApplicationContract } from '@/hooks/contracts/useApplicationContract';
import { useSubscription } from '@/hooks/useSubscription';
import { supabase } from '@/integrations/supabase/client';
import { ContractSummaryPanel } from './ContractSummaryPanel';

interface Props {
  applicationId: string;
  /** 'recruiter' shows upload + replace; 'driver' shows view-only. */
  role: 'recruiter' | 'driver';
  /**
   * Phase RC-1G — recruiter-side MUTATION gate.
   *
   * Defaults to `true` so all existing owner recruiter call sites and all
   * driver behavior are byte-for-byte unchanged. Recruiter STAFF mount this
   * with the RC-1B `contracts_manage` boolean: `contracts_view` staff still
   * see and open the document, but Attach/Upload New Version, Prepare AI
   * Review, and Run AI Risk Review are withheld. UX only — PostgreSQL and the
   * contract Edge Functions remain authoritative.
   */
  canManageRecruiterContract?: boolean;
}


const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';
const MAX_BYTES = 25 * 1024 * 1024;

function StatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return (
      <Badge variant="outline" className="bg-muted text-muted-foreground border-border gap-1">
        <AlertCircle className="h-3 w-3" /> No contract attached
      </Badge>
    );
  }
  if (status === 'uploaded' || status === 'parsing' || status === 'parsed' || status === 'ai_reviewed') {
    return (
      <Badge variant="outline" className="bg-primary/15 text-primary border-primary/30 gap-1">
        <FileText className="h-3 w-3" /> Contract uploaded · Driver can review
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="bg-muted text-foreground border-border capitalize">
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}

function ParseStatusBadge({ status }: { status: string | null }) {
  if (!status || status === 'pending') {
    return (
      <Badge variant="outline" className="bg-muted text-muted-foreground border-border gap-1">
        Text not extracted
      </Badge>
    );
  }
  if (status === 'parsing') {
    return (
      <Badge variant="outline" className="bg-amber-500/15 text-amber-400 border-amber-500/30 gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> Extracting text…
      </Badge>
    );
  }
  if (status === 'parsed') {
    return (
      <Badge variant="outline" className="bg-green-500/15 text-green-400 border-green-500/30 gap-1">
        <CheckCircle2 className="h-3 w-3" /> Text extracted
      </Badge>
    );
  }
  if (status === 'failed') {
    return (
      <Badge variant="outline" className="bg-red-500/15 text-red-400 border-red-500/30 gap-1">
        <XCircle className="h-3 w-3" /> Extraction failed
      </Badge>
    );
  }
  return null;
}

const TIER_STYLES: Record<string, { label: string; cls: string; Icon: typeof ShieldAlert }> = {
  low: { label: 'Low risk', cls: 'bg-green-500/15 text-green-400 border-green-500/30', Icon: ShieldCheck },
  moderate: { label: 'Moderate risk', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30', Icon: ShieldAlert },
  elevated: { label: 'Elevated risk', cls: 'bg-orange-500/15 text-orange-400 border-orange-500/30', Icon: ShieldAlert },
  high: { label: 'High risk', cls: 'bg-red-500/15 text-red-400 border-red-500/30', Icon: ShieldAlert },
  severe: { label: 'Severe risk', cls: 'bg-red-600/20 text-red-300 border-red-600/40', Icon: ShieldAlert },
};

type StepState = 'active' | 'complete' | 'locked' | 'idle';

function DriverStepIndicator({
  reviewState,
  decideState,
  signState,
  signApplicable,
}: {
  reviewState: StepState;
  decideState: StepState;
  signState: StepState;
  signApplicable: boolean;
}) {
  const steps: { key: string; label: string; state: StepState }[] = [
    { key: 'review', label: 'Review', state: reviewState },
    { key: 'decide', label: 'Decide', state: decideState },
  ];
  if (signApplicable) steps.push({ key: 'sign', label: 'Sign', state: signState });

  return (
    <ol
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]"
      aria-label="Contract review progress"
    >
      {steps.map((s, i) => {
        const isComplete = s.state === 'complete';
        const isActive = s.state === 'active';
        const isLocked = s.state === 'locked';
        const dot =
          isComplete
            ? 'bg-green-500/20 text-green-400 border-green-500/40'
            : isActive
              ? 'bg-primary/20 text-primary border-primary/40'
              : isLocked
                ? 'bg-muted text-muted-foreground border-border'
                : 'bg-muted text-muted-foreground border-border';
        const label =
          isComplete
            ? 'text-foreground/90'
            : isActive
              ? 'text-foreground font-semibold'
              : 'text-muted-foreground';
        const ariaCurrent = isActive ? ('step' as const) : undefined;
        return (
          <li key={s.key} className="flex items-center gap-2" aria-current={ariaCurrent}>
            <span
              className={`inline-flex h-5 w-5 items-center justify-center rounded-full border ${dot}`}
              aria-hidden="true"
            >
              {isComplete ? (
                <Check className="h-3 w-3" />
              ) : isLocked ? (
                <Lock className="h-2.5 w-2.5" />
              ) : (
                <span className="text-[10px] font-bold">{i + 1}</span>
              )}
            </span>
            <span className={label}>
              {s.label}
              {isComplete && <span className="sr-only"> — completed</span>}
              {isActive && <span className="sr-only"> — current step</span>}
              {isLocked && <span className="sr-only"> — locked</span>}
            </span>
            {i < steps.length - 1 && (
              <span className="mx-1 h-px w-4 bg-border" aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ParsingSkeleton({ label }: { label: string }) {
  return (
    <div
      className="mt-2 rounded-md border border-border/60 bg-background/40 p-3 space-y-2"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        <span className="text-xs font-semibold text-foreground/90">{label}</span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Looking for terms that may need attention…
      </p>
      <div className="space-y-1.5">
        <div className="h-2 w-full rounded bg-muted animate-pulse" />
        <div className="h-2 w-5/6 rounded bg-muted animate-pulse" />
        <div className="h-2 w-2/3 rounded bg-muted animate-pulse" />
      </div>
    </div>
  );
}

export function ContractAttachment({ applicationId, role }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isViewLoading, setIsViewLoading] = useState(false);
  const [showChangesBox, setShowChangesBox] = useState(false);
  const [changesNote, setChangesNote] = useState('');
  const [pendingDecision, setPendingDecision] = useState<null | 'approve_contract' | 'reject_contract' | 'request_changes'>(null);
  const [showSignBox, setShowSignBox] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [signConsent, setSignConsent] = useState(false);
  const { contractWithVersion, isLoading, uploadContract, getSignedViewUrl, parseContract, analyzeContract, reviewContract, signContract } =
    useApplicationContract(applicationId);
  const navigate = useNavigate();
  const { isPro, isLoading: isSubLoading } = useSubscription();

  const handlePick = () => inputRef.current?.click();

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error('File must be 25 MB or smaller');
      return;
    }
    try {
      await uploadContract.mutateAsync({ file, applicationId });
      toast.success('Contract uploaded');
    } catch (e) {
      toast.error((e as Error).message || 'Upload failed');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleView = async () => {
    setIsViewLoading(true);
    try {
      const url = await getSignedViewUrl.mutateAsync();
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error((e as Error).message || 'Could not open contract');
    } finally {
      setIsViewLoading(false);
    }
  };

  const handleParse = async () => {
    try {
      const res = await parseContract.mutateAsync();
      if (res.parse_status === 'parsed') {
        toast.success(
          `Text extracted${typeof res.characters === 'number' ? ` (${res.characters.toLocaleString()} chars)` : ''}`,
        );
      } else {
        toast.error('Text extraction did not complete');
      }
    } catch (e) {
      toast.error((e as Error).message || 'Could not extract text');
    }
  };

  const handleAnalyze = async () => {
    try {
      const res = await analyzeContract.mutateAsync({});
      if (res?.already) toast.success('Loaded existing AI review');
      else toast.success('AI risk review complete');
    } catch (e) {
      toast.error((e as Error).message || 'AI review failed');
    }
  };

  const hasContract = !!contractWithVersion?.current_version;
  const status = contractWithVersion?.contract.status ?? null;
  const parseStatus = contractWithVersion?.current_version?.parse_status ?? null;
  const parseError = contractWithVersion?.current_version?.parse_error ?? null;
  const fileName = contractWithVersion?.current_version?.file_name;
  const versionNumber = contractWithVersion?.current_version?.version_number;
  const currentVersionId = contractWithVersion?.current_version?.id ?? null;
  const aiReviewRaw = contractWithVersion?.ai_review ?? null;
  const aiReview = aiReviewRaw && aiReviewRaw.version_id === currentVersionId ? aiReviewRaw : null;
  const findings = (aiReview?.ai_findings as { risk_score?: number; risk_tier?: string; top_red_flags?: string[]; truncated?: boolean } | null) ?? null;
  const riskScore = typeof findings?.risk_score === 'number' ? findings.risk_score : null;
  const riskTier = (findings?.risk_tier || '').toLowerCase();
  const tierStyle = riskTier && TIER_STYLES[riskTier] ? TIER_STYLES[riskTier] : null;
  const canAnalyze =
    hasContract && parseStatus === 'parsed' && role === 'recruiter' && recruiterCanManage;

  const showAnalyzeBtn = canAnalyze && !aiReview;

  // Driver decision (Phase 5) — bound to current version only.
  const driverReviewRaw = contractWithVersion?.driver_review ?? null;
  const driverReview = driverReviewRaw && driverReviewRaw.version_id === currentVersionId ? driverReviewRaw : null;
  const decision = (driverReview?.decision ?? null) as null | 'approved' | 'rejected' | 'changes_requested';
  // DB enforces one driver decision per version. Treat all three outcomes as terminal for THIS version.
  // A new decision is only possible after the recruiter uploads a revised version.
  const decisionTerminal =
    decision === 'approved' || decision === 'rejected' || decision === 'changes_requested';
  // Backend (review-contract) only accepts decisions from ai_reviewed | driver_reviewing | changes_requested.
  // changes_requested is included for safety, but decisionTerminal will hide buttons once that decision was made.
  const canDriverDecide =
    role === 'driver' &&
    hasContract &&
    !decisionTerminal &&
    !!status &&
    ['ai_reviewed', 'driver_reviewing', 'changes_requested'].includes(status);
  // True when the driver is looking at a not-yet-reviewable contract (uploaded/parsing/parsed)
  // and hasn't submitted any decision yet — show "Waiting for AI review" panel instead of buttons.
  const driverWaitingForAi =
    role === 'driver' &&
    hasContract &&
    !decision &&
    !!status &&
    ['uploaded', 'parsing', 'parsed'].includes(status);

  // Phase 8 — signature (current version only).
  const signatureRaw = contractWithVersion?.driver_signature ?? null;
  const driverSignature = signatureRaw && signatureRaw.version_id === currentVersionId ? signatureRaw : null;
  const isSigned = status === 'signed' || !!driverSignature;
  const canDriverSign =
    role === 'driver' &&
    hasContract &&
    !isSigned &&
    status === 'approved' &&
    decision === 'approved';

  const submitSign = async () => {
    const name = typedName.trim();
    if (name.length < 2) {
      toast.error('Please type your full legal name to sign.');
      return;
    }
    if (!signConsent) {
      toast.error('Please confirm you understand this is a digital signature.');
      return;
    }
    try {
      await signContract.mutateAsync({ typed_name: name, consent: true });
      toast.success('Contract signed');
      setShowSignBox(false);
      setTypedName('');
      setSignConsent(false);
    } catch (e) {
      toast.error((e as Error).message || 'Could not sign contract');
    }
  };

  const submitDecision = async (d: 'approve_contract' | 'reject_contract' | 'request_changes') => {
    if (d === 'request_changes' && !changesNote.trim()) {
      toast.error('Please describe the changes you need.');
      return;
    }
    setPendingDecision(d);
    try {
      await reviewContract.mutateAsync({ decision: d, note: changesNote.trim() || undefined });
      if (d === 'approve_contract') toast.success('Contract approved');
      else if (d === 'reject_contract') toast.success('Contract rejected');
      else toast.success('Changes requested');
      setShowChangesBox(false);
      setChangesNote('');
    } catch (e) {
      toast.error((e as Error).message || 'Could not submit decision');
    } finally {
      setPendingDecision(null);
    }
  };

  const decisionStyle: Record<'approved' | 'rejected' | 'changes_requested', { label: string; cls: string; Icon: typeof ThumbsUp }> = {
    approved: { label: 'Driver approved', cls: 'bg-green-500/15 text-green-400 border-green-500/30', Icon: ThumbsUp },
    rejected: { label: 'Driver rejected', cls: 'bg-red-500/15 text-red-400 border-red-500/30', Icon: ThumbsDown },
    changes_requested: { label: 'Changes requested', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30', Icon: MessageSquareWarning },
  };

  // Driver step indicator state derivation (purely visual; no workflow change).
  const signApplicable = role === 'driver' && hasContract;
  const reviewState: StepState = !hasContract
    ? 'idle'
    : decision || isSigned
      ? 'complete'
      : 'active';
  const decideState: StepState = !hasContract
    ? 'idle'
    : decision === 'approved' || isSigned
      ? 'complete'
      : decision === 'rejected'
        ? 'complete'
        : canDriverDecide
          ? 'active'
          : 'locked';
  const signState: StepState = !signApplicable
    ? 'idle'
    : isSigned
      ? 'complete'
      : decision === 'rejected'
        ? 'locked'
        : canDriverSign
          ? 'active'
          : 'locked';

  const isAnalyzing = analyzeContract.isPending;
  const isParsing = parseContract.isPending || parseStatus === 'parsing';

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
      <ContractSummaryPanel applicationId={applicationId} role={role} />
      {role === 'driver' && hasContract && (
        <div className="rounded-md border border-border/60 bg-background/40 p-2.5">
          <DriverStepIndicator
            reviewState={reviewState}
            decideState={decideState}
            signState={signState}
            signApplicable={signApplicable}
          />
        </div>
      )}
      {role === 'recruiter' && (
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Upload an accurate, authorized contract. You can't mark a driver hired until they approve
          the current contract. If they also sign, HaulTrackerPro stores an in-app signature record
          (platform record of consent — not a DocuSign-equivalent or qualified electronic signature).
          AI review is informational, not legal advice.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Contract
          </span>
          <StatusBadge status={hasContract ? status : null} />
          {hasContract && <ParseStatusBadge status={parseStatus} />}
          {hasContract && tierStyle && (
            <Badge variant="outline" className={`gap-1 ${tierStyle.cls}`}>
              <tierStyle.Icon className="h-3 w-3" /> {tierStyle.label}
              {typeof riskScore === 'number' ? ` · ${Math.round(Number(riskScore))}/100` : ''}
            </Badge>
          )}
          {hasContract && !aiReview && parseStatus === 'parsed' && (
            <Badge variant="outline" className="bg-muted text-muted-foreground border-border gap-1">
              AI review not run yet
            </Badge>
          )}
          {hasContract && decision && (
            <Badge variant="outline" className={`gap-1 ${decisionStyle[decision].cls}`}>
              {(() => { const I = decisionStyle[decision].Icon; return <I className="h-3 w-3" />; })()}
              {decisionStyle[decision].label}
            </Badge>
          )}
          {hasContract && isSigned && (
            <Badge variant="outline" className="bg-green-500/15 text-green-400 border-green-500/30 gap-1">
              <PenLine className="h-3 w-3" />
              {role === 'recruiter' ? 'Driver signed' : 'Signed'}
            </Badge>
          )}
        </div>
        {role === 'recruiter' && (
          <div className="flex flex-wrap gap-2">
            {recruiterCanManage && (
              <Button
                variant={hasContract ? 'outline' : 'default'}
                size="sm"
                onClick={handlePick}
                disabled={uploadContract.isPending || isLoading}
              >
                {uploadContract.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {hasContract ? 'Upload New Version' : 'Attach Contract'}
              </Button>
            )}
            {hasContract && (
              <Button variant="ghost" size="sm" onClick={handleView} disabled={isViewLoading}>
                {isViewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                View
              </Button>
            )}

            {recruiterCanManage && hasContract && parseStatus !== 'parsed' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleParse}
                disabled={parseContract.isPending || parseStatus === 'parsing'}
              >
                {parseContract.isPending || parseStatus === 'parsing' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {parseStatus === 'failed' ? 'Retry Extraction' : 'Prepare AI Review'}
              </Button>
            )}

            {showAnalyzeBtn && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleAnalyze}
                disabled={analyzeContract.isPending}
              >
                {analyzeContract.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Run AI Risk Review
              </Button>
            )}
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </div>
        )}
        {role === 'driver' && hasContract && (
          <Button variant="outline" size="sm" onClick={handleView} disabled={isViewLoading}>
            {isViewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            View Contract
          </Button>
        )}
      </div>
      {hasContract && (
        <p className="text-[11px] text-muted-foreground truncate">
          v{versionNumber} · {fileName}
        </p>
      )}
      {parseStatus === 'failed' && parseError && role === 'recruiter' && (
        <p className="text-[11px] text-red-400 break-words">
          {parseError}
        </p>
      )}
      {hasContract && !aiReview && isParsing && (
        <ParsingSkeleton label="Preparing contract for AI review…" />
      )}
      {hasContract && !aiReview && !isParsing && isAnalyzing && (
        <ParsingSkeleton label="Analyzing contract details…" />
      )}
      {aiReview && (
        <div className="mt-2 rounded-md border border-border/60 bg-background/40 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              AI Risk Summary
            </span>
          </div>
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
            <p className="text-[11px] leading-relaxed text-amber-200/90">
              AI contract review is for informational purposes only. It is not legal advice, does
              not create an attorney-client relationship, and may miss or misunderstand contract
              terms. Always read the full contract and consider speaking with a qualified attorney
              before signing.
            </p>
          </div>
          {aiReview.ai_summary && (
            <p className="text-xs text-foreground/90 whitespace-pre-wrap break-words">
              {aiReview.ai_summary}
            </p>
          )}
          {findings?.top_red_flags && findings.top_red_flags.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground mb-1">
                Top concerns
              </p>
              <ul className="text-xs text-foreground/90 space-y-1 list-disc pl-4">
                {findings.top_red_flags.slice(0, 3).map((f, i) => (
                  <li key={i} className="break-words">{f}</li>
                ))}
              </ul>
            </div>
          )}
          {findings?.truncated && (
            <p className="text-[10px] text-amber-400">
              Note: Contract was long; only the first portion was analyzed.
            </p>
          )}
        </div>
      )}
      {role === 'driver' && !hasContract && !isLoading && (
        <p className="text-[11px] text-muted-foreground">
          The recruiter has not attached a contract for this application yet.
        </p>
      )}

      {/* Driver decision panel */}
      {role === 'driver' && hasContract && (
        <div className="mt-2 rounded-md border border-border/60 bg-background/40 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Your decision
            </span>
          </div>

          {decision ? (
            <div className="space-y-1">
              <p className="text-xs text-foreground/90">
                You {decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : 'requested changes to'} this contract version.
              </p>
              {driverReview?.notes && (
                <p className="text-[11px] text-muted-foreground whitespace-pre-wrap break-words">
                  Your note: {driverReview.notes}
                </p>
              )}
              {decision === 'changes_requested' && (
                <p className="text-[11px] text-amber-400/90 italic">
                  You requested changes for this contract version. The recruiter must upload a revised version before you can approve or sign.
                </p>
              )}
            </div>
          ) : driverWaitingForAi ? (
            <p className="text-[11px] text-muted-foreground">
              Waiting for AI review. The recruiter must run AI review before you can approve, reject, or request changes.
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Review the contract and AI risk summary above, then choose:
            </p>
          )}

          {canDriverDecide && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => submitDecision('approve_contract')}
                  disabled={reviewContract.isPending}
                >
                  {pendingDecision === 'approve_contract' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsUp className="h-4 w-4" />}
                  Approve Contract
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowChangesBox((v) => !v)}
                  disabled={reviewContract.isPending}
                >
                  <MessageSquareWarning className="h-4 w-4" />
                  Request Changes
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => submitDecision('reject_contract')}
                  disabled={reviewContract.isPending}
                >
                  {pendingDecision === 'reject_contract' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsDown className="h-4 w-4" />}
                  Reject Contract
                </Button>
              </div>
              {showChangesBox && (
                <div className="space-y-2">
                  <p className="text-[11px] text-muted-foreground">
                    Use this if you want the recruiter to revise terms before you approve or sign.
                    Include a clear reason so both sides have a record.
                  </p>
                  <Textarea
                    value={changesNote}
                    onChange={(e) => setChangesNote(e.target.value.slice(0, 4000))}
                    placeholder="Example: Please clarify escrow refund terms, chargebacks, or maintenance responsibility before I approve."
                    aria-label="Describe the changes you need (required)"
                    rows={3}
                    className="text-xs"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => submitDecision('request_changes')}
                      disabled={reviewContract.isPending || !changesNote.trim()}
                    >
                      {pendingDecision === 'request_changes' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareWarning className="h-4 w-4" />}
                      Submit Request
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { setShowChangesBox(false); setChangesNote(''); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground italic">
                Decisions are recorded for this contract version only. This is not legal advice.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Recruiter view of driver decision */}
      {role === 'recruiter' && hasContract && decision && (
        <div className="mt-2 rounded-md border border-border/60 bg-background/40 p-3 space-y-1">
          <div className="flex items-center gap-2">
            {(() => { const I = decisionStyle[decision].Icon; return <I className="h-3.5 w-3.5 text-primary" />; })()}
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Driver decision
            </span>
          </div>
          <p className="text-xs text-foreground/90">{decisionStyle[decision].label} on v{versionNumber}.</p>
          {driverReview?.notes && (
            <p className="text-[11px] text-muted-foreground whitespace-pre-wrap break-words">
              Driver note: {driverReview.notes}
            </p>
          )}
          {decision === 'changes_requested' && (
            <p className="text-[11px] text-amber-400/90 italic">
              Revised version required — upload a new version to continue. The driver cannot approve or sign this version again.
            </p>
          )}
        </div>
      )}

      {/* Phase 8 — Driver signature panel */}
      {role === 'driver' && hasContract && (canDriverSign || isSigned) && (
        <div className="mt-2 rounded-md border border-border/60 bg-background/40 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <PenLine className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Record Your Approval
            </span>
          </div>
          {isSigned ? (
            <div className="space-y-1">
              <p className="text-xs text-foreground/90">
                You signed this contract version.
              </p>
              {driverSignature?.signed_at && (
                <p className="text-[11px] text-muted-foreground">
                  Signed on {new Date(driverSignature.signed_at).toLocaleString()}
                </p>
              )}
            </div>
          ) : !showSignBox ? (
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground">
                You approved this contract. Type your full legal name to record your approval. This is an in-app record of consent — not a notarization or DocuSign-equivalent qualified electronic signature.
              </p>
              <Button variant="default" size="sm" onClick={() => setShowSignBox(true)}>
                <PenLine className="h-4 w-4" /> Sign Contract
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Input
                value={typedName}
                onChange={(e) => setTypedName(e.target.value.slice(0, 200))}
                placeholder="Type your full legal name"
                className="text-xs"
              />
              <label className="flex items-start gap-2 text-[11px] text-foreground/90">
                <Checkbox
                  checked={signConsent}
                  onCheckedChange={(v) => setSignConsent(v === true)}
                  className="mt-0.5"
                />
                <span>
                  By signing, I confirm I reviewed this contract version and want to record my
                  approval in HaulTrackerPro. This signature record may include my typed name,
                  consent, timestamp, IP address, browser/device information, and contract
                  version. This is a platform record of consent, not a notarization or a
                  DocuSign-equivalent qualified electronic signature.
                </span>
              </label>
              <div className="flex gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={submitSign}
                  disabled={signContract.isPending || !typedName.trim() || !signConsent}
                >
                  {signContract.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
                  Confirm Signature
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setShowSignBox(false); setTypedName(''); setSignConsent(false); }}
                  disabled={signContract.isPending}
                >
                  Cancel
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground italic">
                In-app signature record only — not legal advice and not a qualified electronic
                signature.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Phase 9F — Driver Pro: Plain-English Clause Rewrite (Free users see upsell) */}
      {role === 'driver' && hasContract && !isSubLoading && (
        isPro ? (
          <ClauseRewriteCard applicationId={applicationId} />
        ) : (
          <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Crown className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                Plain-English Clause Rewrite
              </span>
              <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-[10px]">
                Driver Pro
              </Badge>
            </div>
            <p className="text-[11px] text-foreground/90 leading-relaxed">
              Paste a confusing clause and get a plain-English explanation, why it may matter,
              and questions to ask before approving. Available on Driver Pro.
            </p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Basic contract viewing, risk flags, and driver approval decisions remain accessible
              on the Free plan. If the driver also signs, an in-app signature record is stored.
            </p>
            <Button
              variant="default"
              size="sm"
              className="gap-1.5"
              onClick={() => navigate('/pricing')}
            >
              <Crown className="h-4 w-4" /> Upgrade to Pro
            </Button>
          </div>
        )
      )}
    </div>

  );
}


interface RewriteResult {
  plain_english: string;
  why_it_matters: string;
  questions_to_ask: string[];
  reminder: string;
}

function ClauseRewriteCard({ applicationId }: { applicationId: string }) {
  const [text, setText] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<RewriteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const MIN = 20;
  const MAX = 5000;
  const len = text.trim().length;

  const handleExplain = async () => {
    setError(null);
    setResult(null);
    if (len < MIN) {
      setError(`Please paste at least ${MIN} characters of clause text.`);
      return;
    }
    if (len > MAX) {
      setError(`Clause is too long (max ${MAX} characters).`);
      return;
    }
    setIsRunning(true);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke('rewrite-contract-clause', {
        body: { application_id: applicationId, clause_text: text.trim() },
      });
      if (invokeErr) throw new Error(invokeErr.message || 'Could not get explanation');
      if (!data?.ok || !data?.result) throw new Error(data?.error || 'No explanation returned');
      setResult(data.result as RewriteResult);
    } catch (e) {
      const msg = (e as Error).message || 'Could not get explanation';
      setError(msg);
      toast.error(msg);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wider text-primary">
          Plain-English Clause Rewrite
        </span>
        <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-[10px]">
          Driver Pro
        </Badge>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Paste a confusing clause from the contract and get a plain-English explanation, why it
        may matter, and questions to ask before approving. Informational only — not legal advice.
      </p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX))}
        placeholder="Paste the clause text here (e.g., escrow terms, chargebacks, termination penalty…)"
        aria-label="Paste contract clause to explain"
        rows={4}
        className="text-xs"
        disabled={isRunning}
      />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[10px] text-muted-foreground">
          {len}/{MAX} characters
        </span>
        <Button
          variant="default"
          size="sm"
          className="gap-1.5"
          onClick={handleExplain}
          disabled={isRunning || len < MIN}
        >
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Explain This Clause
        </Button>
      </div>
      {error && (
        <p className="text-[11px] text-red-400 break-words">{error}</p>
      )}
      {result && (
        <div className="space-y-2 mt-1">
          <div className="rounded-md border border-border/60 bg-background/40 p-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Plain-English meaning
            </p>
            <p className="text-xs text-foreground/90 whitespace-pre-wrap break-words">
              {result.plain_english}
            </p>
          </div>
          {result.why_it_matters && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300 mb-1">
                Why this may matter
              </p>
              <p className="text-xs text-amber-100/90 whitespace-pre-wrap break-words">
                {result.why_it_matters}
              </p>
            </div>
          )}
          {result.questions_to_ask?.length > 0 && (
            <div className="rounded-md border border-primary/30 bg-primary/10 p-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-primary mb-1">
                Questions to ask before approving
              </p>
              <ul className="text-xs text-foreground/90 space-y-1 list-disc pl-4">
                {result.questions_to_ask.map((q, i) => (
                  <li key={i} className="break-words">{q}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground italic leading-relaxed">
            {result.reminder}
          </p>
        </div>
      )}
    </div>
  );
}
