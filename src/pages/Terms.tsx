import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

export default function Terms() {
  const navigate = useNavigate();
  const lastUpdated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-2xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Terms of Service</h1>
        </div>
      </header>

      <main className="px-4 py-6 max-w-2xl mx-auto space-y-6 text-sm leading-relaxed text-foreground">
        <h2 className="text-2xl font-black font-heading">HaulTracker Terms of Service</h2>

        <section className="space-y-2">
          <h3 className="text-base font-bold">1. Acceptance of Terms</h3>
          <p className="text-muted-foreground">By accessing or using HaulTracker, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the service.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">2. Description of Service</h3>
          <p className="text-muted-foreground">HaulTracker provides load tracking, expense tracking, and financial tracking tools for owner-operators and lease operators in the trucking industry. The service helps users log loads, track pay, manage expenses, and generate reports.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">3. No Financial, Tax, or Legal Advice</h3>
          <p className="text-muted-foreground">HaulTracker does NOT provide tax, financial, or legal advice. All calculations, reports, and summaries are provided as tracking tools only. You should consult qualified professionals for tax, financial, and legal matters.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">4. Data Accuracy Disclaimer</h3>
          <p className="text-muted-foreground">Users are solely responsible for the accuracy of all data entered into HaulTracker. You should verify all calculations, exports, and reports independently before relying on them for business or tax purposes.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">5. Limitation of Liability</h3>
          <p className="text-muted-foreground">HaulTracker is not liable for any financial loss, missed payments, tax errors, or other damages arising from the use of this service. The service is provided "as is" without warranties of any kind.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">6. User Responsibilities</h3>
          <p className="text-muted-foreground">You are responsible for maintaining the accuracy of your data, keeping your account credentials secure, and ensuring that your use of the service complies with all applicable laws and regulations.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">7. Account Termination</h3>
          <p className="text-muted-foreground">You may delete your account at any time through the Settings page. We reserve the right to suspend or terminate accounts that violate these terms or engage in fraudulent activity.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">8. Modifications to Service</h3>
          <p className="text-muted-foreground">We reserve the right to modify, suspend, or discontinue any part of the service at any time. We will make reasonable efforts to notify users of significant changes.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">9. Governing Law</h3>
          <p className="text-muted-foreground">These terms shall be governed by and construed in accordance with the laws of the United States, without regard to conflict of law provisions.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">10. Contact Information</h3>
          <p className="text-muted-foreground">For questions about these Terms of Service, please contact us at support@haultracker.app.</p>
        </section>

        <p className="text-xs text-muted-foreground/60 pt-4 border-t border-border">
          Last Updated: {lastUpdated}
        </p>
      </main>
    </div>
  );
}
