import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import SEOHead from '@/components/SEOHead';

export default function Privacy() {
  const navigate = useNavigate();
  const lastUpdated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="min-h-screen bg-background">
      <SEOHead title="Privacy Policy | HaulTrackerPro" description="Privacy policy explaining how HaulTrackerPro protects user data." path="/privacy" />
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
            <li>Email address and optional first name submitted via free resource downloads (e.g., the Free Trucker Starter Kit) — used only to deliver the requested resource and occasional related updates. You can unsubscribe at any time.</li>
            <li>Load data (pickup/dropoff locations, miles, rates, fees)</li>
            <li>Expense data (categories, amounts, dates)</li>
            <li>Driver Opportunity Profile (preferences, experience, trailer types) — only used for matching opportunities and only visible to recruiters after you request information on their listing</li>
            <li>Recruiter / company profile data (company name, contact info, verification documents) for users with recruiter access</li>
            <li>Billing data — handled and stored by Stripe; we store only customer and subscription identifiers, never card numbers</li>
            <li>Usage data (app interactions for product improvement)</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">2. How We Use Information</h3>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>Provide and maintain the HaulTrackerPro service</li>
            <li>Generate reports and summaries for your use</li>
            <li>Match drivers to opportunities and calculate Profit Intelligence estimates</li>
            <li>Process recruiter subscriptions through Stripe</li>
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
          <p className="text-muted-foreground">We do NOT sell your data. We do not share your personal information with third parties except infrastructure providers necessary to operate the service (cloud hosting, database services, and Stripe for recruiter billing). Emails collected through free resource downloads (lead magnets) follow these same rules — they are never sold or shared.</p>
          <p className="text-muted-foreground">When a driver requests more information on an opportunity, the driver's name, email, and phone number (if provided) are shared with the recruiter that posted that specific opportunity so they can respond. This contact snapshot is taken at the moment of the request and is visible only to that recruiter and HaulTrackerPro administrators for moderation purposes.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">5. Recruiter Data &amp; Moderation</h3>
          <p className="text-muted-foreground">Recruiter profiles and submitted opportunities are reviewed by HaulTrackerPro administrators. Admins may view, approve, reject, flag, remove, or suspend recruiter listings and accounts to maintain quality and protect drivers from misleading postings. Recruiters can view applications received on their own opportunities only — they cannot view applications submitted to other recruiters.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">6. Data Retention</h3>
          <p className="text-muted-foreground">We retain your data for as long as your account is active. When you delete your account, all associated data is permanently removed from our systems, subject to limited retention required for legal, tax, or fraud-prevention purposes (e.g., Stripe billing records).</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">7. User Rights</h3>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>Right to access and export all your data at any time</li>
            <li>Right to delete your account and all associated data</li>
            <li>Right to correct inaccurate information</li>
            <li>Right to withdraw an opportunity request at any time (note: contact information already shared with the recruiter cannot be retroactively recalled)</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">8. Contact Information</h3>
          <p className="text-muted-foreground">For questions about this Privacy Policy or your data, please contact us at support@haultrackerpro.app.</p>
        </section>

        <p className="text-xs text-muted-foreground/60 pt-4 border-t border-border">
          Last Updated: {lastUpdated}
        </p>
      </main>
    </div>
  );
}
