// IRS Schedule C (Form 1040) line mapping for trucking expenses
// Reference: https://www.irs.gov/forms-pubs/about-schedule-c-form-1040

export interface ScheduleCLine {
  line: string;
  description: string;
}

// Map each expense category to its Schedule C line
export const SCHEDULE_C_MAP: Record<string, ScheduleCLine> = {
  'Fuel': { line: '9', description: 'Car and truck expenses' },
  'Tolls': { line: '9', description: 'Car and truck expenses' },
  'Parking': { line: '9', description: 'Car and truck expenses' },
  'Maintenance': { line: '21', description: 'Repairs and maintenance' },
  'Repairs': { line: '21', description: 'Repairs and maintenance' },
  'Tires': { line: '21', description: 'Repairs and maintenance' },
  'Insurance': { line: '15', description: 'Insurance (other than health)' },
  'Permits': { line: '22', description: 'Taxes and licenses' },
  'Licensing': { line: '22', description: 'Taxes and licenses' },
  'Truck Payment': { line: '13', description: 'Depreciation / Section 179' },
  'Lease Payment': { line: '20a', description: 'Rent or lease (vehicles, machinery, equipment)' },
  'Phone': { line: '25', description: 'Utilities' },
  'ELD/Software': { line: '18', description: 'Office expense' },
  'Scale/Weigh': { line: '27a', description: 'Other expenses' },
  'Lumper': { line: '27a', description: 'Other expenses' },
  'Meals': { line: '24b', description: 'Travel, meals (50% deductible for truckers / per diem)' },
  'Lodging': { line: '24a', description: 'Travel' },
  'Supplies': { line: '22', description: 'Supplies' },
  'Other': { line: '27a', description: 'Other expenses' },
};

// Get Schedule C info for a category (falls back to "Other" / Line 27a)
export function getScheduleCLine(category: string): ScheduleCLine {
  return SCHEDULE_C_MAP[category] ?? { line: '27a', description: 'Other expenses' };
}

// Group expenses by Schedule C line for summary
export function groupByScheduleC(expenses: { category: string; amount: number }[]): {
  line: string;
  description: string;
  categories: string[];
  total: number;
}[] {
  const groups: Record<string, { description: string; categories: Set<string>; total: number }> = {};

  for (const exp of expenses) {
    const sc = getScheduleCLine(exp.category);
    if (!groups[sc.line]) {
      groups[sc.line] = { description: sc.description, categories: new Set(), total: 0 };
    }
    groups[sc.line].categories.add(exp.category);
    groups[sc.line].total += exp.amount;
  }

  return Object.entries(groups)
    .map(([line, data]) => ({
      line,
      description: data.description,
      categories: [...data.categories],
      total: data.total,
    }))
    .sort((a, b) => {
      const numA = parseFloat(a.line);
      const numB = parseFloat(b.line);
      return numA - numB;
    });
}

// All available categories (expanded for better Schedule C coverage)
export const EXPANDED_EXPENSE_CATEGORIES = [
  'Fuel',
  'Maintenance',
  'Repairs',
  'Tires',
  'Insurance',
  'Tolls',
  'Parking',
  'Permits',
  'Licensing',
  'Truck Payment',
  'Lease Payment',
  'Phone',
  'ELD/Software',
  'Scale/Weigh',
  'Lumper',
  'Meals',
  'Lodging',
  'Supplies',
  'Other',
] as const;
