import { Database, HardDrive, Cloud, Mail } from 'lucide-react';

const SERVICES = [
  { label: 'Database', icon: Database },
  { label: 'Storage', icon: HardDrive },
  { label: 'API Services', icon: Cloud },
  { label: 'Email Service', icon: Mail },
];

export function AdminSystemHealth() {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-[#0D111A] p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/60">System Health</p>
        <span className="text-[10px] font-semibold uppercase text-emerald-400">All Operational</span>
      </div>
      <div className="space-y-2">
        {SERVICES.map((s) => (
          <div
            key={s.label}
            className="flex items-center justify-between rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2"
          >
            <div className="flex items-center gap-2.5">
              <span className="rounded-md bg-emerald-500/10 p-1.5 ring-1 ring-emerald-500/20">
                <s.icon className="h-3.5 w-3.5 text-emerald-400" />
              </span>
              <span className="text-sm font-medium text-white/85">{s.label}</span>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              Operational
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10px] text-white/35">
        Status display only — not measured uptime.
      </p>
    </div>
  );
}
