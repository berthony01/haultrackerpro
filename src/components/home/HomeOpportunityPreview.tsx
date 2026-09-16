/**
 * HP-3B — Real opportunity teasers shown to a signed-out driver AFTER the
 * homepage conversation completes.
 *
 * Contract:
 *  - Mounted only from the completed-summary area, so no request is ever issued
 *    mid-conversation.
 *  - At most two calls to the read-only public teaser RPC. No retry loop.
 *  - Advisory only: a card is never hidden because a listed requirement does not
 *    match, and the Continue action is never blocked or gated by this panel.
 *  - No total inventory is stated or implied.
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardList, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { evaluateKnownOpportunityQualification } from '@/lib/opportunities/opportunityQualification';
import type { IntakeAnswers } from '@/lib/home/conversationIntake';
import {
  ADDITIONAL_REQUIREMENTS_NOTE,
  EMPTY_RESULTS_COPY,
  LOAD_FAILURE_COPY,
  MAX_PREVIEW_CARDS,
  MORE_RESULTS_COPY,
  QUALIFICATION_LABELS,
  TEASER_FETCH_LIMIT,
  formatDriverGoal,
  formatRecruiterPay,
  formatRecruiterWeeklyEstimate,
  formatTeaserLocation,
  rankTeasers,
  teaserTags,
  toQualificationDriver,
  toQualificationOpportunity,
  type PublicTeaserRow,
} from '@/lib/home/publicTeaserPresentation';

const CARD_BG = 'hsl(0, 0%, 100%)';
const CARD_BORDER = 'hsl(220, 16%, 88%)';
const INK = 'hsl(220, 22%, 14%)';
const INK_SOFT = 'hsl(220, 12%, 32%)';
const INK_MUTED = 'hsl(220, 10%, 44%)';
const AMBER_INK = 'hsl(25, 70%, 38%)';

type LoadState = 'loading' | 'ready' | 'failed';

const STATUS_ICON = {
  meets_known_criteria: CheckCircle2,
  needs_driver_information: ClipboardList,
  does_not_meet_known_criteria: AlertTriangle,
  no_structured_criteria: Info,
} as const;

export interface HomeOpportunityPreviewProps {
  answers: IntakeAnswers;
}

export default function HomeOpportunityPreview({ answers }: HomeOpportunityPreviewProps) {
  const [rows, setRows] = useState<PublicTeaserRow[]>([]);
  const [status, setStatus] = useState<LoadState>('loading');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;

    (async () => {
      try {
        const hasState = Boolean(answers.state);
        const first = hasState
          ? { _state: answers.state as string, _limit: TEASER_FETCH_LIMIT }
          : { _limit: TEASER_FETCH_LIMIT };

        const initial = await supabase.rpc('list_public_opportunity_teasers', first);
        if (initial.error) throw initial.error;

        let data = (initial.data ?? []) as PublicTeaserRow[];

        if (data.length === 0 && hasState) {
          const fallback = await supabase.rpc('list_public_opportunity_teasers', {
            _limit: TEASER_FETCH_LIMIT,
          });
          if (fallback.error) throw fallback.error;
          data = (fallback.data ?? []) as PublicTeaserRow[];
        }

        if (cancelled) return;
        setRows(data);
        setStatus('ready');
      } catch {
        if (cancelled) return;
        setStatus('failed');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [answers.state]);

  if (status === 'loading') {
    return (
      <div className="mt-4 space-y-2" data-testid="home-teaser-loading">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-20 rounded-2xl animate-pulse"
            style={{ background: 'hsl(220, 14%, 92%)' }}
          />
        ))}
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <p className="mt-4 text-sm" data-testid="home-teaser-error" style={{ color: INK_MUTED }}>
        {LOAD_FAILURE_COPY}
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="mt-4 text-sm" data-testid="home-teaser-empty" style={{ color: INK_MUTED }}>
        {EMPTY_RESULTS_COPY}
      </p>
    );
  }

  const ranked = rankTeasers(rows, answers);
  const shown = ranked.slice(0, MAX_PREVIEW_CARDS);
  const driverInput = toQualificationDriver(answers);
  const goal = formatDriverGoal(answers);

  return (
    <div className="mt-4 text-left" data-testid="home-teaser-preview">
      <p className="text-xs font-bold uppercase tracking-widest" style={{ color: INK_MUTED }}>
        Open listings on HaulTracker right now
      </p>

      <div className="mt-2 space-y-2">
        {shown.map((row) => {
          const result = evaluateKnownOpportunityQualification(
            toQualificationOpportunity(row),
            driverInput,
          );
          const Icon = STATUS_ICON[result.status];
          const pay = formatRecruiterPay(row);
          const estimate = formatRecruiterWeeklyEstimate(row);
          const location = formatTeaserLocation(row);
          const tags = teaserTags(row);

          return (
            <div
              key={row.id}
              data-testid="home-teaser-card"
              data-status={result.status}
              className="rounded-2xl border p-3"
              style={{ background: CARD_BG, borderColor: CARD_BORDER }}
            >
              <p className="text-sm font-bold break-words" style={{ color: INK }}>
                {row.title}
              </p>
              <p className="text-xs break-words" style={{ color: INK_SOFT }}>
                {row.company_name}
                {location ? ` • ${location}` : ''}
              </p>

              {tags.length > 0 && (
                <p className="mt-1 text-xs break-words" style={{ color: INK_MUTED }}>
                  {tags.join(' • ')}
                </p>
              )}

              {pay && (
                <p className="mt-1 text-xs font-semibold break-words" style={{ color: AMBER_INK }}>
                  {pay}
                </p>
              )}
              {estimate && (
                <p className="text-xs break-words" style={{ color: INK_MUTED }}>
                  {estimate}
                </p>
              )}

              <p
                data-testid="home-teaser-status"
                className="mt-2 flex items-start gap-1.5 text-xs font-semibold break-words"
                style={{ color: INK_SOFT }}
              >
                <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
                <span>{QUALIFICATION_LABELS[result.status]}</span>
              </p>

              {row.has_additional_requirements && (
                <p
                  data-testid="home-teaser-additional-requirements"
                  className="mt-1 text-[11px] break-words"
                  style={{ color: INK_MUTED }}
                >
                  {ADDITIONAL_REQUIREMENTS_NOTE}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {ranked.length > shown.length && (
        <p className="mt-2 text-xs" data-testid="home-teaser-more" style={{ color: INK_MUTED }}>
          {MORE_RESULTS_COPY}
        </p>
      )}

      {goal && (
        <p className="mt-2 text-xs" data-testid="home-teaser-goal" style={{ color: INK_MUTED }}>
          {goal}
        </p>
      )}
    </div>
  );
}
