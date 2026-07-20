import ResourceArticle from '@/components/resources/ResourceArticle';

export default function RecruiterToolsGuide() {
  return (
    <ResourceArticle
      path="/resources/trucking-recruiter-tools"
      seoTitle="Trucking Recruiter Tools & Driver Referral Tracking | HaulTrackerPro"
      seoDescription="Recruiter profile eligibility, unlimited standard opportunities, applicant tracking, referral analytics, premium visibility, and contract workflow tools."
      pageTitle="Trucking Recruiter Tools Guide"
      intro="HaulTrackerPro gives eligible recruiter workspaces tools to post opportunities, manage applicants, and track driver-to-driver referrals."
      sections={[
        {
          heading: 'Recruiter profile eligibility',
          body: 'A recruiter workspace can use standard posting once the recruiter profile is complete, a valid recruiter email is on file, at least one DOT or MC number is provided, current posting terms are accepted, and the account is active. Verified Recruiter badge review is a separate trust-display process and is not required to post.',
        },
        {
          heading: 'Posting and applicant management',
          bullets: [
            'Unlimited standard opportunities after required profile completion and posting-term acceptance',
            'Applicant and driver-interest management in one place',
            'Driver referral tracking with recruiter-controlled status updates',
            'External referral terms shown on each opportunity',
          ],
        },
        {
          heading: 'Premium visibility and analytics',
          body: 'Paid plans add premium visibility, referral analytics, and reports on top of standard posting. Growth adds recruiter reports, contract-management, and AI-assisted contract review. Fleet adds top-placement eligibility and priority support; team seats, bulk tools, custom recruiter profile, and a company-level hiring dashboard are coming soon.',
        },
        {
          heading: 'Contract workflow tools',
          body: 'Universal driver contract review, decision, and hired-state workflow protection are available to all drivers. Growth and Fleet add the recruiter contract-management dashboard, contract upload/management interface, and AI-assisted risk review. Not legal advice.',
        },
        {
          heading: 'How HaulTrackerPro helps',
          body: 'Recruiters get an eligible workspace, a clean applicant view, referral tracking, and analytics — without buying multiple tools.',
        },
      ]}
      disclaimer="HaulTrackerPro does not guarantee hires, driver quality, or specific recruiting outcomes. Referral payments, if offered, are paid externally by the recruiter under recruiter-stated terms."
      ctaTitle="Build a cleaner driver recruiting pipeline"
      ctaDescription="Add the recruiter workspace, complete the required profile and posting terms to unlock standard posting, and upgrade for premium recruiting tools."
      ctas={[
        { label: 'Add Recruiter Workspace', to: '/recruiters' },
        { label: 'Explore Recruiter Tools', to: '/recruiter/features', variant: 'outline' },
      ]}
      related={[
        { to: '/resources/driver-referral-tracking', title: 'Driver Referral Tracking' },
        { to: '/recruiter/faq', title: 'Recruiter FAQ' },
        { to: '/recruiter/guide', title: 'Recruiter Guide' },
      ]}
    />
  );
}
