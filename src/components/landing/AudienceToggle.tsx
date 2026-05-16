import { Truck, Users } from 'lucide-react';
import type { LandingAudience } from '@/hooks/useLandingAudience';

interface AudienceToggleProps {
  audience: LandingAudience;
  onChange: (next: LandingAudience) => void;
  className?: string;
}

export default function AudienceToggle({ audience, onChange, className = '' }: AudienceToggleProps) {
  const base =
    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors whitespace-nowrap';
  const active = { background: 'hsl(25, 95%, 53%)', color: 'hsl(0, 0%, 100%)' };
  const inactive = { color: 'hsl(220, 10%, 70%)' };

  return (
    <div
      role="tablist"
      aria-label="Choose audience"
      className={`inline-flex items-center gap-1 p-1 rounded-xl border ${className}`}
      style={{ background: 'hsl(220, 20%, 12%)', borderColor: 'hsl(220, 16%, 20%)' }}
    >
      <button
        role="tab"
        aria-selected={audience === 'driver'}
        onClick={() => onChange('driver')}
        className={base}
        style={audience === 'driver' ? active : inactive}
      >
        <Truck className="h-4 w-4" />
        For Drivers
      </button>
      <button
        role="tab"
        aria-selected={audience === 'recruiter'}
        onClick={() => onChange('recruiter')}
        className={base}
        style={audience === 'recruiter' ? active : inactive}
      >
        <Users className="h-4 w-4" />
        For Recruiters
      </button>
    </div>
  );
}
