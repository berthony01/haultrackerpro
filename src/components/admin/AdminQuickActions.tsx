import { UserPlus, Users, Mail, BarChart3, Settings, LucideIcon } from 'lucide-react';

interface QuickAction {
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
}

interface AdminQuickActionsProps {
  onAddAdmin?: () => void;
  onManageUsers?: () => void;
  onSendEmail?: () => void;
  onViewReports?: () => void;
  onSettings?: () => void;
}

export function AdminQuickActions({ onAddAdmin, onManageUsers, onSendEmail, onViewReports, onSettings }: AdminQuickActionsProps) {
  const actions: QuickAction[] = [
    { label: 'Add New Admin', icon: UserPlus, onClick: onAddAdmin },
    { label: 'Manage Users', icon: Users, onClick: onManageUsers },
    { label: 'Send Email', icon: Mail, onClick: onSendEmail },
    { label: 'View Reports', icon: BarChart3, onClick: onViewReports },
    { label: 'System Settings', icon: Settings, onClick: onSettings },
  ];
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-[#0D111A] p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/60">Quick Actions</p>
        <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
      </div>
      <div className="space-y-1.5">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={a.onClick}
            className="group flex w-full items-center gap-2.5 rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2 text-left text-sm text-white/80 transition-all hover:border-primary/30 hover:bg-primary/[0.06] hover:text-white"
          >
            <span className="rounded-md bg-white/5 p-1.5 ring-1 ring-white/5 group-hover:bg-primary/15 group-hover:ring-primary/30">
              <a.icon className="h-3.5 w-3.5 text-white/70 group-hover:text-primary" />
            </span>
            <span className="font-medium">{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
