import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trophy, Flame, TrendingUp, MapPin, Lock } from 'lucide-react';
import { useDriverPoints, tierFor, mockPercentile } from '@/hooks/useDriverPoints';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { ProUpgradeModal } from '@/components/ProUpgradeModal';

interface DriverIntelligenceCardProps {
  isPro: boolean;
  isTrialing?: boolean;
}

export function DriverIntelligenceCard({ isPro, isTrialing = false }: DriverIntelligenceCardProps) {
  const { user } = useAuth();
  const { data: points } = useDriverPoints();
  const navigate = useNavigate();
  const hasAccess = isPro || isTrialing;
  const [showUpgrade, setShowUpgrade] = useState(false);

  const total = points?.total_points ?? 0;
  const weekly = points?.weekly_points ?? 0;
  const streak = points?.streak_days ?? 0;
  const parking = points?.parking_points ?? 0;
  const tier = tierFor(total);
  const percentile = mockPercentile(user?.id, total);

  const tip = parking < 5
    ? 'Report parking to level up faster'
    : weekly < 20
    ? 'Log a load this week to keep your streak'
    : 'Keep helping the network — you\'re on a roll';

  const handleParkingClick = () => {
    if (!hasAccess) {
      setShowUpgrade(true);
      return;
    }
    navigate('/parking');
  };

  return (
    <>
      <Card className="shadow-card border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Trophy className={`h-4 w-4 ${tier.color}`} />
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Driver Intelligence
                </p>
                {!hasAccess && <Lock className="h-3 w-3 text-muted-foreground" />}
              </div>
              <div className="mt-1 flex items-baseline gap-2 flex-wrap">
                <span className="text-2xl font-black font-heading">{total}</span>
                <Badge variant="outline" className={`${tier.color} border-current/30`}>
                  {tier.name}
                </Badge>
                {streak > 0 && (
                  <span className="text-xs text-orange-400 flex items-center gap-1">
                    <Flame className="h-3 w-3" /> {streak} day streak
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1 text-success">
                  <TrendingUp className="h-3 w-3" />+{weekly} this week
                </span>
                <span>Ahead of {percentile}% of drivers</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2 italic">{tip}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={handleParkingClick}
            >
              {hasAccess ? (
                <MapPin className="h-3.5 w-3.5" />
              ) : (
                <Lock className="h-3.5 w-3.5" />
              )}
              Parking
            </Button>
          </div>
        </CardContent>
      </Card>
      <ProUpgradeModal
        open={showUpgrade}
        onOpenChange={setShowUpgrade}
        featureName="Driver Intelligence rewards"
      />
    </>
  );
}
