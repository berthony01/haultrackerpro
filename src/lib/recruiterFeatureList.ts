import {
  Building2, Briefcase, Users, ShieldCheck, BarChart3, FileSignature,
  CreditCard, FileText, Sparkles, AlertCircle, Mail, ClipboardList, Eye, Share2,
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
    category: 'Recruiter Profile & Trust',
    features: [
      { icon: Building2, title: 'Recruiter Profile', description: 'Provide your company name, DOT and/or MC number, address, recruiter email, and contact info. A complete, active recruiter profile with current posting terms accepted unlocks standard posting — no admin approval or paid plan required.' },
      { icon: ShieldCheck, title: 'Verified Recruiter Badge Review', description: 'A separate trust-display process. HaulTrackerPro reviews eligible recruiter profiles for the Verified Recruiter badge on driver listings. Pending or rejected badge review does not by itself disable standard posting.' },
      { icon: AlertCircle, title: 'Status Visibility', description: 'See your profile eligibility state and badge review status at a glance — plus any reviewer notes.' },
    ],
  },
  {
    category: 'Post Structured Opportunities',
    features: [
      { icon: Briefcase, title: 'Structured Opportunity Form', description: 'Capture pay model, CPM/percentage/flat, deductions, deadhead, escrow, home time, equipment, and bonuses in a clear schema drivers actually understand.' },
      { icon: ClipboardList, title: 'Opportunity Manager', description: 'Edit, pause, close, or resubmit your opportunities. See active vs draft vs closed status at a glance.' },
      { icon: Eye, title: 'View Counts', description: 'See how many drivers have viewed each opportunity so you know what is resonating.' },
      { icon: ShieldCheck, title: 'Active Opportunity Limits by Plan', description: 'Recruiter Standard includes 1 active opportunity with unlimited drafts. Starter includes 5 active opportunities, Growth includes 15, and Fleet includes 25 active opportunities for existing or included Fleet access — new standalone Fleet checkout is unavailable. Drafts are always unlimited; only active listings count toward your plan limit.' },
    ],
  },
  {
    category: 'Applicant Pipeline',
    features: [
      { icon: Users, title: 'Driver Requests Dashboard', description: 'Every driver application appears in your pipeline with the driver’s submitted profile details and message. Phone and email are revealed only after the driver approves a separate contact request.' },
      { icon: ClipboardList, title: 'Status Workflow', description: 'Move applicants through the recruiter-controlled stages available in the dashboard. Hired status remains protected by the contract-approval workflow and cannot be set directly before the required driver decision.' },
      { icon: Mail, title: 'Driver Contact Snapshot', description: 'Review the driver’s available profile details in the application pipeline. Private phone and email details appear only after the driver approves your contact request.' },
      { icon: BarChart3, title: 'Response & Conversion Stats', description: 'View Total Applicants, Open Applicants, Hired Drivers, and Hire Rate on the Recruiter Dashboard.' },
    ],
  },
  {
    category: 'Contract Protection',
    features: [
      { icon: FileText, title: 'Recruiter Contract Management (Growth & Fleet)', description: 'The recruiter contract-management dashboard and contract upload/management interface let Growth and Fleet recruiters attach the contract you want a driver to sign directly to an application — PDF or image.' },
      { icon: Sparkles, title: 'AI-Assisted Contract Risk Review (Growth & Fleet)', description: 'HaulTrackerPro extracts key contract details and surfaces plain-English risk flags for the driver on Growth and Fleet recruiter plans. Informational only, not legal advice.' },
      { icon: FileSignature, title: 'Driver Review, Decision & In-App Signature (Universal)', description: 'Every driver can view the contract sent by a recruiter, approve, request changes to, reject, or record an optional in-app signature. Available on every driver plan.' },
      { icon: ShieldCheck, title: 'Hired-Status Workflow Protection (Universal)', description: "Recruiters can't mark a driver hired until the driver approves the current contract. If the driver also signs, HaulTrackerPro stores an in-app signature record. This driver protection is universal and does not depend on the recruiter's paid plan." },
    ],
  },
  {
    category: 'Driver-to-Driver Referrals',
    features: [
      { icon: Share2, title: 'Referral Progress Tracking', description: 'Drivers can refer other drivers to your opportunities. You see each referral in your pipeline and can move it through new, contacted, interviewed, hired, closed, or marked paid externally.' },
      { icon: ClipboardList, title: 'External Referral Terms', description: 'Set your own referral terms — bonus amount, when a bonus may be paid externally, and conditions — directly on your recruiter profile so referring drivers see what you offer up front.' },
      { icon: BarChart3, title: 'Referral Analytics', description: 'See referral volume, hire rate, and top referring drivers across your opportunities so you can lean into what works.' },
      { icon: AlertCircle, title: 'Paid Externally by Recruiter', description: 'HaulTrackerPro tracks referral progress only. Referral bonuses, if offered, are paid externally by you according to your terms — HaulTrackerPro does not process, hold, or guarantee referral payments.' },
    ],
  },
  {
    category: 'Billing & Account',
    features: [
      { icon: CreditCard, title: 'Stripe-Powered Subscriptions', description: 'Starter and Growth standalone recruiter subscriptions are available through Stripe, billed monthly. Fleet remains preview-only for new standalone subscriptions. No card data ever touches HaulTrackerPro.' },
      { icon: CreditCard, title: 'In-App Billing Portal', description: 'Open Stripe’s secure customer portal from Recruiter Settings to manage the billing details and subscription actions currently enabled for your account. Available options and timing are controlled by the Stripe portal configuration.' },
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
