import ContractSeoPage from '@/components/contracts/ContractSeoPage';

export default function AiContractReviewForTruckers() {
  return (
    <ContractSeoPage
      path="/ai-contract-review-for-truckers"
      title="AI Contract Review for Truckers"
      description="Use AI-assisted contract review to understand trucking agreements, identify risk flags, and make clearer decisions before approving or signing."
      h1="AI Contract Review for Truckers"
      headerLabel="AI Contract Review"
      breadcrumbName="AI Contract Review for Truckers"
      intro="Trucking contracts are long, dense, and full of terms that affect pay, deductions, and what happens if you leave. AI-assisted contract review reads the document and surfaces the parts that deserve attention so drivers can make a clearer decision before approving or signing."
      reviewItems={[
        'Plain-English summary of the agreement',
        'Risk flags for deductions and escrow',
        'Lease-purchase and walk-away terms',
        'Maintenance and insurance responsibility',
        'Chargebacks and damage liability',
        'Termination clauses',
        'Non-compete or restriction language',
        'Equipment return terms',
        'Recruiter promises vs written contract language',
        'Required driver approval and signature steps',
      ]}
      extraSections={[
        {
          heading: 'How AI contract review helps truckers',
          body: 'AI does not replace reading the contract — it helps drivers focus. Instead of skimming 30 pages of legal text, you see a summary, the risk flags, and the clauses worth a second look. That makes it easier to ask informed questions, request changes, or take the contract to a qualified attorney before signing.',
        },
      ]}
      faqs={[
        {
          q: 'How does AI contract review work for truckers?',
          a: 'The contract is parsed by AI, which produces a plain-English summary and surfaces clauses that commonly cause issues — escrow, deductions, lease-purchase terms, termination, non-compete, and chargebacks. The driver still reads and decides.',
        },
        {
          q: 'Is AI contract review legal advice?',
          a: 'No. AI contract review is informational only. HaulTrackerPro is not a law firm and does not provide legal advice. Always read the full contract and consider speaking with a qualified attorney before signing important agreements.',
        },
        {
          q: 'Can AI miss something important?',
          a: 'Yes. AI flags help drivers focus, but no automated tool catches everything. Read the full contract yourself and ask a qualified attorney about anything you are unsure of.',
        },
        {
          q: 'Is AI contract review free?',
          a: 'HaulTrackerPro may let drivers start with basic contract viewing, risk flags, and approval decisions. Advanced tools like deeper clause review, contract history, downloadable records, and AI follow-up explanations may be part of Pro. The goal is to make basic protection accessible while keeping advanced workflow tools sustainable.',
        },
        {
          q: 'Does AI sign the contract for me?',
          a: 'No. The driver decides. HaulTrackerPro can record an in-app approval or signature as a platform record of consent — it is not a DocuSign-equivalent or qualified electronic signature.',
        },
      ]}
    />
  );
}
