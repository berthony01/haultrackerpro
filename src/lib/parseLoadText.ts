/**
 * Regex-based parser for extracting load details from pasted text (Telegram, SMS, broker messages).
 * No AI. User always reviews before saving.
 */

export interface ParsedLoadData {
  pickup_location?: string;
  dropoff_location?: string;
  loaded_miles?: string;
  deadhead_miles?: string;
  rate_per_mile?: string;
  gross_revenue?: string;
  load_date?: string;
  notes?: string;
}

/** Strip $ and commas from a number string */
function cleanNum(s: string): string {
  return s.replace(/[$,]/g, '').trim();
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

export function parseLoadText(text: string): ParsedLoadData {
  const result: ParsedLoadData = {};
  const t = text.trim();
  if (!t) return result;

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

  // "City, ST → City, ST" or "City, ST - City, ST"  (arrow or dash separating two city/state pairs)
  if (!result.pickup_location) {
    m = t.match(/([A-Za-z\s]+,\s*[A-Z]{2})\s*(?:→|->|–|—|to)\s*([A-Za-z\s]+,\s*[A-Z]{2})/i);
    if (m) {
      result.pickup_location = m[1].trim();
      result.dropoff_location = m[2].trim();
    }
  }

  // --- Miles ---
  // "loaded miles: 920" or "920 mi" or "920 miles" or "miles: 920"
  m = t.match(/(?:loaded\s*(?:miles)?|total\s*miles|miles)\s*[:=]?\s*([\d,.]+)/i);
  if (m) result.loaded_miles = cleanNum(m[1]);
  if (!result.loaded_miles) {
    m = t.match(/([\d,.]+)\s*(?:loaded\s+)?mi(?:les?)?\b/i);
    if (m) result.loaded_miles = cleanNum(m[1]);
  }

  // --- Deadhead ---
  // "DH: 45", "45 DH", "deadhead 45", "deadhead: 45 mi"
  m = t.match(/(?:dh|dead\s*head)\s*[:=]?\s*([\d,.]+)\s*(?:mi(?:les?)?)?\b/i);
  if (m) {
    result.deadhead_miles = cleanNum(m[1]);
  } else {
    m = t.match(/([\d,.]+)\s*(?:dh|dead\s*head)\b/i);
    if (m) result.deadhead_miles = cleanNum(m[1]);
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
  // "$3,500 load", "gross $3500", "revenue: $3500", "total: $3500", "$3500 gross"
  m = t.match(/(?:gross|revenue|total\s*(?:pay|revenue|load)?)\s*[:=]?\s*\$?([\d,.]+)/i);
  if (m) result.gross_revenue = cleanNum(m[1]);
  if (!result.gross_revenue) {
    m = t.match(/\$?([\d,.]+)\s*(?:gross|load\s*(?:pay|revenue)?)\b/i);
    if (m) result.gross_revenue = cleanNum(m[1]);
  }
  // Standalone dollar amount (large, likely gross) — only if no rate found and amount > 100
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

  return result;
}
