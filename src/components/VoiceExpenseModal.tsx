import { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Mic, MicOff, Loader2, Keyboard, Check, Square } from 'lucide-react';
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

// How long to wait after the last word before auto-stopping (ms)
const SILENCE_TIMEOUT = 3000;

export function VoiceExpenseModal({ open, onOpenChange, onAutofill }: VoiceExpenseModalProps) {
  const { checkLimit, logAutomation } = useExpenseAutomation();
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterimText] = useState('');
  const [parsed, setParsed] = useState<ParsedExpense | null>(null);
  const [fallbackMode, setFallbackMode] = useState(!SpeechRecognitionAPI);
  const [manualText, setManualText] = useState('');
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalTranscriptRef = useRef('');

  // Clear silence timer
  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setIsListening(false);
      setTranscript('');
      setInterimText('');
      setParsed(null);
      setManualText('');
      finalTranscriptRef.current = '';
      clearSilenceTimer();
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
    }
  }, [open, clearSilenceTimer]);

  // Stop listening and process the transcript
  const stopAndProcess = useCallback(() => {
    clearSilenceTimer();
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    setIsListening(false);
    setInterimText('');

    const text = finalTranscriptRef.current.trim();
    if (text) {
      setTranscript(text);
      const result = parseExpenseText(text);
      setParsed(result);
    } else {
      toast.error('No speech detected. Try again or type below.');
      setFallbackMode(true);
    }
  }, [clearSilenceTimer]);

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
    recognition.continuous = true;         // Keep listening across pauses
    recognition.interimResults = true;     // Show live text while speaking
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    // Reset state
    finalTranscriptRef.current = '';
    setTranscript('');
    setInterimText('');
    setParsed(null);

    recognition.onresult = (event: any) => {
      let finalText = '';
      let interim = '';

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (finalText) {
        finalTranscriptRef.current = finalText;
        setTranscript(finalText);
      }
      setInterimText(interim);

      // Reset silence timer on every result (speech is still happening)
      clearSilenceTimer();
      silenceTimerRef.current = setTimeout(() => {
        // No new speech for SILENCE_TIMEOUT ms — auto-stop
        stopAndProcess();
      }, SILENCE_TIMEOUT);
    };

    recognition.onerror = (event: any) => {
      clearSilenceTimer();
      setIsListening(false);
      // "no-speech" is not really an error — just means silence
      if (event.error === 'no-speech') {
        toast.error('No speech detected. Try again or type below.');
      } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        toast.error('Microphone permission denied. Check your browser settings.');
      } else {
        toast.error('Could not recognize speech. Try again or type below.');
      }
      setFallbackMode(true);
    };

    recognition.onend = () => {
      // If still supposed to be listening (browser auto-stopped), restart
      // This handles the case where continuous mode times out on some browsers
      if (isListening && recognitionRef.current === recognition) {
        try {
          recognition.start();
        } catch {
          // If restart fails, process what we have
          stopAndProcess();
        }
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);

    // Safety timeout: auto-stop after 30 seconds no matter what
    setTimeout(() => {
      if (recognitionRef.current === recognition) {
        stopAndProcess();
      }
    }, 30000);
  }, [checkLimit, clearSilenceTimer, stopAndProcess, isListening]);

  const handleStop = useCallback(() => {
    stopAndProcess();
  }, [stopAndProcess]);

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
              : 'Speak naturally — e.g. "$85 fuel at Pilot today"'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Voice recording */}
          {!fallbackMode && !parsed && (
            <div className="flex flex-col items-center gap-3">
              {!isListening ? (
                <>
                  <button
                    type="button"
                    onClick={startListening}
                    className="rounded-full p-6 transition-all duration-300 bg-primary/10 text-primary hover:bg-primary/20 active:scale-95"
                  >
                    <Mic className="h-8 w-8" />
                  </button>
                  <p className="text-xs text-muted-foreground">Tap to start speaking</p>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleStop}
                    className="rounded-full p-6 transition-all duration-300 bg-destructive/10 text-destructive animate-pulse"
                  >
                    <Square className="h-8 w-8" />
                  </button>
                  <p className="text-xs text-muted-foreground">Listening... tap to finish</p>

                  {/* Live transcript preview */}
                  <div className="w-full rounded-xl bg-muted/50 p-3 min-h-[48px]">
                    <p className="text-sm">
                      {transcript && <span>{transcript}</span>}
                      {interimText && <span className="text-muted-foreground italic">{transcript ? ' ' : ''}{interimText}</span>}
                      {!transcript && !interimText && (
                        <span className="text-muted-foreground text-xs">Speak now...</span>
                      )}
                    </p>
                  </div>

                  <p className="text-[10px] text-muted-foreground">
                    Auto-stops after 3 seconds of silence
                  </p>
                </>
              )}

              {!isListening && !SpeechRecognitionAPI ? null : (
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => { handleStop(); setFallbackMode(true); }}>
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
                placeholder='e.g. "$85 fuel at Pilot yesterday" or "Tolls $12.50 March 21"'
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
                <p className="text-xs text-muted-foreground">You said:</p>
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
                  <p className="font-bold">{parsed.date ?? 'Today (default)'}</p>
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
                <Button variant="outline" className="flex-1" onClick={() => {
                  setParsed(null);
                  setTranscript('');
                  setInterimText('');
                  finalTranscriptRef.current = '';
                }}>
                  Try Again
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
