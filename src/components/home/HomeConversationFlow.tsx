import { useCallback, useMemo, useRef, useState } from 'react';
import { ArrowRight, MessageSquare, RotateCcw, Undo2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  INTAKE_STEPS,
  INTAKE_OPENING_PROMPT,
  WORK_TYPE_CHOICES,
  applyStepAnswer,
  applyWorkTypeChoice,
  isStepAnswered,
  nextStep,
  summarizeIntake,
  type IntakeAnswers,
  type IntakeStep,
  type IntakeStepId,
  type WorkTypeChoice,
} from '@/lib/home/conversationIntake';

/**
 * HP-2 — the signed-out homepage conversation.
 *
 * This is a real multi-turn transcript backed by the deterministic intake script
 * in `@/lib/home/conversationIntake`. It performs NO network, Supabase, auth, or
 * RPC work: every turn is local. Identity is requested only after the driver has
 * seen the truthful summary of what HaulTracker understood.
 */

interface Bubble {
  id: number;
  role: 'assistant' | 'driver';
  text: string;
}

interface FlowState {
  answers: IntakeAnswers;
  bubbles: Bubble[];
  skipped: IntakeStepId[];
  current: IntakeStep | null;
}

const ACKS: Record<IntakeStepId, string> = {
  'work-type': 'Got it.',
  location: 'Noted.',
  'cdl-class': 'Thanks.',
  experience: 'Good to know.',
  'home-time': 'Understood.',
  trailer: 'Thanks.',
  'pay-goal': 'Thanks.',
};

const INITIAL_STATE: FlowState = {
  answers: {},
  bubbles: [{ id: 0, role: 'assistant', text: INTAKE_OPENING_PROMPT }],
  skipped: [],
  current: INTAKE_STEPS[0],
};

export interface HomeConversationFlowProps {
  /** Navigation stays owned by the page so the homepage keeps a single router surface. */
  onContinue: (answers: IntakeAnswers) => void;
  amber: string;
  surface: string;
  border: string;
  textMuted: string;
  textDim: string;
}

