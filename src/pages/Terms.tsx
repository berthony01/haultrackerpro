import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import SEOHead from '@/components/SEOHead';
import { findPolicyBySlug, POLICY_METADATA_PENDING_LABEL } from '@/lib/legal/policyRegistry';

export default function Terms() {
  const navigate = useNavigate();
  const policy = findPolicyBySlug('terms');
  const hasFixedMetadata = !!(policy && policy.version && policy.effectiveDate);



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

        <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-xs text-foreground/90">
          <span className="font-semibold text-primary">Coverage note:</span> These terms now cover both driver/owner-operator accounts and recruiter/carrier accounts, including verification, anti-harassment, anti-scam, and billing terms. They also cover driver assistants, agencies, delegated access, and settlement statement recordkeeping and reconciliation.
        </div>

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
          <p className="text-muted-foreground">The Opportunities section displays trucking opportunities submitted by recruiters and carriers. All pay figures, weekly mileage, deductions, and Profit Intelligence breakdowns are <span className="font-semibold text-foreground">estimates based on recruiter-provided data</span> and are not guaranteed earnings or guaranteed jobs. When you apply to an opportunity, your application and the profile details you submitted are shared with that specific recruiter. Your private phone number and email address are disclosed to that recruiter only after you approve a separate contact request. You may withdraw a request at any time, but a recruiter may have already received information you previously approved.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">10. Recruiter Accounts &amp; Opportunity Listings</h3>
          <p className="text-muted-foreground">Recruiter accounts are subject to verification before opportunities can be posted. Submitted opportunities go through admin review and may be approved, rejected, flagged, or removed at HaulTrackerPro's sole discretion. Recruiters are solely responsible for the accuracy and legality of opportunity listings, hiring practices, and communications with drivers. Misleading pay claims, fake postings, or harassing behavior may result in suspension of recruiter access. Driver applications are made available only to the recruiter who posted the opportunity the driver applied to, and a driver's private phone and email are released to that recruiter only after the driver approves a contact request.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">11. Recruiter Billing &amp; Subscriptions</h3>
          <p className="text-muted-foreground">Recruiter access requires approval. Approved recruiters may submit standard opportunities for review without an active paid recruiter subscription. Paid recruiter subscriptions unlock premium features, which may include priority placement, featured visibility, reports, analytics, contract workflow tools, and other premium recruiting tools. Cancelling or failing to pay a recruiter subscription may remove premium features, but does not automatically revoke approved recruiter status unless the account violates platform rules or is suspended. Listings remain subject to admin review, moderation, accuracy requirements, and platform policies. HaulTrackerPro does not guarantee hires, applications, driver quality, earnings, or placement results. Contract workflow tools are informational and are not legal advice.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">12. Contract Protection — Uploads</h3>
          <p className="text-muted-foreground">Recruiters and any other authorized users who upload contracts to HaulTrackerPro represent and warrant that they have the right to upload, share, and process those documents. Uploaded contracts must be accurate, lawful, and related to a legitimate trucking, recruiting, leasing, or contractor opportunity. You may not upload contracts that you do not own, control, or have explicit permission to share, and you may not upload documents containing material that is fraudulent, misleading, or in violation of third-party rights.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">13. AI Contract Analysis Disclaimer</h3>
          <p className="text-muted-foreground">HaulTrackerPro provides AI-assisted contract summaries, plain-English explanations, and risk flags as an <span className="font-semibold text-foreground">informational tool only</span>. HaulTrackerPro is not a law firm, does not provide legal advice, and using the AI contract review feature does not create an attorney-client relationship. AI analysis may miss risks, misinterpret clauses, omit important terms, or produce incomplete or inaccurate output. Drivers and other users should always read the full contract themselves and consider consulting a qualified attorney before signing any meaningful agreement.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">14. Driver Responsibility</h3>
          <p className="text-muted-foreground">Drivers are solely responsible for reading the full contract document and for deciding whether to approve, request changes to, reject, or sign any contract presented through HaulTrackerPro. AI summaries and risk flags are not a substitute for reviewing the original document or for getting independent legal advice.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">15. Recruiter Responsibility</h3>
          <p className="text-muted-foreground">Recruiters are solely responsible for ensuring that uploaded contract terms are accurate, complete, and not misleading, and for complying with all applicable laws, including trucking, employment, leasing, independent contractor, FMCSA-related, and state-specific requirements. Recruiters may not use the platform to pressure, deceive, coerce, or bypass driver review, approval, or signature steps.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">16. In-App Signature Record</h3>
          <p className="text-muted-foreground">When a driver signs a contract in HaulTrackerPro, the platform creates a <span className="font-semibold text-foreground">platform-generated record of consent and approval</span>. That record may include the typed name, the consent confirmation, a timestamp, IP address, browser/user-agent information, the contract version ID, and related audit metadata. This in-app signature is <span className="font-semibold text-foreground">not</span> represented as a qualified electronic signature, an advanced electronic signature, a DocuSign-equivalent signature, a notarization, or a guaranteed court-admissible signature. The legal effect and enforceability of any signature record may depend on the facts, jurisdiction, contract type, and applicable law.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">17. Hired-Status Workflow Protection</h3>
          <p className="text-muted-foreground">Where a contract has been attached to an opportunity application, recruiters cannot mark a driver as "hired" until the driver approves the current contract. Driver signature is optional; if the driver also signs, HaulTrackerPro stores an in-app signature record. This is a <span className="font-semibold text-foreground">platform workflow protection</span> intended to support transparency between drivers and recruiters; it is not a guarantee of legal protection or enforceability, is not a DocuSign-equivalent service, and is not a qualified electronic signature.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">18. Prohibited Uses</h3>
          <p className="text-muted-foreground">In connection with Contract Protection, you may not:</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>Upload fraudulent, misleading, illegal, or unauthorized contracts</li>
            <li>Upload contracts you have no right to share or process</li>
            <li>Misrepresent contract terms to drivers</li>
            <li>Attempt to bypass or circumvent driver approval, review, or signature requirements</li>
            <li>Harass, pressure, retaliate against, or penalize a driver for rejecting a contract or requesting changes</li>
            <li>Rely on AI analysis as a substitute for professional legal review</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">19. Contract Records, Audit Logs &amp; Retention</h3>
          <p className="text-muted-foreground">Contract files, extracted text, AI parsing and risk-review output, driver decisions, signature records, and related audit logs may be retained while your account is active and for a reasonable period afterward for security, compliance, dispute resolution, backup, and legal-hold purposes, as further described in our Privacy Policy. Records may be retained or removed in accordance with our retention practices unless deletion is required or restricted by law.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">20. Limitation of Liability — Contract Protection</h3>
          <p className="text-muted-foreground">In addition to the general limitation of liability above, HaulTrackerPro is not liable for missed contract risks, inaccurate or incomplete AI analysis, decisions made by drivers or recruiters, recruiter misrepresentations, unsigned or rejected agreements, lost opportunities, business losses, or disputes arising from contract terms. Contract Protection features are workflow and informational tools, not legal protection or legal services.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">21. Recruiter Eligibility &amp; Verification</h3>
          <p className="text-muted-foreground">To create a recruiter account, you must represent a legitimate motor carrier or authorized recruiting partner with an active USDOT/MC number, provide truthful company information, and consent to verification. HaulTrackerPro may reject, suspend, or revoke recruiter access at any time, in its sole discretion, including for failed verification, fraud signals, or violations of these terms.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">22. Truthful Postings &amp; Anti-Bait-and-Switch</h3>
          <p className="text-muted-foreground">All opportunity details — pay, lanes, equipment, home-time, benefits, hiring areas — must be accurate at the time of posting. Bait-and-switch, undisclosed deductions, fake job postings, and material misrepresentations are grounds for immediate removal of the listing and termination of recruiter access.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">23. Driver Contact &amp; Anti-Harassment</h3>
          <p className="text-muted-foreground">Recruiters may only contact drivers who have requested information through the platform, and only for the opportunity that driver inquired on. Recruiters may not scrape or off-platform-solicit drivers sourced through HaulTrackerPro, may not contact drivers outside reasonable hours, and may not harass, threaten, retaliate against, or repeatedly contact a driver who has declined. Reported violations may result in immediate suspension.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">24. Anti-Scam &amp; Fraud Prevention</h3>
          <p className="text-muted-foreground">The following are strictly prohibited: fake or borrowed DOT/MC numbers, shell carriers, advance-fee or pay-to-apply schemes, impersonation of carriers or drivers, training-contract traps not disclosed up front, and any attempt to collect payment, sensitive personal data, or banking information from drivers off-platform under false pretenses. HaulTrackerPro reserves the right to share fraud signals with industry partners and law enforcement.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">25. Recruiter Account Termination</h3>
          <p className="text-muted-foreground">Recruiter accounts may be suspended or terminated by HaulTrackerPro for verification failure, fraud, repeated complaints, misleading postings, safety concerns, or violations of these terms. Failure to pay for a recruiter subscription may result in loss of paid premium features, but does not automatically revoke approved recruiter access unless connected to a separate policy violation, chargeback abuse, fraud, or account suspension. Upon account suspension or termination, active opportunities may be unpublished, pending applicant data is retained per the Privacy Policy, and any paid billing stops at the end of the current period except where required by law.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">26. Recruiter Reports (Activity &amp; Pipeline)</h3>
          <p className="text-muted-foreground">Recruiter Activity and Pipeline reports (PDF and CSV exports) contain only <span className="font-semibold text-foreground">recruiter-owned workflow data</span> — the recruiter's own opportunities, applications, application status events, driver contact requests, and contract workflow status. These reports <span className="font-semibold text-foreground">do not include</span> any driver loads, fuel, expenses, profit, tax estimates, or other private driver financial data. Once a recruiter downloads a PDF or CSV export, the recruiter is solely responsible for storing, sharing, and protecting that exported file outside HaulTrackerPro.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">27. Driver Referral Tracking</h3>
          <p className="text-muted-foreground">HaulTrackerPro includes a driver-to-driver referral tracking system. Drivers may refer other drivers to recruiter opportunities, and recruiters may view and manage referrals tied to their own opportunities, update referral statuses, and define their own external referral terms. The referring driver may view progress on referrals they created, and a linked referred driver may view referral information tied to their account where applicable. Referral statuses (including a status indicating that a bonus has been <span className="font-semibold text-foreground">marked paid externally</span>) are for tracking and visibility only and reflect updates made by the recruiter; they are not a confirmation by HaulTrackerPro that any payment actually occurred.</p>
          <p className="text-muted-foreground"><span className="font-semibold text-foreground">HaulTrackerPro tracks referral progress only.</span> HaulTrackerPro does not process, verify, guarantee, enforce, collect, hold, or pay referral bonuses, and is not responsible for referral payment disputes between drivers and recruiters. Referral bonuses, if offered, are paid externally by the recruiter according to the recruiter's own stated terms, eligibility rules, and timing. Drivers should review any recruiter-stated referral terms before participating and contact the recruiter directly with questions about eligibility or payment.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">28. Admin Oversight of Referral Activity</h3>
          <p className="text-muted-foreground">Platform administrators may review referral activity and related metadata to operate, secure, support, moderate, and improve the service, including detecting abuse, investigating policy violations, responding to user support requests, and maintaining platform safety. This oversight is operational and is not a form of payment enforcement, payment guarantee, or dispute settlement between drivers and recruiters.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">29. Governing Law</h3>
          <p className="text-muted-foreground">These terms shall be governed by and construed in accordance with the laws of the United States, without regard to conflict of law provisions.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">Settlement Statements &amp; Reconciliation (Recordkeeping Only)</h3>
          <p className="text-muted-foreground">HaulTrackerPro provides settlement statement and reconciliation <span className="font-semibold text-foreground">recordkeeping tools only</span>. A carrier or agency with an accepted relationship to a driver may prepare, finalize, void, or supersede a settlement statement, and a driver may view finalized statements issued to them and reconcile the lines against their own load records. Carrier settlement issuance requires an active standalone paid recruiter/carrier entitlement plus an active carrier↔driver relationship; an agency-included recruiter entitlement is a recruiting entitlement only and does not grant carrier-issued settlement authority. Agency settlement preparation requires an active paid agency plan plus delegated settlement-management permission, and finalizing additionally requires settlement-finalize permission. Basic driver reconciliation is available on every driver plan; advanced reconciliation and manual outside-settlement records require Driver Pro.</p>
          <p className="text-muted-foreground">HaulTrackerPro does <span className="font-semibold text-foreground">not</span> pay, hold, transfer, escrow, collect, verify, audit, or guarantee any settlement amount, and does not act as a paying agent, factoring company, payroll provider, or accountant. HaulTrackerPro does not process payroll, send ACH or direct deposit, calculate, withhold, or remit employer payroll taxes, issue or file employer tax forms, or determine worker classification. A finalized settlement record, a matched load, a reconciliation state, or a comparison between line totals and a reported net is not proof that any payment occurred, that any amount is correct, or that any deduction is lawful. Amounts, deductions, and disputes remain between the driver and the company that issued the statement. Users are responsible for the accuracy of the settlement data they enter or import.</p>

        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">Assistant &amp; Agency Delegated Access</h3>
          <p className="text-muted-foreground">Driver assistants and agencies may act on a driver's account only after the driver explicitly approves the delegation, and only within the permissions the driver granted — including any settlement permissions. Settlement permissions are scoped separately: settlement view permission allows viewing statements, settlement-management permission is required to prepare or modify a settlement, and settlement-finalize permission is required to finalize one. Advanced reconciliation and manual outside-settlement records always follow the recipient driver's own Driver Pro entitlement, never the assistant's or agency's plan. Submitting an agency request does not by itself grant access. Drivers may revoke delegated access at any time, and delegated actions are recorded in an audit log. Payments for assistant or agency services are arranged outside HaulTrackerPro.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-bold">30. Contact Information</h3>
          <p className="text-muted-foreground">For questions about these Terms of Service, sign in to your HaulTrackerPro account, open Settings, and select Send Feedback.</p>
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
