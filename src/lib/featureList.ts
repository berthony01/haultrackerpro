import { Truck, Receipt, Calculator, Route, ClipboardPaste, DollarSign, BarChart3, Sparkles, Target, TrendingUp, CalendarDays, Bell, Download, FileText, Filter, Settings, Calendar, Globe, Building2, UserCheck, Shield, DatabaseBackup, Trash2, AlertCircle, Trophy, Mic, Camera, ParkingCircle, Users, FileCheck, FileSignature, ShieldCheck } from 'lucide-react';

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
      { icon: Sparkles, title: 'Smart Multi-Stop Paste Detection', description: 'When you paste load details with numbered stops (1#:, 2#:), the system auto-detects them, toggles multi-stop mode, and pre-fills each stop location for you.' },
      { icon: DollarSign, title: 'Driver Pay Model Support', description: 'Built for every 1099 setup: owner-operators (loaded miles only), 1099 contractors (paid for total miles including empty), lease-purchase drivers (loaded + deadhead at separate rates), flat-rate loads, and manual overrides. Pick a per-load pay model or set a default in Settings — profit and effective RPM stay accurate either way.' },
    ],
  },
  {
    category: 'Contract Protection',
    features: [
      { icon: FileText, title: 'Recruiter Contract Upload', description: 'Recruiters can upload contract documents directly into the opportunity workflow.' },
      { icon: Sparkles, title: 'AI Contract Parsing', description: 'HaulTrackerPro extracts key contract details so drivers can review the information in a clearer format.' },
      { icon: AlertCircle, title: 'AI Risk Review', description: 'Drivers see plain-English risk flags and summaries for terms that may deserve closer attention. Informational only — not legal advice.' },
      { icon: FileCheck, title: 'Driver Review & Decision', description: 'Drivers can approve, reject, or request changes before moving forward.' },
      { icon: FileSignature, title: 'In-App Signature Record', description: 'Drivers can record approval with a platform signature record tied to the contract version. Not a DocuSign-equivalent or qualified electronic signature.' },
      { icon: Shield, title: 'Hired-Status Protection', description: "Recruiters can't mark a driver hired until the driver approves the current contract. If the driver also signs, HaulTrackerPro stores an in-app signature record." },
      { icon: Sparkles, title: 'Plain-English Clause Rewrite (Pro)', description: 'Driver Pro users can paste a confusing clause and get a plain-English explanation, concern points, and questions to ask the recruiter before approving. Informational only — not legal advice.', pro: true },
      { icon: ShieldCheck, title: 'Admin Moderation', description: 'HaulTrackerPro can review contract-related disputes, abuse reports, and moderation issues when needed.' },
    ],
  },
  {
    category: 'Profit Intelligence — Built To Protect Your Money (Pro)',
    features: [
      { icon: Target, title: 'Score A Load Before You Take It', description: 'Paste a load and get a quick read on whether the rate, miles, deadhead, and broker actually pencil out — scored against your own lane and operating history, not a generic average. Available right inside the load form before you commit.', pro: true },
      { icon: BarChart3, title: 'See Your Best & Worst Lanes', description: 'Dashboard cards show which lanes pay you the most, which ones quietly lose money, which brokers pay reliably, and where your margin is leaking — automatically computed from your own load history. No setup.', pro: true },
      { icon: AlertCircle, title: 'Get Warned Before Money Slips', description: 'Plain-language alerts when a lane goes weak, a broker pays slow, your margin or deadhead drifts the wrong way, or an invoice is aging unpaid — plus a weekly closeout summary of lanes to repeat, lanes to avoid, and brokers to watch.', pro: true },
      { icon: CalendarDays, title: 'A Clear Read On Your Week', description: 'Every Monday and Tuesday, a single dashboard card recaps last week: the top lane to repeat, the lane to avoid, and the broker to watch — so this week starts with a plan instead of a guess. Dismissable per ISO week.', pro: true },
    ],
  },
  {
    category: 'AI & OCR Automation (Pro)',
    features: [
      { icon: Mic, title: 'AI Voice Expense Logging', description: 'Dictate expenses hands-free and let AI parse the amount, category, and notes automatically.', pro: true },
      { icon: Camera, title: 'Receipt & Screenshot OCR Scanning', description: 'Snap a photo of a receipt or screenshot and auto-extract expense details using OCR text extraction.', pro: true },
      { icon: Camera, title: 'AI Rate Con Parsing', description: 'Upload a screenshot of your rate con and AI extracts pickup, dropoff, miles, rate, and multi-stop details automatically.', pro: true },
      { icon: ClipboardPaste, title: 'Paste Load Parser (Unlimited)', description: 'Unlimited paste-to-form load parsing with no weekly cap.', pro: true },
      { icon: Sparkles, title: 'AI Weekly Business Report', description: 'AI-generated narrative summary of your week — highlights best/worst loads, deadhead issues, and actionable recommendations.', pro: true },
      { icon: Target, title: 'AI Lane Advice', description: 'AI analyzes your load history and recommends your most profitable lanes with optimization tips.', pro: true },
      { icon: Calculator, title: 'AI Tax Optimization Tips', description: 'AI-generated quarterly tax tips based on your expense patterns to help maximize deductions.', pro: true },
      { icon: Route, title: 'Deadhead Mile Parsing', description: 'Paste loads with deadhead miles and the parser separates them from line-haul miles automatically. Choose how deadhead is paid in the load form before saving.', pro: true },
    ],
  },
  {
    category: 'Driver Community & Parking (Pro)',
    features: [
      { icon: ParkingCircle, title: 'Real-Time Parking Finder', description: 'Find safe truck parking with live availability reports from other drivers. See verified open spots, limited spots, full lots, and safety ratings near you — updated by the community in real time.', pro: true },
      { icon: AlertCircle, title: 'Report & Verify Spots', description: 'Tap any lot to report status (available / limited / full) and rate safety 1–5. One report per lot per hour keeps the data fresh and trustworthy.', pro: true },
      { icon: Trophy, title: 'Driver Points & Leaderboard', description: 'Earn 5 points for every verified parking report, build daily streaks, and climb the driver leaderboard. Help fellow truckers and get recognized for it.', pro: true },
      { icon: Download, title: 'Parking Log Export (CSV + PDF)', description: 'Export your logged parking stops weekly or monthly to submit with load paperwork or share with your dispatcher.', pro: true },
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
      { icon: DatabaseBackup, title: 'Full Data Export', description: 'Download all your core account and operational data as a single JSON file for backup or migration. Includes 15 datasets; derived analytics are excluded because they regenerate from your raw data.' },
      { icon: Filter, title: 'Date Range Filtering', description: 'Filter all reports and views by custom date ranges — weekly, monthly, quarterly, or custom.' },
    ],
  },
  {
    category: 'Settlement Statements & Reconciliation',
    features: [
      { icon: FileText, title: 'View Finalized Settlement Statements', description: 'Carriers and agencies you have an accepted relationship with can issue you a finalized settlement statement. You can open the statement, its line items, and its reported net on every driver plan — Free and Pro.' },
      { icon: FileCheck, title: 'Basic Reconciliation (Free)', description: 'Confirm or clear the load match on a settlement line so your own load records line up with what the company reported. Available on every driver plan.' },
      { icon: Sparkles, title: 'Advanced Reconciliation (Pro)', description: 'Driver Pro adds refreshing and rejecting suggested load matches so you can work through a long statement faster.', pro: true },
      { icon: ClipboardList, title: 'Manual Outside-Settlement Records (Pro)', description: 'Driver Pro can create a manual settlement record for a statement you received outside HaulTrackerPro, so your reconciliation history stays in one place.', pro: true },
      { icon: BarChart3, title: 'Line Total vs Reported Net', description: 'HaulTrackerPro shows the net implied by the visible line items next to the reported net on the statement header, so a difference is visible instead of hidden. This is a neutral comparison, not an accusation or an audit.' },
      { icon: Building2, title: 'Carrier & Agency Issuance (Paid)', description: 'Issuing carrier settlements requires a paid standalone recruiter/carrier plan. Preparing settlements inside an Agency Workspace requires an active paid agency plan.' },
      { icon: Shield, title: 'Recordkeeping Only — No Money Movement', description: 'HaulTrackerPro does not pay, hold, transfer, escrow, verify, or guarantee any settlement amount. Settlement statements are records; actual payment happens outside the platform between you and the company.' },
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
      { icon: Shield, title: 'Secure Authentication', description: 'Email-based authentication with mandatory verification and leaked-password protection — your financial data stays private and encrypted.' },
      { icon: DatabaseBackup, title: 'Full Data Export', description: 'Download all of your account and operational data as a single JSON file — profile, settings, subscription plan, loads, load stops, expenses, fuel logs, brokers, recurring expense templates, weekly snapshots, feedback, parse usage, alerts, automation logs, and AI insights (15 datasets). Derived analytics (lane, broker, and operating metrics) are excluded because they regenerate automatically from your raw data. You always own your information.' },
      { icon: Trash2, title: 'Complete Account Deletion', description: 'Permanently delete your account and all associated data across 18 tables in one click — loads, expenses, fuel logs, snapshots, AI insights, brokers, alerts, settings, subscription records, and your auth account. No hoops, no retention.' },
    ],
  },
  {
    category: 'Team & Agency Workflow',
    features: [
      { icon: Users, title: 'Driver Assistants', description: 'Direct driver invitations to a spouse, dispatcher, or back-office helper are available without a Driver Pro subscription. Access always remains driver-approved and permission-based (loads, expenses, fuel, reports, settings). Every action is logged and you can revoke access any time.' },
      { icon: Shield, title: 'Driver Control Center', description: 'One screen at /driver/assistant-control to see every person and agency with access to your account — direct invites and agency delegations — and end any access in one tap.' },
      { icon: Building2, title: 'Agency Workspace', description: 'Run a multi-driver back-office: publish service packages, accept private client requests, manage a shared work queue, and track every action in an agency audit log.' },
      { icon: UserCheck, title: 'Driver-Approved Delegation', description: 'Agencies can only act on a driver\'s account after the driver explicitly approves the delegation request — and the driver can revoke it instantly. No silent access.' },
      { icon: Bell, title: 'Waiting-on-Driver Work Items', description: 'When an agency needs driver input on a task, the driver gets an in-app notification with a one-tap response screen at /driver/work-items. No email back-and-forth.' },
      { icon: Globe, title: 'Private Agency Request Links', description: 'Each agency gets a shareable request link (haultrackerpro.com/a/your-agency) that drivers can use to ask for help. Drivers sign in to submit the request, and submitting a request does not grant any account access on its own.' },
      { icon: Bell, title: 'Assistant & Agency Notifications', description: 'In-app notifications for invites, approvals, work assignments, and waiting-on-driver events. Toggle assistant and agency channels independently in your notification preferences.' },
    ],
  },
];


export function generateFeatureMarkdown(): string {
  const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  let md = `# HaulTrackerPro — Feature Overview\n`;
  md += `Generated: ${now}\n\n`;
  md += `For drivers, recruiters, driver assistants, and back-office agencies. Driver Assistants and Agencies can use HaulTracker Pro as a side-hustle / agency workflow to manage approved driver clients. Access is always driver-approved and permission-based. HaulTracker Pro does not currently process payments between drivers and assistants or agencies, and does not guarantee income or clients.\n\n`;
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
