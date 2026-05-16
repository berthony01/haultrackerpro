import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, Download, Loader2, Lock, Crown, AlertCircle, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { format, startOfMonth, endOfMonth, subDays } from 'date-fns';
import { useRecruiterReportData } from '@/hooks/recruiter/useRecruiterReportData';
import {
  aggregateRecruiterReport,
  REPORT_TYPE_LABEL,
  type RecruiterReportType,
  type RecruiterReportRange,
} from '@/lib/recruiterReports/aggregator';
import { buildRecruiterReportCSV, downloadCSV } from '@/lib/recruiterReports/csv';
import { buildRecruiterReportPDF, downloadBlob } from '@/lib/recruiterReports/pdf';

interface Props {
  onBack?: () => void;
  onUpgrade?: () => void;
}

const today = () => format(new Date(), 'yyyy-MM-dd');

const presets: { label: string; from: string; to: string }[] = [
  { label: 'Last 7 days', from: format(subDays(new Date(), 7), 'yyyy-MM-dd'), to: today() },
  { label: 'Last 30 days', from: format(subDays(new Date(), 30), 'yyyy-MM-dd'), to: today() },
  { label: 'This month', from: format(startOfMonth(new Date()), 'yyyy-MM-dd'), to: format(endOfMonth(new Date()), 'yyyy-MM-dd') },
];

export function RecruiterReportsPanel({ onBack, onUpgrade }: Props) {
  const [from, setFrom] = useState<string>(presets[1].from);
  const [to, setTo] = useState<string>(presets[1].to);
  const [type, setType] = useState<RecruiterReportType>('activity');
  const [fmt, setFmt] = useState<'pdf' | 'csv'>('pdf');
  const [busy, setBusy] = useState(false);

  const range: RecruiterReportRange = useMemo(
    () => ({ from, to, label: `${from} to ${to}` }),
    [from, to]
  );

  const { data, isLoading, isError, planEligible, planLabel, billingPlan } =
    useRecruiterReportData(range, true);

  // Free / Starter recruiters see a locked preview, never the generator.
  if (!isLoading && !planEligible) {
    return (
      <div className="space-y-4">
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        )}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Recruiter Reports</CardTitle>
            </div>
            <CardDescription>
              Activity and Pipeline reports (PDF + CSV) are included with Growth and Fleet plans.
              Your current plan: <span className="font-medium text-foreground">{planLabel}</span>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
              <li>Recruiter Activity Report (PDF + CSV)</li>
              <li>Recruiter Pipeline Report (PDF + CSV)</li>
              <li>Application status &amp; contract status summaries</li>
              <li>Top-performing opportunities &amp; plan-usage snapshot</li>
            </ul>
            <p className="text-xs text-muted-foreground">
              Reports include recruiter-owned data only — never driver loads, expenses, fuel, profit, or tax data.
            </p>
            <Button onClick={onUpgrade} className="gap-2">
              <Crown className="h-4 w-4" /> Upgrade to Growth or Fleet
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const generate = async () => {
    if (!data) {
      toast.error('Report data not loaded yet');
      return;
    }
    if (!from || !to || from > to) {
      toast.error('Pick a valid date range');
      return;
    }
    setBusy(true);
    try {
      const aggregate = aggregateRecruiterReport(data);
      const stamp = format(new Date(), 'yyyyMMdd-HHmm');
      const baseName = `haultrackerpro-recruiter-${type}-${stamp}`;
      if (fmt === 'csv') {
        const csv = buildRecruiterReportCSV(type, aggregate);
        downloadCSV(`${baseName}.csv`, csv);
      } else {
        const blob = buildRecruiterReportPDF(type, aggregate);
        downloadBlob(`${baseName}.pdf`, blob);
      }
      toast.success(`${REPORT_TYPE_LABEL[type]} ready`);
    } catch (e: any) {
      toast.error(e?.message || 'Could not generate report');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {onBack && (
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <FileText className="h-5 w-5 text-primary" />
            <CardTitle>Recruiter Reports</CardTitle>
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 capitalize">
              {billingPlan} plan
            </Badge>
          </div>
          <CardDescription>
            Build Activity or Pipeline reports for any date range. Includes recruiter-owned data only —
            no driver financial, load, expense, fuel, or profit data is ever included.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 text-destructive" />
              <span>Could not load report data. Try again in a moment.</span>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {presets.map(p => (
              <Button
                key={p.label}
                variant="outline"
                size="sm"
                onClick={() => { setFrom(p.from); setTo(p.to); }}
              >
                {p.label}
              </Button>
            ))}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rep-from">From</Label>
              <Input id="rep-from" type="date" value={from} onChange={e => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rep-to">To</Label>
              <Input id="rep-to" type="date" value={to} onChange={e => setTo(e.target.value)} />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Report type</Label>
              <Select value={type} onValueChange={(v) => setType(v as RecruiterReportType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="activity">Recruiter Activity Report</SelectItem>
                  <SelectItem value="pipeline">Recruiter Pipeline Report</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Format</Label>
              <Select value={fmt} onValueChange={(v) => setFmt(v as 'pdf' | 'csv')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pdf">PDF</SelectItem>
                  <SelectItem value="csv">CSV</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={generate}
            disabled={busy || isLoading || !data}
            className="gap-2 w-full sm:w-auto"
          >
            {busy || isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Generate &amp; download
          </Button>

          <p className="text-[11px] text-muted-foreground">
            Generated by HaulTrackerPro.com — recruiter-owned data only.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
