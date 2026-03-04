import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

const faqs = [
  {
    question: 'How is net profit calculated?',
    answer: 'Net profit is calculated by taking your actual pay received (or estimated pay if actual isn\'t entered yet) and subtracting all expenses logged for the same period. This includes fuel, tolls, maintenance, and any other tracked expenses.',
  },
  {
    question: 'Why is estimated pay different from actual?',
    answer: 'Estimated pay is calculated from your rate per mile × loaded miles + fees (detention, wait, other). Actual pay is what the broker or carrier deposits into your account. Differences can occur due to deductions, adjustments, fuel surcharges, or billing corrections.',
  },
  {
    question: 'How do I export reports?',
    answer: 'Go to Reports from the bottom navigation. You can export your data as CSV, PDF summary, or a full profit report. You can also export all your data as JSON from Settings → Export All My Data.',
  },
  {
    question: 'Can I edit past loads?',
    answer: 'Yes! Go to My Loads, tap on any load to see its details, then use the edit button to modify any field. You can update pay received, miles, locations, and all other details at any time.',
  },
  {
    question: 'How do I delete my account?',
    answer: 'Go to Settings → scroll to the Account section → tap "Delete Account." You\'ll need to type DELETE to confirm. This permanently removes all your data including loads, expenses, snapshots, and reports.',
  },
  {
    question: 'What is the Weekly Closeout?',
    answer: 'The Weekly Closeout lets you finalize your week\'s data. It creates a snapshot of your earnings, miles, and deadhead percentage so you can track performance week over week.',
  },
  {
    question: 'How does multi-stop tracking work?',
    answer: 'When logging a load, toggle "Multi-stop load?" to add intermediate stops between pickup and drop-off. Each stop can have a type (Pickup, Stop, Drop) and optional detention minutes. Loaded miles and deadhead miles remain totals for the whole load.',
  },
  {
    question: 'What\'s included in the 14-day free trial?',
    answer: 'The free trial gives you full access to every Pro feature: Weekly Closeouts, Driver Scorecard, unlimited paste parsing, advanced exports (PDF & profit reports), Smart Alerts 2.0, and tax planning tools. No restrictions — try everything before you commit.',
  },
  {
    question: 'How do I upgrade to Pro?',
    answer: 'Go to Settings → tap "Upgrade to Pro" or visit the Pricing page. You can choose monthly ($15/mo) or annual ($120/yr — save $60). Both start with a 14-day free trial. Payment is handled securely through Stripe.',
  },
  {
    question: 'Can I cancel my Pro subscription?',
    answer: 'Yes, anytime. Go to Settings → Billing → Manage Billing to open your billing portal. Cancel there and you\'ll keep Pro access until the end of your current billing period. You can always re-subscribe later.',
  },
];

export default function FAQ() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-2xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Frequently Asked Questions</h1>
        </div>
      </header>

      <main className="px-4 py-6 max-w-2xl mx-auto">
        <h2 className="text-2xl font-black font-heading mb-6">FAQ</h2>
        <Accordion type="single" collapsible className="space-y-2">
          {faqs.map((faq, i) => (
            <AccordionItem key={i} value={`faq-${i}`} className="border rounded-xl px-4 bg-card shadow-card">
              <AccordionTrigger className="text-sm font-semibold text-left hover:no-underline">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground leading-relaxed">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </main>
    </div>
  );
}
