import ContractSeoPage from '@/components/contracts/ContractSeoPage';

export default function TruckingEscrowAgreementReview() {
  return (
    <ContractSeoPage
      path="/trucking-escrow-agreement-review"
      title="Trucking Escrow Agreement Review"
      description="Review trucking escrow terms, deductions, refund conditions, and holdback language with AI-assisted summaries and plain-English explanations."
      h1="Trucking Escrow Agreement Review for Drivers"
      headerLabel="Escrow Agreement Review"
      breadcrumbName="Trucking Escrow Agreement Review"
      intro="Escrow clauses can quietly take a piece of every settlement. Some carriers refund escrow when you leave; others hold it for months or attach conditions that make it hard to recover. HaulTrackerPro Contract Protection helps drivers spot escrow terms before approving or signing."
      reviewItems={[
        'Total escrow target amount',
        'Per-week or per-load escrow deduction',
        'Refund timing after termination',
        'Refund conditions and required notice',
        'Forfeiture clauses (damage, equipment return, missed loads)',
        'Interest on escrow balances (if any)',
        'Whether escrow can be used for chargebacks or repairs',
        'Statement and reporting access',
      ]}
      extraSections={[
        {
          heading: 'Why escrow language matters',
          body: 'Escrow is your money — but the contract decides when and how you get it back. Long refund windows, forfeiture conditions, and broad usage clauses can mean drivers never see escrow returned in full. Reviewing the language up front prevents surprises later.',
        },
      ]}
      faqs={[
        {
          q: 'What is escrow in a trucking contract?',
          a: 'Escrow is a holdback the carrier deducts from settlements and keeps in reserve, often used for damage, missed loads, or equipment return. The contract sets refund rules.',
        },
        {
          q: 'How long can a carrier hold escrow after I leave?',
          a: 'It depends on the contract and on state and federal regulations. Refund windows vary widely. The agreement language is the controlling factor — read it before signing.',
        },
        {
          q: 'Does HaulTrackerPro tell me if escrow terms are legal?',
          a: 'No. HaulTrackerPro provides AI-assisted contract review and risk flags. It is informational only and is not legal advice. Consider speaking with a qualified attorney for legal questions about escrow.',
        },
        {
          q: 'Are escrow review tools free or Pro?',
          a: 'Basic contract viewing, risk flags, and approval decisions can be available to help drivers get started. Deeper clause review, saved contract history, and downloadable records may be part of Pro as the feature expands.',
        },
        {
          q: 'What should I look for in escrow language?',
          a: 'Total amount, deduction rate, refund timing, refund conditions, forfeiture triggers, and whether escrow can be used to cover chargebacks or repairs.',
        },
      ]}
    />
  );
}
