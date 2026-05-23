import ResourceArticle from '@/components/resources/ResourceArticle';

export default function LoadProfitCalculatorGuide() {
  return (
    <ResourceArticle
      path="/resources/load-profit-calculator"
      seoTitle="Load Profit Calculator for Truck Drivers | HaulTrackerPro"
      seoDescription="Estimate whether a load is worth taking. Learn how rate, loaded miles, deadhead, fuel, and expenses determine real RPM and net profit."
      pageTitle="Load Profit Calculator Guide"
      intro="A high-paying load can still lose money once you factor in deadhead, fuel, and expenses. Use this guide to estimate load profitability before you accept."
      sections={[
        {
          heading: 'Inputs that decide profitability',
          bullets: [
            'Rate offered by the broker or carrier',
            'Loaded miles from pickup to drop-off',
            'Deadhead miles to get to the pickup',
            'Estimated fuel cost based on MPG and diesel price',
            'Tolls, parking, and any per-load expenses',
          ],
        },
        {
          heading: 'Real RPM vs. broker rate',
          body: 'Broker RPM divides the rate by loaded miles only. Real RPM divides estimated net by total miles (loaded + deadhead). Real RPM is what tells you if a load is actually worth running.',
        },
        {
          heading: 'Why a high-paying load can still be bad',
          body: 'A $2,000 load looks great until you add 250 deadhead miles, expensive diesel, and a long detention window. After expenses, that load can pay less per mile than a cheaper one closer to home.',
        },
        {
          heading: 'How HaulTrackerPro estimates load profit',
          body: 'Enter rate, miles, deadhead, fuel price, and known expenses. HaulTrackerPro shows estimated net profit and real RPM so you can compare offers side by side. Numbers are estimates, not guarantees.',
        },
      ]}
      ctaTitle="Know if the next load is worth it"
      ctaDescription="Estimate net profit and real RPM before you accept a load. Numbers are estimates, not guarantees."
      ctas={[
        { label: 'Start Tracking Free', to: '/auth' },
        { label: 'View Pricing', to: '/pricing', variant: 'outline' },
      ]}
      related={[
        { to: '/resources/truck-driver-profit-tracking', title: 'Truck Driver Profit Tracking' },
        { to: '/resources/real-rpm-trucking', title: 'Real RPM in Trucking' },
        { to: '/tools/load-profit-calculator', title: 'Free Load Profit Calculator Tool' },
        { to: '/tools/fuel-cost-per-mile', title: 'Fuel Cost Per Mile Calculator' },
      ]}
    />
  );
}
