import ContractSeoPage from '@/components/contracts/ContractSeoPage';

export default function TruckingContractReview() {
  return (
    <ContractSeoPage
      path="/trucking-contract-review"
      title="AI Trucking Contract Review for Drivers"
      description="Review trucking contracts with AI-assisted summaries, risk flags, and plain-English explanations before you approve or sign. Informational only, not legal advice."
      h1="AI Trucking Contract Review for 1099 Drivers"
      headerLabel="Trucking Contract Review"
      breadcrumbName="Trucking Contract Review"
      intro="Trucking contracts can include deductions, escrow terms, lease-purchase language, chargebacks, termination clauses, insurance responsibilities, maintenance obligations, and other terms drivers may not fully understand at first glance. HaulTrackerPro Contract Protection helps drivers review what they are about to agree to before they approve or sign."
      reviewItems={[
        'Pay terms and rate calculations',
        'Escrow deductions and refund conditions',
        'Lease-purchase terms and walk-away risk',
        'Maintenance responsibility',
        'Insurance responsibility',
        'Chargebacks and deductions',
        'Termination clauses',
        'Non-compete or restriction language',
        'Equipment return terms',
        'Recruiter promises vs written contract language',
        'Driver approval and signature requirements',
      ]}
      extraSections={[
        {
          heading: 'Why drivers need contract review',
          body: 'Many 1099 truck drivers sign recruiter-sent agreements without reading every clause. The contract — not the recruiter conversation — is what controls pay, deductions, and what happens if you leave. HaulTrackerPro reads contracts you receive and surfaces the parts that deserve attention before you commit.',
        },
      ]}
      faqs={[
        {
          q: 'What is AI trucking contract review?',
          a: 'AI trucking contract review reads a recruiter-sent contract and produces a plain-English summary plus risk flags so drivers can see deductions, escrow language, termination terms, and other items worth reviewing before they approve or sign.',
        },
        {
          q: 'Is HaulTrackerPro contract review legal advice?',
          a: 'No. AI contract review is informational only. HaulTrackerPro is not a law firm and does not provide legal advice. Always read the full contract and consider speaking with a qualified attorney before signing important agreements.',
        },
        {
          q: 'Can the AI miss something in a contract?',
          a: 'Yes. AI summaries and risk flags are tools to help drivers focus, not a substitute for reading the full agreement. Drivers should always read the entire contract themselves before approving or signing.',
        },
        {
          q: 'Is HaulTrackerPro contract review free?',
          a: 'HaulTrackerPro may let drivers start with basic contract viewing, risk flags, and approval decisions. Advanced tools like deeper clause review, contract history, downloadable records, and AI follow-up explanations may be part of Pro. The goal is to make basic protection accessible while keeping advanced workflow tools sustainable.',
        },
        {
          q: 'What should I review before signing a trucking contract?',
          a: 'Pay terms, deductions, escrow, lease-purchase language, maintenance and insurance responsibility, chargebacks, termination clauses, and any non-compete or equipment return terms. Compare the contract against anything the recruiter promised verbally.',
        },
      ]}
    />
  );
}
