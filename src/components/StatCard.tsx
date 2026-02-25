import { Card, CardContent } from '@/components/ui/card';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  subtitle?: string;
  variant?: 'default' | 'success' | 'danger' | 'warning';
  size?: 'default' | 'large';
}

const variantStyles: Record<string, { icon: string; bg: string }> = {
  default: { icon: 'text-primary', bg: 'bg-primary/10' },
  success: { icon: 'text-success', bg: 'bg-success/10' },
  danger: { icon: 'text-destructive', bg: 'bg-destructive/10' },
  warning: { icon: 'text-warning', bg: 'bg-warning/10' },
};

export function StatCard({ label, value, icon: Icon, subtitle, variant = 'default', size = 'default' }: StatCardProps) {
  const styles = variantStyles[variant] || variantStyles.default;
  const isLarge = size === 'large';
  return (
    <Card className="card-premium shadow-card hover:shadow-card-hover transition-all duration-300 animate-scale-in">
      <CardContent className={isLarge ? 'p-5' : 'p-4'}>
        <div className="flex items-start gap-3">
          <div className={`rounded-xl ${styles.bg} ${isLarge ? 'p-3' : 'p-2.5'} shrink-0`}>
            <Icon className={`${isLarge ? 'h-6 w-6' : 'h-5 w-5'} ${styles.icon}`} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-label">{label}</p>
            <p className={`${isLarge ? 'text-value-xl' : 'text-value-lg'} truncate mt-0.5`}>{value}</p>
            {subtitle && <p className="text-[11px] text-muted-foreground mt-1 leading-tight">{subtitle}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function StatCardSkeleton() {
  return (
    <Card className="shadow-card">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="skeleton-shimmer rounded-xl w-10 h-10 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="skeleton-shimmer h-3 w-16 rounded" />
            <div className="skeleton-shimmer h-6 w-24 rounded" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
