import { useCallback, useMemo, useState } from 'react';
import { ArrowRight, MessageSquare, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Homepage conversation-first entry surface.
 *
 * This is a real intake surface, not a decorative mockup: the driver's own words
 * are captured and handed to the existing authentication flow, which lands them on
 * the real driver opportunities workspace where the CF-1A/CF-1B conversation
 * architecture (start_opportunity_conversation / DriverConversationDialog) takes over.
 *
 * It deliberately does NOT create a parallel chat backend and does NOT invent a
 * second identity system. Guest thread persistence is a separate, unauthorized phase;
 * until then the draft is held client-side only.
 */
export const HOME_CONVERSATION_DRAFT_KEY = 'htp_home_conversation_draft';

export const HOME_CONVERSATION_NEXT_PATH = '/dashboard?page=opportunities';

export const HOME_CONVERSATION_PROMPTS: string[] = [
  'Regional dry van, home weekends',
  'Dedicated lanes out of Texas',
  'Flatbed, 2 years experience, no hazmat',
  'OTR reefer paying over $0.65 a mile',
];

export interface HomeConversationHeroProps {
  /** Navigation is owned by the page so the homepage keeps a single router surface. */
  onStart: (draft: string) => void;
  amber: string;
  surface: string;
  border: string;
  textMuted: string;
  textDim: string;
}

export function saveHomeConversationDraft(draft: string): void {
  const trimmed = draft.trim();
  if (!trimmed) return;
  try {
    sessionStorage.setItem(
      HOME_CONVERSATION_DRAFT_KEY,
      JSON.stringify({ text: trimmed.slice(0, 2000), createdAt: new Date().toISOString() }),
    );
  } catch {
    /* storage unavailable — the draft simply is not carried forward */
  }
}

export default function HomeConversationHero({
  onStart,
  amber,
  surface,
  border,
  textMuted,
  textDim,
}: HomeConversationHeroProps) {
  const [draft, setDraft] = useState('');
  const canStart = useMemo(() => draft.trim().length > 0, [draft]);

  const start = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    saveHomeConversationDraft(trimmed);
    onStart(trimmed);
  }, [draft, onStart]);

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
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg" style={{ background: 'hsl(25, 95%, 53%, 0.12)' }}>
          <MessageSquare className="h-4 w-4" style={{ color: amber }} />
        </div>
        <span className="text-sm font-bold text-white">Tell HaulTracker what work you want</span>
      </div>

      <label htmlFor="home-conversation-input" className="sr-only">
        Describe the trucking work you want
      </label>
      <textarea
        id="home-conversation-input"
        data-testid="home-conversation-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Example: I run flatbed, I want regional work out of Georgia and home most weekends."
        className="mt-3 w-full resize-none rounded-2xl border bg-transparent px-4 py-3 text-base text-white outline-none placeholder:text-[hsl(220,10%,45%)] focus:border-[hsl(25,95%,53%)]"
        style={{ borderColor: border, minHeight: 96 }}
      />

      <div className="mt-3 flex flex-wrap gap-2" data-testid="home-conversation-prompts">
        {HOME_CONVERSATION_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setDraft(p)}
            className="rounded-full border px-3 py-2 text-xs font-medium transition-colors hover:border-[hsl(25,95%,53%)]"
            style={{ borderColor: border, color: textMuted }}
          >
            {p}
          </button>
        ))}
      </div>

      <Button
        data-testid="home-conversation-start"
        onClick={start}
        disabled={!canStart}
        className="mt-4 h-14 w-full gap-2 rounded-2xl text-base font-bold disabled:opacity-50"
        style={{
          background: amber,
          color: 'white',
          boxShadow: '0 4px 28px -6px hsl(25, 95%, 53%, 0.6)',
        }}
      >
        <Sparkles className="h-5 w-5" /> Start the conversation <ArrowRight className="h-5 w-5" />
      </Button>

      <p className="mt-3 text-xs" style={{ color: textDim }}>
        We keep what you type and open your driver workspace, where you can send it straight to a
        recruiter. No application forms to start. Free for drivers.
      </p>
    </div>
  );
}
