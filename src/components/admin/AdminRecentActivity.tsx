import { LucideIcon, Truck, Receipt, Fuel, Users } from 'lucide-react';

interface ActivityItem {
  icon: LucideIcon;
  label: string;
  value: number;
  sub?: string;
}

interface AdminRecentActivityProps {
  loads7d?: number;
  expenses7d?: number;
  fuel7d?: number;
  activeDrivers?: number;
}

export function AdminRecentActivity({ loads7d = 0, expenses7d = 0, fuel7d = 0, activeDrivers = 0 }: AdminRecentActivityProps) {
  const items: ActivityItem[] = [
    { icon: Truck, label: 'New loads logged', value: loads7d, sub: 'last 7 days' },
    { icon: Receipt, label: 'Expenses recorded', value: expenses7d, sub: 'last 7 days' },
    { icon: Fuel, label: 'Fuel logs', value: fuel7d, sub: 'last 7 days' },
    { icon: Users, label: 'Active drivers', value: activeDrivers, sub: 'this week' },
  ];
  const total = items.reduce((acc, i) => acc + i.value, 0);
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-[#0D111A] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/60">Recent Platform Activity</p>
          <p className="text-[11px] text-white/40">Aggregated from the last 7 days</p>
        </div>
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary ring-1 ring-primary/30">
          {total} events
        </span>
      </div>
      {total === 0 ? (
        <p className="py-6 text-center text-sm text-white/40">No platform activity in the last 7 days.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {items.map((i) => (
            <li
              key={i.label}
              className="flex items-center gap-3 rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2.5"
            >
              <span className="rounded-md bg-primary/10 p-1.5 ring-1 ring-primary/20">
                <i.icon className="h-3.5 w-3.5 text-primary" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white/85">{i.label}</p>
                <p className="text-[10px] text-white/40">{i.sub}</p>
              </div>
              <span className="font-mono text-base font-black text-white">{i.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
