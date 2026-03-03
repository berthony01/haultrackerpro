import { EXPENSE_CATEGORIES } from '@/hooks/useExpenses';
import { format, subDays } from 'date-fns';

export interface ParsedExpense {
  amount: number | null;
  category: string | null;
  date: string | null;
  notes: string | null;
  confidence: number;
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Fuel: ['fuel', 'gas', 'diesel', 'petrol', 'pump', 'gallons', 'shell', 'bp', 'chevron', 'exxon', 'mobil', 'pilot', 'loves', 'flying j', 'ta ', 'truck stop'],
  Maintenance: ['maintenance', 'oil change', 'tire', 'tyre', 'brake', 'filter', 'lube', 'service', 'tune up', 'alignment'],
  Repairs: ['repair', 'fix', 'replace', 'broken', 'mechanic', 'body shop', 'tow'],
  Insurance: ['insurance', 'premium', 'coverage', 'policy', 'liability'],
  Tolls: ['toll', 'turnpike', 'bridge', 'ez pass', 'ezpass', 'sunpass', 'ipass'],
  Permits: ['permit', 'license', 'registration', 'dot', 'ifta', 'irp', 'ucr'],
  Other: [],
};

export function parseExpenseText(text: string): ParsedExpense {
  const lower = text.toLowerCase();
  let confidence = 0;

  // --- Amount ---
  let amount: number | null = null;
  // Try $123.45 pattern
  const dollarMatch = text.match(/\$\s?([\d,]+\.?\d{0,2})/);
  if (dollarMatch) {
    amount = parseFloat(dollarMatch[1].replace(/,/g, ''));
    confidence += 0.4;
  } else {
    // Try "123 dollars" or just a standalone number
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

  // --- Date ---
  let date: string | null = null;
  if (/\btoday\b/i.test(text)) {
    date = format(new Date(), 'yyyy-MM-dd');
    confidence += 0.2;
  } else if (/\byesterday\b/i.test(text)) {
    date = format(subDays(new Date(), 1), 'yyyy-MM-dd');
    confidence += 0.2;
  } else {
    // Try MM/DD/YYYY or MM-DD-YYYY
    const dateMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (dateMatch) {
      const [, m, d, y] = dateMatch;
      const year = y.length === 2 ? `20${y}` : y;
      date = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      confidence += 0.15;
    }
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
    // Boost for priority keywords
    for (const kw of PRIORITIZE) {
      if (lineLower.includes(kw)) { score += 10; break; }
    }
    // Penalize deprioritized lines
    for (const kw of DEPRIORITIZE) {
      if (lineLower.includes(kw) && !lineLower.includes('total')) { score -= 5; break; }
    }
    // Larger amounts are slightly preferred (likely total not item)
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
