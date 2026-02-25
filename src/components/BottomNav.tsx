import { LayoutDashboard, Plus, FileText, Truck } from 'lucide-react';

interface BottomNavProps {
  active: string;
  onNavigate: (page: string) => void;
}

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'add', label: 'Log Load', icon: Plus },
  { id: 'loads', label: 'My Loads', icon: Truck },
  { id: 'reports', label: 'Reports', icon: FileText },
];

export function BottomNav({ active, onNavigate }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-secondary border-t border-border/30 safe-area-bottom">
      <div className="flex items-center justify-around h-[72px] max-w-lg mx-auto px-2">
        {navItems.map(item => {
          const isActive = active === item.id;
          const isAdd = item.id === 'add';

          if (isAdd) {
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className="flex flex-col items-center justify-center -mt-6"
              >
                <div className="rounded-2xl bg-primary text-primary-foreground w-14 h-14 flex items-center justify-center shadow-primary animate-pulse-glow active:scale-95 transition-transform">
                  <Plus className="h-7 w-7" strokeWidth={2.5} />
                </div>
                <span className="text-[10px] font-bold text-primary mt-1">Log Load</span>
              </button>
            );
          }

          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`flex flex-col items-center gap-1 min-w-[56px] min-h-[48px] justify-center rounded-xl px-3 py-2 transition-all active:scale-95 ${
                isActive
                  ? 'text-primary'
                  : 'text-secondary-foreground/50 hover:text-secondary-foreground/80'
              }`}
            >
              <item.icon className="h-5 w-5" />
              <span className={`text-[10px] font-semibold ${isActive ? 'text-primary' : ''}`}>
                {item.label}
              </span>
              {isActive && (
                <div className="h-0.5 w-4 rounded-full bg-primary -mt-0.5" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
