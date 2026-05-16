import { Handshake, LayoutDashboard, ShieldCheck } from 'lucide-react';
import type { UserRole } from '@/hooks/useUserRole';

interface ViewModeSwitchProps {
  value: UserRole;
  onChange: (next: UserRole) => void;
  className?: string;
}

/**
 * Compact Driver | Recruiter segmented control for admin / dual-role accounts.
 * Renders nothing unless its parent decides to mount it (gated on canSwitch).
 */
export function ViewModeSwitch({ value, onChange, className = '' }: ViewModeSwitchProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Switch view between Driver and Recruiter"
      className={`inline-flex items-center gap-1 p-1 rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm ${className}`}
    >
      <span className="hidden sm:inline-flex items-center gap-1 pl-2 pr-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70">
        <ShieldCheck className="h-3 w-3" />
        View
      </span>
      <button
        type="button"
        role="radio"
        aria-checked={value === 'driver'}
        onClick={() => onChange('driver')}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
          value === 'driver'
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <LayoutDashboard className="h-3.5 w-3.5" />
        Driver
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === 'recruiter'}
        onClick={() => onChange('recruiter')}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
          value === 'recruiter'
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <Handshake className="h-3.5 w-3.5" />
        Recruiter
      </button>
    </div>
  );
}
