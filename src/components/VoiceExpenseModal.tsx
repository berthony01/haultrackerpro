import { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Mic, MicOff, Loader2, Keyboard, Check } from 'lucide-react';
import { parseExpenseText, ParsedExpense } from '@/lib/parseExpenseText';
import { useExpenseAutomation } from '@/hooks/useExpenseAutomation';
import { toast } from 'sonner';

interface VoiceExpenseModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAutofill: (parsed: ParsedExpense) => void;
}

const SpeechRecognitionAPI =
  typeof window !== 'undefined'
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

export function VoiceExpenseModal({ open, onOpenChange, onAutofill }: VoiceExpenseModalProps) {
  const { checkLimit, logAutomation } = useExpenseAutomation();
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [parsed, setParsed] = useState<ParsedExpense | null>(null);
  const [fallbackMode, setFallbackMode] = useState(!SpeechRecognitionAPI);
  const [manualText, setManualText] = useState('');
  const recognitionRef = useRef<any>(null);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setIsListening(false);
      setTranscript('');
      setParsed(null);
      setManualText('');
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
    }
  }, [open]);

  const startListening = useCallback(() => {
    const { allowed } = checkLimit();
    if (!allowed) {
      toast.error('Usage limit reached (200/month). Contact support.');
      return;
    }
    if (!SpeechRecognitionAPI) {
      setFallbackMode(true);
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript;
      setTranscript(text);
      const result = parseExpenseText(text);
      setParsed(result);
      setIsListening(false);
    };

    recognition.onerror = () => {
      setIsListening(false);
      toast.error('Could not recognize speech. Try again or type below.');
      setFallbackMode(true);
    };

    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
    setTranscript('');
    setParsed(null);
  }, [checkLimit]);

  const handleParseManual = () => {
    const { allowed } = checkLimit();
    if (!allowed) {
      toast.error('Usage limit reached (200/month). Contact support.');
      return;
    }
    if (!manualText.trim()) return;
    const result = parseExpenseText(manualText.trim());
    setTranscript(manualText.trim());
    setParsed(result);
  };

  const handleConfirm = () => {
    if (!parsed) return;
    logAutomation.mutate({
      source: 'voice',
      raw_text: transcript,
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
            <Mic className="h-5 w-5 text-primary" />
            Voice Log Expense
          </DialogTitle>
          <DialogDescription className="text-xs">
            {fallbackMode
              ? 'Type or paste your expense description below.'
              : 'Speak your expense (e.g. "Fuel $85 today at Pilot")'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Voice recording */}
          {!fallbackMode && (
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={isListening ? () => { recognitionRef.current?.stop(); setIsListening(false); } : startListening}
                className={`rounded-full p-6 transition-all duration-300 ${
                  isListening
                    ? 'bg-destructive/10 text-destructive animate-pulse'
                    : 'bg-primary/10 text-primary hover:bg-primary/20'
                }`}
              >
                {isListening ? <MicOff className="h-8 w-8" /> : <Mic className="h-8 w-8" />}
              </button>
              <p className="text-xs text-muted-foreground">
                {isListening ? 'Listening... tap to stop' : 'Tap to start'}
              </p>
              {!SpeechRecognitionAPI ? null : (
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => setFallbackMode(true)}>
                  <Keyboard className="h-3.5 w-3.5 mr-1" /> Type instead
                </Button>
              )}
            </div>
          )}

          {/* Text fallback */}
          {fallbackMode && !parsed && (
            <div className="space-y-2">
              <Label className="text-xs">Describe the expense</Label>
              <Textarea
                placeholder='e.g. "Fuel $85 today at Pilot"'
                rows={3}
                value={manualText}
                onChange={e => setManualText(e.target.value)}
              />
              <div className="flex gap-2">
                <Button onClick={handleParseManual} className="flex-1 h-10 font-bold" disabled={!manualText.trim()}>
                  Parse
                </Button>
                {SpeechRecognitionAPI && (
                  <Button variant="outline" size="icon" onClick={() => setFallbackMode(false)}>
                    <Mic className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Parsed preview */}
          {parsed && (
            <div className="space-y-3 animate-fade-in">
              <div className="rounded-xl bg-muted p-3 space-y-1.5">
                <p className="text-xs text-muted-foreground">Transcript:</p>
                <p className="text-sm italic">"{transcript}"</p>
              </div>
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
              <Button onClick={handleConfirm} className="w-full h-11 font-bold">
                <Check className="h-4 w-4 mr-2" />
                Fill Form
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
