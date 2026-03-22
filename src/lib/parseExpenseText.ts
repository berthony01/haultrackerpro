import { EXPENSE_CATEGORIES } from '@/hooks/useExpenses';
import { format, subDays, previousMonday, previousTuesday, previousWednesday, previousThursday, previousFriday, previousSaturday, previousSunday } from 'date-fns';

export interface ParsedExpense {
  amount: number | null;
  category: string | null;
  date: string | null;
  notes: string | null;
  confidence: number;
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Fuel: ['fuel', 'gas', 'diesel', 'petrol', 'pump', 'gallons', 'shell', 'bp', 'chevron', 'exxon', 'mobil', 'pilot', 'loves', 'flying j', 'ta ', 'truck stop', 'speedway', 'circle k', 'wawa', 'quiktrip', 'casey'],
  Maintenance: ['maintenance', 'oil change', 'filter', 'lube', 'service', 'tune up', 'alignment', 'inspection'],
  Repairs: ['repair', 'fix', 'replace', 'broken', 'mechanic', 'body shop', 'tow', 'breakdown'],
  Tires: ['tire', 'tyre', 'tires', 'flat', 'retread', 'recap'],
  Insurance: ['insurance', 'premium', 'coverage', 'policy', 'liability'],
  Tolls: ['toll', 'turnpike', 'bridge', 'ez pass', 'ezpass', 'sunpass', 'ipass', 'peach pass', 'pike pass'],
  Parking: ['parking', 'park', 'truck stop parking', 'overnight parking'],
  Permits: ['permit', 'dot', 'ifta', 'irp', 'ucr', 'oversize', 'overweight'],
  Licensing: ['license', 'registration', 'renewal', 'cdl'],
  'Truck Payment': ['truck payment', 'truck loan', 'truck note', 'vehicle payment'],
  'Lease Payment': ['lease', 'lease payment'],
  Phone: ['phone', 'cell', 'mobile', 'wireless', 'verizon', 'tmobile', 't-mobile', 'att', 'at&t'],
  'ELD/Software': ['eld', 'software', 'app', 'subscription', 'motive', 'keep truckin', 'samsara'],
  'Scale/Weigh': ['scale', 'weigh', 'cat scale', 'weigh station'],
  Lumper: ['lumper', 'unload', 'loading fee'],
  Meals: ['meal', 'food', 'lunch', 'dinner', 'breakfast', 'eat', 'restaurant', 'mcdonald', 'subway', 'denny', 'waffle', 'snack', 'per diem'],
  Lodging: ['hotel', 'motel', 'lodging', 'room', 'stay', 'sleep', 'night'],
  Supplies: ['supplies', 'supply', 'gloves', 'straps', 'chains', 'bungee', 'flashlight', 'cleaning'],
  Other: [],
};

// Month name to number mapping
const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
  april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

// Word numbers that speech recognition might produce
const WORD_NUMBERS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15,
  sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20,
  'twenty first': 21, 'twenty second': 22, 'twenty third': 23, 'twenty fourth': 24,
  'twenty fifth': 25, 'twenty sixth': 26, 'twenty seventh': 27, 'twenty eighth': 28,
  'twenty ninth': 29, thirtieth: 30, 'thirty first': 31,
};

