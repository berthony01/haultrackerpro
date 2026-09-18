/**
 * Phase RB-3B-B — authenticated access to a Telegram Quick Post draft that the
 * recruiter opened from the bot's "Edit Details" button.
 *
 * The draft id in the URL is an UNTRUSTED locator. Every authorization decision
 * (acting account, draft ownership, review state, expiry, recruiter capability)
 * is made server-side inside the two SECURITY DEFINER RPCs. This hook never
 * reads or writes `telegram_opportunity_drafts` directly, never sees Telegram
 * identity or raw source text, and never creates an opportunity.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTelegramDraftLocator(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Reads the optional locator from a raw query string. Anything malformed is
 *  ignored entirely — never passed to the server, never shown to the user. */
export function readTelegramDraftLocator(search: string): string | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  const raw = params.get('telegramDraft');
  return isTelegramDraftLocator(raw) ? raw.toLowerCase() : null;
}

export type TelegramDraftPayload = Record<string, unknown>;

export interface TelegramDraftForEdit {
  draftId: string;
  recruiterId: string | null;
  expiresAt: string | null;
  payload: TelegramDraftPayload;
}

type ReadResult =
  | { ok: true; draft: TelegramDraftForEdit }
  | { ok: false; reason: 'unavailable' };

function parseDraftResponse(data: unknown): ReadResult {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, reason: 'unavailable' };
  }
  const row = data as Record<string, unknown>;
  if (row.ok !== true || typeof row.draft_id !== 'string') {
    return { ok: false, reason: 'unavailable' };
  }
  const payload =
    row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
      ? (row.payload as TelegramDraftPayload)
      : {};
  return {
    ok: true,
    draft: {
      draftId: row.draft_id,
      recruiterId: typeof row.recruiter_id === 'string' ? row.recruiter_id : null,
      expiresAt: typeof row.expires_at === 'string' ? row.expires_at : null,
      payload,
    },
  };
}

export function useTelegramOpportunityDraft(draftId: string | null) {
  const [draft, setDraft] = useState<TelegramDraftForEdit | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(!!draftId);
  const [unavailable, setUnavailable] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!draftId) {
      setDraft(null);
      setIsLoading(false);
      setUnavailable(false);
      return;
    }
    setIsLoading(true);
    setUnavailable(false);
    void (async () => {
      const { data, error } = await supabase.rpc(
        'get_telegram_opportunity_draft_for_edit' as never,
        { _draft_id: draftId } as never,
      );
      if (cancelled) return;
      const result = error ? ({ ok: false, reason: 'unavailable' } as const) : parseDraftResponse(data);
      if (result.ok) {
        setDraft(result.draft);
        setUnavailable(false);
      } else {
        setDraft(null);
        setUnavailable(true);
      }
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  /** Saves corrected values back to the SAME draft. Never creates anything. */
  const savePayload = useCallback(
    async (payload: TelegramDraftPayload): Promise<{ ok: boolean }> => {
      if (!draftId) return { ok: false };
      setIsSaving(true);
      try {
        const { data, error } = await supabase.rpc(
          'save_telegram_opportunity_draft_payload' as never,
          { _draft_id: draftId, _payload: payload } as never,
        );
        if (error) return { ok: false };
        const result = parseDraftResponse(data);
        if (result.ok) {
          setDraft(result.draft);
          return { ok: true };
        }
        setUnavailable(true);
        setDraft(null);
        return { ok: false };
      } finally {
        setIsSaving(false);
      }
    },
    [draftId],
  );

  return { draft, isLoading, unavailable, isSaving, savePayload };
}
