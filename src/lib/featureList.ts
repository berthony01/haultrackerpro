import { Truck, Receipt, Calculator, Route, ClipboardPaste, DollarSign, BarChart3, Sparkles, Target, TrendingUp, CalendarDays, Bell, Download, FileText, Filter, Settings, Calendar, Globe, Building2, UserCheck, Shield, DatabaseBackup, Trash2, AlertCircle, Trophy } from 'lucide-react';

export interface Feature {
  icon: typeof Truck;
  title: string;
  description: string;
}

export interface FeatureCategory {
  category: string;
  features: Feature[];
}

export const featureList: FeatureCategory[] = [
  {
    category: 'Load & Expense Management',
    features: [
      { icon: Truck, title: 'Load Tracking', description: 'Log every load with pickup/dropoff locations, miles, rate per mile, fees, and detailed notes.' },
      { icon: Receipt, title: 'Expense Tracking', description: 'Track fuel, maintenance, tolls, insurance, and every cost category that impacts your bottom line.' },
      { icon: Route, title: 'Multi-Stop Loads', description: 'Add multiple pickup and dropoff stops per load with detention time tracking at each stop.' },
      { icon: ClipboardPaste, title: 'Paste Load Parser', description: 'Paste load details from any source and auto-populate your load form — no manual entry needed.' },
      { icon: DollarSign, title: 'Estimated vs Actual Pay', description: 'Compare what you expected to earn against what you actually received to catch pay discrepancies.' },
      { icon: Calculator, title: 'Net Profit Calculation', description: 'See real net profit per load after all expenses — not just gross revenue.' },
      { icon: Route, title: 'Deadhead Awareness', description: 'Track deadhead miles and percentage to understand how empty miles impact your earnings.' },
      { icon: Sparkles, title: 'Multi-Stop Auto-Detection', description: 'Paste load details with numbered stops (1#:, 2#:) and the system auto-detects multi-stop loads, toggles multi-stop mode, and pre-fills stop locations.' },
    ],
  },
  {
    category: 'Dashboard & Analytics',
    features: [
      { icon: BarChart3, title: 'Profit Overview', description: 'At-a-glance financial summary showing revenue, expenses, net profit, and key metrics.' },
      { icon: Sparkles, title: 'Smart Chips', description: 'Dynamic KPI badges highlighting your top stats like best rate per mile and weekly earnings.' },
      { icon: Target, title: 'Weekly Focus Card', description: 'Actionable weekly insights showing what to focus on to improve your profitability.' },
      { icon: TrendingUp, title: 'Performance Trends', description: 'Charts and graphs showing your earnings, expenses, and profit trends over time.' },
      { icon: CalendarDays, title: 'Weekly Closeout', description: 'Close out each week with a snapshot of loads, miles, revenue, and profit for clean record-keeping.' },
    ],
  },
  {
    category: 'Tax Tools',
    features: [
      { icon: Calculator, title: 'Tax Set-Aside Planner', description: 'Calculate estimated quarterly tax set-asides based on your federal, state, and self-employment tax rates.' },
      { icon: Bell, title: 'Quarterly Tax Reminders', description: 'Get dashboard reminders before IRS quarterly estimated tax due dates so you never miss a payment.' },
      { icon: Download, title: 'Tax Calendar Export', description: 'Download a .ics calendar file with all four quarterly due dates and built-in reminder alarms.' },
    ],
  },
  {
    category: 'Reports & Exports',
    features: [
      { icon: FileText, title: 'CSV Export', description: 'Export your load and expense data as CSV files for spreadsheets or bookkeepers.' },
      { icon: FileText, title: 'PDF Reports', description: 'Generate professional PDF reports for tax prep, dispute resolution, or personal records.' },
      { icon: DatabaseBackup, title: 'Full Data Export', description: 'Download your complete account data as JSON for backup or migration purposes.' },
      { icon: Filter, title: 'Date Range Filtering', description: 'Filter all reports and views by custom date ranges — weekly, monthly, quarterly, or custom.' },
    ],
  },
  {
    category: 'Settings & Customization',
    features: [
      { icon: DollarSign, title: 'Pay Type Configuration', description: 'Choose between CPM (cost per mile) or percentage-based pay structures to match your carrier agreement.' },
      { icon: Calendar, title: 'Custom Week Start', description: 'Set your preferred week start day to align with your carrier or personal scheduling.' },
      { icon: Globe, title: 'Multi-Currency Support', description: 'Select your preferred currency for all financial displays and exports.' },
      { icon: Building2, title: 'Company Profile', description: 'Store your company name and start date for use in reports and exports.' },
      { icon: UserCheck, title: 'Guided Onboarding', description: 'Step-by-step setup wizard to configure your account and start tracking in under 30 seconds.' },
    ],
  },
  {
    category: 'Pro Features',
    features: [
      { icon: AlertCircle, title: 'Smart Alerts 2.0', description: 'Tiered alert system — basic alerts (negative profit, high deadhead, missing pay) are free for all users. Advanced insights (profit trends, RPM analysis, expense ratio warnings) require Pro.' },
      { icon: Trophy, title: 'Driver Scorecard', description: 'Overall performance score (0–100) with tier badges and 5 metric breakdowns: RPM, deadhead, expenses, profit trend, and logging streak.' },
    ],
  },
  {
    category: 'Account & Security',
    features: [
      { icon: Shield, title: 'Secure Authentication', description: 'Email-based authentication with encrypted data storage — your financial data stays private.' },
      { icon: DatabaseBackup, title: 'Data Export', description: 'Export all your data anytime — you always own your information.' },
      { icon: Trash2, title: 'Account Deletion', description: 'Full account and data deletion available anytime from Settings — no hoops to jump through.' },
    ],
  },
];

export function generateFeatureMarkdown(): string {
  const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  let md = `# HaulTrackerPro — Feature Overview\n`;
  md += `Generated: ${now}\n\n`;
  md += `---\n\n`;

  for (const cat of featureList) {
    md += `## ${cat.category}\n\n`;
    for (const f of cat.features) {
      md += `### ${f.title}\n${f.description}\n\n`;
    }
  }

  md += `---\n\n`;
  md += `© ${new Date().getFullYear()} HaulTrackerPro. All rights reserved.\n`;
  return md;
}

export function downloadFeatureSheet() {
  const md = generateFeatureMarkdown();
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'HaulTrackerPro-Features.md';
  a.click();
  URL.revokeObjectURL(url);
}
