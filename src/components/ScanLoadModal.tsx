import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Camera, Loader2, Check, Image as ImageIcon, AlertCircle, Sparkles, RefreshCw, ShieldCheck } from 'lucide-react';
import { parseLoadText, ParsedLoadData } from '@/lib/parseLoadText';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ScanLoadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onParsed: (data: ParsedLoadData) => void;
}

/** Try AI parsing of OCR text, fall back to regex */
async function parseWithAI(ocrText: string): Promise<{ data: ParsedLoadData; usedAI: boolean }> {
  try {
    const { data, error } = await supabase.functions.invoke('ai-insight', {
      body: { type: 'parse_ratecon', context: { text: ocrText } },
    });

    if (error) throw error;

    const parsed = data?.parsed;
    if (parsed && (parsed.pickup_location || parsed.estimated_pay)) {
      const result: ParsedLoadData = {
        pickup_location: parsed.pickup_location || undefined,
        dropoff_location: parsed.dropoff_location || undefined,
        load_date: parsed.load_date || undefined,
        loaded_miles: parsed.loaded_miles?.toString() || undefined,
        rate_per_mile: parsed.rate_per_mile?.toString() || undefined,
        gross_revenue: parsed.estimated_pay?.toString() || undefined,
        notes: parsed.notes || undefined,
        multiStopDetected: parsed.stops && parsed.stops.length > 2,
        detectedStopsCount: parsed.stops?.length,
        stops: parsed.stops?.map((s: any) => ({
          location: s.location,
          stop_type: s.stop_type || 'Stop',
        })),
      };
      return { data: result, usedAI: true };
    }
  } catch (err) {
    console.error('AI rate con parsing failed, falling back to regex:', err);
  }

  return { data: parseLoadText(ocrText), usedAI: false };
}

