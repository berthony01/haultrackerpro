/**
 * Deadhead Pay Resolver — Phase 6C compatibility layer.
 *
 * Pure helpers for resolving how much deadhead pay a load is expected to
 * generate, given a mix of:
 *   1. NEW structured columns (Phase 6B):
 *        loads.deadhead_pay_status  ∈ 'unpaid' | 'per_mile' | 'flat'
 *        loads.deadhead_pay_amount  (numeric, used when status='flat')
 *   2. Existing `loaded_plus_deadhead` pay model + `deadhead_rate_per_mile`.
 *   3. LEGACY notes-tag fallback written by LoadForm:
 *        [dh_pay:unpaid]            → unpaid
 *        [dh_pay:same]              → deadhead_miles × loaded rate
 *        [dh_pay:custom:0.85]       → deadhead_miles × 0.85
 *
 * Precedence: structured > pay-model rate > legacy notes > none.
 *
 * This module:
 *   - is pure (no IO, no mutation),
 *   - never writes notes,
 *   - never touches estimated_pay (which remains authoritative when present),
 *   - never reads or persists anything to the DB.
 */

export type DeadheadPayStatus = 'unpaid' | 'per_mile' | 'flat';

export type DeadheadPaySource =
  | 'structured'      // came from loads.deadhead_pay_status
  | 'pay_model_rate'  // came from pay_model='loaded_plus_deadhead' + deadhead_rate_per_mile
  | 'legacy_notes'    // came from [dh_pay:*] notes tag
  | 'none';           // nothing applied; amount = 0

export type DeadheadPayWarning = 'missing_rate' | 'missing_amount' | 'malformed_notes';

export interface DeadheadPayResolution {
  /** Resolved expected deadhead pay in dollars. Never negative. Never NaN. */
  amount: number;
  /** Where the resolution came from. */
  source: DeadheadPaySource;
  /** Optional diagnostic code (does not affect amount; amount is already safe). */
  warning?: DeadheadPayWarning;
  /** Effective status for callers that want to display intent. */
  status: DeadheadPayStatus | null;
}

/** Minimal shape we read from a load — kept loose so it accepts Load, LoadInsert, etc. */
export interface DeadheadPayLoadLike {
  pay_model?: string | null;
  deadhead_miles?: number | string | null;
  rate_per_mile?: number | string | null;
  deadhead_rate_per_mile?: number | string | null;
  deadhead_pay_status?: string | null;
  deadhead_pay_amount?: number | string | null;
  notes?: string | null;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

// Matches the writer in src/components/LoadForm.tsx
const DH_TAG_RE = /\[dh_pay:(unpaid|same|custom)(?::([\d.]+))?\]/i;

/**
 * Parse the legacy `[dh_pay:*]` tag out of a notes string.
 * Returns null if no tag (or unrecognised content) — callers should treat as "no legacy signal".
 */
export function parseLegacyDeadheadPayFromNotes(
  notes: string | null | undefined,
): { mode: 'unpaid' | 'same' | 'custom'; rate: number | null } | null {
  if (!notes) return null;
  const m = notes.match(DH_TAG_RE);
  if (!m) return null;
  const mode = m[1].toLowerCase() as 'unpaid' | 'same' | 'custom';
  const rateRaw = m[2];
  const rate = rateRaw != null && rateRaw !== '' ? Number(rateRaw) : null;
  return {
    mode,
    rate: rate != null && Number.isFinite(rate) && rate >= 0 ? rate : null,
  };
}

function isStatus(v: unknown): v is DeadheadPayStatus {
  return v === 'unpaid' || v === 'per_mile' || v === 'flat';
}

/**
 * Resolve expected deadhead pay for a load, applying the precedence rules
 * described at the top of this file. Pure; safe to call on any load shape.
 */
export function resolveDeadheadPay(load: DeadheadPayLoadLike): DeadheadPayResolution {
  const dhMiles = num(load.deadhead_miles);
  const loadedRate = num(load.rate_per_mile);
  const dhRate = num(load.deadhead_rate_per_mile);
  const flatAmt = num(load.deadhead_pay_amount);
  const rawStatus = load.deadhead_pay_status ?? null;

  // 1–3. Structured fields take precedence.
  if (isStatus(rawStatus)) {
    if (rawStatus === 'unpaid') {
      return { amount: 0, source: 'structured', status: 'unpaid' };
    }
    if (rawStatus === 'per_mile') {
      if (dhRate <= 0) {
        return {
          amount: 0,
          source: 'structured',
          status: 'per_mile',
          warning: 'missing_rate',
        };
      }
      return {
        amount: dhMiles * dhRate,
        source: 'structured',
        status: 'per_mile',
      };
    }
    // flat
    if (load.deadhead_pay_amount == null || flatAmt <= 0) {
      return {
        amount: 0,
        source: 'structured',
        status: 'flat',
        warning: 'missing_amount',
      };
    }
    return { amount: flatAmt, source: 'structured', status: 'flat' };
  }

  // 4. No structured status. If pay_model is loaded_plus_deadhead and a rate
  //    exists, use it. This mirrors current computeLoadPay behaviour and is
  //    NOT a behaviour change.
  if (load.pay_model === 'loaded_plus_deadhead' && dhRate > 0) {
    return {
      amount: dhMiles * dhRate,
      source: 'pay_model_rate',
      status: 'per_mile',
    };
  }

  // 5. Legacy notes-tag fallback.
  const legacy = parseLegacyDeadheadPayFromNotes(load.notes);
  if (legacy) {
    if (legacy.mode === 'unpaid') {
      return { amount: 0, source: 'legacy_notes', status: 'unpaid' };
    }
    if (legacy.mode === 'same') {
      return {
        amount: dhMiles * loadedRate,
        source: 'legacy_notes',
        status: 'per_mile',
      };
    }
    // custom
    if (legacy.rate == null) {
      return {
        amount: 0,
        source: 'legacy_notes',
        status: 'per_mile',
        warning: 'malformed_notes',
      };
    }
    return {
      amount: dhMiles * legacy.rate,
      source: 'legacy_notes',
      status: 'per_mile',
    };
  }

  // 6. Nothing applies.
  return { amount: 0, source: 'none', status: null };
}

/** Convenience accessor: just the resolved deadhead pay dollar amount. */
export function getResolvedDeadheadPayAmount(load: DeadheadPayLoadLike): number {
  return resolveDeadheadPay(load).amount;
}
