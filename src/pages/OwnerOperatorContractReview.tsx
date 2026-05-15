import ContractSeoPage from '@/components/contracts/ContractSeoPage';

export default function OwnerOperatorContractReview() {
  return (
    <ContractSeoPage
      path="/owner-operator-contract-review"
      title="Owner-Operator Contract Review Tool"
      description="Understand owner-operator agreements with AI-assisted contract summaries, risk flags, and approval workflow protection before moving forward."
      h1="Owner-Operator Contract Review Made Easier"
      headerLabel="Owner-Operator Contract Review"
      breadcrumbName="Owner-Operator Contract Review"
      intro="Owner-operator agreements often bundle pay structure, escrow, fuel and maintenance responsibility, insurance requirements, and equipment terms into long documents. HaulTrackerPro Contract Protection helps owner-operators review the terms before approving or signing."
      reviewItems={[
        'Pay percentage or rate-per-mile structure',
        'Escrow deductions and refund timing',
        'Fuel surcharge handling',
        'Maintenance responsibility',
        'Insurance requirements and coverage gaps',
        'Chargebacks and equipment damage clauses',
        'Termination notice and walk-away terms',
        'Equipment return conditions',
        'Non-compete or restriction language',
        'Settlement timing and dispute terms',
      ]}
      extraSections={[
        {
          heading: 'Owner-operator contracts deserve a closer read',
          body: 'Lease and owner-operator agreements can hide cost shifts that change real take-home pay — escrow holds, maintenance responsibility, deduction stacking, and termination penalties. HaulTrackerPro highlights the clauses that matter so you can ask the right questions before signing.',
        },
      ]}
      faqs={[
        {
          q: 'What does an owner-operator contract review check?',
          a: 'It surfaces pay structure, escrow, deductions, maintenance and insurance responsibility, termination terms, and any non-compete language so owner-operators know what they are agreeing to before approval.',
        },
        {
          q: 'Is this the same as having a lawyer review my contract?',
          a: 'No. AI-assisted review is informational only and is not a substitute for an attorney. HaulTrackerPro is not a law firm and does not provide legal advice. Consider speaking with a qualified attorney before signing important agreements.',
        },
        {
          q: 'Can AI catch every risky clause in an owner-operator agreement?',
          a: 'No. AI flags help drivers focus on common risk areas, but no automated tool catches everything. Always read the full contract yourself.',
        },
        {
          q: 'Are owner-operator review tools free or Pro?',
          a: 'Basic contract viewing, risk flags, and approval decisions can be available to help drivers get started. Deeper clause-by-clause review, saved history, downloadable records, and AI follow-up explanations may be part of Pro as the feature expands.',
        },
        {
          q: 'How does HaulTrackerPro fit into the hiring workflow?',
          a: 'Recruiters upload the contract, drivers see a plain-English summary and risk flags, and drivers approve, reject, or request changes. Recruiters cannot move forward to hired status until required contract steps are completed.',
        },
      ]}
    />
  );
}