export function ScanLoadModal({ open, onOpenChange, onParsed }: ScanLoadModalProps) {
  const [scanning, setScanning] = useState(false);
  const [_rawText, setRawText] = useState('');
  const [parsed, setParsed] = useState<ParsedLoadData | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fieldCount, setFieldCount] = useState(0);
  const [usedAI, setUsedAI] = useState(false);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setScanning(false);
      setRawText('');
      setParsed(null);
      setPreview(null);
      setFieldCount(0);
      setUsedAI(false);
    }
  }, [open]);

  const handleFile = async (file: File) => {
    const url = URL.createObjectURL(file);
    setPreview(url);
    setScanning(true);
    setParsed(null);
    setUsedAI(false);

    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng');
      const { data } = await worker.recognize(file);
      await worker.terminate();

      const text = data.text;
      setRawText(text);

      if (!text || text.trim().length < 10) {
        toast.error('Could not read text from this image. Try a clearer photo.');
        setScanning(false);
        return;
      }

      // Try AI first, then regex fallback
      const { data: result, usedAI: ai } = await parseWithAI(text);
      setUsedAI(ai);

      const count = Object.entries(result)
        .filter(([key, val]) => val && key !== 'multiStopDetected' && key !== 'detectedStopsCount' && key !== 'stops')
        .length;

      if (count === 0) {
        toast.error('Could not extract load details. Try a clearer photo or use the paste parser instead.');
        setScanning(false);
        return;
      }

      setParsed(result);
      setFieldCount(count);
    } catch {
      toast.error('Failed to scan image. Please try a clearer photo.');
    } finally {
      setScanning(false);
    }
  };

  const handleConfirm = () => {
    if (!parsed) return;
    onParsed(parsed);
    onOpenChange(false);
    const extra = parsed.multiStopDetected ? ` (${parsed.detectedStopsCount} stops detected)` : '';
    toast.success(`Filled ${fieldCount} field${fieldCount > 1 ? 's' : ''}${extra} — please review`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <Camera className="h-5 w-5 text-primary" />
            Scan Rate Confirmation
          </DialogTitle>
          <DialogDescription className="text-xs">
            Upload a screenshot or photo of your rate con to auto-fill the load form.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
          <input
            ref={cameraRef}
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

          {/* Upload buttons */}
          {!parsed && !scanning && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  className="h-24 flex-col gap-1.5 rounded-xl border-dashed border-2 border-primary/30 hover:border-primary"
                  onClick={() => galleryRef.current?.click()}
                >
                  <ImageIcon className="h-6 w-6 text-primary" />
                  <span className="text-xs font-bold">Choose from Gallery</span>
                  <span className="text-[10px] text-muted-foreground">Existing screenshot</span>
                </Button>
                <Button
                  variant="outline"
                  className="h-24 flex-col gap-1.5 rounded-xl border-dashed border-2 border-primary/30 hover:border-primary"
                  onClick={() => cameraRef.current?.click()}
                >
                  <Camera className="h-6 w-6 text-primary" />
                  <span className="text-xs font-bold">Take Photo</span>
                  <span className="text-[10px] text-muted-foreground">Use camera now</span>
                </Button>
              </div>
              <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-2.5">
                <ShieldCheck className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Image is processed on your device and never uploaded or stored. Always review extracted fields before saving.
                </p>
              </div>
            </div>
          )}

          {/* Scanning state */}
          {scanning && (
            <div className="flex flex-col items-center gap-3 py-6">
              {preview && (
                <img src={preview} alt="Rate con preview" className="w-28 h-28 object-cover rounded-xl border" />
              )}
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm font-bold text-foreground">Extracting load details…</p>
              <p className="text-[11px] text-muted-foreground">Reading text and parsing with AI</p>
            </div>
          )}

          {/* Parsed results */}
          {parsed && (
            <div className="space-y-3 animate-fade-in">
              {preview && (
                <img src={preview} alt="Rate con" className="w-full max-h-32 object-contain rounded-xl border" />
              )}

              {usedAI && (
                <div className="flex items-center gap-1.5 px-2">
                  <Sparkles className="h-3 w-3 text-primary" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary">AI-Enhanced Extraction</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-sm">
                {parsed.pickup_location && (
                  <div className="rounded-lg bg-muted/50 p-2 col-span-2">
                    <span className="text-label">Pickup</span>
                    <p className="font-bold text-xs">{parsed.pickup_location}</p>
                  </div>
                )}
                {parsed.dropoff_location && (
                  <div className="rounded-lg bg-muted/50 p-2 col-span-2">
                    <span className="text-label">Drop-off</span>
                    <p className="font-bold text-xs">{parsed.dropoff_location}</p>
                  </div>
                )}
                {parsed.loaded_miles && (
                  <div className="rounded-lg bg-muted/50 p-2">
                    <span className="text-label">Miles</span>
                    <p className="font-bold">{parsed.loaded_miles}</p>
                  </div>
                )}
                {parsed.rate_per_mile && (
                  <div className="rounded-lg bg-muted/50 p-2">
                    <span className="text-label">Rate/Mile</span>
                    <p className="font-bold">${parsed.rate_per_mile}</p>
                  </div>
                )}
                {parsed.gross_revenue && (
                  <div className="rounded-lg bg-muted/50 p-2">
                    <span className="text-label">Gross Revenue</span>
                    <p className="font-bold">${parsed.gross_revenue}</p>
                  </div>
                )}
                {parsed.load_date && (
                  <div className="rounded-lg bg-muted/50 p-2">
                    <span className="text-label">Date</span>
                    <p className="font-bold">{parsed.load_date}</p>
                  </div>
                )}
              </div>

              {parsed.multiStopDetected && (
                <div className="flex items-start gap-2 rounded-lg bg-primary/5 p-2.5">
                  <AlertCircle className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                  <p className="text-[11px] text-muted-foreground">
                    {parsed.detectedStopsCount} stops detected — they'll be pre-filled in the multi-stop editor.
                  </p>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground">
                {fieldCount} field{fieldCount > 1 ? 's' : ''} extracted. Only empty fields in the form will be filled. Always review before saving.
              </p>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setParsed(null);
                    setPreview(null);
                    setRawText('');
                    setFieldCount(0);
                    setUsedAI(false);
                  }}
                >
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
