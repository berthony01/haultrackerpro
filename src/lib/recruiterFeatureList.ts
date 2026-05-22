import {
  Building2, Briefcase, Users, ShieldCheck, BarChart3, FileSignature,
  CreditCard, FileText, Sparkles, AlertCircle, Mail, ClipboardList, Eye,
} from 'lucide-react';

export interface RecruiterFeature {
  icon: typeof Building2;
  title: string;
  description: string;
}

export interface RecruiterFeatureCategory {
  category: string;
  features: RecruiterFeature[];
}

export const recruiterFeatureList: RecruiterFeatureCategory[] = [
  {
    category: 'Get Verified',
    features: [
      { icon: Building2, title: 'Recruiter Profile', description: 'Submit your company name, DOT, MC, address, and recruiter contact info for admin review.' },
      { icon: ShieldCheck, title: 'Admin Verification', description: 'Every recruiter is reviewed by HaulTrackerPro before any opportunity goes live. Drivers see a verified badge on approved listings.' },
      { icon: AlertCircle, title: 'Status Visibility', description: 'See your verification state at a glance — pending, approved, needs attention, or suspended — plus any reviewer notes.' },
    ],
  },
  {
    category: 'Post Structured Opportunities',
    features: [
      { icon: Briefcase, title: 'Structured Opportunity Form', description: 'Capture pay model, CPM/percentage/flat, deductions, deadhead, escrow, home time, equipment, and bonuses in a clear schema drivers actually understand.' },
      { icon: ClipboardList, title: 'Opportunity Manager', description: 'Edit, pause, close, or resubmit your opportunities. See active vs draft vs closed status at a glance.' },
      { icon: Eye, title: 'View Counts', description: 'See how many drivers have viewed each opportunity so you know what is resonating.' },
      { icon: ShieldCheck, title: 'Unlimited Standard Posts (Verified Recruiters)', description: 'Once your recruiter profile is approved, you can post unlimited standard opportunities — no per-plan post cap. Paid plans add premium visibility and recruiting tools on top.' },
    ],
  },
  {
    category: 'Applicant Pipeline',
    features: [
      { icon: Users, title: 'Driver Requests Dashboard', description: 'Every driver who requests info on your listing lands in your pipeline with their preferences, contact info, and message.' },
      { icon: ClipboardList, title: 'Status Workflow', description: 'Move applicants through new → contacted → call scheduled → interview → offer sent → hired with a single click.' },
      { icon: Mail, title: 'Driver Contact Snapshot', description: 'Receive the driver\'s name, email, and phone at the moment they request info so you can respond on your preferred channel.' },
      { icon: BarChart3, title: 'Response & Conversion Stats', description: 'Track response rate, hires, and interview counts on the Recruiter Dashboard so you can measure what is working.' },
    ],
  },
  {
    category: 'Contract Protection',
    features: [
      { icon: FileText, title: 'Recruiter Contract Upload', description: 'Attach the contract you want a driver to sign directly to an application — PDF or image.' },
      { icon: Sparkles, title: 'AI Parsing & Risk Review', description: 'HaulTrackerPro extracts key contract details and surfaces plain-English risk flags for the driver. Informational only, not legal advice.' },
      { icon: FileSignature, title: 'Driver Approval & Signature', description: 'Drivers can approve, request changes to, reject, or sign the contract in-app. You get an audit log of every step.' },
      { icon: ShieldCheck, title: 'Hired-Status Workflow Protection (Growth & Fleet)', description: "You can't mark a driver hired until the driver approves the current contract. If the driver also signs, HaulTrackerPro stores an in-app signature record." },
    ],
  },
  {
    category: 'Billing & Account',
    features: [
      { icon: CreditCard, title: 'Stripe-Powered Subscriptions', description: 'Starter, Growth, and Fleet plans billed monthly through Stripe. No card data ever touches HaulTrackerPro.' },
      { icon: CreditCard, title: 'In-App Billing Portal', description: 'Update card, change plan, or cancel directly from Recruiter Settings — changes take effect at the end of your current period.' },
      { icon: ShieldCheck, title: 'Secure Account Controls', description: 'Email-verified authentication, password reset, and account deletion controls live in Recruiter Settings.' },
    ],
  },
  {
    category: 'Trust & Moderation',
    features: [
      { icon: ShieldCheck, title: 'Admin Oversight', description: 'HaulTrackerPro admins can review, flag, or suspend listings that mislead drivers — keeping the platform credible for both sides.' },
      { icon: AlertCircle, title: 'Transparency Requirements', description: 'Pay claims, deductions, and required fees are surfaced clearly so drivers can compare opportunities on real numbers.' },
      { icon: FileText, title: 'Audit Trail', description: 'Every contract upload, status change, AI run, decision, and signature is logged for moderation and dispute support.' },
    ],
  },
];

export function generateRecruiterFeatureMarkdown(): string {
  const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  let md = `# HaulTrackerPro — Recruiter Feature Overview\n`;
  md += `Generated: ${now}\n\n---\n\n`;
  for (const cat of recruiterFeatureList) {
    md += `## ${cat.category}\n\n`;
    for (const f of cat.features) {
      md += `### ${f.title}\n${f.description}\n\n`;
    }
  }
  md += `---\n© ${new Date().getFullYear()} HaulTrackerPro. All rights reserved.\n`;
  return md;
}

export function downloadRecruiterFeatureSheet() {
  const md = generateRecruiterFeatureMarkdown();
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'HaulTrackerPro-Recruiter-Features.md';
  a.click();
  URL.revokeObjectURL(url);
}
