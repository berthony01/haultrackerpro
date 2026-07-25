import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, ClipboardPaste, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

export interface ExtractedOpportunity {
  title?: string;
  company_name?: string;
  hiring_city?: string;
  hiring_state?: string;
  hiring_states?: string[];
  driver_type?: string;
  route_type?: string;
  trailer_type?: string;
  description?: string;
  pay_model?: string;
  cpm?: number;
  percentage_pay?: number;
  flat_weekly_pay?: number;
  estimated_weekly_gross?: number;
  estimated_weekly_miles?: number;
  estimated_loaded_miles?: number;
  estimated_deadhead_miles?: number;
  deadhead_paid?: boolean;
  detention_pay?: string;
  layover_pay?: string;
  sign_on_bonus?: number;
  fuel_paid_by?: string;
  insurance_deductions?: number;
  escrow_required?: boolean;
  escrow_amount?: number;
  lease_payment?: number;
  maintenance_deductions?: number;
  other_deductions?: number;
  home_time?: string;
  forced_dispatch?: boolean;
  pets_allowed?: boolean;
  riders_allowed?: boolean;
  equipment_year?: string;
  benefits?: string;
  typical_lanes?: string;
  requirements?: string;
}

/**
 * Centralized opportunity extraction — the single Supabase invocation used by
 * both the paste dialog and the inline `Extract details` action on the
 * recruiter authoring form. All callers must funnel through this function so
 * the AI-extraction contract stays in one place.
 */
export async function extractOpportunityFromText(text: string): Promise<ExtractedOpportunity> {
  const trimmed = text.trim();
  if (trimmed.length < 30) {
    throw new Error('Paste at least a short opportunity description first.');
  }
  const { data, error } = await supabase.functions.invoke('ai-insight', {
    body: { type: 'parse_opportunity', context: { text: trimmed } },
  });
  if (error) throw new Error(error.message || 'Extraction failed');
  const parsed = (data as { parsed?: ExtractedOpportunity })?.parsed;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI returned no structured data. Try cleaner text.');
  }
  return parsed;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExtracted: (data: ExtractedOpportunity) => void;
}

export function PasteOpportunityDialog({ open, onOpenChange, onExtracted }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const handlePasteFromClipboard = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip) setText(clip);
    } catch {
      toast.error('Could not read clipboard. Paste manually instead.');
    }
  };

  const handleExtract = async () => {
    setBusy(true);
    try {
      const parsed = await extractOpportunityFromText(text);
      onExtracted(parsed);
      toast.success('Fields extracted. Review and adjust before submitting.');
      setText('');
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Extraction failed';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Paste Opportunity to Auto-Fill
          </DialogTitle>
          <DialogDescription>
            Paste a job posting, recruiter pitch, or rate sheet. We'll extract the fields
            (pay, CPM, miles, home time, etc.) so you don't have to retype them. Review
            before submitting.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePasteFromClipboard}
              disabled={busy}
            >
              <ClipboardPaste className="h-4 w-4" /> Paste from clipboard
            </Button>
            {text && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setText('')}
                disabled={busy}
              >
                <X className="h-4 w-4" /> Clear
              </Button>
            )}
          </div>

          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            placeholder={'Example:\n\nABC Logistics is hiring company drivers for regional dry van runs out of Dallas, TX. Pay is $0.65/mile, average 2,800 miles per week. Home weekends. No-touch freight. Sign-on bonus $2,000. 1 year experience required.'}
            disabled={busy}
            className="font-mono text-xs"
          />

          <p className="text-[11px] text-muted-foreground">
            We send only the text you paste to our AI extractor. Nothing is saved until you click Submit on the form.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleExtract} disabled={busy || text.trim().length < 30}>
            {busy ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Extracting…</>
            ) : (
              <><Sparkles className="h-4 w-4" /> Extract Fields</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
