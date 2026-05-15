import { useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Upload, Eye, AlertCircle, Loader2, Sparkles, CheckCircle2, XCircle, ShieldAlert, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useApplicationContract } from '@/hooks/contracts/useApplicationContract';

interface Props {
  applicationId: string;
  /** 'recruiter' shows upload + replace; 'driver' shows view-only. */
  role: 'recruiter' | 'driver';
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

export function ContractAttachment({ applicationId, role }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isViewLoading, setIsViewLoading] = useState(false);
  const { contractWithVersion, isLoading, uploadContract, getSignedViewUrl, parseContract, analyzeContract } =
    useApplicationContract(applicationId);

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
  const aiReview = contractWithVersion?.ai_review ?? null;
  const findings = (aiReview?.ai_findings as { risk_score?: number; risk_tier?: string; top_red_flags?: string[]; truncated?: boolean } | null) ?? null;
  const riskScore = typeof findings?.risk_score === 'number' ? findings.risk_score : (contractWithVersion?.contract.risk_score ?? null);
  const riskTier = (findings?.risk_tier || contractWithVersion?.contract.risk_tier || '').toLowerCase();
  const tierStyle = riskTier && TIER_STYLES[riskTier] ? TIER_STYLES[riskTier] : null;
  const canAnalyze = hasContract && parseStatus === 'parsed' && (role === 'recruiter');
  const showAnalyzeBtn = canAnalyze && (!aiReview || role === 'recruiter');

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Contract
          </span>
          <StatusBadge status={hasContract ? status : null} />
          {hasContract && <ParseStatusBadge status={parseStatus} />}
          {tierStyle && (
            <Badge variant="outline" className={`gap-1 ${tierStyle.cls}`}>
              <tierStyle.Icon className="h-3 w-3" /> {tierStyle.label}
              {typeof riskScore === 'number' ? ` · ${Math.round(Number(riskScore))}/100` : ''}
            </Badge>
          )}
        </div>
        {role === 'recruiter' && (
          <div className="flex flex-wrap gap-2">
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
            {hasContract && (
              <Button variant="ghost" size="sm" onClick={handleView} disabled={isViewLoading}>
                {isViewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                View
              </Button>
            )}
            {hasContract && parseStatus !== 'parsed' && (
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
                {aiReview ? 'Refresh AI Review' : 'Run AI Risk Review'}
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
      {aiReview && (
        <div className="mt-2 rounded-md border border-border/60 bg-background/40 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              AI Risk Summary
            </span>
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
          <p className="text-[10px] text-muted-foreground italic">
            AI review is educational only and not legal advice. Consider asking a qualified
            professional to review this contract before signing.
          </p>
        </div>
      )}
      {role === 'driver' && !hasContract && !isLoading && (
        <p className="text-[11px] text-muted-foreground">
          The recruiter has not attached a contract for this application yet.
        </p>
      )}
    </div>
  );
}

