/**
 * Phase 18E — 12-Week SEO/AEO Content Calendar
 *
 * Pure planning data. No DB writes, no public exposure.
 * Consumed only by the admin-only ContentCalendarAdmin page.
 */

export type CalendarCluster =
  | 'profit' | 'rpm' | 'fuel' | 'expenses' | 'taxes' | 'bookkeeping'
  | 'deadhead' | 'load_selection' | 'contracts' | 'spreadsheets' | 'quickbooks';

export type SearchIntent =
  | 'informational' | 'educational' | 'practical' | 'comparison'
  | 'buyer-aware' | 'buyer-intent' | 'tax-organization' | 'brand-conversion'
  | 'reporting' | 'checklist';

export type Priority = 'high' | 'medium' | 'low';

export interface PlannedArticle {
  id: string;
  week: number;
  recommended_publish_day: 'Tuesday' | 'Thursday';
  topic_cluster: CalendarCluster;
  title: string;
  slug: string;
  primary_keyword: string;
  secondary_keywords: string[];
  target_audience: string[];
  search_intent: SearchIntent;
  content_angle: string;
  outline_sections: string[];
  suggested_faqs: string[];
  suggested_internal_links: { label: string; path: string }[];
  recommended_cta: string;
  disclaimer_required: boolean;
  priority: Priority;
  status_label: 'planned';
}

// Curated set of internal link paths (existing public pages only)
const L = {
  resources: { label: 'Trucking resources hub', path: '/resources' },
  features: { label: 'Haul Tracker Pro features', path: '/features' },
  pricing: { label: 'Pricing', path: '/pricing' },
  about: { label: 'About Haul Tracker Pro', path: '/about' },
  vsSheets: { label: 'Haul Tracker Pro vs spreadsheets', path: '/haultrackerpro-vs-spreadsheets' },
  vsQb: { label: 'Haul Tracker Pro vs QuickBooks', path: '/haultrackerpro-vs-quickbooks' },
  bestTracker: { label: 'Best truck driver profit tracker', path: '/best-truck-driver-profit-tracker' },
  profitCalc: { label: 'Trucking profit calculator', path: '/trucking-profit-calculator' },
  expenseTracker: { label: 'Owner-operator expense tracker', path: '/owner-operator-expense-tracker' },
  taxDeductions: { label: 'Truck driver tax deductions', path: '/truck-driver-tax-deductions' },
  costPerMile: { label: 'Trucking cost per mile', path: '/trucking-cost-per-mile' },
  bookkeeping: { label: 'Trucker bookkeeping guide', path: '/trucker-bookkeeping-guide' },
  profitGuide: { label: 'Truck driver profit tracking guide', path: '/resources/truck-driver-profit-tracking' },
  loadCalc: { label: 'Load profit calculator guide', path: '/resources/load-profit-calculator' },
  realRpm: { label: 'Real RPM guide', path: '/resources/real-rpm-trucking' },
  tenNineNine: { label: '1099 truck driver expenses guide', path: '/resources/1099-truck-driver-expenses' },
  contractClarity: { label: 'Trucking contract clarity', path: '/resources/trucking-contract-clarity' },
} as const;

