import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, Building2, User, MapPin, Hash, FileText, Calendar, PenLine } from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface Props {
  applicationId: string;
  role: 'driver' | 'recruiter';
}

const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  try { return format(parseISO(iso), 'MM/dd/yyyy'); } catch { return '—'; }
};

const statusPill = (s?: string | null) => (
  <Badge variant="outline" className="capitalize text-[10px] py-0.5 px-1.5">
    {(s ?? '—').replace(/_/g, ' ')}
  </Badge>
);

/**
 * Auto-filled platform contract record (Part 2).
 * Does NOT modify the uploaded contract PDF. Only displays connected application/
 * recruiter/opportunity context the user is already authorized to see via RLS.
 */
export function ContractSummaryPanel({ applicationId, role }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['contract-summary-panel', applicationId, role],
    enabled: !!applicationId,
    queryFn: async () => {
      // Phase 28A: fetch application + opportunity + recruiter card via safe
      // RPC. Recruiters no longer have direct SELECT on opportunity_applications
      // or recruiter_profiles; the RPC is gated to application parties + admins
      // and never returns driver_phone_snapshot / driver_email_snapshot /
      // admin_notes / verified_by.
      const { data: summary, error: sumErr } = await (supabase as any).rpc(
        'get_application_contract_summary',
        { _application_id: applicationId },
      );
      if (sumErr) throw sumErr;
      if (!summary) return null;
      const app = summary as any;
      const rp = app.recruiter ?? null;

      // Contract + current version + driver signature
      const { data: contract } = await supabase
        .from('contracts')
        .select('id,status,current_version_id,updated_at')
        .eq('application_id', applicationId)
        .maybeSingle();

      let version: { version_number: number; uploaded_at: string | null } | null = null;
      let signedAt: string | null = null;
      let driverReviewDecision: string | null = null;

      if (contract?.current_version_id) {
        const { data: v } = await supabase
          .from('contract_versions')
          .select('version_number,uploaded_at')
          .eq('id', contract.current_version_id)
          .maybeSingle();
        version = v as any;

        const { data: sig } = await supabase
          .from('contract_signatures')
          .select('signed_at')
          .eq('contract_id', contract.id)
          .eq('version_id', contract.current_version_id)
          .eq('signer_role', 'driver')
          .order('signed_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        signedAt = (sig as any)?.signed_at ?? null;

        const { data: rev } = await supabase
          .from('contract_reviews')
          .select('decision')
          .eq('contract_id', contract.id)
          .eq('version_id', contract.current_version_id)
          .eq('reviewer_role', 'driver')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        driverReviewDecision = (rev as any)?.decision ?? null;
      }

      return { app, recruiter: rp, contract, version, signedAt, driverReviewDecision };
    },
  });

  if (isLoading || !data) return null;

  const { app, recruiter, contract, version, signedAt, driverReviewDecision } = data as any;
  const opp = app.opportunities;
  const isVerified = recruiter?.verification_status === 'approved' && recruiter?.status !== 'suspended';
  const location = [recruiter?.company_city, recruiter?.company_state].filter(Boolean).join(', ');
  const mcDot = [recruiter?.mc_number && `MC ${recruiter.mc_number}`, recruiter?.dot_number && `DOT ${recruiter.dot_number}`]
    .filter(Boolean).join(' · ');

  const paySummary = opp ? buildPaySummary(opp) : null;

  return (
    <div className="rounded-lg border border-border/60 bg-background/60 p-3 mb-2">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Contract details
          </h4>
        </div>
        {isVerified && role === 'driver' && (
          <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 gap-1" variant="outline">
            <ShieldCheck className="h-3 w-3" /> Verified Recruiter
          </Badge>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {role === 'driver' ? (
          <>
            <Row icon={Building2} label="Company" value={recruiter?.company_name ?? opp?.company_name ?? '—'} />
            <Row icon={User} label="Recruiter" value={recruiter?.recruiter_name ?? '—'} />
            <Row icon={FileText} label="Opportunity" value={opp?.title ?? '—'} />
            {paySummary && <Row icon={Hash} label="Pay" value={paySummary} />}
            {location && <Row icon={MapPin} label="Location" value={location} />}
            {mcDot && <Row icon={Hash} label="Authority" value={mcDot} />}
          </>
        ) : (
          <>
            <Row icon={User} label="Driver" value={app.driver_profile?.full_name ?? '—'} />
            <Row icon={FileText} label="Opportunity" value={opp?.title ?? '—'} />
            <RowNode icon={Calendar} label="Application status">{statusPill(app.status)}</RowNode>
            <RowNode icon={FileText} label="Contract status">{statusPill(contract?.status)}</RowNode>
            <RowNode icon={PenLine} label="Driver decision">
              {statusPill(driverReviewDecision ?? 'pending')}
            </RowNode>
            <RowNode icon={PenLine} label="Signature">
              {signedAt
                ? <Badge variant="outline" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px]">Signed {fmtDate(signedAt)}</Badge>
                : <Badge variant="outline" className="text-[10px]">Not signed</Badge>}
            </RowNode>
          </>
        )}

        {role === 'driver' && (
          <>
            <RowNode icon={Calendar} label="Application status">{statusPill(app.status)}</RowNode>
            <RowNode icon={FileText} label="Contract status">{statusPill(contract?.status)}</RowNode>
            {version && (
              <Row icon={Calendar} label="Uploaded" value={`${fmtDate(version.uploaded_at)} · v${version.version_number}`} />
            )}
          </>
        )}
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground leading-snug">
        Auto-filled from this application. Does not modify the uploaded contract PDF.
      </p>
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium text-foreground truncate">{value}</span>
    </div>
  );
}

function RowNode({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">{label}:</span>
      {children}
    </div>
  );
}

function buildPaySummary(opp: any): string | null {
  if (opp.flat_weekly_pay) return `$${Number(opp.flat_weekly_pay).toLocaleString()} /wk flat`;
  if (opp.cpm) return `${Number(opp.cpm).toFixed(2)} CPM`;
  if (opp.percentage_pay) return `${Number(opp.percentage_pay)}%`;
  if (opp.estimated_weekly_gross) return `~$${Number(opp.estimated_weekly_gross).toLocaleString()} /wk est.`;
  return null;
}
