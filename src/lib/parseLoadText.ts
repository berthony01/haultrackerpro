/**
 * Regex-based parser for extracting load details from pasted text (Telegram, SMS, broker messages).
 * No AI. User always reviews before saving.
 *
 * Mileage detection strategy (pattern-first + context classification):
 *   1. Normalize input (fold bold-unicode letters → ASCII).
 *   2. Find ALL `<number> mi|mile|miles` occurrences (the unit is required, so $-amounts can't match).
 *   3. For each occurrence, look at a context window (~30 chars before, ~10 after) and classify:
 *        - deadhead keyword nearby → deadhead miles
 *        - loaded/trip/linehaul/route/distance/total keyword nearby → loaded miles
 *        - otherwise → unclassified candidate
 *   4. Pick deadhead = first deadhead-classified value.
 *   5. Pick loaded by priority of context strength
 *      (loaded > trip > linehaul > route > distance > total > largest non-deadhead candidate).
 *   6. If exactly 2 values and one is deadhead, the other is loaded.
 *   7. If only 1 value and it's not deadhead, it's loaded.
 */

import { isValidISODate, isWithinSanityWindow } from './sourceDate';




export interface ParsedStopData {
  location: string;
  stop_type: string;
  /** Phase 29: optional per-stop date when the source (AI/OCR) provides it. */
  stop_date?: string;
}

export type ParsedPayModelSuggestion =
  | 'loaded_miles_only'
  | 'total_miles'
  | 'loaded_plus_deadhead'
  | 'flat_rate'
  | 'manual';

export interface ParsedLoadData {
  pickup_location?: string;
  dropoff_location?: string;
  loaded_miles?: string;
  deadhead_miles?: string;
  /** Dispatcher-provided "total miles" (loaded + deadhead). Preserved separately. */
  total_miles?: string;
  rate_per_mile?: string;
  /** Separate deadhead pay rate when explicitly provided ("DH rate $1.00/mi"). */
  deadhead_rate_per_mile?: string;
  /** Flat-rate dollar amount for the whole load when explicitly stated ("flat $850"). */
  flat_rate?: string;
  gross_revenue?: string;
  load_date?: string;
  /** Phase 6C.6: drop-off / delivery date extracted from source (OCR/AI), or an explicit delivery-labeled date line. */
  dropoff_date?: string;
  /** Phase 1S-B1: explicitly labeled waiting-time total fee (e.g. "Wait pay $50"). Never a per-hour rate. */
  wait_fee?: string;
  /** Phase 1S-B1: explicitly labeled detention total fee (e.g. "Detention fee: $75"). Never a per-hour rate. */
  detention_fee?: string;
  notes?: string;

  trip_id?: string;
  multiStopDetected?: boolean;
  detectedStopsCount?: number;
  stops?: ParsedStopData[];
  /**
   * True when the parser detected deadhead miles but could not confidently
   * resolve loaded/line-haul miles (e.g. only ambiguous "total miles" present).
   * Consumers should warn the user to confirm mileage before saving.
   */
  needsMileageReview?: boolean;
  /** Human-readable note about mileage reconciliation (mismatch, derived value, etc.). */
  mileage_warning?: string;
  /** Best-guess pay model based on which fields were detected. UI may override. */
  pay_model_suggestion?: ParsedPayModelSuggestion;
}

/** Strip $ and commas from a number string */
function cleanNum(s: string): string {
  return s.replace(/[$,]/g, '').trim();
}

/**
 * Fold "mathematical bold / sans / mono" Unicode letter ranges back to plain ASCII.
 * Examples: 𝗧𝗿𝗶𝗽 → Trip, 𝐋𝐨𝐚𝐝𝐞𝐝 → Loaded.
 * Covers the common ranges Telegram / dispatch bots use.
 */
