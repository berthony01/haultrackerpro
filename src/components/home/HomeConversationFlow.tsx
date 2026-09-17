import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, MessageSquare, RotateCcw, Undo2, Send, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import HomeOpportunityPreview from '@/components/home/HomeOpportunityPreview';
import {
  INTAKE_STEPS,
  INTAKE_OPENING_PROMPT,
  WORK_TYPE_CHOICES,
  applyStepAnswer,
  applyWorkTypeChoice,
  describeCapturedPreferences,
  extractFirstMessagePreferences,
  hasExtraCapturedPreferences,
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
 *
 * HP-2R1 — visual emphasis only: the outer shell stays dark/charcoal with the
 * HaulTracker orange accent, while the conversation itself lives on a warm
 * off-white canvas so the chat is unmistakably the primary product surface.
 *
 * HP-4B — optional profile-aware mode for the authenticated Find Work route.
 * When `initialAnswers` / `profileReuseLabels` are absent the component behaves
 * exactly as the signed-out homepage does. When present, the conversation starts
 * from validated stored employment answers, discloses the reuse in plain words,
 * and offers explicit Change / Start over control. No write of any kind happens
 * here — this component still never touches storage, auth or the database.
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
  /** HP-4B — awaiting the driver's confirmation of a fully seeded profile. */
  confirming: boolean;
  /** HP-4B — walking every step again so seeded answers can be corrected. */
  reviewing: boolean;
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

const COMPLETION_LINE = 'That is everything I need for now — here is what I understood.';

/** HP-4B — profile reuse vocabulary. No identity or contact detail may appear. */
export const PROFILE_REUSE_PREFIX = 'Using your saved work profile:';
export const PROFILE_CONFIRM_PROMPT = 'Does that still look right?';
export const PROFILE_CONFIRM_YES = 'Looks right';
export const PROFILE_CONFIRM_CHANGE = 'Change something';
export const PROFILE_CHANGE_LABEL = 'Change saved answers';
export const PROFILE_START_OVER_LABEL = 'Start over';

/** Monotonic across restarts so React keys can never collide. */
let bubbleSeq = 0;
const nextBubbleId = () => bubbleSeq++;

function profileDisclosure(labels?: readonly string[]): string | null {
  const parts = (labels ?? []).filter((l) => typeof l === 'string' && l.trim());
  return parts.length ? `${PROFILE_REUSE_PREFIX} ${parts.join(' • ')}.` : null;
}

/** Sequential walker used only in HP-4B review mode, where answered steps are re-asked. */
function stepAfter(stepId: IntakeStepId, skipped: readonly IntakeStepId[]): IntakeStep | null {
  const index = INTAKE_STEPS.findIndex((s) => s.id === stepId);
  for (let i = index + 1; i < INTAKE_STEPS.length; i += 1) {
    if (!skipped.includes(INTAKE_STEPS[i].id)) return INTAKE_STEPS[i];
  }
  return null;
}

/**
 * HP-3C — only the FIRST assistant line may be prefixed with verified public
 * listing context. The script, order, chips and completion behavior are
 * untouched.
 *
 * HP-4B — when a validated profile seed is supplied the opening is instead the
 * reuse disclosure followed by the first UNANSWERED question (or a confirmation
 * prompt when the stored profile already answers everything).
 */
function makeInitialState(
  openingNote?: string,
  seed?: IntakeAnswers,
  reuseLabels?: readonly string[],
): FlowState {
  const disclosure = seed ? profileDisclosure(reuseLabels) : null;

  if (!disclosure) {
    const opening = openingNote?.trim()
      ? `${openingNote.trim()} ${INTAKE_OPENING_PROMPT}`
      : INTAKE_OPENING_PROMPT;
    return {
      answers: {},
      bubbles: [{ id: nextBubbleId(), role: 'assistant', text: opening }],
      skipped: [],
      current: INTAKE_STEPS[0],
      confirming: false,
      reviewing: false,
    };
  }

  const answers: IntakeAnswers = { ...seed };
  const current = nextStep(answers, []);
  return {
    answers,
    bubbles: [
      { id: nextBubbleId(), role: 'assistant', text: disclosure },
      {
        id: nextBubbleId(),
        role: 'assistant',
        text: current ? current.prompt : PROFILE_CONFIRM_PROMPT,
      },
    ],
    skipped: [],
    current,
    confirming: current === null,
    reviewing: false,
  };
}


// HP-2R1 — warm off-white conversation canvas + premium chat palette.
const CANVAS_BG = 'hsl(36, 45%, 97%)';
const CANVAS_BORDER = 'hsl(220, 16%, 86%)';
const INK = 'hsl(220, 22%, 14%)';
const INK_SOFT = 'hsl(220, 12%, 32%)';
const INK_MUTED = 'hsl(220, 10%, 44%)';
const ASSISTANT_BG = 'hsl(0, 0%, 100%)';
const ASSISTANT_BORDER = 'hsl(220, 16%, 88%)';
const DRIVER_BG = 'hsl(25, 80%, 46%)';
const CHIP_BORDER = 'hsl(220, 16%, 78%)';
const CHIP_HOVER_BORDER = 'hsl(25, 95%, 53%)';
const CHIP_HOVER_INK = 'hsl(25, 70%, 38%)';
const FIELD_BG = 'hsl(36, 50%, 99%)';
const FIELD_BORDER = 'hsl(220, 16%, 76%)';
const FIELD_FOCUS = 'hsl(25, 95%, 53%)';
const PLACEHOLDER_INK = 'hsl(220, 10%, 42%)';
const SUMMARY_BG = 'hsl(0, 0%, 100%)';
const SUMMARY_BORDER = 'hsl(25, 80%, 70%)';

export interface HomeConversationFlowProps {
  /** Navigation stays owned by the page so the homepage keeps a single router surface. */
  onContinue: (answers: IntakeAnswers) => void;
  amber: string;
  surface: string;
  border: string;
  textMuted: string;
  textDim: string;
  /** HP-3C — optional verified listing context prefixed to the first assistant line only. */
  openingNote?: string;
  /** HP-4B — validated, employment-only seed from the driver's stored work profile. */
  initialAnswers?: IntakeAnswers;
  /** HP-4B — plain-language reuse disclosure lines. Never identity or contact. */
  profileReuseLabels?: readonly string[];
  /** HP-4B — label for the completion CTA when the route is not the public homepage. */
  continueLabel?: string;
}

export default function HomeConversationFlow({
  onContinue,
  amber,
  surface,
  border,
  textMuted,
  textDim,
  openingNote,
  initialAnswers,
  profileReuseLabels,
  continueLabel,
}: HomeConversationFlowProps) {
  const [seedIgnored, setSeedIgnored] = useState(false);
  const [state, setState] = useState<FlowState>(() =>
    makeInitialState(openingNote, initialAnswers, profileReuseLabels),
  );

  const [history, setHistory] = useState<FlowState[]>([]);
  const [draft, setDraft] = useState('');

  const { answers, bubbles, current, confirming } = state;
  const summary = useMemo(() => summarizeIntake(answers), [answers]);
  const complete = current === null && !confirming;
  const seedActive = !seedIgnored && Boolean(profileDisclosure(initialAnswers ? profileReuseLabels : undefined));

  const advance = useCallback(
    (
      spoken: string,
      nextAnswers: IntakeAnswers,
      step: IntakeStep,
      skippedStep: boolean,
      disclosure?: string,
    ) => {
      setState((prev) => {
        setHistory((h) => [...h, prev]);
        const skipped = skippedStep ? [...prev.skipped, step.id] : prev.skipped;
        const progressed = prev.reviewing
          ? skippedStep || nextAnswers !== prev.answers
          : skippedStep || isStepAnswered(nextAnswers, step.id);
        const added: Bubble[] = [
          { id: nextBubbleId(), role: 'driver', text: spoken },
        ];
        if (disclosure) {
          added.push({ id: nextBubbleId(), role: 'assistant', text: disclosure });
        }

        if (!progressed) {
          added.push({
            id: nextBubbleId(),
            role: 'assistant',
            text: `I did not catch that one. ${step.prompt}`,
          });
          return { ...prev, answers: nextAnswers, bubbles: [...prev.bubbles, ...added] };
        }

        const upcoming = prev.reviewing
          ? stepAfter(step.id, skipped)
          : nextStep(nextAnswers, skipped);
        added.push({
          id: nextBubbleId(),
          role: 'assistant',
          text: upcoming ? `${ACKS[step.id]} ${upcoming.prompt}` : COMPLETION_LINE,
        });
        return {
          ...prev,
          answers: nextAnswers,
          bubbles: [...prev.bubbles, ...added],
          skipped,
          current: upcoming,
          confirming: false,
        };
      });
    },
    [],
  );

  const submitText = useCallback(() => {
    const text = draft.trim();
    if (!text || !current) return;

    /**
     * HP-4A — the driver's FIRST free-text reply may safely carry several
     * unambiguous PREFERENCE fields at once. Facts (CDL class, years of
     * experience, endorsements) are never inferred here; ambiguous dimensions
     * stay unset so the normal step still asks them.
     */
    if (current.id === 'work-type' && !answers.initialMessage) {
      const captured = extractFirstMessagePreferences(text);
      const nextAnswers: IntakeAnswers = {
        ...answers,
        ...captured,
        // Preserve the driver's own words verbatim.
        initialMessage: text.slice(0, 500),
      };
      const disclosure = hasExtraCapturedPreferences(captured)
        ? `I also picked up: ${describeCapturedPreferences(captured).join(' • ')}.`
        : undefined;
      setDraft('');
      advance(text, nextAnswers, current, false, disclosure);
      return;
    }

    const nextAnswers = applyStepAnswer(answers, current.id, text);
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
    // HP-4B — "Start over" drops the profile seed for THIS conversation only.
    // Nothing is written, deleted or changed in the stored work profile.
    setSeedIgnored(true);
    setState(makeInitialState(openingNote));
    setHistory([]);
    setDraft('');
  }, [openingNote]);

  /** HP-4B — accept the reused profile and move to the truthful summary. */
  const acceptProfile = useCallback(() => {
    setState((prev) => {
      if (!prev.confirming) return prev;
      setHistory((h) => [...h, prev]);
      return {
        ...prev,
        confirming: false,
        bubbles: [
          ...prev.bubbles,
          { id: nextBubbleId(), role: 'driver', text: PROFILE_CONFIRM_YES },
          { id: nextBubbleId(), role: 'assistant', text: COMPLETION_LINE },
        ],
      };
    });
  }, []);

  /**
   * HP-4B — walk the whole script again so any seeded answer can be corrected.
   * Current answers are preserved until the driver actually replaces one, and
   * no database call is made.
   */
  const changeSavedAnswers = useCallback(() => {
    setState((prev) => {
      setHistory((h) => [...h, prev]);
      const first = INTAKE_STEPS[0];
      return {
        ...prev,
        current: first,
        confirming: false,
        reviewing: true,
        bubbles: [
          ...prev.bubbles,
          { id: nextBubbleId(), role: 'driver', text: PROFILE_CONFIRM_CHANGE },
          {
            id: nextBubbleId(),
            role: 'assistant',
            text: `No problem — let's go through them. ${first.prompt}`,
          },
        ],
      };
    });
  }, []);

  /**
   * HP-3C — the listing context resolves asynchronously. Refresh the opening
   * line only while the conversation is still untouched; never mid-conversation.
   */
  useEffect(() => {
    setState((prev) =>
      prev.bubbles.length === 1 && prev.current === INTAKE_STEPS[0]
        ? makeInitialState(openingNote)
        : prev,
    );
  }, [openingNote]);


  const bubbleStyle = (role: Bubble['role']) =>
    role === 'assistant'
      ? {
          background: ASSISTANT_BG,
          color: INK,
          borderColor: ASSISTANT_BORDER,
          boxShadow: '0 1px 2px rgba(20,20,40,0.06)',
        }
      : { background: DRIVER_BG, color: 'white', borderColor: 'transparent' };

  const chipStyle = {
    borderColor: CHIP_BORDER,
    color: INK_SOFT,
    background: 'hsl(0, 0%, 100%)',
  };

  const chipHover = (e: React.SyntheticEvent<HTMLButtonElement>) => {
    e.currentTarget.style.borderColor = CHIP_HOVER_BORDER;
    e.currentTarget.style.color = CHIP_HOVER_INK;
  };
  const chipReset = (e: React.SyntheticEvent<HTMLButtonElement>) => {
    e.currentTarget.style.borderColor = CHIP_BORDER;
    e.currentTarget.style.color = INK_SOFT;
  };

  return (
    <div
      data-testid="home-conversation-surface"
      className="relative mx-auto w-full max-w-3xl rounded-3xl border p-4 sm:p-5 text-left"
      style={{
        background: surface,
        borderColor: amber,
        boxShadow:
          '0 30px 90px -40px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.02) inset, 0 0 50px -12px hsla(25, 95%, 53%, 0.45)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className="p-1.5 rounded-lg"
            style={{ background: 'hsl(25, 95%, 53%, 0.16)' }}
          >
            <MessageSquare className="h-4 w-4" style={{ color: amber }} />
          </div>
          <span className="text-sm font-bold text-white">Talk to HaulTracker</span>
        </div>
        <div className="flex items-center gap-1">
          {seedActive && (
            <button
              type="button"
              data-testid="home-conversation-change-saved"
              onClick={changeSavedAnswers}
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold min-h-[32px] transition-colors hover:bg-white/5"
              style={{ color: textMuted }}
            >
              <Pencil className="h-3.5 w-3.5" /> {PROFILE_CHANGE_LABEL}
            </button>
          )}
          {history.length > 0 && (
            <button
              type="button"
              data-testid="home-conversation-back"
              onClick={back}
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold min-h-[32px] transition-colors hover:bg-white/5"
              style={{ color: textMuted }}
            >
              <Undo2 className="h-3.5 w-3.5" /> Back
            </button>
          )}
          {(history.length > 0 || complete || seedActive) && (
            <button
              type="button"
              data-testid="home-conversation-restart"
              onClick={restart}
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold min-h-[32px] transition-colors hover:bg-white/5"
              style={{ color: textMuted }}
            >
              <RotateCcw className="h-3.5 w-3.5" /> {PROFILE_START_OVER_LABEL}
            </button>
          )}
        </div>
      </div>

      {/* HP-2R1 — warm off-white conversation canvas inside the dark shell. */}
      <div
        className="mt-3 rounded-2xl border p-3 sm:p-4"
        style={{ background: CANVAS_BG, borderColor: CANVAS_BORDER }}
      >
        <div
          data-testid="home-conversation-transcript"
          className="space-y-2 overflow-y-auto pr-1 min-h-[260px] max-h-[54vh]"
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

        {confirming && (
          <div className="mt-3 flex flex-wrap gap-2" data-testid="home-conversation-confirm">
            <button
              type="button"
              data-testid="home-conversation-confirm-yes"
              onClick={acceptProfile}
              className="rounded-full border px-3 py-2 text-xs font-semibold min-h-[36px] transition-colors hover:bg-white"
              style={chipStyle}
              onMouseEnter={chipHover}
              onMouseLeave={chipReset}
              onFocus={chipHover}
              onBlur={chipReset}
            >
              {PROFILE_CONFIRM_YES}
            </button>
            <button
              type="button"
              data-testid="home-conversation-confirm-change"
              onClick={changeSavedAnswers}
              className="rounded-full border px-3 py-2 text-xs font-semibold min-h-[36px] transition-colors hover:bg-white"
              style={chipStyle}
              onMouseEnter={chipHover}
              onMouseLeave={chipReset}
              onFocus={chipHover}
              onBlur={chipReset}
            >
              {PROFILE_CONFIRM_CHANGE}
            </button>
          </div>
        )}

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
                    className="rounded-full border px-3 py-2 text-xs font-semibold min-h-[36px] transition-colors hover:bg-white"
                    style={{
                      borderColor: CHIP_BORDER,
                      color: INK_SOFT,
                      background: 'hsl(0, 0%, 100%)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = CHIP_HOVER_BORDER;
                      e.currentTarget.style.color = CHIP_HOVER_INK;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = CHIP_BORDER;
                      e.currentTarget.style.color = INK_SOFT;
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = CHIP_HOVER_BORDER;
                      e.currentTarget.style.color = CHIP_HOVER_INK;
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = CHIP_BORDER;
                      e.currentTarget.style.color = INK_SOFT;
                    }}
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
                className="w-full resize-none rounded-2xl border px-4 py-3 text-base outline-none focus:ring-2"
                style={{
                  background: FIELD_BG,
                  borderColor: FIELD_BORDER,
                  color: INK,
                  minHeight: 68,
                  caretColor: FIELD_FOCUS,
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = FIELD_FOCUS;
                  e.currentTarget.style.boxShadow = `0 0 0 3px hsla(25, 95%, 53%, 0.25)`;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = FIELD_BORDER;
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
              <Button
                data-testid="home-conversation-send"
                onClick={submitText}
                disabled={draft.trim().length === 0}
                aria-label="Send reply"
                className="h-[68px] w-14 shrink-0 rounded-2xl disabled:opacity-40"
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
                style={{ color: INK_MUTED }}
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
            style={{ background: SUMMARY_BG, borderColor: SUMMARY_BORDER }}
          >
            <p
              className="text-xs font-bold uppercase tracking-widest"
              style={{ color: INK_MUTED }}
            >
              Here’s what HaulTracker understands
            </p>
            <p
              data-testid="home-conversation-summary-line"
              className="mt-2 text-base font-bold"
              style={{ color: INK }}
            >
              {summary.join(' • ')}
            </p>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: INK_SOFT }}>
              You’re ready to continue to real HaulTracker opportunities. We’ll use these answers to
              prefill your Driver Work Profile so you don’t have to start over.
            </p>
            <HomeOpportunityPreview answers={answers} />
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
              {continueLabel ?? 'Continue to real opportunities'} <ArrowRight className="h-5 w-5" />
            </Button>
            <p className="mt-3 text-xs" style={{ color: INK_MUTED }}>
              Nothing is shared with anyone until you review and save your preferences. Free for drivers.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export { WORK_TYPE_CHOICES };