function parseSpokenDate(text: string): string | null {
  const lower = text.toLowerCase();
  const now = new Date();

  // "today", "this morning", "this afternoon", "tonight"
  if (/\b(today|this morning|this afternoon|this evening|tonight|just now)\b/.test(lower)) {
    return format(now, 'yyyy-MM-dd');
  }

  // "yesterday"
  if (/\byesterday\b/.test(lower)) {
    return format(subDays(now, 1), 'yyyy-MM-dd');
  }

  // "day before yesterday"
  if (/\bday before yesterday\b/.test(lower)) {
    return format(subDays(now, 2), 'yyyy-MM-dd');
  }

  // "last Monday", "last Tuesday", etc.
  const lastDayMatch = lower.match(/\blast\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (lastDayMatch) {
    const dayFns: Record<string, (d: Date) => Date> = {
      monday: previousMonday,
      tuesday: previousTuesday,
      wednesday: previousWednesday,
      thursday: previousThursday,
      friday: previousFriday,
      saturday: previousSaturday,
      sunday: previousSunday,
    };
    const fn = dayFns[lastDayMatch[1]];
    if (fn) return format(fn(now), 'yyyy-MM-dd');
  }

  // "March 21", "March 21st", "Jan 5th", "January fifth"
  const monthNamePattern = Object.keys(MONTHS).join('|');
  const monthDayMatch = lower.match(new RegExp(`\\b(${monthNamePattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`));
  if (monthDayMatch) {
    const month = MONTHS[monthDayMatch[1]];
    const day = parseInt(monthDayMatch[2]);
    if (month && day >= 1 && day <= 31) {
      const year = now.getFullYear();
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // "March fifth", "January twentieth" — month name + word number
  for (const [word, dayNum] of Object.entries(WORD_NUMBERS)) {
    const wordPattern = new RegExp(`\\b(${monthNamePattern})\\s+${word}\\b`);
    const match = lower.match(wordPattern);
    if (match) {
      const month = MONTHS[match[1]];
      if (month) {
        const year = now.getFullYear();
        return `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      }
    }
  }

  // "on the 21st", "on the 5th", "the 15th" — assumes current month
  const onTheDayMatch = lower.match(/\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b/);
  if (onTheDayMatch) {
    const day = parseInt(onTheDayMatch[1]);
    if (day >= 1 && day <= 31) {
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // MM/DD/YYYY or MM-DD-YYYY numeric
  const numericMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (numericMatch) {
    const [, m, d, y] = numericMatch;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return null;
}

export function parseExpenseText(text: string): ParsedExpense {
  const lower = text.toLowerCase();
  let confidence = 0;

  // --- Amount ---
  let amount: number | null = null;
  const dollarMatch = text.match(/\$\s?([\d,]+\.?\d{0,2})/);
  if (dollarMatch) {
    amount = parseFloat(dollarMatch[1].replace(/,/g, ''));
    confidence += 0.4;
  } else {
    const dollarWord = text.match(/([\d,]+\.?\d{0,2})\s*(?:dollars?|bucks?)/i);
    if (dollarWord) {
      amount = parseFloat(dollarWord[1].replace(/,/g, ''));
      confidence += 0.3;
    } else {
      const numbers = text.match(/\b(\d+\.?\d{0,2})\b/g);
      if (numbers && numbers.length === 1) {
        amount = parseFloat(numbers[0]);
        confidence += 0.15;
      }
    }
  }

  // --- Category ---
  let category: string | null = null;
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (cat === 'Other') continue;
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        category = cat;
        confidence += 0.3;
        break;
      }
    }
    if (category) break;
  }

  // --- Date (improved spoken date parsing) ---
  let date: string | null = parseSpokenDate(text);
  if (date) {
    confidence += 0.2;
  } else {
    // Default to today if no date mentioned — expense likely happened now
    date = format(new Date(), 'yyyy-MM-dd');
    confidence += 0.05; // Low confidence boost since it's assumed
  }

  // Notes: use the raw text trimmed
  const notes = text.trim().substring(0, 200) || null;

  return {
    amount: amount && amount > 0 ? amount : null,
    category: category && EXPENSE_CATEGORIES.includes(category as any) ? category : null,
    date,
    notes,
    confidence: Math.min(confidence, 1),
  };
}

/**
 * Receipt-specific parsing with TOTAL scoring.
 * Prefers lines containing TOTAL / AMOUNT DUE over SUBTOTAL / TAX / TIP / CHANGE.
 */
export function parseReceiptText(text: string): ParsedExpense {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const lower = text.toLowerCase();

  // --- Amount: TOTAL scoring ---
  let bestAmount: number | null = null;
  let bestScore = -1;

  const DEPRIORITIZE = ['subtotal', 'sub total', 'tax', 'tip', 'change', 'cash', 'card', 'visa', 'mastercard', 'debit', 'credit', 'balance due'];
  const PRIORITIZE = ['total', 'amount due', 'grand total', 'balance', 'amt due', 'total due'];

  for (const line of lines) {
    const lineLower = line.toLowerCase();
    const amountMatch = line.match(/\$?\s?([\d,]+\.\d{2})\b/);
    if (!amountMatch) continue;
    const val = parseFloat(amountMatch[1].replace(/,/g, ''));
    if (val <= 0 || val > 100000) continue;

    let score = 0;
    for (const kw of PRIORITIZE) {
      if (lineLower.includes(kw)) { score += 10; break; }
    }
    for (const kw of DEPRIORITIZE) {
      if (lineLower.includes(kw) && !lineLower.includes('total')) { score -= 5; break; }
    }
    score += Math.min(val / 100, 2);

    if (score > bestScore) {
      bestScore = score;
      bestAmount = val;
    }
  }

  let confidence = 0;
  if (bestAmount !== null) confidence += bestScore >= 10 ? 0.5 : 0.25;

  // Category from receipt context
  let category: string | null = null;
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (cat === 'Other') continue;
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        category = cat;
        confidence += 0.2;
        break;
      }
    }
    if (category) break;
  }

  // Date from receipt
  let date: string | null = null;
  const dateMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dateMatch) {
    const [, m, d, y] = dateMatch;
    const year = y.length === 2 ? `20${y}` : y;
    date = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    confidence += 0.1;
  }

  return {
    amount: bestAmount,
    category,
    date,
    notes: null,
    confidence: Math.min(confidence, 1),
  };
}
