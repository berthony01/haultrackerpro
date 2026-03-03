import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Camera, Loader2, Check, Upload } from 'lucide-react';
import { parseReceiptText, ParsedExpense } from '@/lib/parseExpenseText';
import { useExpenseAutomation } from '@/hooks/useExpenseAutomation';
import { toast } from 'sonner';

interface ReceiptScanModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAutofill: (parsed: ParsedExpense) => void;
}

export function ReceiptScanModal({ open, onOpenChange, onAutofill }: ReceiptScanModalProps) {
  const { checkLimit, logAutomation } = useExpenseAutomation();
  const [scanning, setScanning] = useState(false);
  const [rawText, setRawText] = useState('');
  const [parsed, setParsed] = useState<ParsedExpense | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setScanning(false);
      setRawText('');
      setParsed(null);
      setPreview(null);
    }
  }, [open]);

  const handleFile = async (file: File) => {
    const { allowed } = checkLimit();
    if (!allowed) {
      toast.error('Usage limit reached (200/month). Contact support.');
      return;
    }

    // Show preview
    const url = URL.createObjectURL(file);
    setPreview(url);
    setScanning(true);
    setParsed(null);

    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng');
      const { data } = await worker.recognize(file);
      await worker.terminate();

      const text = data.text;
      setRawText(text);

      const result = parseReceiptText(text);
      setParsed(result);
    } catch (err) {
      toast.error('Failed to scan receipt. Please try a clearer image.');
    } finally {
      setScanning(false);
    }
  };

  const handleConfirm = () => {
    if (!parsed) return;
    logAutomation.mutate({
      source: 'receipt',
      raw_text: rawText,
      parsed_json: parsed as any,
      parse_confidence: parsed.confidence,
    });
    onAutofill(parsed);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <Camera className="h-5 w-5 text-primary" />
            Scan Receipt
          </DialogTitle>
          <DialogDescription className="text-xs">
            Upload a photo of your receipt to auto-fill the expense form.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />

          {!parsed && !scanning && (
            <Button
              variant="outline"
              className="w-full h-28 flex-col gap-2 rounded-xl border-dashed border-2 border-primary/30 hover:border-primary"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-8 w-8 text-primary" />
              <span className="text-sm font-bold">Upload Receipt Image</span>
              <span className="text-[11px] text-muted-foreground">JPG, PNG, or take a photo</span>
            </Button>
          )}

          {scanning && (
            <div className="flex flex-col items-center gap-3 py-6">
              {preview && (
                <img src={preview} alt="Receipt" className="w-24 h-24 object-cover rounded-xl border" />
              )}
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Scanning receipt...</p>
            </div>
          )}

          {parsed && (
            <div className="space-y-3 animate-fade-in">
              {preview && (
                <img src={preview} alt="Receipt" className="w-full max-h-32 object-contain rounded-xl border" />
              )}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-muted/50 p-2">
                  <span className="text-label">Amount</span>
                  <p className="font-bold">{parsed.amount != null ? `$${parsed.amount.toFixed(2)}` : '—'}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-2">
                  <span className="text-label">Category</span>
                  <p className="font-bold">{parsed.category ?? '—'}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-2">
                  <span className="text-label">Date</span>
                  <p className="font-bold">{parsed.date ?? '—'}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-2">
                  <span className="text-label">Confidence</span>
                  <p className="font-bold">{Math.round(parsed.confidence * 100)}%</p>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Only empty fields in the form will be filled. Your existing entries are preserved.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => { setParsed(null); setPreview(null); setRawText(''); }}>
                  Retry
                </Button>
                <Button onClick={handleConfirm} className="flex-1 font-bold">
                  <Check className="h-4 w-4 mr-2" />
                  Fill Form
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
