import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import SEOHead from '@/components/SEOHead';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, ParkingCircle, Activity, Trophy } from 'lucide-react';
import { ParkingFinder } from '@/components/parking/ParkingFinder';
import { useSubscription } from '@/hooks/useSubscription';
import { useParkingLocations, useRecentParkingReports } from '@/hooks/useParkingLocations';
import { useDriverPoints } from '@/hooks/useDriverPoints';

export default function Parking() {
  const navigate = useNavigate();
  const { isPro, isLoading: subLoading } = useSubscription();
  const hasAccess = isPro;
  const { data: locations = [] } = useParkingLocations();
  const { data: recentReports = [] } = useRecentParkingReports();
  const { data: points } = useDriverPoints();

  const reportsToday = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const startMs = start.getTime();
    return recentReports.filter((r) => new Date(r.created_at).getTime() >= startMs).length;
  }, [recentReports]);

  return (
    <div className="min-h-screen bg-background pb-24">
      <SEOHead
        title="Truck Parking Finder | HaulTrackerPro"
        description="Find safe truck parking in real time. Drivers helping drivers with verified availability reports."
        path="/parking"
        noindex
      />
      <div className="max-w-3xl mx-auto p-4 space-y-5">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/dashboard')}
          className="h-8 px-2 -ml-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
        </Button>

        {/* Hero header */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card to-primary/5 p-5 shadow-card">
          <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-primary/10 blur-2xl pointer-events-none" />
          <div className="relative flex items-start gap-3">
            <div className="rounded-xl bg-primary/15 p-2.5 shrink-0">
              <ParkingCircle className="h-6 w-6 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-black font-heading leading-tight">Parking Finder</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Drivers helping drivers in real time. Tap a spot to report or verify.
              </p>
            </div>
          </div>

          {/* Stat tiles */}
          <div className="grid grid-cols-3 gap-2 mt-4">
            <Card className="bg-background/60 border-border/60">
              <CardContent className="p-3 text-center">
                <div className="flex items-center justify-center gap-1 text-muted-foreground text-[10px] uppercase font-semibold tracking-wide">
                  <ParkingCircle className="h-3 w-3" /> Locations
                </div>
                <div className="text-xl font-black font-heading mt-1">{locations.length}</div>
              </CardContent>
            </Card>
            <Card className="bg-background/60 border-border/60">
              <CardContent className="p-3 text-center">
                <div className="flex items-center justify-center gap-1 text-muted-foreground text-[10px] uppercase font-semibold tracking-wide">
                  <Activity className="h-3 w-3" /> Reports today
                </div>
                <div className="text-xl font-black font-heading mt-1">{reportsToday}</div>
              </CardContent>
            </Card>
            <Card className="bg-background/60 border-border/60">
              <CardContent className="p-3 text-center">
                <div className="flex items-center justify-center gap-1 text-muted-foreground text-[10px] uppercase font-semibold tracking-wide">
                  <Trophy className="h-3 w-3" /> Your points
                </div>
                <div className="text-xl font-black font-heading mt-1 text-primary">
                  {hasAccess ? (points?.total_points ?? 0) : '—'}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <ParkingFinder hasAccess={hasAccess} subscriptionLoading={subLoading} />
      </div>
    </div>
  );
}
