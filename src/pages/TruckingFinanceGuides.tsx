import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpen, Receipt, TrendingUp, DollarSign, Truck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';
import { FinalCTASection } from '@/components/SEOConversionSections';

const categories = [
  {
    title: 'Tax & Deductions',
    icon: Receipt,
    guides: [
      { path: '/truck-driver-tax-deductions', title: 'Truck Driver Tax Deductions' },
      { path: '/truck-driver-per-diem', title: 'Truck Driver Per Diem' },
      { path: '/truck-driver-expenses', title: 'Truck Driver Expenses' },
    ],
  },
  {
    title: 'Profit & Salary',
    icon: TrendingUp,
    guides: [
      { path: '/owner-operator-salary', title: 'Owner Operator Salary' },
      { path: '/trucking-profit-calculator', title: 'Trucking Profit Calculator' },
    ],
  },
  {
    title: 'Expense Management',
    icon: DollarSign,
    guides: [
      { path: '/owner-operator-expense-tracker', title: 'Owner Operator Expense Tracker' },
      { path: '/trucking-expenses-list', title: 'Trucking Expenses List' },
      { path: '/owner-operator-expenses-list', title: 'Owner Operator Expenses List' },
    ],
  },
  {
    title: 'Operations & Cost',
    icon: Truck,
    guides: [
      { path: '/trucking-cost-per-mile', title: 'Trucking Cost Per Mile' },
      { path: '/trucker-bookkeeping-guide', title: 'Trucker Bookkeeping Guide' },
    ],
  },
];

export default function TruckingFinanceGuides() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Trucking Finance Guides | HaulTrackerPro Knowledge Hub"
        description="Browse free trucking finance guides covering tax deductions, expenses, profit calculators, cost per mile, bookkeeping, and more for owner operators."
        path="/trucking-finance-guides"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          headline: 'Trucking Finance Guides | HaulTrackerPro Knowledge Hub',
          description: 'Browse free trucking finance guides covering tax deductions, expenses, profit calculators, cost per mile, bookkeeping, and more for owner operators.',
          author: { '@type': 'Organization', name: 'HaulTrackerPro' },
        }}
      />

      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Trucking Finance Guides</h1>
        </div>
      </header>

      <main className="px-4 py-8 max-w-3xl mx-auto space-y-12">
        {/* Hero */}
        <section className="text-center space-y-4 py-4">
          <div className="flex justify-center">
            <BookOpen className="h-10 w-10 text-primary" />
          </div>
          <h2 className="text-3xl font-black font-heading">Trucking Finance Knowledge Hub</h2>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Free guides covering everything owner operators and truck drivers need to know about expenses, taxes, profit, and running a trucking business.
          </p>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Start Tracking Free <ArrowRight className="h-4 w-4" />
          </Button>
        </section>

        {/* Category Sections */}
        {categories.map((cat) => {
          const Icon = cat.icon;
          return (
            <section key={cat.title}>
              <div className="flex items-center gap-2 mb-4">
                <Icon className="h-6 w-6 text-primary" />
                <h2 className="text-2xl font-black font-heading">{cat.title}</h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {cat.guides.map((g) => (
                  <Link
                    key={g.path}
                    to={g.path}
                    className="flex items-center justify-between gap-3 p-4 rounded-xl border border-border bg-card shadow-card hover:border-primary/40 transition-colors group"
                  >
                    <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                      {g.title}
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                  </Link>
                ))}
              </div>
            </section>
          );
        })}

        {/* Mid-page CTA */}
        <section className="rounded-xl border border-primary/20 bg-primary/5 p-6 text-center space-y-3">
          <h2 className="text-xl font-black font-heading">Track Your Trucking Finances Automatically</h2>
          <p className="text-sm text-muted-foreground max-w-lg mx-auto leading-relaxed">
            HaulTrackerPro helps truck drivers track loads, expenses, and profit in one simple dashboard.
          </p>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Start Free <ArrowRight className="h-4 w-4" />
          </Button>
        </section>

        <FinalCTASection />
      </main>
    </div>
  );
}
