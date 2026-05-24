import { ReactNode } from 'react';
import { Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

export default function ComparisonShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen" style={{ background: 'hsl(220, 20%, 8%)' }}>
      <nav className="sticky top-0 z-50 border-b" style={{ background: 'hsl(220, 20%, 8%)', borderColor: 'hsl(220, 16%, 16%)' }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 sm:px-6 h-16">
          <button onClick={() => navigate('/')} className="flex items-center gap-2">
            <Truck className="h-6 w-6" style={{ color: 'hsl(25, 95%, 53%)' }} />
            <span className="text-lg font-black tracking-tight" style={{ color: 'hsl(0, 0%, 100%)' }}>HaulTrackerPro</span>
          </button>
          <div className="flex items-center gap-2 sm:gap-3">
            <Button variant="ghost" onClick={() => navigate('/resources')} className="text-sm hidden sm:inline-flex" style={{ color: 'hsl(220, 10%, 70%)' }}>Resources</Button>
            <Button variant="ghost" onClick={() => navigate('/pricing')} className="text-sm hidden sm:inline-flex" style={{ color: 'hsl(220, 10%, 70%)' }}>Pricing</Button>
            <Button onClick={() => navigate('/auth')} className="text-xs sm:text-sm font-bold rounded-xl px-3 sm:px-5" style={{ background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' }}>
              Start Tracking Free
            </Button>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-16 space-y-12">{children}</main>

      <footer className="border-t py-8" style={{ borderColor: 'hsl(220, 16%, 14%)', background: 'hsl(220, 20%, 6%)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-xs" style={{ color: 'hsl(220, 10%, 40%)' }}>© {new Date().getFullYear()} HaulTrackerPro. All rights reserved.</span>
          <div className="flex items-center gap-5 flex-wrap justify-center">
            {[
              { label: 'About', href: '/about' },
              { label: 'Resources', href: '/resources' },
              { label: 'Features', href: '/features' },
              { label: 'Pricing', href: '/pricing' },
              { label: 'Terms', href: '/terms' },
              { label: 'Privacy', href: '/privacy' },
            ].map((link) => (
              <a key={link.href} href={link.href} className="text-xs font-medium hover:underline" style={{ color: 'hsl(220, 10%, 50%)' }}>
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}

export function CompareTable({ headers, rows }: { headers: [string, string, string]; rows: Array<[string, string, string]> }) {
  return (
    <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'hsl(220, 16%, 16%)' }}>
      <table className="w-full text-sm" style={{ background: 'hsl(220, 20%, 10%)' }}>
        <thead>
          <tr style={{ background: 'hsl(220, 20%, 12%)' }}>
            {headers.map((h, i) => (
              <th key={i} className="text-left px-4 py-3 font-bold" style={{ color: 'hsl(0, 0%, 100%)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t" style={{ borderColor: 'hsl(220, 16%, 16%)' }}>
              <td className="px-4 py-3 font-medium" style={{ color: 'hsl(0, 0%, 100%)' }}>{r[0]}</td>
              <td className="px-4 py-3" style={{ color: 'hsl(220, 10%, 65%)' }}>{r[1]}</td>
              <td className="px-4 py-3" style={{ color: 'hsl(220, 10%, 65%)' }}>{r[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FAQList({ items }: { items: Array<{ q: string; a: string }> }) {
  return (
    <div className="space-y-3">
      {items.map((f, i) => (
        <details key={i} className="rounded-xl border p-4 group" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
          <summary className="cursor-pointer font-bold text-sm" style={{ color: 'hsl(0, 0%, 100%)' }}>{f.q}</summary>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: 'hsl(220, 10%, 65%)' }}>{f.a}</p>
        </details>
      ))}
    </div>
  );
}

export function Disclaimer() {
  return (
    <section className="rounded-2xl border p-6" style={{ background: 'hsl(220, 20%, 10%)', borderColor: 'hsl(220, 16%, 16%)' }}>
      <h2 className="text-lg font-black mb-2" style={{ color: 'hsl(0, 0%, 100%)' }}>Trust &amp; disclaimers</h2>
      <ul className="space-y-1.5 text-sm leading-relaxed" style={{ color: 'hsl(220, 10%, 65%)' }}>
        <li>• Haul Tracker Pro is not tax, legal, accounting, or financial advice.</li>
        <li>• Drivers should confirm tax, legal, and financial questions with qualified professionals.</li>
        <li>• Designed for organization, visibility, and decision support — not to guarantee earnings, savings, deductions, or legal outcomes.</li>
      </ul>
    </section>
  );
}

export function buildFAQSchema(items: Array<{ q: string; a: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}
