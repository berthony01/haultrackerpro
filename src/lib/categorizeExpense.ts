/**
 * AI Expense Categorization
 * Auto-detects expense category from text input using keyword matching.
 * No LLM required — fast, free, and runs client-side.
 */

const categoryPatterns: { category: string; keywords: string[] }[] = [
  {
    category: 'Fuel',
    keywords: [
      'fuel', 'diesel', 'gas', 'def', 'pilot', "love's", 'loves', 'ta ', 'petro',
      'flying j', 'flyingj', 'casey', 'sheetz', 'wawa', 'speedway', 'shell',
      'chevron', 'bp ', 'exxon', 'mobil', 'sunoco', 'valero', 'citgo',
      'marathon', 'phillips', 'pump', 'gallons', 'gal ', 'fill up', 'fillup',
      'truck stop', 'truckstop', 'fuel stop', 'ambest', 'sapp bros',
    ],
  },
  {
    category: 'Tolls',
    keywords: [
      'toll', 'ezpass', 'ez-pass', 'e-zpass', 'sunpass', 'i-pass', 'ipass',
      'pike', 'turnpike', 'thruway', 'bridge', 'tunnel', 'fastrak',
      'peach pass', 'txtag', 'tollway', 'expressway toll',
    ],
  },
  {
    category: 'Maintenance',
    keywords: [
      'oil change', 'tire', 'tires', 'brake', 'brakes', 'filter', 'alignment',
      'tune up', 'tuneup', 'service', 'inspection', 'dot inspection',
      'pm service', 'preventive', 'preventative', 'grease', 'lube',
      'transmission', 'coolant', 'antifreeze', 'belt', 'hose',
      'wiper', 'light', 'bulb', 'battery', 'alternator', 'starter',
      'wheel seal', 'bearing', 'air dryer', 'glad hand',
    ],
  },
  {
    category: 'Repairs',
    keywords: [
      'repair', 'fix', 'broke', 'broken', 'replace', 'tow', 'towing',
      'roadside', 'breakdown', 'mechanic', 'shop', 'body work', 'bodywork',
      'welding', 'weld', 'dent', 'accident', 'collision', 'windshield',
      'crack', 'blow out', 'blowout', 'flat tire', 'flat ',
    ],
  },
  {
    category: 'Insurance',
    keywords: [
      'insurance', 'premium', 'policy', 'coverage', 'liability',
      'cargo insurance', 'physical damage', 'bobtail', 'non-trucking',
      'occupational accident', 'workers comp',
    ],
  },
  {
    category: 'Permits',
    keywords: [
      'permit', 'license', 'registration', 'tag', 'plate', 'ifta',
      'irp', 'ucr', 'oversize', 'overweight', 'hazmat', 'twic',
      'medical card', 'dot physical', 'cdl', 'renewal', 'sticker',
      '2290', 'hvut',
    ],
  },
];

export function categorizeExpense(text: string): string | null {
  if (!text || text.length < 2) return null;
  const lower = text.toLowerCase();

  let bestMatch: { category: string; score: number } | null = null;

  for (const pattern of categoryPatterns) {
    let score = 0;
    for (const keyword of pattern.keywords) {
      if (lower.includes(keyword)) {
        score += keyword.length;
      }
    }
    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { category: pattern.category, score };
    }
  }

  return bestMatch?.category ?? null;
}
