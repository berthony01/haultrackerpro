import ResourceArticle from '@/components/resources/ResourceArticle';

export default function RecruiterToolsGuide() {
  return (
    <ResourceArticle
      path="/resources/trucking-recruiter-tools"
      seoTitle="Trucking Recruiter Tools & Driver Referral Tracking | HaulTrackerPro"
      seoDescription="Verified recruiter access, unlimited standard opportunities, applicant tracking, referral analytics, premium visibility, and contract workflow tools."
      pageTitle="Trucking Recruiter Tools Guide"
      intro="HaulTrackerPro gives verified recruiters tools to post opportunities, manage applicants, and track driver-to-driver referrals."
      sections={[
        {
          heading: 'Verified recruiter access',
          body: 'Recruiter accounts go through an approval step. Verified access keeps the opportunity surface accountable for drivers and recruiters alike.',
        },
        {
          heading: 'Posting and applicant management',
          bullets: [
            'Unlimited standard opportunities after approval',
            'Applicant and driver-interest management in one place',
            'Driver referral tracking with recruiter-controlled status updates',
            'External referral terms shown on each opportunity',
          ],
        },
        {
          heading: 'Premium visibility and analytics',
          body: 'Paid plans unlock premium visibility for opportunities, referral analytics, and reports that help recruiters understand pipeline performance.',
        },
        {
          heading: 'Contract workflow tools',
          body: 'Where contract workflow tools are included, recruiters can structure agreements and share them with drivers in an organized way. Recruiters and drivers remain responsible for their own contracts.',
        },
        {
          heading: 'How HaulTrackerPro helps',
          body: 'Recruiters get verified access, a clean applicant view, referral tracking, and analytics — without buying multiple tools.',
        },
      ]}
      disclaimer="HaulTrackerPro does not guarantee hires, driver quality, or specific recruiting outcomes. Referral payments, if offered, are paid externally by the recruiter under recruiter-stated terms."
      ctaTitle="Build a cleaner driver recruiting pipeline"
      ctaDescription="Apply for verified recruiter access, post standard opportunities after approval, and upgrade for premium recruiting tools."
      ctas={[
        { label: 'Apply for Recruiter Access', to: '/recruiters' },
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
