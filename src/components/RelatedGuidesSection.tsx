import { Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';

const guides = [
  { path: '/truck-driver-tax-deductions', title: 'Truck Driver Tax Deductions' },
  { path: '/truck-driver-per-diem', title: 'Truck Driver Per Diem' },
  { path: '/owner-operator-expense-tracker', title: 'Owner Operator Expense Tracker' },
  { path: '/trucking-cost-per-mile', title: 'Trucking Cost Per Mile' },
  { path: '/trucking-profit-calculator', title: 'Trucking Profit Calculator' },
  { path: '/trucker-bookkeeping-guide', title: 'Trucker Bookkeeping Guide' },
  { path: '/owner-operator-salary', title: 'Owner Operator Salary' },
  { path: '/truck-driver-expenses', title: 'Truck Driver Expenses' },
  { path: '/trucking-expenses-list', title: 'Trucking Expenses List' },
  { path: '/owner-operator-expenses-list', title: 'Owner Operator Expenses List' },
];

interface Props {
  currentPath: string;
}

export default function RelatedGuidesSection({ currentPath }: Props) {
  const filtered = guides.filter((g) => g.path !== currentPath);

  return (
    <section className="pt-4 pb-2">
      <div className="flex items-center gap-2 mb-4">
        <BookOpen className="h-6 w-6 text-primary" />
        <h2 className="text-2xl font-black font-heading">Related Trucking Finance Guides</h2>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {filtered.map((g) => (
          <Link
            key={g.path}
            to={g.path}
            className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card shadow-card hover:border-primary/40 transition-colors"
          >
            <span className="text-sm font-semibold text-primary">{g.title}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
