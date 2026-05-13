import { Badge } from '@/components/ui/badge';
import { Sparkles, ThumbsUp, CircleHelp, AlertTriangle } from 'lucide-react';
import type { MatchTier } from '@/lib/opportunities/opportunityMatch';
import { tierLabel } from '@/lib/opportunities/opportunityMatch';

interface Props {
  score: number;
  tier: MatchTier;
  size?: 'sm' | 'md';
}

const TIER_CFG: Record<MatchTier, { cls: string; Icon: typeof Sparkles }> = {
  excellent: { cls: 'border-success/40 text-success bg-success/10', Icon: Sparkles },
  strong: { cls: 'border-primary/40 text-primary bg-primary/10', Icon: ThumbsUp },
  possible: { cls: 'border-warning/40 text-warning bg-warning/10', Icon: CircleHelp },
  weak: { cls: 'border-destructive/40 text-destructive bg-destructive/10', Icon: AlertTriangle },
};

export function OpportunityMatchBadge({ score, tier, size = 'sm' }: Props) {
  const cfg = TIER_CFG[tier];
  const Icon = cfg.Icon;
  const padding = size === 'md' ? 'px-3 py-1 text-sm' : 'gap-1';
  return (
    <Badge variant="outline" className={`${cfg.cls} ${padding} whitespace-nowrap`}>
      <Icon className="h-3 w-3" />
      {score}% {tierLabel(tier)}
    </Badge>
  );
}