function normalizeUnicodeLetters(input: string): string {
  // NFKC compatibility-fold + strip zero-width / invisible formatting chars
  // (ZWSP, ZWNJ, ZWJ, BOM, LRM/RLM, soft hyphen) that Telegram and brokers
  // sometimes embed and that can break adjacency in our regex matchers.
  // Also normalize non-breaking / odd-width spaces to a regular space.
  let pre: string;
  try {
    pre = input.normalize('NFKC');
  } catch {
    pre = input;
  }
  pre = pre
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u00AD]/g, '')
    .replace(/[\u00A0\u2007\u202F\u2009\u200A\u205F\u3000]/g, ' ');

  let out = '';
  for (const ch of pre) {
    const cp = ch.codePointAt(0)!;
    // Mathematical Bold (A–Z 1D400–1D419, a–z 1D41A–1D433)
    if (cp >= 0x1d400 && cp <= 0x1d419) out += String.fromCharCode(0x41 + (cp - 0x1d400));
    else if (cp >= 0x1d41a && cp <= 0x1d433) out += String.fromCharCode(0x61 + (cp - 0x1d41a));
    // Mathematical Italic, Bold-Italic, Script, Bold Script, Fraktur, Double-Struck,
    // Bold Fraktur, Sans-Serif, Sans-Serif Bold, Sans-Serif Italic,
    // Sans-Serif Bold Italic, Monospace — all 26-letter blocks at 1D434..1D6A3
    else if (cp >= 0x1d434 && cp <= 0x1d6a3) {
      const offset = (cp - 0x1d434) % 52;
      out += offset < 26
        ? String.fromCharCode(0x41 + offset)
        : String.fromCharCode(0x61 + offset - 26);
    }
    // Mathematical Bold Digits 1D7CE–1D7D7 → 0–9
    else if (cp >= 0x1d7ce && cp <= 0x1d7ff) {
      out += String.fromCharCode(0x30 + ((cp - 0x1d7ce) % 10));
    } else {
      out += ch;
    }
  }
  return out;
}

/** Try to parse a date string into YYYY-MM-DD */
function tryParseDate(raw: string): string | undefined {
  // MM/DD/YYYY or MM-DD-YYYY
  let m = raw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) {
    return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  // YYYY-MM-DD
  m = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  // MM/DD or MM-DD (assume current year)
  m = raw.match(/(\d{1,2})[\/\-](\d{1,2})(?!\d)/);
  if (m) {
    const year = new Date().getFullYear();
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  // Month name + day: "June 15" or "Jun 15, 2025"
  const months: Record<string, string> = {
    jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03',
    apr: '04', april: '04', may: '05', jun: '06', june: '06',
    jul: '07', july: '07', aug: '08', august: '08', sep: '09', september: '09',
    oct: '10', october: '10', nov: '11', november: '11', dec: '12', december: '12',
  };
  m = raw.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?\b/i);
  if (m) {
    const mon = months[m[1].toLowerCase()];
    const day = m[2].padStart(2, '0');
    const year = m[3] || new Date().getFullYear().toString();
    return `${year}-${mon}-${day}`;
  }
  return undefined;
}

/* ---------------------------------------------------------------------------
 * Phase 1S-B1: conservative explicit pickup / delivery date labels.
 * Only labels that unambiguously mean "a date" are accepted. Bare `Pickup:` /
 * `Delivery:` are intentionally NOT accepted because brokers use them for
 * locations too.
 * ------------------------------------------------------------------------- */
const PICKUP_DATE_LABEL_RE =
  /\b(?:pick\s*up|pickup|pu)\s*(?:date|appt|appointment)\s*[:=]\s*(.+)/i;
const DELIVERY_DATE_LABEL_RE =
  /\b(?:delivery|deliver|del|drop\s*off|dropoff|drop)\s*(?:date|appt|appointment)\s*[:=]\s*(.+)/i;

/** First line matching `re` → parsed ISO date, else undefined. */
function extractLabeledDate(lines: string[], re: RegExp): string | undefined {
  for (const line of lines) {
    const m = line.match(re);
    if (!m) continue;
    const d = tryParseDate(m[1]);
    if (d) return d;
  }
  return undefined;
}

/* ---------------------------------------------------------------------------
 * Phase 1S-B1: conservative accessorial fee extraction.
 * Only clearly monetary, explicitly labeled TOTALS are accepted. Per-hour
 * rates and durations must never auto-fill a total fee.
 * ------------------------------------------------------------------------- */
const PER_UNIT_SUFFIX_RE = /^\s*(?:\/|per\b|an?\b)\s*(?:hr|hour|hrs|hours|min|minute|minutes|day|days|stop|stops)\b/i;
const AMOUNT_SRC = '([\\d,]+(?:\\.\\d{1,2})?)';

