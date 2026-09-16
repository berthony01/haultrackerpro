/**
 * HP-3C — Compact public-safe context for a `?job=<uuid>` deep link.
 *
 * Contract:
 *  - Rendered only when the homepage parsed a canonical UUID, so a malformed
 *    value never reaches the RPC.
 *  - Exactly ONE call to the read-only public teaser RPC. No retry.
 *  - Malformed / unknown / ineligible / failed all collapse to one identical
 *    line. Nothing reveals whether the listing exists.
 *  - Advisory context only: it never replaces, gates, or short-circuits the
 *    conversation, and it makes no qualification claim.
 */
import { useEffect, useRef, useState } from 'react';
import { Briefcase } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  ADDITIONAL_REQUIREMENTS_NOTE,
  formatRecruiterPay,
  formatRecruiterWeeklyEstimate,
  formatTeaserLocation,
  teaserTags,
  type PublicTeaserRow,
} from '@/lib/home/publicTeaserPresentation';
import { UNAVAILABLE_JOB_COPY } from '@/lib/home/homeDeepLink';

export interface HomeTargetedJobContextProps {
  /**
   * A canonical UUID, or null when the link carried a `job` value that failed
   * strict validation. A null id renders the same unavailable line WITHOUT any
   * lookup, so a malformed value never reaches the backend.
   */
  jobId: string | null;
  amber: string;
  surface: string;
  border: string;
  textMuted: string;
  /** Lets the page adapt the first assistant line once the listing is verified. */
  onResolved?: (row: PublicTeaserRow | null) => void;
}

type LoadState = 'loading' | 'ready' | 'unavailable';

export default function HomeTargetedJobContext({
  jobId,
  amber,
  surface,
  border,
  textMuted,
  onResolved,
}: HomeTargetedJobContextProps) {
  const [row, setRow] = useState<PublicTeaserRow | null>(null);
  const [status, setStatus] = useState<LoadState>(jobId ? 'loading' : 'unavailable');
  const started = useRef(false);
  const resolvedRef = useRef(onResolved);
  resolvedRef.current = onResolved;

  useEffect(() => {
    if (!jobId) return;
    if (started.current) return;
    started.current = true;
    let cancelled = false;

    (async () => {
      try {
        const result = await supabase.rpc('list_public_opportunity_teasers', {
          _opportunity_id: jobId,
          _limit: 1,
        });
        if (result.error) throw result.error;
        const found = ((result.data ?? []) as PublicTeaserRow[])[0] ?? null;
        if (cancelled) return;
        setRow(found);
        setStatus(found ? 'ready' : 'unavailable');
        resolvedRef.current?.(found);
      } catch {
        if (cancelled) return;
        setRow(null);
        setStatus('unavailable');
        resolvedRef.current?.(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [jobId]);


  if (status === 'loading') {
    return (
      <div
        data-testid="home-targeted-job-loading"
        className="mx-auto mb-3 h-16 w-full max-w-3xl animate-pulse rounded-2xl border"
        style={{ background: surface, borderColor: border }}
      />
    );
  }

  if (status === 'unavailable' || !row) {
    return (
      <p
        data-testid="home-targeted-job-unavailable"
        className="mx-auto mb-3 w-full max-w-3xl rounded-2xl border px-4 py-3 text-sm text-left"
        style={{ background: surface, borderColor: border, color: textMuted }}
      >
        {UNAVAILABLE_JOB_COPY}
      </p>
    );
  }

  const location = formatTeaserLocation(row);
  const tags = teaserTags(row);
  const pay = formatRecruiterPay(row);
  const estimate = formatRecruiterWeeklyEstimate(row);

  return (
    <div
      data-testid="home-targeted-job-card"
      className="mx-auto mb-3 w-full max-w-3xl rounded-2xl border p-4 text-left"
      style={{ background: surface, borderColor: amber }}
    >
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest" style={{ color: textMuted }}>
        <Briefcase className="h-3.5 w-3.5" aria-hidden style={{ color: amber }} />
        Listing you opened
      </p>
      <p className="mt-1.5 text-base font-bold text-white break-words">{row.title}</p>
      <p className="text-xs break-words" style={{ color: textMuted }}>
        {row.company_name}
        {location ? ` • ${location}` : ''}
      </p>
      {tags.length > 0 && (
        <p className="mt-1 text-xs break-words" style={{ color: textMuted }}>
          {tags.join(' • ')}
        </p>
      )}
      {pay && (
        <p className="mt-1 text-xs font-semibold break-words" style={{ color: amber }}>
          {pay}
        </p>
      )}
      {estimate && (
        <p className="text-xs break-words" style={{ color: textMuted }}>
          {estimate}
        </p>
      )}
      {row.has_additional_requirements && (
        <p
          data-testid="home-targeted-job-additional-requirements"
          className="mt-1.5 text-[11px] break-words"
          style={{ color: textMuted }}
        >
          {ADDITIONAL_REQUIREMENTS_NOTE}
        </p>
      )}
    </div>
  );
}
