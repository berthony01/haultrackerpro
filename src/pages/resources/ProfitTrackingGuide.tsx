import ResourceArticle from '@/components/resources/ResourceArticle';

export default function ProfitTrackingGuide() {
  return (
    <ResourceArticle
      path="/resources/truck-driver-profit-tracking"
      seoTitle="Truck Driver Profit Tracking Guide | HaulTrackerPro"
      seoDescription="Learn why truck drivers should track real net profit, not just gross pay — fuel, DEF, tolls, parking, repairs, and RPM explained."
      pageTitle="Truck Driver Profit Tracking Guide"
      intro="Gross pay on a rate confirmation rarely matches what you actually keep. This guide explains how owner-operators and 1099 drivers can track real load profit so every haul is measured against the costs to run it."
      sections={[
        {
          heading: 'Gross revenue vs. net profit',
          body: 'Gross revenue is what the broker or carrier pays you. Net profit is what is left after fuel, DEF, tolls, parking, repairs, meals, insurance, and other operating costs. Two loads at the same gross can produce very different net profit depending on the lane and the truck.',
        },
        {
          heading: 'Expenses to track on every load',
          bullets: [
            'Fuel and DEF for loaded and deadhead miles',
            'Tolls, parking, and scale fees',
            'Repairs, maintenance, and tires',
            'Meals on the road where applicable',
            'Insurance, permits, and ELD costs allocated per mile',
          ],
        },
        {
          heading: 'Why RPM matters',
          body: 'Rate per mile (RPM) gives you a single number to compare loads, lanes, and brokers. Real RPM includes deadhead miles and operating costs — not just the loaded rate. Tracking real RPM over time shows which lanes and brokers are actually worth running.',
        },
        {
          heading: 'How HaulTrackerPro helps',
          body: 'HaulTrackerPro lets you log each load with rate, miles, deadhead, and expenses, then shows estimated net profit and real RPM. You can review weekly summaries, watch lane trends, and keep clean records — all from your phone.',
        },
      ]}
      ctas={[
        { label: 'Start Tracking Free', to: '/auth' },
        { label: 'View Pricing', to: '/pricing', variant: 'outline' },
      ]}
      related={[
        { to: '/resources/load-profit-calculator', title: 'Load Profit Calculator Guide' },
        { to: '/resources/real-rpm-trucking', title: 'Real RPM in Trucking' },
        { to: '/resources/1099-truck-driver-expenses', title: '1099 Truck Driver Expenses' },
        { to: '/resources/trucking-contract-clarity', title: 'Trucking Contract Clarity' },
      ]}
    />
  );
}
