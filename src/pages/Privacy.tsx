import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

export default function Privacy() {
  const navigate = useNavigate();
  const lastUpdated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-2xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Privacy Policy</h1>
        </div>
      </header>

      <main className="px-4 py-6 max-w-2xl mx-auto space-y-6 text-sm leading-relaxed text-foreground">
        <h2 className="text-2xl font-black font-heading">HaulTrackerPro Privacy Policy</h2>

        <section className="space-y-2">
          <h3 className="text-base font-bold">1. Information We Collect</h3>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>Email address (for account creation and authentication)</li>
            <li>Load data (pickup/dropoff locations, miles, rates, fees)</li>
            <li>Expense data (categories, amounts, dates)</li>
            <li>Usage data (app interactions for product improvement)</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">2. How We Use Information</h3>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>Provide and maintain the HaulTrackerPro service</li>
            <li>Generate reports and summaries for your use</li>
            <li>Improve product features and user experience</li>
            <li>Internal analytics to understand usage patterns</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">3. Data Storage</h3>
          <p className="text-muted-foreground">Your data is stored securely using industry-standard cloud infrastructure. All data is encrypted in transit using TLS/SSL protocols.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">4. Data Sharing</h3>
          <p className="text-muted-foreground">We do NOT sell your data. We do not share your personal information with third parties except infrastructure providers necessary to operate the service (cloud hosting, database services).</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">5. Data Retention</h3>
          <p className="text-muted-foreground">We retain your data for as long as your account is active. When you delete your account, all associated data is permanently removed from our systems.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">6. User Rights</h3>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>Right to access and export all your data at any time</li>
            <li>Right to delete your account and all associated data</li>
            <li>Right to correct inaccurate information</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">7. Contact Information</h3>
          <p className="text-muted-foreground">For questions about this Privacy Policy or your data, please contact us at support@haultrackerpro.app.</p>
        </section>

        <p className="text-xs text-muted-foreground/60 pt-4 border-t border-border">
          Last Updated: {lastUpdated}
        </p>
      </main>
    </div>
  );
}
