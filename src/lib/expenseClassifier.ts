// Auto-classify expense categories as fixed or variable
// Fixed: recurring monthly costs that don't change per load
// Variable: costs that change with each trip or load

const FIXED_CATEGORIES = new Set([
  'Insurance',
  'Permits',
  'Licensing',
  'Truck Payment',
  'Lease Payment',
  'Phone',
  'ELD/Software',
]);

export function classifyCategory(category: string): 'fixed' | 'variable' {
  return FIXED_CATEGORIES.has(category) ? 'fixed' : 'variable';
}

export function isFixedCategory(category: string): boolean {
  return FIXED_CATEGORIES.has(category);
}
