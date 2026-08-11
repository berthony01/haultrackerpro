import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link, useNavigate } from 'react-router-dom';
import SEOHead from '@/components/SEOHead';
import { findPolicyBySlug, POLICY_METADATA_PENDING_LABEL } from '@/lib/legal/policyRegistry';


export default function Privacy() {
  const navigate = useNavigate();
  const policy = findPolicyBySlug('privacy');
  const hasFixedMetadata = !!(policy && policy.version && policy.effectiveDate);



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

        <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-xs text-foreground/90">
          <span className="font-semibold text-primary">Coverage note:</span> This policy now describes data collected from recruiter and carrier accounts, what drivers see, and how Stripe handles billing data.
        </div>

        <section className="space-y-2">
          <h3 className="text-base font-bold">1. Information We Collect</h3>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>Email address (for account creation and authentication)</li>
            <li>Email address and optional first name submitted via free resource downloads (e.g., the Free Trucker Starter Kit) — used only to deliver the requested resource and occasional related updates. You can unsubscribe at any time.</li>
            <li>Load data (pickup/dropoff locations, miles, rates, fees)</li>
            <li>Expense data (categories, amounts, dates)</li>
            <li>Opportunity Preferences (preferences, experience, trailer types) — only used for matching opportunities and only visible to recruiters after you request information on their listing</li>
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
          <p className="text-muted-foreground">When a driver applies to an opportunity, the driver's application and submitted profile details are shared with the recruiter that posted that specific opportunity. The driver's private phone number and email address are disclosed to that recruiter only after the driver approves a separate contact request. This information is visible only to that recruiter and to HaulTrackerPro administrators for moderation purposes.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">5. Recruiter Data &amp; Moderation</h3>
          <p className="text-muted-foreground">Recruiter profiles and submitted opportunities are reviewed by HaulTrackerPro administrators. Admins may view, approve, reject, flag, remove, or suspend recruiter listings and accounts to maintain quality and protect drivers from misleading postings. Recruiters can view applications received on their own opportunities only — they cannot view applications submitted to other recruiters.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">6. Data Retention</h3>
          <p className="text-muted-foreground">We retain your data for as long as your account is active. When you permanently delete your account, direct personal operational records are targeted for transactional cleanup. Some shared, audit, billing or payment, application, contract or signature, security, fraud-prevention, dispute, legal or compliance, backup, or third-party-held records may be retained, detached, anonymized, or remain where operationally or lawfully necessary.</p>
          <p className="text-muted-foreground"><Link to="/docs/account-deletion-data-retention" className="font-semibold text-primary underline">Review account deletion and data retention details.</Link></p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">7. User Rights</h3>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>Right to access and export all your data at any time</li>
            <li>Right to request permanent deletion of your account, subject to the retention behavior described in Section 6</li>
            <li>Right to correct inaccurate information</li>
            <li>Right to withdraw an opportunity request at any time (note: contact information already shared with the recruiter cannot be retroactively recalled)</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">8. Contract Protection — Data We Collect &amp; Process</h3>
          <p className="text-muted-foreground">When recruiters and drivers use the in-app Contract Protection workflow, HaulTrackerPro may collect and process the following additional categories of data:</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>Contract files uploaded by recruiters (PDF or image)</li>
            <li>Text extracted from those contract files</li>
            <li>AI parsing output (structured fields and clauses identified by AI)</li>
            <li>AI risk-review output (summaries, risk scores, risk flags, plain-English explanations)</li>
            <li>Driver decisions on a contract version (approve, reject, request changes) and any notes the driver provides</li>
            <li>Signature records, including typed name, consent confirmation, timestamp, IP address, browser/user-agent and device metadata, and the contract version ID</li>
            <li>Audit logs and moderation records related to contract uploads, status changes, AI runs, decisions, and signatures</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">9. Contract Storage &amp; Access</h3>
          <p className="text-muted-foreground">Uploaded contract files are intended to be private and are not publicly listed. Access is limited to the assigned driver, the uploading recruiter, and HaulTrackerPro administrators or moderators where access is needed for support, moderation, security, abuse prevention, troubleshooting, or dispute review. Where private storage and short-lived access links are used, those mechanisms are designed to prevent unauthenticated public access to contract files.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">10. AI Processing of Contracts</h3>
          <p className="text-muted-foreground">To generate contract summaries, risk flags, and plain-English explanations, contract text or extracted content may be sent to third-party AI providers or AI processing services through HaulTrackerPro's AI processing layer. Those providers process the content in order to return the requested output. AI contract analysis is informational only, is not legal advice, and may be incomplete or inaccurate. Drivers should always read the full contract themselves and consider consulting a qualified attorney before signing.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">11. Admin &amp; Moderator Access to Contract Records</h3>
          <p className="text-muted-foreground">HaulTrackerPro administrators and moderators may access contract files, extracted text, AI output, driver decisions, signature records, and audit logs only for moderation, support, security, abuse prevention, troubleshooting, or dispute review. Admin access is logged and is not used to share contract content publicly or with unrelated third parties.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">12. Contract Data Retention</h3>
          <p className="text-muted-foreground">Contract records, signature records, and audit logs may be retained while your account is active and for a reasonable period afterward to support account functionality, security, dispute resolution, regulatory compliance, backups, and legal-hold obligations. Users may request deletion of contract-related personal data subject to legal, security, backup, dispute, and retention limitations described in this policy.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">13. User Controls for Contract Data</h3>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>Drivers may request deletion of certain personal data, including contract-related personal data, where legally available</li>
            <li>Recruiters may manage their uploaded contract records in accordance with platform rules and admin moderation</li>
            <li>Deletion requests may not immediately remove copies stored in backups, audit logs, or records subject to legal hold</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">14. Recruiter &amp; Carrier Data</h3>
          <p className="text-muted-foreground">For users with recruiter access, we additionally collect company legal name, USDOT/MC numbers, company and recruiter phone numbers, business address, hiring states, equipment types, and verification metadata. Billing details are handled by Stripe; we store only the Stripe customer/subscription identifiers, plan tier, status, and (where surfaced by Stripe) the last four digits and brand of the payment method. We never store full card numbers.</p>
          <p className="text-muted-foreground"><span className="font-semibold text-foreground">What drivers see:</span> only public recruiter fields — company name, verified badge, hiring states, equipment types, and the contact channel for the specific opportunity a driver inquires on. Internal verification documents, admin notes, billing data, and unapproved listings are never shown to drivers.</p>
          <p className="text-muted-foreground"><span className="font-semibold text-foreground">Retention:</span> recruiter accounts and their billing records are retained while active and for up to 24 months after closure for tax, audit, fraud-prevention, and dispute-resolution purposes. Recruiters may request deletion of personal contact data subject to those retention limits.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">15. Recruiter Reports &amp; Exports</h3>
          <p className="text-muted-foreground">Recruiter Activity and Pipeline reports (PDF and CSV) are generated on demand from <span className="font-semibold text-foreground">recruiter-owned workflow data only</span>: the recruiter's own opportunities, applications, application status events, driver contact requests, and contract workflow status. These exports <span className="font-semibold text-foreground">do not include</span> any driver loads, fuel, expenses, profit, tax estimates, or other private driver financial data. After download, the recruiter is solely responsible for storing, sharing, and protecting the exported file outside of HaulTrackerPro.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">16. Referral Tracking Data</h3>
          <p className="text-muted-foreground">When drivers and recruiters use the driver-to-driver referral tracking system, HaulTrackerPro may collect, store, and process referral-related data, including:</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>The referring driver's account/user ID</li>
            <li>The referred driver's name</li>
            <li>The referred driver's email</li>
            <li>The referred driver's phone number (if provided)</li>
            <li>Referral notes entered by the referring driver or recruiter</li>
            <li>The opportunity linked to the referral</li>
            <li>The recruiter/company linked to the referral</li>
            <li>Referral status and status history/events</li>
            <li>Recruiter-stated referral terms</li>
            <li>Referral notification metadata</li>
            <li>Admin oversight and analytics metadata</li>
            <li>Timestamps such as created_at, updated_at, and last_status_at</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">17. How Referral Data Is Used</h3>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>Create and track driver-to-driver referrals</li>
            <li>Show referral status to authorized users</li>
            <li>Allow recruiters to manage referrals tied to their own opportunities</li>
            <li>Display recruiter-stated referral terms</li>
            <li>Send in-app referral notifications to authorized users</li>
            <li>Support admin oversight of referral activity</li>
            <li>Prevent abuse, fraud, and spam</li>
            <li>Provide customer support</li>
            <li>Improve and secure the platform</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">18. Who Can See Referral Data</h3>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>The referring driver may see referrals they created.</li>
            <li>A linked referred driver may see referral information tied to their account.</li>
            <li>The owning recruiter may see referrals tied to their own opportunities.</li>
            <li>Platform administrators may see referral data for operations, support, safety, abuse prevention, and compliance with platform rules.</li>
          </ul>
          <p className="text-muted-foreground">Raw email or phone contacts entered as referral contact information are not contacted externally by HaulTrackerPro just because they appear in a referral record. HaulTrackerPro does not send SMS or email referral notifications to unregistered contacts in this phase; if the platform later adds such features, this policy will be updated accordingly.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">19. Referral Notification Metadata</h3>
          <p className="text-muted-foreground">In-app referral notifications may include metadata such as referral_id, opportunity_id, recruiter_id, current status or new status, notification type, read/unread status, and timestamps. This metadata is used to deliver in-app notifications, mark them as read, and support troubleshooting and abuse prevention.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">20. Referral Payment &amp; Tax Safety</h3>
          <p className="text-muted-foreground">HaulTrackerPro does not process or guarantee referral payments. HaulTrackerPro does not collect bank account, debit card, or other payout information for referral bonus payouts, and does not issue tax forms (such as 1099s) for recruiter-paid external referral bonuses. Referral bonus arrangements, if any, are handled externally between recruiters and participating drivers according to the recruiter's own stated terms. A referral status indicating that a bonus has been <span className="font-semibold text-foreground">marked paid externally</span> reflects an update made by the recruiter and is not a confirmation by HaulTrackerPro that any payment actually occurred.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">Settlement Statement Data</h3>
          <p className="text-muted-foreground">When a carrier or agency prepares a settlement statement for a driver, HaulTrackerPro stores the statement header (period, source, status, reported net), its line items (type, description, amount, and any linked load), carrier↔driver relationship records, reconciliation and load-match state, finalization, void and correction history, and related audit metadata.</p>
          <p className="text-muted-foreground"><span className="font-semibold text-foreground">Who can see it:</span> the issuing carrier or agency and its authorized members, the recipient driver, any assistant or agency the driver has granted settlement permissions to — limited to the specific settlement view, settlement-management, or settlement-finalize permission granted — and HaulTrackerPro administrators where access is needed for support, security, moderation, or dispute review. Settlement records are used for recordkeeping and reconciliation only — HaulTrackerPro does not process, hold, or verify settlement payments, does not run payroll, ACH, or direct deposit, does not issue or file employer tax forms, and does not collect bank account or payout information for settlements.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">AI &amp; OCR Processing of Your Content</h3>
          <p className="text-muted-foreground">Optional AI and OCR features — voice expense capture, receipt and rate-confirmation scanning, pasted load text, and AI summaries — send the content you submit to third-party AI or OCR processing services through HaulTrackerPro's processing layer so the requested output can be returned. Output may be incomplete or inaccurate and should be compared against the original document before you rely on it.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">Assistant &amp; Agency Access Data</h3>
          <p className="text-muted-foreground">When a driver approves an assistant or agency delegation, HaulTrackerPro stores the delegation record, the specific permissions granted, work items and requests exchanged in the workspace, and an audit log of actions taken on the driver's account. Drivers can review this activity and revoke access at any time. Agency-owned workspace records may remain with the workspace after an individual membership ends.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">21. Contact Information</h3>
          <p className="text-muted-foreground">For questions about this Privacy Policy or your data, sign in to your HaulTrackerPro account, open Settings, and select Send Feedback.</p>
        </section>


        <p className="text-xs text-muted-foreground/60 pt-4 border-t border-border">
          Policy metadata:{' '}
          {hasFixedMetadata
            ? `Version ${policy!.version} — Effective ${policy!.effectiveDate}`
            : POLICY_METADATA_PENDING_LABEL}
        </p>

      </main>
    </div>
  );
}
