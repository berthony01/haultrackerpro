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

export interface ParsedStopData {
  location: string;
  stop_type: string;
}

export interface ParsedLoadData {
  pickup_location?: string;
  dropoff_location?: string;
  loaded_miles?: string;
  deadhead_miles?: string;
  rate_per_mile?: string;
  gross_revenue?: string;
  load_date?: string;
  notes?: string;
  trip_id?: string;
  multiStopDetected?: boolean;
  detectedStopsCount?: number;
  stops?: ParsedStopData[];
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
  let out = '';
  for (const ch of input) {
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

/**
 * Extract loaded / trip miles from the (already unicode-normalized) text.
 * Tries label variants in priority order; falls back to "Total Miles".
 */
function extractLoadedMiles(t: string): string | undefined {
  // High-priority labelled patterns. Group 1 = numeric value.
  // Order matters — most specific first.
  const labelledPatterns: RegExp[] = [
    // "Total Trip Miles: 257.10"
    /total\s*trip\s*miles?\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
    // "Trip Miles: 257.10" / "Miles Trip: 257.10"
    /(?:trip\s*miles?|miles?\s*trip)\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
    // "Loaded Miles: 300" / "Loaded Mi: 300" / "Loaded Distance: 300" / "Loaded: 300mi"
    /loaded\s*(?:miles?|mi|distance)?\s*[:=]\s*([\d,]+(?:\.\d+)?)\s*(?:mi(?:les?)?)?\b/i,
    // "Linehaul Miles: 257"
    /linehaul\s*miles?\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
    // "Route Miles: 222" / "Route miles 222 mi"
    /route\s*miles?\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
    // "Distance: 257 mi"
    /distance\s*[:=]\s*([\d,]+(?:\.\d+)?)\s*(?:mi(?:les?)?)?\b/i,
    // "Trip: 257.10mi" / "Trip: 257.10 mi" / "Trip: 257.10 miles"
    // Requires "mi" suffix after the number to avoid matching "Trip ID: T-123".
    /\btrip\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*mi(?:les?)?\b/i,
  ];

  for (const re of labelledPatterns) {
    const m = t.match(re);
    if (m) return cleanNum(m[1]);
  }

  // Fallback only: "Total Miles: 500" (no better mileage value found)
  const totalM = t.match(/total\s*miles?\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i);
  if (totalM) return cleanNum(totalM[1]);

  return undefined;
}

/**
 * Extract deadhead miles. Run BEFORE loaded miles so DH numbers can't be
 * misread as trip miles.
 */
function extractDeadheadMiles(t: string): string | undefined {
  const patterns: RegExp[] = [
    // "Deadhead Miles: 25" / "Deadhead 25 miles" / "Deadhead: 25 mi"
    /dead\s*head\s*(?:miles?)?\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(?:mi(?:les?)?)?\b/i,
    // "DH 25 miles" / "DH: 25 miles" / "DH 25mi" / "DH: 25"
    /\bdh\s*[:=]?\s*([\d,]+(?:\.\d+)?)\s*(?:mi(?:les?)?)?\b/i,
    // "Empty Miles: 25"
    /empty\s*miles?\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
    // "Bobtail Miles: 25"
    /bobtail\s*miles?\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
    // "Unpaid Miles: 25"
    /unpaid\s*miles?\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
    // Trailing form: "25 DH" / "25 deadhead"
    /([\d,]+(?:\.\d+)?)\s*(?:dh|dead\s*head)\b/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) return cleanNum(m[1]);
  }
  return undefined;
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

  // --- Deadhead first (so loaded-miles regex can't consume DH numbers) ---
  const dh = extractDeadheadMiles(t);
  if (dh) result.deadhead_miles = dh;

  // --- Loaded / Trip miles ---
  const loaded = extractLoadedMiles(t);
  if (loaded) result.loaded_miles = loaded;

  // Legacy fallback: bare "920 mi" / "920 miles" — only if still nothing
  // and we're confident we won't grab the deadhead number again.
  if (!result.loaded_miles) {
    const bare = t.match(/(?<![\w-])([\d,]+(?:\.\d+)?)\s*mi(?:les?)?\b/i);
    if (bare) {
      const candidate = cleanNum(bare[1]);
      if (candidate !== result.deadhead_miles) result.loaded_miles = candidate;
    }
  }

  // --- Rate per mile ---
  // "$2.45/mi", "$2.45 CPM", "$2.45 per mile", "2.45 rpm", "rate: $2.45"
  m = t.match(/\$?([\d,.]+)\s*(?:\/\s*mi(?:le)?|cpm|rpm|per\s+mile)\b/i);
  if (m) result.rate_per_mile = cleanNum(m[1]);
  if (!result.rate_per_mile) {
    m = t.match(/(?:rate|cpm|rpm)\s*[:=]?\s*\$?([\d,.]+)/i);
    if (m) result.rate_per_mile = cleanNum(m[1]);
  }

  // --- Gross Revenue ---
  m = t.match(/(?:gross|revenue|total\s*(?:pay|revenue|load)?)\s*[:=]?\s*\$?([\d,.]+)/i);
  if (m) result.gross_revenue = cleanNum(m[1]);
  if (!result.gross_revenue) {
    m = t.match(/\$?([\d,.]+)\s*(?:gross|load\s*(?:pay|revenue)?)\b/i);
    if (m) result.gross_revenue = cleanNum(m[1]);
  }
  if (!result.gross_revenue && !result.rate_per_mile) {
    m = t.match(/\$([\d,]+(?:\.\d{1,2})?)/);
    if (m) {
      const val = parseFloat(cleanNum(m[1]));
      if (val > 100) result.gross_revenue = cleanNum(m[1]);
    }
  }

  // --- Date ---
  const dateStr = tryParseDate(t);
  if (dateStr) result.load_date = dateStr;

  // --- Numbered Stop Detection (e.g. "1#:", "2#:", "3#:") ---
  const stopMarkers = t.match(/\b\d+#:\s*/g);
  if (stopMarkers && stopMarkers.length >= 2) {
    result.multiStopDetected = true;
    result.detectedStopsCount = stopMarkers.length;

    const blocks = t.split(/(?=\b\d+#:\s*)/).filter(b => /^\d+#:/.test(b.trim()));
    const parsedStops: ParsedStopData[] = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      let cityMatch = block.match(/([A-Za-z .'-]+,\s*[A-Z]{2})\s*\d{5}/);
      if (!cityMatch) cityMatch = block.match(/([A-Za-z .'-]+,\s*[A-Z]{2})\b/);
      const location = cityMatch ? cityMatch[1].trim() : block.replace(/^\d+#:\s*/, '').split('\n')[0].trim();

      let stop_type = 'Stop';
      if (i === 0) stop_type = 'Pickup';
      else if (i === blocks.length - 1) stop_type = 'Drop';

      if (location) parsedStops.push({ location, stop_type });
    }

    if (parsedStops.length >= 2) {
      result.stops = parsedStops;
      result.pickup_location = parsedStops[0].location;
      result.dropoff_location = parsedStops[parsedStops.length - 1].location;
    }
  }

  return result;
}
