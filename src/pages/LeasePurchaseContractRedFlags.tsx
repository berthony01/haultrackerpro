import ContractSeoPage from '@/components/contracts/ContractSeoPage';

export default function LeasePurchaseContractRedFlags() {
  return (
    <ContractSeoPage
      path="/lease-purchase-contract-red-flags"
      title="Lease-Purchase Contract Red Flags for Truckers"
      description="Learn common lease-purchase trucking contract red flags, including escrow terms, deductions, maintenance responsibility, and walk-away risk."
      h1="Lease-Purchase Trucking Contract Red Flags"
      headerLabel="Lease-Purchase Red Flags"
      breadcrumbName="Lease-Purchase Contract Red Flags"
      intro="Lease-purchase agreements can look attractive on a recruiter call and very different on paper. Hidden deductions, large escrow holds, maintenance responsibility, and walk-away penalties can turn a 'path to ownership' into a financial trap. HaulTrackerPro Contract Protection helps drivers spot these red flags before signing."
      reviewItems={[
        'Weekly truck payment vs realistic settlement after deductions',
        'Escrow size, refund conditions, and forfeiture terms',
        'Maintenance and breakdown responsibility',
        'Insurance, plates, and permits responsibility',
        'Chargebacks for damage, missed loads, or downtime',
        'Walk-away penalties and equipment return terms',
        'Termination clauses and notice periods',
        'Forced dispatch language',
        'Non-compete or restriction clauses',
        'Mileage minimums or load acceptance requirements',
      ]}
      extraSections={[
        {
          heading: 'Common lease-purchase red flags',
          body: 'Watch for: escrow that is forfeited if you leave, maintenance fully on the driver with no rate adjustment, insurance bundled at marked-up rates, chargebacks that can exceed weekly settlement, and termination clauses that let the carrier reclaim the truck without refunding your investment. None of these are illegal on their own — but you deserve to know they are there before you sign.',
        },
      ]}
      faqs={[
        {
          q: 'Are lease-purchase trucking contracts a scam?',
          a: 'Not all of them, but many lease-purchase agreements transfer cost and risk to the driver in ways that make ownership unrealistic. Reading the full contract is the only way to tell, and an AI-assisted review can help you focus on the high-risk clauses.',
        },
        {
          q: 'What is the biggest red flag in a lease-purchase contract?',
          a: 'For many drivers it is escrow forfeiture combined with full maintenance responsibility — meaning if you walk away, the money you put in stays with the carrier and any breakdowns came out of your settlement.',
        },
        {
          q: 'Can HaulTrackerPro tell me whether to take a lease-purchase deal?',
          a: 'No. HaulTrackerPro provides AI-assisted contract review, risk flags, and a plain-English summary — informational only. It is not legal advice and does not decide whether a deal is right for you. Consider speaking with a qualified attorney before signing.',
        },
        {
          q: 'Are lease-purchase review tools free?',
          a: 'Basic risk flags, contract viewing, and approval decisions can be available to help drivers get started. Deeper clause analysis, saved history, downloadable records, and AI follow-up explanations may be part of Pro.',
        },
        {
          q: 'Should I sign a lease-purchase contract on the spot?',
          a: 'No. Take time to read the full agreement, compare it to anything the recruiter said verbally, run the numbers against realistic settlements after deductions, and consider speaking with a qualified attorney before signing.',
        },
      ]}
    />
  );
}
