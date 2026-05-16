import { LayoutDashboard, Truck, Receipt, Fuel, FileText, Settings as SettingsIcon, BriefcaseBusiness, Handshake, Users, ClipboardList, FileSignature, BarChart3 } from 'lucide-react';
import type { UserRole } from '@/hooks/useUserRole';

interface AppSidebarProps {
  active: string;
  onNavigate: (page: string) => void;
  role: UserRole;
  roleLoading?: boolean;
}

const driverItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'loads', label: 'Loads', icon: Truck },
  { id: 'opportunities', label: 'Opportunities', icon: BriefcaseBusiness },
  { id: 'contracts', label: 'Contracts', icon: FileSignature },
  { id: 'expenses', label: 'Expenses', icon: Receipt },
  { id: 'fuel', label: 'Fuel', icon: Fuel },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

const recruiterItems = [
  { id: 'recruiter-access', label: 'Recruiter Dashboard', icon: Handshake },
  { id: 'recruiter-access:manager', label: 'Manage Opportunities', icon: ClipboardList },
  { id: 'recruiter-access:applications', label: 'Applications', icon: Users },
  { id: 'recruiter-access:reports', label: 'Reports', icon: BarChart3 },
  { id: 'contracts', label: 'Contracts', icon: FileSignature },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

export function AppSidebar({ active, onNavigate, role, roleLoading }: AppSidebarProps) {
  const items = role === 'recruiter' ? recruiterItems : driverItems;

  return (
    <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-border/60 bg-card/40 backdrop-blur-md sticky top-0 h-screen">
      <div className="flex items-center gap-3 px-5 py-5 border-b border-border/60">
        <div className="rounded-xl bg-primary p-2 shadow-primary">
          <Truck className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="leading-tight">
          <h1 className="text-base font-black tracking-tight text-foreground">
            Haul<span className="text-primary">TrackerPro</span>
          </h1>
          <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-[0.18em]">
            {roleLoading ? 'Loading…' : role === 'recruiter' ? 'Recruiter Console' : 'Load & Pay Manager'}
          </p>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Primary">
        {roleLoading ? (
          <div className="px-2 py-3 space-y-2">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="h-8 rounded-lg bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : (
          items.map(item => {
            const isActive = active === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`sidebar-link w-full text-left ${isActive ? 'active' : ''}`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })
        )}
      </nav>
      <div className="p-4 border-t border-border/60">
        <p className="text-[10px] text-muted-foreground/60 leading-snug">
          {role === 'recruiter'
            ? 'Post opportunities. Review drivers. Hire smarter.'
            : 'Track every mile. Every dollar. Every decision.'}
        </p>
      </div>
    </aside>
  );
}
