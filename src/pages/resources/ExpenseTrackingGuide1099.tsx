import ResourceArticle from '@/components/resources/ResourceArticle';

export default function ExpenseTrackingGuide1099() {
  return (
    <ResourceArticle
      path="/resources/1099-truck-driver-expenses"
      seoTitle="1099 Truck Driver Expense Tracking Guide | HaulTrackerPro"
      seoDescription="Learn how 1099 truck drivers can organize expenses and receipts for cleaner records and easier tax preparation."
      pageTitle="1099 Truck Driver Expense Tracking Guide"
      intro="1099 drivers are responsible for their own expense records. Good organization throughout the year makes tax preparation faster and helps you keep cleaner books."
      sections={[
        {
          heading: 'Common 1099 driver expense categories',
          bullets: [
            'Fuel and DEF',
            'Repairs and maintenance',
            'Tires and parts',
            'Parking and tolls',
            'Phone and internet used for the business',
            'Meals on the road where applicable',
          ],
        },
        {
          heading: 'Receipts and recordkeeping',
          body: 'Keep digital copies of receipts as soon as you pay. Label them by date, location, and category. Storing receipts in one place avoids the scramble at tax time and supports your records if questions come up later.',
        },
        {
          heading: 'Reports for your records or accountant',
          body: 'Pulling clean reports by category and date range makes year-end review much easier. HaulTrackerPro lets you export expense and load reports as CSV or PDF for your own records or to share with a qualified tax professional.',
        },
        {
          heading: 'How HaulTrackerPro helps',
          body: 'Log expenses by category in seconds, attach context, and review them weekly. You stay organized without spreadsheets, and you have records ready when you need them.',
        },
      ]}
      disclaimer="This information is for general organization and recordkeeping only and is not tax advice. Consult a qualified tax professional for your situation."
      ctaTitle="Organize your trucking expenses"
      ctaDescription="Keep cleaner records for your own organization and tax preparation. Not tax advice."
      ctas={[
        { label: 'Start Tracking Free', to: '/auth' },
        { label: 'View Pricing', to: '/pricing', variant: 'outline' },
      ]}
      related={[
        { to: '/resources/truck-driver-profit-tracking', title: 'Truck Driver Profit Tracking' },
        { to: '/trucking-expense-categories', title: 'Trucking Expense Categories' },
        { to: '/owner-operator-expenses-list', title: 'Owner Operator Expenses List' },
      ]}
    />
  );
}
