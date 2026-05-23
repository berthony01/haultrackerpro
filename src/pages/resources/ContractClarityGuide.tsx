import ResourceArticle from '@/components/resources/ResourceArticle';

export default function ContractClarityGuide() {
  return (
    <ResourceArticle
      path="/resources/trucking-contract-clarity"
      seoTitle="Trucking Contract Clarity Guide for Drivers | HaulTrackerPro"
      seoDescription="Learn how to review trucking contracts more carefully — payment terms, chargebacks, non-compete, and termination clauses."
      pageTitle="Trucking Contract Clarity Guide"
      intro="Carrier, lease, and broker agreements can be long and dense. This guide highlights the sections drivers should read carefully before signing."
      sections={[
        {
          heading: 'Plain-English summaries help',
          body: 'Breaking a contract down into plain language makes it easier to spot what you are actually agreeing to. Look for who pays, when they pay, what gets deducted, and what happens if either side ends the agreement.',
        },
        {
          heading: 'Risk flags to watch for',
          bullets: [
            'Vague payment timing or settlement windows',
            'Open-ended chargebacks or deductions',
            'Escrow holds with unclear release terms',
            'Non-compete clauses with broad geographic or time limits',
            'Termination clauses that favor only one side',
          ],
        },
        {
          heading: 'Payment terms and chargebacks',
          body: 'Confirm how often you get paid, what triggers a deduction, and how disputes are handled. Surprises here are the most common source of friction after a driver signs on.',
        },
        {
          heading: 'How HaulTrackerPro helps',
          body: 'HaulTrackerPro contract tools provide structured summaries and highlight common clauses drivers want to review carefully. The tools are informational and do not replace your own review.',
        },
      ]}
      disclaimer="Contract tools are informational only and are not legal advice. Drivers should review documents carefully and consult a qualified professional when needed."
      ctaTitle="Review contracts with more confidence"
      ctaDescription="Use informational contract summaries and risk flags to review documents more clearly. Not legal advice."
      ctas={[
        { label: 'Review Contracts More Clearly', to: '/auth' },
        { label: 'View Pricing', to: '/pricing', variant: 'outline' },
      ]}
      related={[
        { to: '/trucking-contract-review', title: 'Trucking Contract Review' },
        { to: '/lease-purchase-contract-red-flags', title: 'Lease-Purchase Contract Red Flags' },
        { to: '/1099-truck-driver-contract-protection', title: '1099 Driver Contract Protection' },
      ]}
    />
  );
}
