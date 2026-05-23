import ResourceArticle from '@/components/resources/ResourceArticle';

export default function RealRpmGuide() {
  return (
    <ResourceArticle
      path="/resources/real-rpm-trucking"
      seoTitle="Real RPM in Trucking: Loaded Miles, Deadhead & Expenses | HaulTrackerPro"
      seoDescription="Understand real rate per mile in trucking. Learn how loaded miles, deadhead, and operating costs change your true RPM."
      pageTitle="Real RPM in Trucking"
      intro="Real RPM is the rate per mile you actually earn after deadhead and operating costs. It is the single best number to compare loads, brokers, and lanes."
      sections={[
        {
          heading: 'Broker rate vs. real RPM',
          body: 'The broker rate divides pay by loaded miles. Real RPM divides net pay by total miles driven, including deadhead. Two loads with the same broker rate can have very different real RPM.',
        },
        {
          heading: 'Loaded miles vs. total miles',
          bullets: [
            'Loaded miles: miles run under load',
            'Deadhead miles: miles to get to the pickup',
            'Total miles: loaded + deadhead',
            'Real RPM uses total miles in the denominator',
          ],
        },
        {
          heading: 'Deadhead impact',
          body: 'Every deadhead mile costs fuel and wear with no pay. A 200-mile deadhead on a 500-mile loaded run drops real RPM significantly, even on a strong broker rate.',
        },
        {
          heading: 'Fuel and operating costs',
          body: 'Subtract estimated fuel, tolls, parking, and per-mile operating costs from the rate to get net pay. Divide by total miles to get net RPM — your real number.',
        },
        {
          heading: 'How HaulTrackerPro tracks real RPM',
          body: 'HaulTrackerPro calculates real RPM on every logged load and tracks it across lanes, brokers, and weeks. You can see which routes consistently pay and which ones drain the truck.',
        },
      ]}
      ctas={[
        { label: 'Track Your Real RPM', to: '/auth' },
        { label: 'View Pricing', to: '/pricing', variant: 'outline' },
      ]}
      related={[
        { to: '/resources/load-profit-calculator', title: 'Load Profit Calculator Guide' },
        { to: '/resources/truck-driver-profit-tracking', title: 'Truck Driver Profit Tracking' },
        { to: '/trucking-cost-per-mile', title: 'Trucking Cost Per Mile' },
      ]}
    />
  );
}
