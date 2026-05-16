import { useState } from 'react';
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
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

interface BottomNavProps {
  active: string;
  onNavigate: (page: string) => void;
}

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'loads', label: 'Loads', icon: Truck },
  { id: 'add', label: 'Add', icon: Plus },
  { id: 'opportunities', label: 'Opps', icon: BriefcaseBusiness },
  { id: 'more', label: 'More', icon: MoreHorizontal },
];

export function BottomNav({ active, onNavigate }: BottomNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);

  const go = (page: string) => {
    setMoreOpen(false);
    onNavigate(page);
  };

  const goNav = (page: string) => {
    setMoreOpen(false);
    onNavigate(page);
  };

  const moreItems: { label: string; icon: typeof Settings; onClick: () => void; description?: string }[] = [
    { label: 'Recruiter Access', icon: Users, onClick: () => goNav('recruiter-access'), description: 'Recruiting drivers? Open recruiter tools.' },
    { label: 'Opportunity Preferences', icon: UserCog, onClick: () => goNav('opportunity-preferences'), description: 'Tell recruiters what fits you.' },
    { label: 'Reports', icon: FileText, onClick: () => go('reports') },
    { label: 'Expenses', icon: Receipt, onClick: () => go('expenses') },
    { label: 'Fuel', icon: Fuel, onClick: () => go('fuel') },
    { label: 'Settings', icon: Settings, onClick: () => go('settings') },
  ];

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