export default function HomeConversationFlow({
  onContinue,
  amber,
  surface,
  border,
  textMuted,
  textDim,
}: HomeConversationFlowProps) {
  const [state, setState] = useState<FlowState>(INITIAL_STATE);
  const [history, setHistory] = useState<FlowState[]>([]);
  const [draft, setDraft] = useState('');
  const bubbleId = useRef(1);

  const { answers, bubbles, current } = state;
  const summary = useMemo(() => summarizeIntake(answers), [answers]);
  const complete = current === null;

  const advance = useCallback(
    (spoken: string, nextAnswers: IntakeAnswers, step: IntakeStep, skippedStep: boolean) => {
      setState((prev) => {
        setHistory((h) => [...h, prev]);
        const skipped = skippedStep ? [...prev.skipped, step.id] : prev.skipped;
        const progressed = skippedStep || isStepAnswered(nextAnswers, step.id);
        const added: Bubble[] = [
          { id: bubbleId.current++, role: 'driver', text: spoken },
        ];

        if (!progressed) {
          added.push({
            id: bubbleId.current++,
            role: 'assistant',
            text: `I did not catch that one. ${step.prompt}`,
          });
          return { ...prev, bubbles: [...prev.bubbles, ...added] };
        }

        const upcoming = nextStep(nextAnswers, skipped);
        added.push({
          id: bubbleId.current++,
          role: 'assistant',
          text: upcoming
            ? `${ACKS[step.id]} ${upcoming.prompt}`
            : 'That is everything I need for now — here is what I understood.',
        });
        return { answers: nextAnswers, bubbles: [...prev.bubbles, ...added], skipped, current: upcoming };
      });
    },
    [],
  );

  const submitText = useCallback(() => {
    const text = draft.trim();
    if (!text || !current) return;
    let nextAnswers = applyStepAnswer(answers, current.id, text);
    if (current.id === 'work-type' && !answers.initialMessage) {
      // Preserve the driver's own words verbatim.
      nextAnswers = { ...nextAnswers, initialMessage: text.slice(0, 500) };
    }
    setDraft('');
    advance(text, nextAnswers, current, false);
  }, [draft, current, answers, advance]);

  const submitChip = useCallback(
    (chip: string) => {
      if (!current) return;
      const nextAnswers =
        current.id === 'work-type'
          ? applyWorkTypeChoice(answers, chip as WorkTypeChoice)
          : applyStepAnswer(answers, current.id, chip);
      setDraft('');
      advance(chip, nextAnswers, current, false);
    },
    [current, answers, advance],
  );

  const skip = useCallback(() => {
    if (!current) return;
    setDraft('');
    advance('Skip for now', answers, current, true);
  }, [current, answers, advance]);

  const back = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      setState(h[h.length - 1]);
      setDraft('');
      return h.slice(0, -1);
    });
  }, []);

  const restart = useCallback(() => {
    setState(INITIAL_STATE);
    setHistory([]);
    setDraft('');
  }, []);

  const bubbleStyle = (role: Bubble['role']) =>
    role === 'assistant'
      ? { background: 'hsl(220, 20%, 14%)', color: 'white', borderColor: border }
      : { background: 'hsl(25, 95%, 53%, 0.16)', color: 'white', borderColor: 'hsl(25, 95%, 53%, 0.35)' };

  return (
    <div
      data-testid="home-conversation-surface"
      className="relative mx-auto w-full max-w-2xl rounded-3xl border p-4 sm:p-5 text-left"
      style={{
        background: surface,
        borderColor: border,
        boxShadow: '0 30px 80px -40px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.02) inset',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg" style={{ background: 'hsl(25, 95%, 53%, 0.12)' }}>
            <MessageSquare className="h-4 w-4" style={{ color: amber }} />
          </div>
          <span className="text-sm font-bold text-white">Talk to HaulTracker</span>
        </div>
        <div className="flex items-center gap-1">
          {history.length > 0 && (
            <button
              type="button"
              data-testid="home-conversation-back"
              onClick={back}
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold min-h-[32px]"
              style={{ color: textMuted }}
            >
              <Undo2 className="h-3.5 w-3.5" /> Back
            </button>
          )}
          {(history.length > 0 || complete) && (
            <button
              type="button"
              data-testid="home-conversation-restart"
              onClick={restart}
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold min-h-[32px]"
              style={{ color: textMuted }}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Start over
            </button>
          )}
        </div>
      </div>

      <div
        data-testid="home-conversation-transcript"
        className="mt-3 space-y-2 max-h-[46vh] overflow-y-auto pr-1"
        aria-live="polite"
      >
        {bubbles.map((b) => (
          <div
            key={b.id}
            data-testid={`home-conversation-bubble-${b.role}`}
            className={b.role === 'driver' ? 'flex justify-end' : 'flex justify-start'}
          >
            <p
              className="max-w-[88%] rounded-2xl border px-3.5 py-2.5 text-sm leading-relaxed"
              style={bubbleStyle(b.role)}
            >
              {b.text}
            </p>
          </div>
        ))}
      </div>

      {!complete && current && (
        <>
          {current.chips.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2" data-testid="home-conversation-chips">
              {current.chips.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  data-testid={`home-conversation-chip-${chip.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                  onClick={() => submitChip(chip)}
                  className="rounded-full border px-3 py-2 text-xs font-semibold min-h-[36px] transition-colors hover:border-[hsl(25,95%,53%)]"
                  style={{ borderColor: border, color: textMuted }}
                >
                  {chip}
                </button>
              ))}
            </div>
          )}

          <label htmlFor="home-conversation-input" className="sr-only">
            Reply to HaulTracker
          </label>
          <div className="mt-3 flex items-end gap-2">
            <textarea
              id="home-conversation-input"
              data-testid="home-conversation-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submitText();
                }
              }}
              rows={2}
              maxLength={500}
              placeholder={current.placeholder}
              className="w-full resize-none rounded-2xl border bg-transparent px-4 py-3 text-base text-white outline-none placeholder:text-[hsl(220,10%,45%)] focus:border-[hsl(25,95%,53%)]"
              style={{ borderColor: border, minHeight: 60 }}
            />
            <Button
              data-testid="home-conversation-send"
              onClick={submitText}
              disabled={draft.trim().length === 0}
              aria-label="Send reply"
              className="h-[60px] w-14 shrink-0 rounded-2xl disabled:opacity-40"
              style={{ background: amber, color: 'white' }}
            >
              <Send className="h-5 w-5" />
            </Button>
          </div>

          {current.optional && (
            <button
              type="button"
              data-testid="home-conversation-skip"
              onClick={skip}
              className="mt-2 text-xs font-semibold underline-offset-4 hover:underline min-h-[32px]"
              style={{ color: textDim }}
            >
              Skip this one
            </button>
          )}
        </>
      )}

      {complete && (
        <div
          data-testid="home-conversation-summary"
          className="mt-4 rounded-2xl border p-4"
          style={{ background: 'hsl(220, 20%, 9%)', borderColor: border }}
        >
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: textDim }}>
            Here’s what HaulTracker understands
          </p>
          <p
            data-testid="home-conversation-summary-line"
            className="mt-2 text-base font-bold text-white"
          >
            {summary.join(' • ')}
          </p>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: textMuted }}>
            You’re ready to continue to real HaulTracker opportunities. We’ll use these answers to
            prefill your Driver Work Profile so you don’t have to start over.
          </p>
          <Button
            data-testid="home-conversation-continue"
            onClick={() => onContinue(answers)}
            className="mt-4 h-14 w-full gap-2 rounded-2xl text-base font-bold"
            style={{
              background: amber,
              color: 'white',
              boxShadow: '0 4px 28px -6px hsl(25, 95%, 53%, 0.6)',
            }}
          >
            Continue to real opportunities <ArrowRight className="h-5 w-5" />
          </Button>
          <p className="mt-3 text-xs" style={{ color: textDim }}>
            Nothing is shared with anyone until you review and save your preferences. Free for drivers.
          </p>
        </div>
      )}
    </div>
  );
}

export { WORK_TYPE_CHOICES };
