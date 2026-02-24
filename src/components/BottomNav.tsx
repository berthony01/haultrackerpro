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
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border safe-area-bottom">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
        {navItems.map(item => {
          const isActive = active === item.id;
          const isAdd = item.id === 'add';
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors ${
                isAdd
                  ? 'bg-primary text-primary-foreground rounded-full w-12 h-12 flex items-center justify-center -mt-4 shadow-lg'
                  : isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <item.icon className={isAdd ? 'h-6 w-6' : 'h-5 w-5'} />
              {!isAdd && (
                <span className={`text-[10px] font-semibold ${isActive ? 'text-primary' : ''}`}>
                  {item.label}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
