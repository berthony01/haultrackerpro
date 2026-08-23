import { LayoutDashboard, Truck, Receipt, Fuel, FileText, Settings as SettingsIcon, BriefcaseBusiness, Handshake, Users, ClipboardList, FileSignature, BarChart3, ArrowLeftRight, ReceiptText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { UserRole } from '@/hooks/useUserRole';
import {
  isAssistantPageAllowed,
  type AssistantPermissions,
} from '@/lib/assistantPermissions';
import type { UserCapabilityStatus } from '@/lib/userCapabilities';
import { resolveRecruiterNavTier } from '@/lib/dashboardWorkspacePolicy';

interface AppSidebarProps {
  active: string;
  onNavigate: (page: string) => void;
  role: UserRole;
  /** Kept for backward compatibility; new callers pass workspaceLoading. */
  roleLoading?: boolean;
  workspaceLoading?: boolean;
  /** Capability-driven recruiter nav gating. When present, overrides
   *  role for recruiter item selection. */
  recruiterCapabilityStatus?: UserCapabilityStatus | null;
  recruiterOperationsAllowed?: boolean;
  /** When set, this user is acting as an assistant for a driver and nav items
   *  are filtered to the keys the driver has granted. */
  assistantPermissions?: AssistantPermissions | null;
}

type NavItem = {
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** When set, clicking this item calls react-router navigate(href) instead
   *  of onNavigate(id). Used for cross-shell destinations like /start and
   *  /driver/assistant-control that live outside the page-state router. */
  href?: string;
};

const driverItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'loads', label: 'Loads', icon: Truck },
  { id: 'opportunities', label: 'Opportunities', icon: BriefcaseBusiness },
  { id: 'contracts', label: 'Contracts', icon: FileSignature },
  { id: 'expenses', label: 'Expenses', icon: Receipt },
  { id: 'fuel', label: 'Fuel', icon: Fuel },
  { id: 'settlements', label: 'Settlements', icon: ReceiptText },
  { id: 'reports', label: 'Reports', icon: FileText },

  { id: 'settings', label: 'Settings', icon: SettingsIcon },
  { id: 'nav:assistant-control', label: 'Assistants & Agency', icon: Users, href: '/driver/assistant-control' },
  { id: 'nav:switch-workspace', label: 'Switch Workspace', icon: ArrowLeftRight, href: '/start' },
];

const recruiterActiveItems: NavItem[] = [
  { id: 'recruiter-access', label: 'Recruiter Command Center', icon: Handshake },
  { id: 'recruiter-access:manager', label: 'Manage Opportunities', icon: ClipboardList },
  { id: 'recruiter-access:applications', label: 'Applications', icon: Users },
  { id: 'recruiter-access:reports', label: 'Reports', icon: BarChart3 },
  { id: 'contracts', label: 'Contracts', icon: FileSignature },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
  { id: 'nav:switch-workspace', label: 'Switch Workspace', icon: ArrowLeftRight, href: '/start' },
];

const recruiterHubOnlyItems: NavItem[] = [
  { id: 'recruiter-access', label: 'Recruiter Dashboard', icon: Handshake },
  { id: 'nav:switch-workspace', label: 'Switch Workspace', icon: ArrowLeftRight, href: '/start' },
];

export function AppSidebar(props: AppSidebarProps) {
  const {
    active,
    onNavigate,
    role,
    roleLoading,
    workspaceLoading,
    recruiterOperationsAllowed = false,
    assistantPermissions,
  } = props;
  const navigate = useNavigate();
  const isAssistant = !!assistantPermissions;
  const loading = workspaceLoading ?? roleLoading;

  // Strict compatibility: capability-aware mode is engaged whenever the
  // caller passes the prop AT ALL — even as an explicit `null`. Only a
  // truly omitted prop preserves the legacy role-driven behavior.
  const capabilitySignalled = 'recruiterCapabilityStatus' in props;
  const recruiterCapabilityStatus = capabilitySignalled
    ? props.recruiterCapabilityStatus ?? null
    : null;
  const tier = capabilitySignalled
    ? resolveRecruiterNavTier(recruiterCapabilityStatus, recruiterOperationsAllowed)
    : role === 'recruiter'
      ? 'active'
      : 'none';

  // In capability-aware mode, workspace + tier decide EVERYTHING. `role`
  // (which reflects effectiveRole) chooses driver vs recruiter surface,
  // but the tier gates recruiter items and can never be widened by role.
  let baseItems: NavItem[];
  if (capabilitySignalled) {
    if (role === 'recruiter') {
      if (tier === 'active') baseItems = recruiterActiveItems;
      else if (tier === 'hub_only') baseItems = recruiterHubOnlyItems;
      else baseItems = []; // fail-closed: no recruiter workspace links.
    } else {
      baseItems = driverItems;
    }
  } else {
    baseItems = role === 'recruiter' ? recruiterActiveItems : driverItems;
  }

  // Acting-assistant mode must never expose cross-shell nav (workspace
  // switch or the driver's own assistant/agency control center).
  const filteredForAssistant = isAssistant
    ? baseItems.filter((i) => !i.href && isAssistantPageAllowed(i.id, assistantPermissions))
    : baseItems;
  const items = filteredForAssistant;

  const isRecruiterConsole = capabilitySignalled
    ? role === 'recruiter' && tier !== 'none'
    : role === 'recruiter';

  const consoleLabel = loading
    ? 'Loading…'
    : isAssistant
      ? 'Assistant Console'
      : isRecruiterConsole
        ? 'Recruiter Console'
        : 'Load & Pay Manager';

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
            {consoleLabel}
          </p>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Primary">
        {loading ? (
          <div className="px-2 py-3 space-y-2">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="h-8 rounded-lg bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : (
          items.map(item => {
            const isActive = !item.href && active === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                data-nav-id={item.id}
                onClick={() => (item.href ? navigate(item.href) : onNavigate(item.id))}
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
          {isAssistant
            ? 'You are acting on behalf of a driver. Every change is recorded in the audit log.'
            : isRecruiterConsole
              ? 'Post opportunities. Review drivers. Hire smarter.'
              : 'Track every mile. Every dollar. Every decision.'}
        </p>
      </div>
    </aside>
  );
}