function extractFee(t: string, labelSrc: string): string | undefined {
  // 1) Explicit fee/pay/charge wording — `$` optional.
  // 2) Bare label — an explicit currency marker is required.
  const patterns = [
    new RegExp(`\\b(?:${labelSrc})\\s*(?:time\\s*)?(?:fee|pay|charge)\\s*[:=]?\\s*\\$?\\s*${AMOUNT_SRC}`, 'i'),
    new RegExp(`\\b(?:${labelSrc})\\s*[:=]?\\s*\\$\\s*${AMOUNT_SRC}`, 'i'),
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m || m.index === undefined) continue;
    // Reject per-unit rates: "$25/hr", "$30 per hour", "$25 an hour".
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 16);
    if (PER_UNIT_SUFFIX_RE.test(after)) continue;
    const v = cleanNum(m[1]);
    const num = parseFloat(v);
    if (Number.isFinite(num) && num > 0) return v;
  }
  return undefined;
}



/**
 * Pattern-first mileage extraction.
 *
 * Finds every `<number> mi|mile|miles` in the text (unit required — penalty $ amounts
 * like "$1000" are ignored automatically). For each, inspects ~30 chars before and
 * ~10 chars after to classify by context.
 */
type LoadedKind = 'loaded' | 'trip' | 'linehaul' | 'route' | 'distance' | 'unknown';

interface MileageMatch {
  value: string;       // cleaned numeric string, e.g. "257.10"
  numeric: number;     // parsed float for comparisons
  isDeadhead: boolean;
  loadedKind: LoadedKind;
  hasTotalContext: boolean; // true if "total" appears nearby — ambiguous w/ deadhead
  index: number;       // start position in text
}

const TOTAL_CTX_RE = /\btotal\b/i;

// Number-with-unit. Unit (mi/mile/miles) is REQUIRED — prevents matching "$1000".
// `(?<![\w-])` so we don't grab the "10" out of "ORH5" / "ALB1" etc.
const MILEAGE_TOKEN_RE = /(?<![\w-])([\d]{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(mi|mile|miles)\b/gi;

const DEADHEAD_CTX_RE = /\b(dh|dead\s*head|empty|bobtail|reposition|non[\s-]?revenue|unpaid)\b/i;

// Loaded-context keyword matchers, ranked. First match wins for that token.
// NOTE: "total" is intentionally excluded — total miles often already include
// deadhead and must never outrank an explicit loaded/trip/linehaul label.
const LOADED_CTX_RANKED: { kind: Exclude<LoadedKind, 'unknown'>; re: RegExp }[] = [
  { kind: 'loaded',   re: /\bloaded\b/i },
  { kind: 'trip',     re: /\btrip\b/i },
  { kind: 'linehaul', re: /\blinehaul\b/i },
  { kind: 'route',    re: /\broute\b/i },
  { kind: 'distance', re: /\bdistance\b/i },
];

const LOADED_PRIORITY: Record<LoadedKind, number> = {
  loaded: 6, trip: 5, linehaul: 4, route: 3, distance: 2, unknown: 0,
};

function findAllMileage(t: string): MileageMatch[] {
  const out: MileageMatch[] = [];
  MILEAGE_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MILEAGE_TOKEN_RE.exec(t)) !== null) {
    const raw = m[1];
    const value = cleanNum(raw);
    const numeric = parseFloat(value);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;

    const start = m.index;
    // Restrict context to the current line so labels from neighboring lines
    // (e.g. "Trip:" on the next line) cannot be borrowed by this token.
    const lineStart = t.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const lineEndIdx = t.indexOf('\n', start);
    const lineEnd = lineEndIdx === -1 ? t.length : lineEndIdx;
    const before = t.slice(Math.max(lineStart, start - 30), start);
    const after = t.slice(start + m[0].length, Math.min(lineEnd, start + m[0].length + 10));
    const ctx = `${before} ${after}`;

    const isDeadhead = DEADHEAD_CTX_RE.test(before);
    const hasTotalContext = !isDeadhead && TOTAL_CTX_RE.test(ctx);

    let loadedKind: LoadedKind = 'unknown';
    if (!isDeadhead) {
      for (const { kind, re } of LOADED_CTX_RANKED) {
        if (re.test(ctx)) { loadedKind = kind; break; }
      }
    }

    out.push({ value, numeric, isDeadhead, loadedKind, hasTotalContext, index: start });
  }
  return out;
}

