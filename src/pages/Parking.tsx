import { useNavigate } from 'react-router-dom';
import SEOHead from '@/components/SEOHead';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { ParkingFinder } from '@/components/parking/ParkingFinder';
import { useSubscription } from '@/hooks/useSubscription';

export default function Parking() {
  const navigate = useNavigate();
  const { isPro, isTrialing } = useSubscription();

  return (
    <div className="min-h-screen bg-background pb-24">
      <SEOHead
        title="Truck Parking Finder | HaulTrackerPro"
        description="Find safe truck parking in real time. Drivers helping drivers with verified availability reports."
        path="/parking"
        noindex
      />
      <div className="max-w-3xl mx-auto p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/dashboard')}
            className="-ml-2"
          >
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Button>
        </div>
        <div>
          <h1 className="text-2xl font-black font-heading">Parking Finder</h1>
          <p className="text-sm text-muted-foreground">
            Drivers helping drivers in real time. Tap a spot to report or verify.
          </p>
        </div>
        <ParkingFinder hasAccess={isPro || isTrialing} />
      </div>
    </div>
  );
}
