import { LayoutDashboard, Plus, FileText, Truck, Settings } from 'lucide-react';

interface BottomNavProps {
  active: string;
  onNavigate: (page: string) => void;
}

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'loads', label: 'My Loads', icon: Truck },
  { id: 'add', label: 'Log Load', icon: Plus },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function BottomNav({ active, onNavigate }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-secondary/95 backdrop-blur-sm border-t border-border/20 safe-area-bottom">
      <div className="flex items-center justify-around h-[72px] max-w-lg mx-auto px-2">
        {navItems.map(item => {
          const isActive = active === item.id;
          const isAdd = item.id === 'add';

          if (isAdd) {
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className="flex flex-col items-center justify-center -mt-7"
              >
                <div className="rounded-2xl bg-primary text-primary-foreground w-[56px] h-[56px] flex items-center justify-center shadow-primary animate-pulse-glow active:scale-90 transition-transform duration-150">
                  <Plus className="h-7 w-7" strokeWidth={2.5} />
                </div>
                <span className="text-[10px] font-bold text-primary mt-1.5">Log Load</span>
              </button>
            );
          }

          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`flex flex-col items-center gap-1 min-w-[56px] min-h-[48px] justify-center rounded-xl px-3 py-2 transition-all duration-200 active:scale-90 ${
                isActive
                  ? 'text-primary'
                  : 'text-secondary-foreground/40 hover:text-secondary-foreground/70'
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