function pickDeadhead(matches: MileageMatch[]): string | undefined {
  const dh = matches.find(m => m.isDeadhead);
  return dh?.value;
}

function pickLoaded(matches: MileageMatch[], deadheadValue?: string): string | undefined {
  let nonDh = matches.filter(m => !m.isDeadhead && m.value !== deadheadValue);
  if (nonDh.length === 0) return undefined;

  // When deadhead is present, exclude tokens whose only nearby context is "total"
  // — total miles often already include deadhead, so we can't safely use them as
  // loaded miles. Only filter when this leaves at least one candidate; otherwise
  // we'd return undefined and the caller will set needsMileageReview.
  if (deadheadValue) {
    const filtered = nonDh.filter(m => !(m.hasTotalContext && m.loadedKind === 'unknown'));
    nonDh = filtered;
    if (nonDh.length === 0) return undefined;
  }

  // Strongest context wins; break ties by larger numeric value (likely the trip total).
  const sorted = [...nonDh].sort((a, b) => {
    const pri = LOADED_PRIORITY[b.loadedKind] - LOADED_PRIORITY[a.loadedKind];
    if (pri !== 0) return pri;
    return b.numeric - a.numeric;
  });
  return sorted[0].value;
}

export function parseLoadText(text: string): ParsedLoadData {
  const result: ParsedLoadData = {};
  if (!text || !text.trim()) return result;

  // STEP 1: Normalize bold/styled unicode letters → ASCII so all label
  // regexes can match regardless of formatting characters used by dispatch bots.
  const t = normalizeUnicodeLetters(text).trim();

  // --- Trip ID (e.g. "Trip ID: T-1123J49SR") ---
  const tripIdMatch = t.match(/trip\s*id\s*[:=]?\s*([A-Z0-9][A-Z0-9\-]{2,})/i);
  if (tripIdMatch) result.trip_id = tripIdMatch[1].trim();

  // --- Locations ---
  // "from X to Y" pattern
  let m = t.match(/from\s+(.+?)\s+to\s+(.+?)(?:\n|,\s*\d|$)/i);
  if (m) {
    result.pickup_location = m[1].replace(/,\s*$/, '').trim();
    result.dropoff_location = m[2].replace(/,\s*$/, '').trim();
  }

  // "Origin: X" / "Dest: Y" or "PU: X" / "DEL: Y" or "Pickup: X" / "Dropoff: Y"
  if (!result.pickup_location) {
    m = t.match(/(?:origin|pu|pick\s*up|pickup)\s*[:=]\s*(.+)/i);
    if (m) result.pickup_location = m[1].split(/\n/)[0].replace(/,\s*$/, '').trim();
  }
  if (!result.dropoff_location) {
    m = t.match(/(?:dest(?:ination)?|del(?:ivery)?|drop\s*off|dropoff|consignee)\s*[:=]\s*(.+)/i);
    if (m) result.dropoff_location = m[1].split(/\n/)[0].replace(/,\s*$/, '').trim();
  }

  // "City, ST → City, ST" or "City, ST - City, ST"
  if (!result.pickup_location) {
    m = t.match(/([A-Za-z\s]+,\s*[A-Z]{2})\s*(?:→|->|–|—|to)\s*([A-Za-z\s]+,\s*[A-Z]{2})/i);
    if (m) {
      result.pickup_location = m[1].trim();
      result.dropoff_location = m[2].trim();
    }
  }

  // --- Mileage: pattern-first scan + context classification ---
  // Find every "<number> mi|mile|miles" token. Penalty $-amounts have no mi unit so they're skipped.
  const mileageMatches = findAllMileage(t);

  let dh = pickDeadhead(mileageMatches);
  let loaded = pickLoaded(mileageMatches, dh);

  // ---- HIGH-PRIORITY explicit Trip / Loaded line matchers (Telegram dispatch bots) ----
  // These run BEFORE labelled fallback so a clear `Trip: 257.10mi` always wins, even
  // if a noisy generic token elsewhere (e.g. another `25 mi`) might otherwise outrank it.
  // Keyword must NOT be "Trip ID" (we exclude that explicitly).
  const TRIP_LOADED_LINE_RE =
    /(?:^|[\s\W])(?:loaded\s+)?(trip\s*(?:miles?|mileage|distance)?|loaded\s*(?:miles?|mi|distance)?|linehaul(?:\s*miles?)?|route\s*miles?|distance)\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(?:mi|mile|miles)?\b/i;
  // Find ALL matches and pick the strongest one whose keyword isn't "trip id".
  const TRIP_LOADED_GLOBAL_RE = new RegExp(TRIP_LOADED_LINE_RE.source, 'gi');
  let bestExplicit: { value: string; priority: number } | null = null;
  let gm: RegExpExecArray | null;
  TRIP_LOADED_GLOBAL_RE.lastIndex = 0;
  while ((gm = TRIP_LOADED_GLOBAL_RE.exec(t)) !== null) {
    const keyword = gm[1].toLowerCase().replace(/\s+/g, ' ').trim();
    const numStr = cleanNum(gm[2]);
    const numeric = parseFloat(numStr);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    // Exclude "trip id" — verify the chars immediately before/after the keyword
    // aren't forming "trip id". The captured keyword starts with "trip" — check
    // the next 3 chars in the source for " id".
    const after = t.slice(gm.index + gm[0].indexOf(gm[1]) + gm[1].length, gm.index + gm[0].indexOf(gm[1]) + gm[1].length + 4).toLowerCase();
    if (keyword.startsWith('trip') && /^\s*id\b/.test(after)) continue;
    // Also skip if the matched value equals the deadhead value we already locked in.
    if (dh && numStr === dh) continue;
    // Priority: loaded > trip > linehaul > route > distance
    let priority = 1;
    if (keyword.startsWith('loaded')) priority = 6;
    else if (keyword.startsWith('trip')) priority = 5;
    else if (keyword.startsWith('linehaul')) priority = 4;
    else if (keyword.startsWith('route')) priority = 3;
    else if (keyword.startsWith('distance')) priority = 2;
    if (!bestExplicit || priority > bestExplicit.priority) {
      bestExplicit = { value: numStr, priority };
    }
  }
  if (bestExplicit) {
    loaded = bestExplicit.value;
  }

  // --- Labelled fallback (covers "Loaded Miles: 300" / "Trip Miles: 415.5" /
  // "Empty Miles: 25" / "Linehaul Miles: 257.10" — number has no trailing "mi") ---
  if (!dh) {
    const dhLabelled =
      t.match(/(?:dead\s*head|empty|bobtail|unpaid|reposition|non[\s-]?revenue)\s*miles?\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i) ||
      t.match(/(?:dead\s*head|empty|bobtail|unpaid|reposition|non[\s-]?revenue)\s*[:=]\s*([\d,]+(?:\.\d+)?)/i) ||
      t.match(/\bdh\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i) ||
      t.match(/([\d,]+(?:\.\d+)?)\s*(?:dh|dead\s*head)\b/i);
    if (dhLabelled) dh = cleanNum(dhLabelled[1]);
  }
  if (!loaded) {
    const labelledLoaded: RegExp[] = [
      /total\s*trip\s*miles?\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
      /(?:trip\s*miles?|miles?\s*trip)\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
      /loaded\s*(?:miles?|mi|distance)?\s*[:=]\s*([\d,]+(?:\.\d+)?)/i,
      /linehaul\s*miles?\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
      /route\s*miles?\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
      /distance\s*[:=]\s*([\d,]+(?:\.\d+)?)/i,
      /\btrip\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*mi(?:les?)?\b/i,
    ];
    for (const re of labelledLoaded) {
      const lm = t.match(re);
      if (lm) {
        const v = cleanNum(lm[1]);
        if (v !== dh) { loaded = v; break; }
      }
    }
    // Last-resort "Total Miles: 500" — ONLY when no deadhead was found.
    // If deadhead is present alongside bare "total miles", we can't tell whether
    // the total already includes deadhead, so we leave loaded undefined and
    // flag the result for user review.
    if (!loaded && !dh) {
      const totalM = t.match(/total\s*miles?\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i);
      if (totalM) {
        const v = cleanNum(totalM[1]);
        loaded = v;
      }
    }
  }

  // Flag ambiguous mileage: deadhead present but no confident loaded value.
  if (dh && !loaded) {
    result.needsMileageReview = true;
  }

  // Defensive guard: a single number can't be both loaded AND deadhead.
  // If they ended up equal AND there's only one mileage token in the source, drop deadhead.
  if (dh && loaded && dh === loaded && mileageMatches.length <= 1) {
    dh = undefined;
  }
  // Stronger guard: if both exist but are the same numeric value AND we have a
  // distinct non-deadhead candidate elsewhere, prefer that other candidate for loaded
  // so deadhead never duplicates into loaded miles.
  if (dh && loaded && dh === loaded && mileageMatches.length > 1) {
    const alt = pickLoaded(mileageMatches.filter(m => m.value !== dh), dh);
    if (alt) loaded = alt;
  }

  if (dh) result.deadhead_miles = dh;
  if (loaded) result.loaded_miles = loaded;

  // --- Total miles (Phase 5) — captured as its own field, NOT collapsed into loaded.
  // Match labels: "total miles", "total mile", "total trip miles", "total distance",
  // "all miles". Numeric value can be followed by mi/mile/miles or nothing.
  let totalMiles: string | undefined;
  const totalLabelRe =
    /\b(?:total\s*(?:trip\s*)?(?:miles?|distance)|all\s*miles?)\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(?:mi(?:les?)?)?\b/i;
  const tm = t.match(totalLabelRe);
  if (tm) totalMiles = cleanNum(tm[1]);
  if (totalMiles) result.total_miles = totalMiles;

  // Mileage reconciliation warnings + derivation
  const loadedNum = loaded ? parseFloat(loaded) : NaN;
  const dhNum = dh ? parseFloat(dh) : NaN;
  const totalNum = totalMiles ? parseFloat(totalMiles) : NaN;

  if (Number.isFinite(loadedNum) && Number.isFinite(dhNum) && Number.isFinite(totalNum)) {
    if (Math.abs(loadedNum + dhNum - totalNum) > 2) {
      result.mileage_warning =
        `Mileage mismatch: loaded (${loaded}) + deadhead (${dh}) ≠ total (${totalMiles}). Please verify.`;
    }
  }
  if (Number.isFinite(dhNum) && Number.isFinite(totalNum) && dhNum > totalNum) {
    result.mileage_warning = `Deadhead miles (${dh}) is greater than total miles (${totalMiles}).`;
  }
  if (Number.isFinite(loadedNum) && Number.isFinite(totalNum) && totalNum < loadedNum) {
    result.mileage_warning = `Total miles (${totalMiles}) is less than loaded miles (${loaded}).`;
  }
  // Total + DH only (no explicit loaded): derive loaded = total - dh, flag for review.
  if (!loaded && Number.isFinite(totalNum) && Number.isFinite(dhNum) && totalNum > dhNum) {
    const derived = (totalNum - dhNum).toString();
    result.loaded_miles = derived;
    result.needsMileageReview = true;
    result.mileage_warning =
      result.mileage_warning ??
      'Loaded miles calculated from total minus deadhead. Please verify.';
  }

  // Dev-only debug trace (stripped in production builds by Vite).
  if (import.meta.env?.DEV) {
    const loadedSrc = mileageMatches.find(mm => mm.value === loaded);
    const dhSrc = mileageMatches.find(mm => mm.value === dh && mm.isDeadhead);
    // eslint-disable-next-line no-console
    console.log('[Load Parser]', {
      detectedLoadedMiles: result.loaded_miles,
      detectedDeadheadMiles: result.deadhead_miles,
      detectedTotalMiles: result.total_miles,
      mileageWarning: result.mileage_warning,
      matchedLoadedMilesSource: loadedSrc?.loadedKind ?? 'labelled-fallback',
      matchedDeadheadMilesSource: dhSrc ? 'context' : (dh ? 'labelled-fallback' : null),
    });
  }

  // --- Deadhead rate per mile (Phase 5) — must run BEFORE general rate to avoid stealing.
  // "DH rate $1.00/mi", "deadhead rate: 1.00", "empty rate 0.85/mile"
  const dhRateMatch =
    t.match(/(?:dh|dead\s*head|empty)\s*rate\s*[:=]?\s*\$?([\d,.]+)/i) ||
    t.match(/\$?([\d,.]+)\s*\/\s*mi(?:le)?\s+(?:dh|dead\s*head|empty)/i);
  if (dhRateMatch) result.deadhead_rate_per_mile = cleanNum(dhRateMatch[1]);

  // --- Loaded rate per mile (also accept explicit "loaded rate") ---
  const loadedRateMatch = t.match(/loaded\s*rate\s*[:=]?\s*\$?([\d,.]+)/i);
  if (loadedRateMatch) result.rate_per_mile = cleanNum(loadedRateMatch[1]);

  // --- Rate per mile (generic) ---
  // "$2.45/mi", "$2.45 CPM", "$2.45 per mile", "2.45 rpm", "rate: $2.45"
  if (!result.rate_per_mile) {
    m = t.match(/\$?([\d,.]+)\s*(?:\/\s*mi(?:le)?|cpm|rpm|per\s+mile)\b/i);
    if (m) {
      const v = cleanNum(m[1]);
      if (v !== result.deadhead_rate_per_mile) result.rate_per_mile = v;
    }
  }
  if (!result.rate_per_mile) {
    m = t.match(/(?:rate|cpm|rpm)\s*[:=]?\s*\$?([\d,.]+)/i);
    if (m) {
      const v = cleanNum(m[1]);
      if (v !== result.deadhead_rate_per_mile) result.rate_per_mile = v;
    }
  }

  // --- Flat rate (Phase 5) ---
  // "Flat rate: $850", "Flat $850", "Flat pay 850"
  const flatMatch =
    t.match(/\bflat\s*(?:rate|pay)?\s*[:=]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)\b/i);
  if (flatMatch) {
    const v = cleanNum(flatMatch[1]);
    const num = parseFloat(v);
    if (Number.isFinite(num) && num > 0) result.flat_rate = v;
  }

  // --- Gross Revenue ---
  // Use a more specific pattern that excludes "total miles" / "total mile" phrasing
  // so it doesn't pick up mileage labels.
  m = t.match(/(?:gross|revenue|total\s*(?:pay|revenue|load))\s*[:=]?\s*\$?([\d,.]+)/i);
  if (m) result.gross_revenue = cleanNum(m[1]);
  if (!result.gross_revenue) {
    m = t.match(/\$?([\d,.]+)\s*(?:gross|load\s*(?:pay|revenue)?)\b/i);
    if (m) result.gross_revenue = cleanNum(m[1]);
  }
  if (!result.gross_revenue && !result.rate_per_mile && !result.flat_rate) {
    m = t.match(/\$([\d,]+(?:\.\d{1,2})?)/);
    if (m) {
      const val = parseFloat(cleanNum(m[1]));
      if (val > 100) result.gross_revenue = cleanNum(m[1]);
    }
  }

  // --- Pay model suggestion (Phase 5) ---
  if (result.flat_rate) {
    result.pay_model_suggestion = 'flat_rate';
  } else if (result.rate_per_mile && result.deadhead_rate_per_mile) {
    result.pay_model_suggestion = 'loaded_plus_deadhead';
  } else if (result.rate_per_mile && result.total_miles && !result.loaded_miles) {
    result.pay_model_suggestion = 'total_miles';
  } else if (result.rate_per_mile || result.loaded_miles) {
    result.pay_model_suggestion = 'loaded_miles_only';
  } else if (result.gross_revenue) {
    result.pay_model_suggestion = 'manual';
  }

  // --- Accessorial fees (Phase 1S-B1) ---
  const waitFee = extractFee(t, 'wait|waiting');
  if (waitFee) result.wait_fee = waitFee;
  const detentionFee = extractFee(t, 'detention');
  if (detentionFee) result.detention_fee = detentionFee;

  // --- Date ---
  // Phase 1S-B1: explicit labeled pickup/delivery dates take authority.
  const dateLines = t.split('\n');
  const explicitPickupDate = extractLabeledDate(dateLines, PICKUP_DATE_LABEL_RE);
  const explicitDeliveryDate = extractLabeledDate(dateLines, DELIVERY_DATE_LABEL_RE);
  if (explicitPickupDate) {
    result.load_date = explicitPickupDate;
  } else {
    // Generic fallback preserved — but a delivery-labeled date line must never
    // become the pickup date merely because it is the first/only date present.
    const genericSource = dateLines.filter(l => !DELIVERY_DATE_LABEL_RE.test(l)).join('\n');
    const dateStr = tryParseDate(genericSource);
    if (dateStr) result.load_date = dateStr;
  }
  if (explicitDeliveryDate) result.dropoff_date = explicitDeliveryDate;


  // --- Numbered Stop Detection (e.g. "1#:", "2#:", "3#:") ---
  const stopMarkers = t.match(/\b\d+#:\s*/g);
  if (stopMarkers && stopMarkers.length >= 2) {
    result.multiStopDetected = true;
    // detectedStopsCount is set from the filtered blocks below (after pinned-preview filter)
    const blocks = t.split(/(?=\b\d+#:\s*)/)
      .filter(b => /^\d+#:/.test(b.trim()))
      // Drop Telegram pinned-message-preview snippets. The preview is a
      // single-line truncated copy ending in "..." or "…" — e.g.
      // "1#: 111DF4KFK Loaded - P..." — which would otherwise be parsed as a stop.
      .filter(b => {
        const body = b.replace(/^\d+#:\s*/, '');
        const firstLine = body.split('\n')[0].trim();
        // Block must have multi-line body OR contain a city,ST pattern.
        // Single-line truncated previews fail both checks.
        if (/(\.{3}|…)/.test(firstLine) && !/[A-Za-z]+,\s*[A-Z]{2}/.test(body)) return false;
        return true;
      });
    const parsedStops: ParsedStopData[] = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      let cityMatch = block.match(/([A-Za-z .'-]+,\s*[A-Z]{2})\s*\d{5}/);
      if (!cityMatch) cityMatch = block.match(/([A-Za-z .'-]+,\s*[A-Z]{2})\b/);
      const location = cityMatch ? cityMatch[1].trim() : block.replace(/^\d+#:\s*/, '').split('\n')[0].trim();

      let stop_type = 'Stop';
      if (i === 0) stop_type = 'Pickup';
      else if (i === blocks.length - 1) stop_type = 'Drop';

      // Phase 29A/F: conservative per-stop date extraction. Only accept a
      // date when it is clearly local to this stop:
      //   - the block's first (marker) line, OR
      //   - a line whose only content is a date (optionally prefixed with a
      //     stop-local label like Pickup/PU/Appt/Delivery/Drop/ETA/Ready), OR
      //   - a line that begins with one of those labels
      // If multiple distinct dates qualify, leave stop_date undefined.
      let stop_date: string | undefined;
      const blockBody = block.replace(/^\d+#:\s*/, '');
      const headerLineDate = tryParseDate(blockBody.split('\n')[0] ?? '');
      const LOCAL_LABEL_RE = /\b(pickup|pu|appt|appointment|delivery|del|drop|eta|ready|dispatch)\b/i;
      const candidates: string[] = [];
      if (headerLineDate) candidates.push(headerLineDate);
      const bodyLines = blockBody.split('\n').slice(1);
      for (const rawLine of bodyLines) {
        const line = rawLine.trim();
        if (!line) continue;
        const d = tryParseDate(line);
        if (!d) continue;
        // Accept if line is essentially just the date (≤4 extra chars besides
        // the date itself) OR if it begins with / contains a stop-local label.
        const stripped = line.replace(/(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,?\s*\d{4})?)/i, '').trim();
        const isBareDateLine = stripped.length <= 4;
        const hasLocalLabel = LOCAL_LABEL_RE.test(line);
        if (isBareDateLine || hasLocalLabel) candidates.push(d);
      }
      const distinct = Array.from(new Set(candidates));
      if (distinct.length === 1) {
        const only = distinct[0];
        if (isValidISODate(only) && isWithinSanityWindow(only)) stop_date = only;
      }

      if (location) parsedStops.push({ location, stop_type, ...(stop_date ? { stop_date } : {}) });
    }

    if (parsedStops.length >= 2) {
      result.stops = parsedStops;
      result.detectedStopsCount = parsedStops.length;
      result.pickup_location = parsedStops[0].location;
      result.dropoff_location = parsedStops[parsedStops.length - 1].location;
    } else {
      // Filtered down to <2 real stops — not actually multi-stop.
      result.multiStopDetected = false;
    }
  }

  return result;
}