export const CONTENT_CALENDAR: PlannedArticle[] = [
  // ---------- Week 1 — profit fundamentals ----------
  {
    id: 'w01-a01',
    week: 1,
    recommended_publish_day: 'Tuesday',
    topic_cluster: 'profit',
    title: 'How to Calculate Real Profit on a Trucking Load',
    slug: 'how-to-calculate-real-profit-trucking-load',
    primary_keyword: 'how to calculate trucking load profit',
    secondary_keywords: ['trucking load profit formula', 'real profit per load', 'net pay per load'],
    target_audience: ['owner-operators', 'lease drivers', '1099 truck drivers'],
    search_intent: 'buyer-aware',
    content_angle: 'Walk a driver through gross pay, deadhead, fuel, and variable costs to expose the real take-home per load.',
    outline_sections: [
      'What "real profit" means on a load',
      'Gross pay vs net pay',
      'Subtracting fuel and deadhead miles',
      'Variable vs fixed costs',
      'Worked example with simple numbers',
      'Common mistakes drivers make',
    ],
    suggested_faqs: [
      'How is real profit different from gross pay?',
      'Do I need to include deadhead miles?',
      'How often should I review load profit?',
    ],
    suggested_internal_links: [L.profitGuide, L.profitCalc, L.features],
    recommended_cta: 'Start Tracking Free',
    disclaimer_required: false,
    priority: 'high',
    status_label: 'planned',
  },
  {
    id: 'w01-a02',
    week: 1,
    recommended_publish_day: 'Thursday',
    topic_cluster: 'profit',
    title: 'Why Gross Pay Is Not Real Profit for Truck Drivers',
    slug: 'gross-pay-vs-real-profit-truck-drivers',
    primary_keyword: 'gross pay vs net profit trucking',
    secondary_keywords: ['trucker net pay', 'gross vs net trucking', 'real take-home pay trucking'],
    target_audience: ['truck drivers tracking loads manually'],
    search_intent: 'educational',
    content_angle: 'Show why a $3,000 load is rarely $3,000 of profit and what hidden costs eat into it.',
    outline_sections: [
      'The gross pay illusion',
      'Hidden costs in every load',
      'Why spreadsheets often miss the gap',
      'How to start measuring real profit',
    ],
    suggested_faqs: [
      'What costs reduce my real profit?',
      'Is gross pay useful at all?',
      'How do I track net pay simply?',
    ],
    suggested_internal_links: [L.profitGuide, L.vsSheets, L.features],
    recommended_cta: 'Try Haul Tracker Pro Free',
    disclaimer_required: false,
    priority: 'high',
    status_label: 'planned',
  },

  // ---------- Week 2 — RPM ----------
  {
    id: 'w02-a03',
    week: 2,
    recommended_publish_day: 'Tuesday',
    topic_cluster: 'rpm',
    title: 'What Is RPM in Trucking and Why It Matters',
    slug: 'what-is-rpm-in-trucking',
    primary_keyword: 'what is rpm in trucking',
    secondary_keywords: ['rate per mile trucking', 'rpm trucking explained', 'trucking rpm meaning'],
    target_audience: ['new owner-operators', 'lease drivers'],
    search_intent: 'informational',
    content_angle: 'Beginner-friendly explanation of rate-per-mile, how it is quoted, and what it actually represents.',
    outline_sections: [
      'Definition of RPM',
      'How brokers quote RPM',
      'RPM vs flat rate loads',
      'Why RPM alone is not enough',
    ],
    suggested_faqs: [
      'What is a good RPM in trucking?',
      'Does RPM include deadhead?',
      'Is higher RPM always better?',
    ],
    suggested_internal_links: [L.realRpm, L.profitCalc, L.features],
    recommended_cta: 'Use the trucking profit calculator',
    disclaimer_required: false,
    priority: 'high',
    status_label: 'planned',
  },
  {
    id: 'w02-a04',
    week: 2,
    recommended_publish_day: 'Thursday',
    topic_cluster: 'rpm',
    title: 'Effective RPM vs Net RPM: What Truck Drivers Should Know',
    slug: 'effective-rpm-vs-net-rpm-trucking',
    primary_keyword: 'effective rpm vs net rpm trucking',
    secondary_keywords: ['effective rate per mile', 'net rpm trucking', 'true rpm calculation'],
    target_audience: ['owner-operators', 'lease drivers'],
    search_intent: 'educational',
    content_angle: 'Differentiate quoted RPM, effective RPM (including deadhead), and net RPM (after costs).',
    outline_sections: [
      'Quoted RPM',
      'Effective RPM with deadhead',
      'Net RPM after costs',
      'Worked example',
    ],
    suggested_faqs: [
      'How do I calculate effective RPM?',
      'What costs go into net RPM?',
      'Why does net RPM matter more than gross?',
    ],
    suggested_internal_links: [L.realRpm, L.costPerMile, L.profitGuide],
    recommended_cta: 'Explore Real RPM resources',
    disclaimer_required: false,
    priority: 'high',
    status_label: 'planned',
  },

  // ---------- Week 3 — Deadhead ----------
  {
    id: 'w03-a05',
    week: 3,
    recommended_publish_day: 'Tuesday',
    topic_cluster: 'deadhead',
    title: 'How Deadhead Miles Affect Truck Driver Profit',
    slug: 'how-deadhead-miles-affect-truck-driver-profit',
    primary_keyword: 'deadhead miles trucking profit',
    secondary_keywords: ['unpaid miles trucking', 'deadhead impact on rpm', 'deadhead cost per mile'],
    target_audience: ['drivers taking loads with unpaid deadhead'],
    search_intent: 'educational',
    content_angle: 'Quantify how unpaid miles silently reduce real RPM and load profit.',
    outline_sections: [
      'What deadhead actually costs',
      'Effective RPM with deadhead',
      'When deadhead is worth it',
      'How to track deadhead easily',
    ],
    suggested_faqs: [
      'Is deadhead always bad?',
      'What deadhead percentage is acceptable?',
      'Do brokers ever pay for deadhead?',
    ],
    suggested_internal_links: [L.realRpm, L.profitCalc, L.features],
    recommended_cta: 'Track deadhead miles in Haul Tracker Pro',
    disclaimer_required: false,
    priority: 'medium',
    status_label: 'planned',
  },
  {
    id: 'w03-a06',
    week: 3,
    recommended_publish_day: 'Thursday',
    topic_cluster: 'deadhead',
    title: 'Loaded Miles vs Deadhead Miles: Simple Guide for Truck Drivers',
    slug: 'loaded-miles-vs-deadhead-miles',
    primary_keyword: 'loaded miles vs deadhead miles',
    secondary_keywords: ['loaded vs empty miles', 'paid vs unpaid miles trucking'],
    target_audience: ['truck drivers learning rate-per-mile math'],
    search_intent: 'informational',
    content_angle: 'Plain-English explanation of loaded vs deadhead miles with examples.',
    outline_sections: [
      'Definitions and examples',
      'Why brokers quote loaded miles',
      'Total miles vs paid miles',
      'How to log both on every load',
    ],
    suggested_faqs: [
      'Are loaded miles always paid?',
      'How do I record deadhead consistently?',
      'What is a healthy deadhead ratio?',
    ],
    suggested_internal_links: [L.profitGuide, L.profitCalc, L.features],
    recommended_cta: 'Start tracking real miles',
    disclaimer_required: false,
    priority: 'medium',
    status_label: 'planned',
  },

  // ---------- Week 4 — Fuel ----------
  {
    id: 'w04-a07',
    week: 4,
    recommended_publish_day: 'Tuesday',
    topic_cluster: 'fuel',
    title: 'How to Track Fuel Cost Per Load',
    slug: 'how-to-track-fuel-cost-per-load',
    primary_keyword: 'fuel cost per load trucking',
    secondary_keywords: ['fuel per load calculator', 'trucking fuel tracking', 'mpg per load'],
    target_audience: ['owner-operators', 'lease drivers'],
    search_intent: 'practical',
    content_angle: 'A simple workflow for attributing fuel cost to a specific load using MPG and total miles.',
    outline_sections: [
      'Why per-load fuel matters',
      'MPG and total miles method',
      'Tracking diesel price changes',
      'Connecting fuel to load profit',
    ],
    suggested_faqs: [
      'How do I estimate fuel cost before a load?',
      'What MPG should I use?',
      'How can I lower fuel cost per load?',
    ],
    suggested_internal_links: [L.features, L.profitGuide, L.costPerMile],
    recommended_cta: 'Track fuel and expenses',
    disclaimer_required: false,
    priority: 'high',
    status_label: 'planned',
  },
  {
    id: 'w04-a08',
    week: 4,
    recommended_publish_day: 'Thursday',
    topic_cluster: 'fuel',
    title: 'Why Fuel Receipts Matter for 1099 Truck Drivers',
    slug: 'why-fuel-receipts-matter-1099-truck-drivers',
    primary_keyword: 'fuel receipts 1099 truck drivers',
    secondary_keywords: ['1099 driver fuel records', 'fuel receipts trucking taxes'],
    target_audience: ['1099 truck drivers'],
    search_intent: 'tax-organization',
    content_angle: 'How keeping fuel receipts supports clear records at tax time without claiming tax expertise.',
    outline_sections: [
      'Why receipts matter for 1099 drivers',
      'Paper vs digital receipts',
      'Organizing receipts by week',
      'When to share records with your tax pro',
    ],
    suggested_faqs: [
      'Do I need every fuel receipt?',
      'How long should I keep receipts?',
      'Can a CPA work from a fuel log?',
    ],
    suggested_internal_links: [L.tenNineNine, L.taxDeductions, L.expenseTracker],
    recommended_cta: 'Organize trucking records',
    disclaimer_required: true,
    priority: 'medium',
    status_label: 'planned',
  },

  // ---------- Week 5 — Expenses ----------
  {
    id: 'w05-a09',
    week: 5,
    recommended_publish_day: 'Tuesday',
    topic_cluster: 'expenses',
    title: 'Trucking Expenses Owner-Operators Should Track',
    slug: 'trucking-expenses-owner-operators-should-track',
    primary_keyword: 'trucking expenses owner operators should track',
    secondary_keywords: ['owner operator expenses list', 'trucking business expenses'],
    target_audience: ['owner-operators'],
    search_intent: 'educational',
    content_angle: 'Comprehensive list of fixed and variable expenses owner-operators should record consistently.',
    outline_sections: [
      'Fixed expenses',
      'Variable expenses',
      'Per-mile expenses',
      'How to categorize cleanly',
    ],
    suggested_faqs: [
      'What is the difference between fixed and variable expenses?',
      'Should I track per-diem?',
      'How often should I review expenses?',
    ],
    suggested_internal_links: [L.expenseTracker, L.costPerMile, L.features],
    recommended_cta: 'Track trucking expenses',
    disclaimer_required: false,
    priority: 'high',
    status_label: 'planned',
  },
  {
    id: 'w05-a10',
    week: 5,
    recommended_publish_day: 'Thursday',
    topic_cluster: 'expenses',
    title: '1099 Truck Driver Expense Tracking Checklist',
    slug: '1099-truck-driver-expense-tracking-checklist',
    primary_keyword: '1099 truck driver expense tracker',
    secondary_keywords: ['1099 trucking checklist', '1099 driver expense list'],
    target_audience: ['1099 truck drivers'],
    search_intent: 'checklist',
    content_angle: 'Actionable checklist 1099 drivers can use weekly to keep expense records organized.',
    outline_sections: [
      'Weekly checklist',
      'Categories that matter for 1099 drivers',
      'Common things drivers forget to track',
      'Bringing records to a tax pro',
    ],
    suggested_faqs: [
      'How is 1099 expense tracking different?',
      'What should I do weekly?',
      'Do I need an app for this?',
    ],
    suggested_internal_links: [L.tenNineNine, L.expenseTracker, L.taxDeductions],
    recommended_cta: 'View owner-operator expense tracker',
    disclaimer_required: true,
    priority: 'high',
    status_label: 'planned',
  },

  // ---------- Week 6 — Taxes ----------
  {
    id: 'w06-a11',
    week: 6,
    recommended_publish_day: 'Tuesday',
    topic_cluster: 'taxes',
    title: 'Truck Driver Tax Organization: What Records to Keep',
    slug: 'truck-driver-tax-organization-records',
    primary_keyword: 'truck driver tax records',
    secondary_keywords: ['trucking tax records list', 'records for trucking taxes'],
    target_audience: ['1099 truck drivers', 'owner-operators'],
    search_intent: 'tax-organization',
    content_angle: 'Practical record-keeping guidance with clear "not tax advice" framing.',
    outline_sections: [
      'Why organization matters before tax time',
      'Records to keep',
      'How long to keep records',
      'Working with a tax pro',
    ],
    suggested_faqs: [
      'How long should I keep trucking records?',
      'Do digital records count?',
      'When should I get a CPA?',
    ],
    suggested_internal_links: [L.taxDeductions, L.tenNineNine, L.bookkeeping],
    recommended_cta: 'Explore tax deduction resources',
    disclaimer_required: true,
    priority: 'high',
    status_label: 'planned',
  },
  {
    id: 'w06-a12',
    week: 6,
    recommended_publish_day: 'Thursday',
    topic_cluster: 'taxes',
    title: 'Truck Driver Tax Deductions: What to Track Before Tax Time',
    slug: 'truck-driver-tax-deductions-what-to-track',
    primary_keyword: 'truck driver tax deductions tracker',
    secondary_keywords: ['trucking deductions list', 'common trucker deductions'],
    target_audience: ['1099 truck drivers'],
    search_intent: 'buyer-aware',
    content_angle: 'Categories drivers commonly discuss with their tax professional, framed as record-keeping (not advice).',
    outline_sections: [
      'Common deduction categories',
      'What records support each category',
      'How an app can help organize them',
      'What only a CPA can confirm',
    ],
    suggested_faqs: [
      'Are these deductions guaranteed?',
      'What counts as a business expense?',
      'Does Haul Tracker Pro file taxes?',
    ],
    suggested_internal_links: [L.taxDeductions, L.tenNineNine, L.expenseTracker],
    recommended_cta: 'Track expenses for tax organization',
    disclaimer_required: true,
    priority: 'high',
    status_label: 'planned',
  },

  // ---------- Week 7 — Load selection ----------
  {
    id: 'w07-a13',
    week: 7,
    recommended_publish_day: 'Tuesday',
    topic_cluster: 'load_selection',
    title: 'Is This Load Worth Taking? A Simple Profit Checklist',
    slug: 'is-this-load-worth-taking-profit-checklist',
    primary_keyword: 'is this load worth taking trucking',
    secondary_keywords: ['accept or reject load trucking', 'load profit checklist'],
    target_audience: ['owner-operators', 'lease drivers'],
    search_intent: 'buyer-intent',
    content_angle: 'A quick pre-acceptance checklist drivers can run in under a minute.',
    outline_sections: [
      'Five questions before saying yes',
      'Quick fuel and deadhead math',
      'When to walk away',
      'Using a tool to confirm',
    ],
    suggested_faqs: [
      'How quickly can I evaluate a load?',
      'What numbers really matter?',
      'How does Haul Tracker Pro help?',
    ],
    suggested_internal_links: [L.loadCalc, L.profitCalc, L.features],
    recommended_cta: 'Use Haul Tracker Pro before accepting loads',
    disclaimer_required: false,
    priority: 'high',
    status_label: 'planned',
  },
  {
    id: 'w07-a14',
    week: 7,
    recommended_publish_day: 'Thursday',
    topic_cluster: 'load_selection',
    title: 'Bad Loads Can Look Good: How to Check the Real Numbers',
    slug: 'bad-loads-can-look-good-real-numbers',
    primary_keyword: 'bad trucking loads profit',
    secondary_keywords: ['avoid bad loads trucking', 'load looks good but bad'],
    target_audience: ['truck drivers comparing loads'],
    search_intent: 'educational',
    content_angle: 'Common patterns where a load looks profitable on paper but loses money in practice.',
    outline_sections: [
      'High RPM, hidden deadhead',
      'Long detention loads',
      'Slow-pay brokers',
      'Out-of-lane backhauls',
    ],
    suggested_faqs: [
      'How do I spot a bad load?',
      'What is "effective rate"?',
      'Are high-RPM loads always good?',
    ],
    suggested_internal_links: [L.loadCalc, L.profitGuide, L.features],
    recommended_cta: 'Check real profit before and after every load',
    disclaimer_required: false,
    priority: 'medium',
    status_label: 'planned',
  },

  // ---------- Week 8 — Spreadsheets ----------
  {
    id: 'w08-a15',
    week: 8,
    recommended_publish_day: 'Tuesday',
    topic_cluster: 'spreadsheets',
    title: 'Trucking Spreadsheet Mistakes That Can Hide Real Profit',
    slug: 'trucking-spreadsheet-mistakes-hide-profit',
    primary_keyword: 'trucking spreadsheet mistakes',
    secondary_keywords: ['trucking excel mistakes', 'driver spreadsheet errors'],
    target_audience: ['drivers using spreadsheets'],
    search_intent: 'buyer-aware',
    content_angle: 'Common spreadsheet pitfalls that quietly distort RPM and profit numbers.',
    outline_sections: [
      'Missing deadhead column',
      'Incorrect fuel allocation',
      'No category for variable vs fixed',
      'Manual entry fatigue',
    ],
    suggested_faqs: [
      'Are spreadsheets bad for trucking?',
      'When should I switch tools?',
      'Can I migrate my data?',
    ],
    suggested_internal_links: [L.vsSheets, L.features, L.profitGuide],
    recommended_cta: 'Compare Haul Tracker Pro vs spreadsheets',
    disclaimer_required: false,
    priority: 'medium',
    status_label: 'planned',
  },
  {
    id: 'w08-a16',
    week: 8,
    recommended_publish_day: 'Thursday',
    topic_cluster: 'spreadsheets',
    title: 'Spreadsheet vs Trucking Profit Tracker: Which Should Drivers Use?',
    slug: 'spreadsheet-vs-trucking-profit-tracker',
    primary_keyword: 'spreadsheet vs trucking profit tracker',
    secondary_keywords: ['excel vs trucking app', 'spreadsheet alternatives trucking'],
    target_audience: ['drivers comparing tools'],
    search_intent: 'comparison',
    content_angle: 'Side-by-side comparison of when a spreadsheet is enough and when a dedicated tool helps.',
    outline_sections: [
      'Pros of spreadsheets',
      'Cons at scale',
      'What a profit tracker adds',
      'How to choose',
    ],
    suggested_faqs: [
      'Is a spreadsheet ever enough?',
      'What do I lose with a spreadsheet?',
      'Does Haul Tracker Pro replace Excel?',
    ],
    suggested_internal_links: [L.vsSheets, L.bestTracker, L.features],
    recommended_cta: 'Read Haul Tracker Pro vs spreadsheets',
    disclaimer_required: false,
    priority: 'medium',
    status_label: 'planned',
  },

  // ---------- Week 9 — QuickBooks / Bookkeeping ----------
  {
    id: 'w09-a17',
    week: 9,
    recommended_publish_day: 'Tuesday',
    topic_cluster: 'quickbooks',
    title: 'QuickBooks for Truck Drivers: When It Helps and When It May Not Be Enough',
    slug: 'quickbooks-for-truck-drivers',
    primary_keyword: 'quickbooks for truck drivers',
    secondary_keywords: ['quickbooks trucking', 'trucking accounting software'],
    target_audience: ['drivers comparing bookkeeping tools'],
    search_intent: 'comparison',
    content_angle: 'Where QuickBooks shines for bookkeeping, and where trucking-specific load profit gaps appear.',
    outline_sections: [
      'What QuickBooks does well',
      'What it does not solve for drivers',
      'Pairing bookkeeping with load tracking',
      'A simple workflow',
    ],
    suggested_faqs: [
      'Is QuickBooks worth it for one truck?',
      'Can I use both?',
      'Does Haul Tracker Pro replace QuickBooks?',
    ],
    suggested_internal_links: [L.vsQb, L.bookkeeping, L.features],
    recommended_cta: 'Compare Haul Tracker Pro vs QuickBooks',
    disclaimer_required: true,
    priority: 'high',
    status_label: 'planned',
  },
  {
    id: 'w09-a18',
    week: 9,
    recommended_publish_day: 'Thursday',
    topic_cluster: 'bookkeeping',
    title: 'Trucking Bookkeeping vs Load Profit Tracking',
    slug: 'trucking-bookkeeping-vs-load-profit-tracking',
    primary_keyword: 'trucking bookkeeping vs profit tracking',
    secondary_keywords: ['load level profit', 'bookkeeping vs profitability'],
    target_audience: ['owner-operators', '1099 drivers'],
    search_intent: 'comparison',
    content_angle: 'Bookkeeping is monthly; load profit is per-trip. Both matter.',
    outline_sections: [
      'What each one answers',
      'Why drivers need both',
      'Workflow recommendation',
      'Tools that fit each role',
    ],
    suggested_faqs: [
      'Is bookkeeping the same as profit tracking?',
      'Do I need both?',
      'Where does Haul Tracker Pro fit?',
    ],
    suggested_internal_links: [L.bookkeeping, L.vsQb, L.profitGuide],
    recommended_cta: 'Read the trucker bookkeeping guide',
    disclaimer_required: true,
    priority: 'medium',
    status_label: 'planned',
  },

  // ---------- Week 10 — Contracts ----------
  {
    id: 'w10-a19',
    week: 10,
    recommended_publish_day: 'Tuesday',
    topic_cluster: 'contracts',
    title: 'Trucking Contract Red Flags Drivers Should Watch For',
    slug: 'trucking-contract-red-flags-drivers',
    primary_keyword: 'trucking contract red flags',
    secondary_keywords: ['lease purchase red flags', 'trucking agreement warning signs'],
    target_audience: ['drivers reviewing trucking contracts'],
    search_intent: 'educational',
    content_angle: 'Plain-English overview of contract clauses worth reading carefully before signing.',
    outline_sections: [
      'Pay terms and escrow',
      'Forced dispatch and abandonment',
      'Maintenance and chargebacks',
      'Termination clauses',
    ],
    suggested_faqs: [
      'Is this legal advice?',
      'Can I negotiate a trucking contract?',
      'Where can I get help reviewing one?',
    ],
    suggested_internal_links: [L.contractClarity, L.resources, L.about],
    recommended_cta: 'Explore contract clarity resources',
    disclaimer_required: true,
    priority: 'medium',
    status_label: 'planned',
  },
  {
    id: 'w10-a20',
    week: 10,
    recommended_publish_day: 'Thursday',
    topic_cluster: 'contracts',
    title: 'Why Truck Drivers Should Review Pay Terms Before Signing',
    slug: 'truck-drivers-review-pay-terms-before-signing',
    primary_keyword: 'trucking pay terms contract',
    secondary_keywords: ['driver pay terms', 'pay schedule trucking contract'],
    target_audience: ['drivers considering contracts'],
    search_intent: 'educational',
    content_angle: 'A focused look at how pay terms (RPM, deductions, settlement timing) shape real take-home.',
    outline_sections: [
      'Pay structure basics',
      'Common deductions to expect',
      'Settlement timing',
      'Questions to ask before signing',
    ],
    suggested_faqs: [
      'Are pay terms negotiable?',
      'What deductions are normal?',
      'Should I have someone review my contract?',
    ],
    suggested_internal_links: [L.contractClarity, L.resources, L.about],
    recommended_cta: 'Use contract clarity tools',
    disclaimer_required: true,
    priority: 'medium',
    status_label: 'planned',
  },

  // ---------- Week 11 — Reporting cadence ----------
  {
    id: 'w11-a21',
    week: 11,
    recommended_publish_day: 'Tuesday',
    topic_cluster: 'profit',
    title: 'Weekly Profit Review for Truck Drivers: What to Check',
    slug: 'weekly-profit-review-truck-drivers',
    primary_keyword: 'weekly profit review truck drivers',
    secondary_keywords: ['weekly closeout trucking', 'driver weekly review'],
    target_audience: ['truck drivers trying to stay organized'],
    search_intent: 'practical',
    content_angle: '5-minute weekly review template to keep numbers honest.',
    outline_sections: [
      'Why weekly beats monthly',
      'The 5-minute weekly checklist',
      'What to do when a week looks bad',
      'Tools that make it automatic',
    ],
    suggested_faqs: [
      'When should I do a weekly review?',
      'What if I missed a week?',
      'How does Haul Tracker Pro help?',
    ],
    suggested_internal_links: [L.features, L.profitGuide, L.bestTracker],
    recommended_cta: 'Start a weekly closeout with Haul Tracker Pro',
    disclaimer_required: false,
    priority: 'medium',
    status_label: 'planned',
  },
  {
    id: 'w11-a22',
    week: 11,
    recommended_publish_day: 'Thursday',
    topic_cluster: 'profit',
    title: 'Monthly Trucking Profit Report: What Owner-Operators Should Review',
    slug: 'monthly-trucking-profit-report-owner-operators',
    primary_keyword: 'monthly trucking profit report',
    secondary_keywords: ['trucking monthly report', 'owner operator profit report'],
    target_audience: ['owner-operators'],
    search_intent: 'reporting',
    content_angle: 'A monthly report template covering revenue, costs, RPM, and trend signals.',
    outline_sections: [
      'Revenue and load count',
      'Fixed and variable cost summary',
      'RPM and deadhead trends',
      'What to change next month',
    ],
    suggested_faqs: [
      'Why review monthly if I review weekly?',
      'What should I share with my CPA?',
      'Can I export reports?',
    ],
    suggested_internal_links: [L.features, L.pricing, L.bestTracker],
    recommended_cta: 'View reports and exports',
    disclaimer_required: false,
    priority: 'medium',
    status_label: 'planned',
  },

  // ---------- Week 12 — Brand / buyer-intent ----------
  {
    id: 'w12-a23',
    week: 12,
    recommended_publish_day: 'Tuesday',
    topic_cluster: 'profit',
    title: 'Best Truck Driver Profit Tracker Features to Look For',
    slug: 'best-truck-driver-profit-tracker-features',
    primary_keyword: 'best truck driver profit tracker features',
    secondary_keywords: ['profit tracker features trucking', 'choosing a trucking app'],
    target_audience: ['drivers comparing tools'],
    search_intent: 'buyer-intent',
    content_angle: 'Buyer guide that lists features serious drivers should expect (without trashing competitors).',
    outline_sections: [
      'Per-load profit math',
      'Fuel and deadhead handling',
      'Exports and reports',
      'Ease of weekly review',
    ],
    suggested_faqs: [
      'What features matter most?',
      'Should I pay for a profit tracker?',
      'How does Haul Tracker Pro compare?',
    ],
    suggested_internal_links: [L.bestTracker, L.features, L.pricing],
    recommended_cta: 'Read Best Truck Driver Profit Tracker',
    disclaimer_required: false,
    priority: 'high',
    status_label: 'planned',
  },
  {
    id: 'w12-a24',
    week: 12,
    recommended_publish_day: 'Thursday',
    topic_cluster: 'profit',
    title: 'How Haul Tracker Pro Helps Truck Drivers See Real Profit',
    slug: 'how-haul-tracker-pro-helps-truck-drivers-see-real-profit',
    primary_keyword: 'haul tracker pro real profit',
    secondary_keywords: ['haul tracker pro features', 'haul tracker pro overview'],
    target_audience: ['brand-aware visitors'],
    search_intent: 'brand-conversion',
    content_angle: 'A grounded overview of how Haul Tracker Pro turns raw load data into clear profit numbers.',
    outline_sections: [
      'The driver problem',
      'How the app captures load data',
      'How costs roll up into real profit',
      'Reports, exports, and weekly review',
    ],
    suggested_faqs: [
      'Is there a free version?',
      'Do I need to be tech-savvy?',
      'How long does setup take?',
    ],
    suggested_internal_links: [L.features, L.pricing, L.about],
    recommended_cta: 'Start Tracking Free',
    disclaimer_required: false,
    priority: 'high',
    status_label: 'planned',
  },
];

