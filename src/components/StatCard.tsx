import { Card, CardContent } from '@/components/ui/card';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  subtitle?: string;
}

export function StatCard({ label, value, icon: Icon, subtitle }: StatCardProps) {
  return (
    <Card className="shadow-card hover:shadow-card-hover transition-shadow duration-200 animate-scale-in">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
            <p className="text-xl font-black font-mono truncate mt-0.5">{value}</p>
            {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
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
