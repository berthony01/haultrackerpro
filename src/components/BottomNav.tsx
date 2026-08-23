import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Plus,
  Truck,
  BriefcaseBusiness,
  MoreHorizontal,
  Settings,
  FileText,
  Receipt,
  Fuel,
  Users,
  UserCog,
  Handshake,
  ClipboardList,
  LogOut,
  FileSignature,
  BarChart3,
  ArrowLeftRight,
  ReceiptText,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { UserRole } from '@/hooks/useUserRole';
import { useAuth } from '@/hooks/useAuth';
import {
  isAssistantPageAllowed,
  hasPerm,
  type AssistantPermissions,
} from '@/lib/assistantPermissions';
import type { UserCapabilityStatus } from '@/lib/userCapabilities';
import { resolveRecruiterNavTier } from '@/lib/dashboardWorkspacePolicy';

interface BottomNavProps {
  active: string;
  onNavigate: (page: string) => void;
  role: UserRole;
  roleLoading?: boolean;
  workspaceLoading?: boolean;
  recruiterCapabilityStatus?: UserCapabilityStatus | null;
  recruiterOperationsAllowed?: boolean;
  /** When set, this user is acting as an assistant for a driver and nav items
   *  are filtered to the keys the driver has granted. */
  assistantPermissions?: AssistantPermissions | null;
}

const driverNav = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'loads', label: 'Loads', icon: Truck },
  { id: 'add', label: 'Add', icon: Plus },
  { id: 'opportunities', label: 'Opps', icon: BriefcaseBusiness },
  { id: 'more', label: 'More', icon: MoreHorizontal },
];

const recruiterActiveNav = [
  { id: 'recruiter-access', label: 'Home', icon: Handshake },
  { id: 'recruiter-access:manager', label: 'Opps', icon: ClipboardList },
  { id: 'recruiter-access:applications', label: 'Apps', icon: Users },
  { id: 'more', label: 'More', icon: MoreHorizontal },
];

const recruiterHubOnlyNav = [
  { id: 'recruiter-access', label: 'Home', icon: Handshake },
  { id: 'more', label: 'More', icon: MoreHorizontal },
];

