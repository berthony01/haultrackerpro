import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';

const FALLBACK_STARTER_KIT_URL =
  'https://pngptztxwbtozwxrtbwo.supabase.co/storage/v1/object/public/lead-magnets/HaulTrackerPro_Trucker_Starter_Kit_Free.zip';

/**
 * Public download URL for the free Trucker Starter Kit.
 * Override at build time with VITE_STARTER_KIT_DOWNLOAD_URL.
 */
export const STARTER_KIT_DOWNLOAD_URL =
  (import.meta.env?.VITE_STARTER_KIT_DOWNLOAD_URL as string | undefined) ||
  FALLBACK_STARTER_KIT_URL;

/**
 * Mobile-safe trigger for the Starter Kit zip download.
 * - iOS: same-tab navigation (only reliable path for cross-origin binaries).
 * - Other: hidden anchor click with `download` attribute + `_blank` fallback.
 * Must be called inside a user gesture (click handler).
 */
export function triggerStarterKitDownload(): string {
  const url = STARTER_KIT_DOWNLOAD_URL;
  if (typeof window === 'undefined' || typeof document === 'undefined') return url;

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;

  if (isIOS) {
    window.location.assign(url);
    return url;
  }

  const a = document.createElement('a');
  a.href = url;
  a.download = 'HaulTrackerPro_Trucker_Starter_Kit.zip';
  a.rel = 'noopener noreferrer';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  a.remove();
  return url;
}

export const leadMagnetSchema = z.object({
  email: z
    .string()
    .trim()
    .email({ message: 'Please enter a valid email' })
    .max(255, { message: 'Email is too long' }),
  first_name: z
    .string()
    .trim()
    .max(100, { message: 'Name is too long' })
    .optional()
    .or(z.literal('')),
});

export type LeadMagnetInput = z.infer<typeof leadMagnetSchema>;

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
type UtmKey = (typeof UTM_KEYS)[number];

export function getUtmFromUrl(): Partial<Record<UtmKey, string>> {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const out: Partial<Record<UtmKey, string>> = {};
  for (const key of UTM_KEYS) {
    const v = params.get(key);
    if (v) out[key] = v.slice(0, 200);
  }
  return out;
}

export async function submitLeadMagnet(input: LeadMagnetInput, opts?: { convertedUserId?: string | null }) {
  const parsed = leadMagnetSchema.parse(input);
  const utm = getUtmFromUrl();
  const sourcePage = typeof window !== 'undefined' ? window.location.pathname : null;

  // Phase 28C: Direct INSERT on `lead_magnet_signups` is no longer permitted by
  // RLS — all submissions must go through the `submit_lead_magnet_signup` RPC.
  // The RPC is SECURITY DEFINER and handles validation + duplicate-safe upsert.
  const { error } = await supabase.rpc('submit_lead_magnet_signup', {
    _email: parsed.email.toLowerCase(),
    _first_name: parsed.first_name?.trim() || null,
    _bundle_name: 'Trucker Starter Kit',
    _bundle_version: 'free',
    _source_page: sourcePage,
    _utm_source: utm.utm_source ?? null,
    _utm_medium: utm.utm_medium ?? null,
    _utm_campaign: utm.utm_campaign ?? null,
    _utm_content: utm.utm_content ?? null,
    _utm_term: utm.utm_term ?? null,
    _converted_user_id: opts?.convertedUserId ?? null,
  });

  if (error) throw error;


  return { ok: true as const };
}
