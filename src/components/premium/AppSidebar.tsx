import { LayoutDashboard, Truck, Receipt, Fuel, Route, FileText, CreditCard, Settings as SettingsIcon } from 'lucide-react';

interface AppSidebarProps {
  active: string;
  onNavigate: (page: string) => void;
}

const items = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'loads', label: 'Loads', icon: Truck },
  { id: 'expenses', label: 'Expenses', icon: Receipt },
  { id: 'fuel', label: 'Fuel', icon: Fuel },
  { id: 'deadhead', label: 'Deadhead', icon: Route, target: 'reports' },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'payments', label: 'Payments', icon: CreditCard, target: 'loads' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

export function AppSidebar({ active, onNavigate }: AppSidebarProps) {
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
          <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-[0.18em]">Load &amp; Pay Manager</p>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {items.map(item => {
          const target = (item as any).target ?? item.id;
          const isActive = active === target || active === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(target)}
              className={`sidebar-link w-full text-left ${isActive ? 'active' : ''}`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="p-4 border-t border-border/60">
        <p className="text-[10px] text-muted-foreground/60 leading-snug">
          Track every mile. Every dollar. Every decision.
        </p>
      </div>
    </aside>
  );
}
