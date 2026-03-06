import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpen, Receipt, TrendingUp, DollarSign, Truck, Sparkles, Gauge, MapPin, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEOHead from '@/components/SEOHead';

const sections = [
  {
    title: 'Tax & Deductions',
    icon: Receipt,
    guides: [
      { path: '/truck-driver-tax-deductions', title: 'Truck Driver Tax Deductions' },
      { path: '/truck-driver-per-diem', title: 'Truck Driver Per Diem' },
      { path: '/owner-operator-tax-write-offs', title: 'Owner Operator Tax Write-Offs' },
    ],
  },
  {
    title: 'Expenses & Bookkeeping',
    icon: DollarSign,
    guides: [
      { path: '/truck-driver-expenses', title: 'Truck Driver Expenses' },
      { path: '/trucking-expense-categories', title: 'Trucking Expense Categories' },
      { path: '/owner-operator-expenses-list', title: 'Owner Operator Expenses List' },
      { path: '/truck-driver-operating-expenses', title: 'Truck Driver Operating Expenses' },
    ],
  },
  {
    title: 'Cost Per Mile',
    icon: Gauge,
    guides: [
      { path: '/trucking-cost-per-mile', title: 'Trucking Cost Per Mile' },
      { path: '/trucker-cost-per-mile-breakdown', title: 'Trucker Cost Per Mile Breakdown' },
      { path: '/fuel-cost-per-mile-trucking', title: 'Fuel Cost Per Mile Trucking' },
      { path: '/trucking-maintenance-cost-per-mile', title: 'Trucking Maintenance Cost Per Mile' },
    ],
  },
  {
    title: 'Profit & Income',
    icon: TrendingUp,
    guides: [
      { path: '/owner-operator-salary', title: 'Owner Operator Salary' },
      { path: '/trucking-profit-calculator', title: 'Trucking Profit Calculator' },
    ],
  },
  {
    title: 'Operations',
    icon: MapPin,
    guides: [
      { path: '/trucking-mileage-expense-guide', title: 'Trucking Mileage Expense Guide' },
      { path: '/owner-operator-operating-costs', title: 'Owner Operator Operating Costs' },
    ],
  },
];

export default function TruckingFinanceGuides() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Trucking Finance Guides for Owner Operators"
        description="Learn trucking expenses, cost per mile, tax deductions, and owner operator finances. Practical guides to help truck drivers understand real profit."
        path="/trucking-finance-guides"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          headline: 'Trucking Finance Guides for Owner Operators',
          description: 'Learn trucking expenses, cost per mile, tax deductions, and owner operator finances. Practical guides to help truck drivers understand real profit.',
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
          <h2 className="text-3xl font-black font-heading">Trucking Finance Guides</h2>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Practical guides to help owner-operators and truck drivers understand expenses, taxes, and real profit.
          </p>
        </section>

        {/* Introduction */}
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <p className="text-muted-foreground leading-relaxed">
            Trucking is a business — and running it profitably means understanding where your money goes. From fuel and maintenance to tax deductions and per diem, every dollar matters. These guides break down the financial side of trucking so owner-operators, lease operators, and company drivers can track expenses accurately, calculate real profit per load, and keep more of what they earn.
          </p>
        </section>

        {/* Category Sections */}
        {sections.map((cat) => {
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
                    className="flex items-center justify-between gap-3 p-4 rounded-xl border border-border bg-card shadow-sm hover:border-primary/40 transition-colors group"
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

        {/* CTA */}
        <section className="text-center py-8 space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-6">
          <Truck className="h-10 w-10 text-primary mx-auto" />
          <h2 className="text-xl font-black font-heading">Stop Guessing Your Trucking Profit</h2>
          <p className="text-sm text-muted-foreground max-w-lg mx-auto leading-relaxed">
            Track every load, expense, and mile in one dashboard. HaulTrackerPro gives you real numbers so you can run your trucking business with confidence.
          </p>
          <div className="flex flex-wrap justify-center gap-4 text-xs text-muted-foreground pt-2">
            {['No credit card required', 'Free plan available', 'Mobile-first', 'Set up in minutes'].map((t) => (
              <span key={t} className="flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                {t}
              </span>
            ))}
          </div>
          <Button size="lg" className="rounded-xl gap-2" onClick={() => navigate('/pricing')}>
            Start Free <Sparkles className="h-4 w-4" />
          </Button>
        </section>
      </main>
    </div>
  );
}