export const CALENDAR_SUMMARY = {
  total_weeks: 12,
  total_articles: CONTENT_CALENDAR.length,
  articles_per_week: 2,
  main_clusters: Array.from(new Set(CONTENT_CALENDAR.map((a) => a.topic_cluster))),
};

/** Look up a planned calendar article by its stable id. */
export function getPlannedArticleById(id: string | null | undefined): PlannedArticle | null {
  if (!id) return null;
  return CONTENT_CALENDAR.find((a) => a.id === id) ?? null;
}

/**
 * Build a detailed AI draft prompt for a planned article.
 * The prompt is safe to paste into the Phase 18D article generator or the manual draft editor.
 * It bakes in the content safety rules (no fake stats, no guarantees, not advice).
 */
export function buildDraftPrompt(a: PlannedArticle): string {
  const lines: string[] = [];
  lines.push(`# Article Brief — ${a.title}`);
  lines.push('');
  lines.push(`Title: ${a.title}`);
  lines.push(`Slug: ${a.slug}`);
  lines.push(`Topic cluster: ${a.topic_cluster}`);
  lines.push(`Audience: ${a.target_audience.join(', ')}`);
  lines.push(`Search intent: ${a.search_intent}`);
  lines.push(`Primary keyword: ${a.primary_keyword}`);
  if (a.secondary_keywords.length) lines.push(`Secondary keywords: ${a.secondary_keywords.join(', ')}`);
  lines.push(`Content angle: ${a.content_angle}`);
  lines.push(`Recommended CTA: ${a.recommended_cta}`);
  lines.push('');
  lines.push('## Outline');
  a.outline_sections.forEach((s) => lines.push(`- ${s}`));
  lines.push('');
  lines.push('## Suggested FAQs');
  a.suggested_faqs.forEach((q) => lines.push(`- ${q}`));
  lines.push('');
  lines.push('## Suggested internal links');
  a.suggested_internal_links.forEach((l) => lines.push(`- [${l.label}](${l.path})`));
  lines.push('');
  lines.push('## Disclaimer requirements');
  lines.push(
    a.disclaimer_required
      ? 'Include a clear disclaimer: Haul Tracker Pro is not a CPA, attorney, or financial advisor. This article is educational only.'
      : 'No specific legal/tax disclaimer required, but never imply guaranteed financial outcomes.',
  );
  lines.push('');
  lines.push('## Writing requirements (mandatory)');
  lines.push('- Write the COMPLETE, publish-ready article in polished prose. Do not return an outline, template, or writing instructions.');
  lines.push('- Never output placeholder text such as "Draft this section", "add example here", "TODO", or bracketed placeholders.');
  lines.push('- Professional, polished, trucking-specific writing aimed at working drivers and carriers.');
  lines.push('- Include practical detail and worked illustrative examples where they genuinely help.');
  lines.push('- Use the primary and secondary keywords naturally, without keyword stuffing.');
  lines.push('- Follow the supplied outline and FAQs as guidance, and answer every FAQ completely.');
  lines.push('- Use only the supplied internal links, and only where they fit naturally. Do not invent internal routes.');
  lines.push('- Use the recommended CTA naturally at the end, not as a hard sell.');
  lines.push('- Include the required disclaimer when the topic is tax, legal, financial, contract, or accounting related.');
  lines.push('');
  lines.push('## Safety rules (mandatory)');
  lines.push('- Do not invent statistics, citations, quotes, studies, or sources.');
  lines.push('- Do not guarantee profit, savings, tax deductions, legal protection, or higher earnings.');
  lines.push('- Do not claim IRS, FMCSA, accounting, legal, or tax expertise.');
  lines.push('- Use safe wording: "may help", "designed to help", "can support organization".');
  lines.push('- Make the article useful even if the reader never signs up for Haul Tracker Pro.');
  lines.push('- Mention Haul Tracker Pro naturally, not as a sales pitch.');
  lines.push('- Do not copy any specific competitor\'s content.');
  return lines.join('\n');
}
