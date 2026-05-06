import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import SEOHead from '@/components/SEOHead';
import { Button } from '@/components/ui/button';
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

  // Bring Parking under the premium authenticated app theme so Radix portals
  // (sheets, popovers, selects) inherit dark tokens.
  useEffect(() => {
    document.body.classList.add('app-shell-active');
    return () => document.body.classList.remove('app-shell-active');
  }, []);

  const reportsToday = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const startMs = start.getTime();
    return recentReports.filter((r) => new Date(r.created_at).getTime() >= startMs).length;
  }, [recentReports]);

  return (
    <div className="app-shell min-h-screen bg-background pb-24">
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
        <div className="premium-card p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/10 ring-1 ring-primary/25 p-2.5 shrink-0 text-primary">
              <ParkingCircle className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-label">Driver Network</p>
              <h1 className="text-2xl font-black font-heading leading-tight tracking-tight">Parking Finder</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Drivers helping drivers in real time. Tap a spot to report or verify.
              </p>
            </div>
          </div>

          {/* Stat tiles */}
          <div className="grid grid-cols-3 gap-2 mt-4">
            <div className="premium-card p-3 text-center">
              <div className="flex items-center justify-center gap-1 text-label">
                <ParkingCircle className="h-3 w-3" /> Locations
              </div>
              <div className="text-xl font-mono font-black mt-1 text-foreground">{locations.length}</div>
            </div>
            <div className="premium-card p-3 text-center">
              <div className="flex items-center justify-center gap-1 text-label">
                <Activity className="h-3 w-3" /> Reports today
              </div>
              <div className="text-xl font-mono font-black mt-1 text-foreground">{reportsToday}</div>
            </div>
            <div className="premium-card p-3 text-center">
              <div className="flex items-center justify-center gap-1 text-label">
                <Trophy className="h-3 w-3" /> Your points
              </div>
              <div className="text-xl font-mono font-black mt-1 text-primary">
                {hasAccess ? (points?.total_points ?? 0) : '—'}
              </div>
            </div>
          </div>
        </div>

        <ParkingFinder hasAccess={hasAccess} subscriptionLoading={subLoading} />
      </div>
    </div>
  );
}
