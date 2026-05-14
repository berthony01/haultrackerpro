import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, Search } from 'lucide-react';
import { AdminSidebar } from './AdminSidebar';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface AdminShellProps {
  value: string;
  onChange: (v: string) => void;
  role?: string;
  email?: string;
  children: ReactNode;
  /** Optional mobile fallback (e.g. TabsList) shown above content on small screens */
  mobileNav?: ReactNode;
}

export function AdminShell({ value, onChange, role, email, children, mobileNav }: AdminShellProps) {
  const navigate = useNavigate();
  return (
    <div
      className="min-h-screen w-full text-white"
      style={{
        background:
          'radial-gradient(1200px 600px at 0% -10%, rgba(255,140,40,0.08), transparent 60%), radial-gradient(900px 500px at 100% 0%, rgba(40,80,200,0.10), transparent 60%), #05070C',
      }}
    >
      <div className="flex">
        <AdminSidebar value={value} onChange={onChange} role={role} email={email} />

        <main className="min-w-0 flex-1">
          {/* Top bar */}
          <header className="sticky top-0 z-20 border-b border-white/5 bg-[#05070C]/80 backdrop-blur-xl">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/')}
                className="h-9 w-9 text-white/70 hover:bg-white/5 hover:text-white"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-lg font-black tracking-tight text-white sm:text-xl">
                  Admin Dashboard
                </h1>
                <p className="hidden text-[11px] text-white/50 sm:block">
                  Real-time overview of your HaulTrackerPro platform.
                </p>
              </div>

              <div className="relative hidden md:block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <Input
                  placeholder="Search anything…"
                  className="h-9 w-64 border-white/10 bg-white/[0.04] pl-8 text-sm text-white placeholder:text-white/40 focus-visible:ring-primary/40"
                />
              </div>

              <button
                type="button"
                className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white/70 hover:text-white"
                aria-label="Notifications"
              >
                <Bell className="h-4 w-4" />
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
              </button>

              <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary ring-1 ring-primary/30">
                {role || 'admin'}
              </span>
            </div>

            {mobileNav && <div className="px-4 pb-3 lg:hidden">{mobileNav}</div>}
          </header>

          <div className="p-4 sm:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
