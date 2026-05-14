import { LucideIcon } from 'lucide-react';

interface AdminMetricCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  sub?: string;
  accent?: 'primary' | 'success' | 'muted';
}

export function AdminMetricCard({ label, value, icon: Icon, sub, accent = 'primary' }: AdminMetricCardProps) {
  const ring =
    accent === 'success'
      ? 'ring-emerald-500/30 bg-emerald-500/10 text-emerald-400'
      : accent === 'muted'
      ? 'ring-white/10 bg-white/5 text-white/70'
      : 'ring-primary/30 bg-primary/10 text-primary';
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0D111A] p-4 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)] transition-all hover:border-white/10 hover:shadow-[0_8px_40px_-12px_hsl(var(--primary)/0.35)]">
      <div className="pointer-events-none absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">{label}</p>
        <div className={`rounded-lg p-1.5 ring-1 ${ring}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <p className="mt-2.5 font-mono text-2xl font-black tracking-tight text-white">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-white/40">{sub}</p>}
    </div>
  );
}
