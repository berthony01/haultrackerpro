import { useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Upload, Eye, AlertCircle, Loader2 } from 'lucide-react';
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

export function ContractAttachment({ applicationId, role }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isViewLoading, setIsViewLoading] = useState(false);
  const { contractWithVersion, isLoading, uploadContract, getSignedViewUrl } =
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

  const hasContract = !!contractWithVersion?.current_version;
  const status = contractWithVersion?.contract.status ?? null;
  const fileName = contractWithVersion?.current_version?.file_name;
  const versionNumber = contractWithVersion?.current_version?.version_number;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Contract
          </span>
          <StatusBadge status={hasContract ? status : null} />
        </div>
        {role === 'recruiter' && (
          <div className="flex gap-2">
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
      {role === 'driver' && !hasContract && !isLoading && (
        <p className="text-[11px] text-muted-foreground">
          The recruiter has not attached a contract for this application yet.
        </p>
      )}
    </div>
  );
}
