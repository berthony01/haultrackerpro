import { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Mic, MicOff, Loader2, Keyboard, Check, Square, Sparkles } from 'lucide-react';
import { parseExpenseText, ParsedExpense } from '@/lib/parseExpenseText';
import { useExpenseAutomation } from '@/hooks/useExpenseAutomation';
import { supabase } from '@/integrations/supabase/client';
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

/** Try AI parsing first, fall back to regex */
async function parseWithAI(text: string): Promise<{ expenses: ParsedExpense[]; usedAI: boolean }> {
  try {
    const { data, error } = await supabase.functions.invoke('ai-insight', {
      body: { type: 'parse_expense', context: { text } },
    });

    if (error) throw error;

    const parsed = data?.parsed;
    if (parsed?.expenses?.length > 0) {
      const mapped: ParsedExpense[] = parsed.expenses.map((e: any) => ({
        amount: e.amount ?? null,
        category: e.category ?? null,
        notes: e.notes ?? null,
        date: e.date ?? null,
        confidence: 0.9,
      }));
      return { expenses: mapped, usedAI: true };
    }
  } catch (err) {
    console.error('AI parse failed, falling back to regex:', err);
  }

  // Fallback to regex
  const result = parseExpenseText(text);
  return { expenses: [result], usedAI: false };
}

export function VoiceExpenseModal({ open, onOpenChange, onAutofill }: VoiceExpenseModalProps) {
  const { checkLimit, logAutomation } = useExpenseAutomation();
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterimText] = useState('');
  const [parsedExpenses, setParsedExpenses] = useState<ParsedExpense[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [usedAI, setUsedAI] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
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
      setParsedExpenses([]);
      setSelectedIdx(0);
      setUsedAI(false);
      setIsParsing(false);
      setManualText('');
      finalTranscriptRef.current = '';
      clearSilenceTimer();
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
    }
  }, [open, clearSilenceTimer]);

  // Process text with AI then regex fallback
  const processText = useCallback(async (text: string) => {
    if (!text.trim()) {
      toast.error('No speech detected. Try again or type below.');
      setFallbackMode(true);
      return;
    }
    setTranscript(text);
    setIsParsing(true);
    try {
      const { expenses, usedAI: ai } = await parseWithAI(text);
      setParsedExpenses(expenses);
      setUsedAI(ai);
      setSelectedIdx(0);
    } catch {
      const result = parseExpenseText(text);
      setParsedExpenses([result]);
      setUsedAI(false);
      setSelectedIdx(0);
    }
    setIsParsing(false);
  }, []);

  // Stop listening and process the transcript
  const stopAndProcess = useCallback(() => {
    clearSilenceTimer();
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    setIsListening(false);
    setInterimText('');
    processText(finalTranscriptRef.current.trim());
  }, [clearSilenceTimer, processText]);

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
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    finalTranscriptRef.current = '';
    setTranscript('');
    setInterimText('');
    setParsedExpenses([]);

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

      clearSilenceTimer();
      silenceTimerRef.current = setTimeout(() => {
        stopAndProcess();
      }, SILENCE_TIMEOUT);
    };

    recognition.onerror = (event: any) => {
      clearSilenceTimer();
      setIsListening(false);
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
      if (isListening && recognitionRef.current === recognition) {
        try {
          recognition.start();
        } catch {
          stopAndProcess();
        }
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);

    setTimeout(() => {
      if (recognitionRef.current === recognition) {
        stopAndProcess();
      }
    }, 30000);
  }, [checkLimit, clearSilenceTimer, stopAndProcess, isListening]);

  const handleStop = useCallback(() => {
    stopAndProcess();
  }, [stopAndProcess]);

  const handleParseManual = async () => {
    const { allowed } = checkLimit();
    if (!allowed) {
      toast.error('Usage limit reached (200/month). Contact support.');
      return;
    }
    if (!manualText.trim()) return;
    await processText(manualText.trim());
  };

  const handleConfirm = () => {
    const parsed = parsedExpenses[selectedIdx];
    if (!parsed) return;
    logAutomation.mutate({
      source: 'voice',
      raw_text: transcript,
      parsed_json: parsed as any,
      parse_confidence: parsed.confidence,
    });
    onAutofill(parsed);

    // If there are more expenses, remove the confirmed one and stay open
    if (parsedExpenses.length > 1) {
      const remaining = parsedExpenses.filter((_, i) => i !== selectedIdx);
      setParsedExpenses(remaining);
      setSelectedIdx(0);
      toast.success(`Expense filled! ${remaining.length} more remaining.`);
    } else {
      onOpenChange(false);
    }
  };

  const currentParsed = parsedExpenses[selectedIdx] ?? null;

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
              : 'Speak naturally — e.g. "$85 fuel at Pilot and $12 tolls today"'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Voice recording */}
          {!fallbackMode && parsedExpenses.length === 0 && !isParsing && (
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

          {/* AI Parsing indicator */}
          {isParsing && (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
              <p className="text-xs text-muted-foreground">AI is parsing your expense...</p>
            </div>
          )}

          {/* Text fallback */}
          {fallbackMode && parsedExpenses.length === 0 && !isParsing && (
            <div className="space-y-2">
              <Label className="text-xs">Describe the expense</Label>
              <Textarea
                placeholder='e.g. "$85 fuel at Pilot yesterday and $12 tolls"'
                rows={3}
                value={manualText}
                onChange={e => setManualText(e.target.value)}
              />
              <div className="flex gap-2">
                <Button onClick={handleParseManual} className="flex-1 h-10 font-bold" disabled={!manualText.trim() || isParsing}>
                  {isParsing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Parse'}
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
          {currentParsed && !isParsing && (
            <div className="space-y-3 animate-fade-in">
              <div className="rounded-xl bg-muted p-3 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs text-muted-foreground">You said:</p>
                  {usedAI && (
                    <span className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                      <Sparkles className="h-2.5 w-2.5" /> AI Parsed
                    </span>
                  )}
                </div>
                <p className="text-sm italic">"{transcript}"</p>
              </div>

              {/* Multi-expense tabs */}
              {parsedExpenses.length > 1 && (
                <div className="flex gap-1.5">
                  {parsedExpenses.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedIdx(i)}
                      className={`text-[10px] font-bold px-2.5 py-1 rounded-full transition-colors ${
                        i === selectedIdx
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                    >
                      Expense {i + 1}
                    </button>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-muted/50 p-2">
                  <span className="text-label">Amount</span>
                  <p className="font-bold">{currentParsed.amount != null ? `$${currentParsed.amount.toFixed(2)}` : '—'}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-2">
                  <span className="text-label">Category</span>
                  <p className="font-bold">{currentParsed.category ?? '—'}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-2">
                  <span className="text-label">Date</span>
                  <p className="font-bold">{currentParsed.date ?? 'Today (default)'}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-2">
                  <span className="text-label">Confidence</span>
                  <p className="font-bold">{Math.round(currentParsed.confidence * 100)}%</p>
                </div>
              </div>
              {currentParsed.notes && (
                <p className="text-xs text-muted-foreground">📝 {currentParsed.notes}</p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Only empty fields in the form will be filled. Your existing entries are preserved.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => {
                  setParsedExpenses([]);
                  setTranscript('');
                  setInterimText('');
                  setUsedAI(false);
                  finalTranscriptRef.current = '';
                }}>
                  Try Again
                </Button>
                <Button onClick={handleConfirm} className="flex-1 font-bold">
                  <Check className="h-4 w-4 mr-2" />
                  {parsedExpenses.length > 1 ? `Fill #${selectedIdx + 1}` : 'Fill Form'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