export function BottomNav(props: BottomNavProps) {
  const {
    active,
    onNavigate,
    role,
    roleLoading,
    workspaceLoading,
    recruiterOperationsAllowed = false,
    assistantPermissions,
  } = props;
  const [moreOpen, setMoreOpen] = useState(false);
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const isAssistant = !!assistantPermissions;
  const loading = workspaceLoading ?? roleLoading;

  // Strict compatibility: capability-aware mode engages whenever the
  // caller passes the prop at all — including explicit `null`.
  const capabilitySignalled = 'recruiterCapabilityStatus' in props;
  const recruiterCapabilityStatus = capabilitySignalled
    ? props.recruiterCapabilityStatus ?? null
    : null;
  const tier = capabilitySignalled
    ? resolveRecruiterNavTier(recruiterCapabilityStatus, recruiterOperationsAllowed)
    : role === 'recruiter'
      ? 'active'
      : 'none';

  let baseNav: typeof driverNav;
  if (capabilitySignalled) {
    if (role === 'recruiter') {
      if (tier === 'active') baseNav = recruiterActiveNav;
      else if (tier === 'hub_only') baseNav = recruiterHubOnlyNav;
      else baseNav = [{ id: 'more', label: 'More', icon: MoreHorizontal }];
    } else {
      baseNav = driverNav;
    }
  } else {
    baseNav = role === 'recruiter' ? recruiterActiveNav : driverNav;
  }

  const navItems = isAssistant
    ? baseNav.filter((i) => isAssistantPageAllowed(i.id, assistantPermissions))
    : baseNav;

  const go = (page: string) => {
    setMoreOpen(false);
    onNavigate(page);
  };
  const goHref = (href: string) => {
    setMoreOpen(false);
    navigate(href);
  };

  type MoreItem = { label: string; icon: typeof Settings; onClick: () => void; description?: string };

  const driverMoreItemsFull: MoreItem[] = [
    { label: 'Opportunity Preferences', icon: UserCog, onClick: () => go('opportunity-preferences'), description: 'Tell recruiters what fits you.' },
    { label: 'Contracts', icon: FileSignature, onClick: () => go('contracts'), description: 'Review, approve, request changes, sign.' },
    { label: 'Reports', icon: FileText, onClick: () => go('reports') },
    { label: 'Expenses', icon: Receipt, onClick: () => go('expenses') },
    { label: 'Fuel', icon: Fuel, onClick: () => go('fuel') },
    { label: 'Settlements', icon: ReceiptText, onClick: () => go('settlements'), description: 'Reconcile carrier statements against your loads.' },
    { label: 'Assistants & Agency', icon: Users, onClick: () => goHref('/driver/assistant-control'), description: 'Delegate access to assistants or an agency.' },
    { label: 'Switch Workspace', icon: ArrowLeftRight, onClick: () => goHref('/start'), description: 'Choose a different workspace on this account.' },
    { label: 'Settings', icon: Settings, onClick: () => go('settings') },
    { label: 'Sign Out', icon: LogOut, onClick: () => { setMoreOpen(false); signOut(); } },
  ];

  const driverMoreItemsAssistant: MoreItem[] = [
    hasPerm(assistantPermissions, 'view_reports') || hasPerm(assistantPermissions, 'export_reports')
      ? { label: 'Reports', icon: FileText, onClick: () => go('reports') } : null,
    hasPerm(assistantPermissions, 'manage_expenses')
      ? { label: 'Expenses', icon: Receipt, onClick: () => go('expenses') } : null,
    hasPerm(assistantPermissions, 'manage_fuel')
      ? { label: 'Fuel', icon: Fuel, onClick: () => go('fuel') } : null,
    hasPerm(assistantPermissions, 'settlements_view')
      ? {
          label: 'Settlements',
          icon: ReceiptText,
          onClick: () => go('settlements'),
          description: "View the selected driver's settlement statements.",
        }
      : null,
    { label: 'Switch driver / exit', icon: UserCog, onClick: () => go('assistant_exit'), description: 'Stop acting for this driver.' },
    { label: 'Sign Out', icon: LogOut, onClick: () => { setMoreOpen(false); signOut(); } },
  ].filter(Boolean) as MoreItem[];

  const recruiterActiveMoreItems: MoreItem[] = [
    { label: 'Recruiter Command Center', icon: Handshake, onClick: () => go('recruiter-access') },
    { label: 'Manage Opportunities', icon: ClipboardList, onClick: () => go('recruiter-access:manager') },
    { label: 'Applications', icon: Users, onClick: () => go('recruiter-access:applications') },
    { label: 'Reports', icon: BarChart3, onClick: () => go('recruiter-access:reports'), description: 'Activity & Pipeline reports (PDF + CSV).' },
    { label: 'Contracts', icon: FileSignature, onClick: () => go('contracts'), description: 'Upload, AI review, track approvals.' },
    { label: 'Switch Workspace', icon: ArrowLeftRight, onClick: () => goHref('/start'), description: 'Choose a different workspace on this account.' },
    { label: 'Settings', icon: Settings, onClick: () => go('settings') },
    { label: 'Sign Out', icon: LogOut, onClick: () => { setMoreOpen(false); signOut(); } },
  ];

  const recruiterHubOnlyMoreItems: MoreItem[] = [
    { label: 'Recruiter Command Center', icon: Handshake, onClick: () => go('recruiter-access') },
    { label: 'Switch Workspace', icon: ArrowLeftRight, onClick: () => goHref('/start'), description: 'Choose a different workspace on this account.' },
    { label: 'Sign Out', icon: LogOut, onClick: () => { setMoreOpen(false); signOut(); } },
  ];

  const recruiterNoTierMoreItems: MoreItem[] = [
    { label: 'Sign Out', icon: LogOut, onClick: () => { setMoreOpen(false); signOut(); } },
  ];

  let moreItems: MoreItem[];
  if (isAssistant) {
    moreItems = driverMoreItemsAssistant;
  } else if (capabilitySignalled) {
    if (role === 'recruiter') {
      moreItems =
        tier === 'active'
          ? recruiterActiveMoreItems
          : tier === 'hub_only'
            ? recruiterHubOnlyMoreItems
            : recruiterNoTierMoreItems;
    } else {
      moreItems = driverMoreItemsFull;
    }
  } else {
    moreItems = role === 'recruiter' ? recruiterActiveMoreItems : driverMoreItemsFull;
  }

  if (loading) {
    // Non-interactive skeleton — exposes NO workspace action while
    // capability state is loading or the shell is otherwise blocked.
    return (
      <nav
        aria-hidden="true"
        data-testid="bottom-nav-loading"
        className="fixed bottom-0 left-0 right-0 z-50 bg-card/90 backdrop-blur-xl border-t border-border/60 safe-area-bottom"
      >
        <div className="flex items-center justify-around h-[72px] max-w-lg mx-auto px-2">
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              className="h-9 w-14 rounded-xl bg-muted/40 animate-pulse"
            />
          ))}
        </div>
      </nav>
    );
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card/90 backdrop-blur-xl border-t border-border/60 safe-area-bottom">
      <div className="flex items-center justify-around h-[72px] max-w-lg mx-auto px-2">
        {navItems.map(item => {
          const isActive = active === item.id;
          const isAdd = item.id === 'add';
          const isMore = item.id === 'more';

          if (isAdd) {
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                aria-label="Add new load or expense"
                className="flex flex-col items-center justify-center -mt-7"
              >
                <div className="rounded-2xl bg-primary text-primary-foreground w-[56px] h-[56px] flex items-center justify-center shadow-primary animate-pulse-glow active:scale-90 transition-transform duration-150">
                  <Plus className="h-7 w-7" strokeWidth={2.5} />
                </div>
                <span className="text-[10px] font-bold text-primary mt-1.5">Add</span>
              </button>
            );
          }

          if (isMore) {
            return (
              <Sheet key={item.id} open={moreOpen} onOpenChange={setMoreOpen}>
                <SheetTrigger asChild>
                  <button
                    aria-label="More"
                    className={`flex flex-col items-center gap-1 min-w-[64px] min-h-[48px] justify-center rounded-xl px-3 py-2 transition-all duration-200 active:scale-90 ${
                      moreOpen ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <item.icon className={`h-5 w-5 transition-transform duration-200 ${moreOpen ? 'scale-110' : ''}`} />
                    <span className={`text-[10px] font-semibold ${moreOpen ? 'text-primary' : ''}`}>
                      {item.label}
                    </span>
                  </button>
                </SheetTrigger>
                <SheetContent side="bottom" className="rounded-t-2xl pb-8">
                  <SheetHeader className="text-left mb-4">
                    <SheetTitle>More</SheetTitle>
                  </SheetHeader>
                  <div className="grid grid-cols-1 gap-2">
                    {moreItems.map(mi => (
                      <button
                        key={mi.label}
                        onClick={mi.onClick}
                        className="w-full flex items-start gap-3 p-3 rounded-xl border border-border/60 hover:bg-muted/40 active:scale-[0.99] transition-all text-left"
                      >
                        <mi.icon className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">{mi.label}</p>
                          {mi.description && (
                            <p className="text-xs text-muted-foreground leading-snug">{mi.description}</p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </SheetContent>
              </Sheet>
            );
          }

          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              aria-label={item.label}
              className={`flex flex-col items-center gap-1 min-w-[64px] min-h-[48px] justify-center rounded-xl px-3 py-2 transition-all duration-200 active:scale-90 ${
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <item.icon className={`h-5 w-5 transition-transform duration-200 ${isActive ? 'scale-110' : ''}`} />
              <span className={`text-[10px] font-semibold transition-colors duration-200 ${isActive ? 'text-primary' : ''}`}>
                {item.label}
              </span>
              {isActive && (
                <div className="h-0.5 w-5 rounded-full bg-primary -mt-0.5 animate-scale-in" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
