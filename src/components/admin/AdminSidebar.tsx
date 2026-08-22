import { Link } from 'react-router-dom';
import { Truck, BarChart3, TrendingUp, Users, ParkingCircle, Trophy, Gift, Briefcase, Building2, Shield, CreditCard, MessageSquare, Mail, FileText, Share2, BookOpen, ScrollText, Inbox, FlaskConical, LucideIcon } from 'lucide-react';

export interface AdminNavItem {
  value: string;
  label: string;
  icon: LucideIcon;
}

export const ADMIN_NAV: AdminNavItem[] = [
  { value: 'overview', label: 'Overview', icon: BarChart3 },
  { value: 'activation', label: 'Activation', icon: TrendingUp },
  { value: 'users', label: 'Users', icon: Users },
  { value: 'parking', label: 'Parking', icon: ParkingCircle },
  { value: 'drivers', label: 'Drivers', icon: Trophy },
  { value: 'leads', label: 'Starter Kit', icon: Gift },
  { value: 'opportunities', label: 'Opportunities', icon: Briefcase },
  { value: 'applications', label: 'Applications', icon: Inbox },
  { value: 'recruiters', label: 'Recruiters', icon: Building2 },
  { value: 'recruiter-leaderboard', label: 'Leaderboard', icon: Trophy },
  { value: 'referrals', label: 'Referral Oversight', icon: Share2 },
  { value: 'contracts', label: 'Contracts', icon: FileText },
  { value: 'admins', label: 'Admins', icon: Shield },
  { value: 'billing', label: 'Billing', icon: CreditCard },
  { value: 'feedback', label: 'Feedback', icon: MessageSquare },
  { value: 'emails', label: 'Emails', icon: Mail },
  { value: 'audit-logs', label: 'Audit Logs', icon: ScrollText },
];

interface AdminSidebarProps {
  value: string;
  onChange: (v: string) => void;
  role?: string;
  email?: string;
}

export function AdminSidebar({ value, onChange, role, email }: AdminSidebarProps) {
  return (
    <aside className="hidden lg:flex sticky top-0 h-screen w-64 shrink-0 flex-col gap-4 border-r border-white/5 bg-[#070B14] p-4">
      <div className="flex items-center gap-2.5 px-1 py-1">
        <div className="rounded-xl bg-gradient-to-br from-primary to-primary/70 p-2 shadow-[0_0_24px_-4px_hsl(var(--primary)/0.6)]">
          <Truck className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-black tracking-tight text-white">HaulTrackerPro</p>
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">Admin Console</p>
        </div>
      </div>

      <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
        <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">Signed in</p>
        <p className="mt-1 truncate text-xs font-semibold text-white/90">{email || '—'}</p>
        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary ring-1 ring-primary/30">
          {role || 'admin'}
        </span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto pr-1">
        {ADMIN_NAV.map((item) => {
          const Icon = item.icon;
          const active = value === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onChange(item.value)}
              className={[
                'group relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-all',
                active
                  ? 'bg-primary/15 text-white shadow-[inset_2px_0_0_0_hsl(var(--primary)),0_0_20px_-6px_hsl(var(--primary)/0.6)]'
                  : 'text-white/60 hover:bg-white/5 hover:text-white',
              ].join(' ')}
            >
              <Icon className={`h-4 w-4 ${active ? 'text-primary' : 'text-white/50 group-hover:text-white/80'}`} />
              <span className="font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="space-y-2">
        {role === 'super_admin' && (
          <Link
            to="/owner-qa"
            data-testid="admin-nav-owner-qa"
            className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-medium text-white/80 transition-colors hover:bg-primary/20 hover:text-white"
          >
            <FlaskConical className="h-4 w-4 text-primary" />
            Owner QA Center
          </Link>
        )}
        <Link
          to="/admin/resource-articles"
          className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-xs font-medium text-white/70 transition-colors hover:bg-white/5 hover:text-white"
        >
          <BookOpen className="h-4 w-4 text-white/50" />
          Resource Articles
        </Link>
        <Link
          to="/admin/content-calendar"
          className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-xs font-medium text-white/70 transition-colors hover:bg-white/5 hover:text-white"
        >
          <BookOpen className="h-4 w-4 text-white/50" />
          Content Calendar
        </Link>
        <div className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-[10px] text-white/40">
          v1.0 · Command Center
        </div>
      </div>
    </aside>
  );
}
