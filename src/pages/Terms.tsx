import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import SEOHead from '@/components/SEOHead';

export default function Terms() {
  const navigate = useNavigate();
  const lastUpdated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="min-h-screen bg-background">
      <SEOHead title="Terms of Service | HaulTrackerPro" description="Terms and conditions for using HaulTrackerPro." path="/terms" />
      <header className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-2xl mx-auto">
          <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold font-heading">Terms of Service</h1>
        </div>
      </header>

      <main className="px-4 py-6 max-w-2xl mx-auto space-y-6 text-sm leading-relaxed text-foreground">
        <h2 className="text-2xl font-black font-heading">HaulTrackerPro Terms of Service</h2>

        <section className="space-y-2">
          <h3 className="text-base font-bold">1. Acceptance of Terms</h3>
          <p className="text-muted-foreground">By accessing or using HaulTrackerPro, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the service.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">2. Description of Service</h3>
          <p className="text-muted-foreground">HaulTrackerPro provides load tracking, expense tracking, and financial tracking tools for owner-operators and lease operators in the trucking industry. The service helps users log loads, track pay, manage expenses, and generate reports. HaulTrackerPro also offers an Opportunities marketplace where approved recruiters and carriers can post trucking opportunities and where drivers can browse and request more information.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">3. No Financial, Tax, or Legal Advice</h3>
          <p className="text-muted-foreground">HaulTrackerPro does NOT provide tax, financial, or legal advice. All calculations, reports, and summaries are provided as tracking tools only. You should consult qualified professionals for tax, financial, and legal matters.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">4. Data Accuracy Disclaimer</h3>
          <p className="text-muted-foreground">Users are solely responsible for the accuracy of all data entered into HaulTrackerPro. You should verify all calculations, exports, and reports independently before relying on them for business or tax purposes.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">5. Limitation of Liability</h3>
          <p className="text-muted-foreground">HaulTrackerPro is not liable for any financial loss, missed payments, tax errors, or other damages arising from the use of this service. The service is provided "as is" without warranties of any kind.</p>
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
          <h3 className="text-base font-bold">9. Opportunities Marketplace (Drivers)</h3>
          <p className="text-muted-foreground">The Opportunities section displays trucking opportunities submitted by recruiters and carriers. All pay figures, weekly mileage, deductions, and Profit Intelligence breakdowns are <span className="font-semibold text-foreground">estimates based on recruiter-provided data</span> and are not guaranteed earnings or guaranteed jobs. When you request more information about an opportunity, your contact details (name, email, and phone if provided) are shared with that specific recruiter so they can respond. You may withdraw a request at any time, but a recruiter may have already received your contact information.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">10. Recruiter Accounts &amp; Opportunity Listings</h3>
          <p className="text-muted-foreground">Recruiter accounts are subject to verification before opportunities can be posted. Submitted opportunities go through admin review and may be approved, rejected, flagged, or removed at HaulTrackerPro's sole discretion. Recruiters are solely responsible for the accuracy and legality of opportunity listings, hiring practices, and communications with drivers. Misleading pay claims, fake postings, or harassing behavior may result in suspension of recruiter access. Drivers' applications and contact information are made available only to the recruiter who posted the opportunity the driver requested information on.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">11. Recruiter Billing &amp; Subscriptions</h3>
          <p className="text-muted-foreground">Posting active opportunities requires an active recruiter subscription (Starter, Growth, or Fleet). Subscriptions are billed monthly through Stripe and are subject to active opportunity limits per plan. Cancelling a subscription removes access to post or keep listings active; existing applications remain visible per applicable retention rules. HaulTrackerPro does not refund partial billing periods unless required by law.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">12. Governing Law</h3>
          <p className="text-muted-foreground">These terms shall be governed by and construed in accordance with the laws of the United States, without regard to conflict of law provisions.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">13. Contact Information</h3>
          <p className="text-muted-foreground">For questions about these Terms of Service, please contact us at support@haultrackerpro.com.</p>
        </section>

        <p className="text-xs text-muted-foreground/60 pt-4 border-t border-border">
          Last Updated: {lastUpdated}
        </p>
      </main>
    </div>
  );
}
