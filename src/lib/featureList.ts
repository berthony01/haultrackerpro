import { Truck, Receipt, Calculator, Route, ClipboardPaste, DollarSign, BarChart3, Sparkles, Target, TrendingUp, CalendarDays, Bell, Download, FileText, Filter, Settings, Calendar, Globe, Building2, UserCheck, Shield, DatabaseBackup, Trash2, AlertCircle, Trophy, Mic, Camera } from 'lucide-react';

export interface Feature {
  icon: typeof Truck;
  title: string;
  description: string;
  pro?: boolean;
}

export interface FeatureCategory {
  category: string;
  features: Feature[];
}

export const featureList: FeatureCategory[] = [
  {
    category: 'Core Tracking (Free)',
    features: [
      { icon: Truck, title: 'Load Tracking', description: 'Log every load with pickup/dropoff locations, miles, rate per mile, fees, and detailed notes.' },
      { icon: Receipt, title: 'Expense Tracking', description: 'Track fuel, maintenance, tolls, insurance, and every cost category that impacts your bottom line.' },
      { icon: Route, title: 'Multi-Stop Loads', description: 'Add multiple pickup and dropoff stops per load with detention time tracking at each stop.' },
      { icon: ClipboardPaste, title: 'Paste Load Parser (5 per week)', description: 'Paste load details from any source and auto-populate your load form — no manual entry needed. Free users get 5 parses per week.' },
      { icon: DollarSign, title: 'Estimated vs Actual Pay', description: 'Compare what you expected to earn against what you actually received to catch pay discrepancies.' },
      { icon: Calculator, title: 'Net Profit Calculation', description: 'See real net profit per load after all expenses — not just gross revenue.' },
      { icon: Route, title: 'Deadhead Awareness', description: 'Track deadhead miles and percentage to understand how empty miles impact your earnings.' },
      { icon: Sparkles, title: 'Multi-Stop Auto-Detection', description: 'Paste load details with numbered stops (1#:, 2#:) and the system auto-detects multi-stop loads, toggles multi-stop mode, and pre-fills stop locations.' },
    ],
  },
  {
    category: 'AI Automation (Pro)',
    features: [
      { icon: Mic, title: 'AI Voice Expense Logging', description: 'Dictate expenses hands-free and let AI parse the amount, category, and notes automatically.', pro: true },
      { icon: Camera, title: 'AI Receipt & Screenshot Scanning', description: 'Snap a photo of a receipt or screenshot and auto-extract expense details using OCR.', pro: true },
      { icon: Camera, title: 'AI Rate Con Parsing', description: 'Upload a screenshot of your rate con and AI extracts pickup, dropoff, miles, rate, and multi-stop details automatically.', pro: true },
      { icon: ClipboardPaste, title: 'Paste Load Parser (Unlimited)', description: 'Unlimited paste-to-form load parsing with no weekly cap.', pro: true },
      { icon: Sparkles, title: 'AI Weekly Business Report', description: 'AI-generated narrative summary of your week — highlights best/worst loads, deadhead issues, and actionable recommendations.', pro: true },
      { icon: Target, title: 'AI Lane Advice', description: 'AI analyzes your load history and recommends your most profitable lanes with optimization tips.', pro: true },
      { icon: Calculator, title: 'AI Tax Optimization Tips', description: 'AI-generated quarterly tax tips based on your expense patterns to help maximize deductions.', pro: true },
    ],
  },
  {
    category: 'Advanced Insights (Pro)',
    features: [
      { icon: TrendingUp, title: 'RPM Trend Analysis', description: 'Track your rate per mile over time to spot pricing trends and negotiate better rates.', pro: true },
      { icon: BarChart3, title: 'Deadhead % Tracking', description: 'Visualize your deadhead percentage trend to minimize empty miles and maximize efficiency.', pro: true },
      { icon: Receipt, title: 'Expense Breakdown by Category', description: 'See where your money goes with a detailed category-by-category expense breakdown chart.', pro: true },
      { icon: Trophy, title: 'Driver Performance Scorecard', description: 'Overall performance score (0–100) with tier badges, 5 metric breakdowns, and personalized coaching recommendations to improve each area.', pro: true },
      { icon: CalendarDays, title: 'Weekly Closeout Snapshots', description: 'Close out each week with a snapshot of loads, miles, revenue, and profit — plus a Week in Review that flags your best/worst loads, deadhead issues, and missing payments.', pro: true },
      { icon: AlertCircle, title: 'Smart Alerts 2.0', description: 'Advanced alerts with dollar impact for profit drops, RPM dips, and expense ratio warnings — so you see exactly how much each issue is costing you.', pro: true },
    ],
  },
  {
    category: 'Tax Planning',
    features: [
      { icon: Calculator, title: 'Basic Tax Set-Aside Estimate', description: 'See a single estimated tax owed number based on your federal and state tax rates.' },
      { icon: Calculator, title: 'Full Tax Breakdown', description: 'Detailed federal, state, and self-employment tax calculation with buffer and calculation base options.', pro: true },
      { icon: Bell, title: 'Quarterly Tax Reminders', description: 'Get dashboard reminders before IRS quarterly estimated tax due dates so you never miss a payment.', pro: true },
      { icon: Download, title: 'Tax Calendar Export (.ics)', description: 'Download a .ics calendar file with all four quarterly due dates and built-in reminder alarms.' },
    ],
  },
  {
    category: 'Dashboard & Analytics (Free)',
    features: [
      { icon: BarChart3, title: 'Profit Overview', description: 'At-a-glance financial summary showing revenue, expenses, net profit, and key metrics.' },
      { icon: Sparkles, title: 'Smart Chips', description: 'Dynamic KPI badges highlighting your top stats like best rate per mile and weekly earnings.' },
      { icon: Target, title: 'Weekly Focus Card', description: 'Actionable weekly insights showing what to focus on to improve your profitability.' },
      { icon: TrendingUp, title: 'Performance Trends', description: 'Net Profit and Revenue vs Expenses charts showing your financial trends over time.' },
    ],
  },
  {
    category: 'Reports & Exports',
    features: [
      { icon: FileText, title: 'CSV Export', description: 'Export your load and expense data as CSV files for spreadsheets or bookkeepers.' },
      { icon: FileText, title: 'PDF Reports', description: 'Generate branded, professional PDF reports with summary totals and clean formatting — ready for tax prep, bookkeepers, or dispute resolution.', pro: true },
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
      md += `### ${f.title}${f.pro ? ' (Pro)' : ''}\n${f.description}\n\n`;
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
