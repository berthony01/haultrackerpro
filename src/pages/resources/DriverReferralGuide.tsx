import ResourceArticle from '@/components/resources/ResourceArticle';

export default function DriverReferralGuide() {
  return (
    <ResourceArticle
      path="/resources/driver-referral-tracking"
      seoTitle="Driver Referral Tracking for Trucking Opportunities | HaulTrackerPro"
      seoDescription="Learn how drivers can refer other drivers to recruiter opportunities and track referral progress with recruiter-stated terms."
      pageTitle="Driver Referral Tracking Guide"
      intro="HaulTrackerPro lets drivers refer other drivers to recruiter opportunities and track referral progress. Recruiters update referral statuses based on their own stated terms."
      sections={[
        {
          heading: 'How driver referrals work',
          bullets: [
            'Drivers can share opportunities with other drivers',
            'Drivers can track referral progress in one place',
            'Recruiters update statuses such as contacted, hired, eligible based on recruiter terms, or marked paid externally',
            'Recruiter-stated external referral terms are shown on the opportunity',
          ],
        },
        {
          heading: 'What the statuses mean',
          body: 'Statuses reflect updates the recruiter chooses to log. They are progress tracking only — they do not represent a payment guarantee or an enforceable promise from HaulTrackerPro.',
        },
        {
          heading: 'External referral terms',
          body: 'Any referral bonus terms come from the recruiter, not from HaulTrackerPro. Drivers should read those terms carefully on the opportunity before referring others.',
        },
        {
          heading: 'How HaulTrackerPro helps',
          body: 'You get a single place to see referrals, statuses, and recruiter-stated terms. This makes it easier to follow up and stay organized.',
        },
      ]}
      disclaimer="Referral bonuses, if offered, are paid externally by recruiters. HaulTrackerPro tracks referral progress only and does not process, verify, guarantee, collect, hold, enforce, or pay referral bonuses."
      ctas={[
        { label: 'Explore Opportunities', to: '/auth' },
        { label: 'Apply for Recruiter Access', to: '/recruiters', variant: 'outline' },
      ]}
      related={[
        { to: '/resources/trucking-recruiter-tools', title: 'Trucking Recruiter Tools' },
        { to: '/recruiter/faq', title: 'Recruiter FAQ' },
        { to: '/recruiter/features', title: 'Recruiter Features' },
      ]}
    />
  );
}
