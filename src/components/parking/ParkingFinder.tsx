import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { MapPin, Search, Plus, Loader2 } from 'lucide-react';
import { useParkingLocations, useRecentParkingReports, computeConfidence, ParkingLocation } from '@/hooks/useParkingLocations';
import { useGeolocation, distanceMiles } from '@/hooks/useGeolocation';
import { ParkingCard } from './ParkingCard';
import { ParkingDetailSheet } from './ParkingDetailSheet';
import { AddParkingModal } from './AddParkingModal';
import { ProUpgradeModal } from '@/components/ProUpgradeModal';

interface ParkingFinderProps {
  hasAccess: boolean;
}

type ConfidenceFilter = 'any' | 'high' | 'medium' | 'low';

export function ParkingFinder({ hasAccess }: ParkingFinderProps) {
  const { data: locations = [], isLoading } = useParkingLocations();
  const { data: recentReports = [] } = useRecentParkingReports();
  const geo = useGeolocation();

  const [search, setSearch] = useState('');
  const [paidFilter, setPaidFilter] = useState<'any' | 'free' | 'paid'>('any');
  const [overnightOnly, setOvernightOnly] = useState(false);
  const [truckOnly, setTruckOnly] = useState(false);
  const [confFilter, setConfFilter] = useState<ConfidenceFilter>('any');

  const [selected, setSelected] = useState<ParkingLocation | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = locations.filter((loc) => {
      if (q) {
        const hay = `${loc.name} ${loc.address ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (paidFilter === 'free' && loc.is_paid) return false;
      if (paidFilter === 'paid' && !loc.is_paid) return false;
      if (overnightOnly && !loc.overnight_allowed) return false;
      if (truckOnly && !loc.truck_friendly) return false;
      if (confFilter !== 'any') {
        const { level } = computeConfidence(recentReports, loc.id);
        if (level !== confFilter) return false;
      }
      return true;
    });

    if (geo.coords) {
      list = [...list].sort(
        (a, b) => distanceMiles(geo.coords!, a) - distanceMiles(geo.coords!, b),
      );
    }
    return list;
  }, [locations, search, paidFilter, overnightOnly, truckOnly, confFilter, recentReports, geo.coords]);

  return (
    <div className="space-y-4">
      {/* Search + location */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search city, zip, or name"
            className="pl-9"
          />
        </div>
        <Button
          variant="outline"
          onClick={geo.request}
          disabled={geo.isPending}
          className="shrink-0"
          aria-label="Use my location"
        >
          {geo.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
          <span className="hidden sm:inline ml-1">Near me</span>
        </Button>
      </div>
      {geo.error && <p className="text-xs text-destructive">{geo.error}</p>}

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {(['any', 'free', 'paid'] as const).map((v) => (
          <Button
            key={v}
            size="sm"
            variant={paidFilter === v ? 'default' : 'outline'}
            className="h-7 text-xs rounded-full"
            onClick={() => setPaidFilter(v)}
          >
            {v === 'any' ? 'All' : v === 'free' ? 'Free' : 'Paid'}
          </Button>
        ))}
        <Button
          size="sm"
          variant={overnightOnly ? 'default' : 'outline'}
          className="h-7 text-xs rounded-full"
          onClick={() => setOvernightOnly((v) => !v)}
        >
          Overnight
        </Button>
        <Button
          size="sm"
          variant={truckOnly ? 'default' : 'outline'}
          className="h-7 text-xs rounded-full"
          onClick={() => setTruckOnly((v) => !v)}
        >
          Truck-friendly
        </Button>
        {(['any', 'high', 'medium', 'low'] as const).map((v) => (
          <Button
            key={v}
            size="sm"
            variant={confFilter === v ? 'default' : 'outline'}
            className="h-7 text-xs rounded-full"
            onClick={() => setConfFilter(v)}
          >
            {v === 'any' ? 'Any confidence' : v[0].toUpperCase() + v.slice(1)}
          </Button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Loading parking…</CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center space-y-3">
            <p className="text-sm text-muted-foreground">No parking matches your filters.</p>
            <Button onClick={() => setShowAdd(true)} size="sm">
              <Plus className="h-4 w-4" /> Add a location
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.slice(0, 100).map((loc) => (
            <ParkingCard
              key={loc.id}
              location={loc}
              reports={recentReports}
              userCoords={geo.coords}
              onSelect={setSelected}
            />
          ))}
          {filtered.length > 100 && (
            <p className="text-xs text-center text-muted-foreground">
              Showing first 100 of {filtered.length}. Refine your search to see more.
            </p>
          )}
        </div>
      )}

      <Button variant="outline" className="w-full" onClick={() => setShowAdd(true)}>
        <Plus className="h-4 w-4" /> Add a parking spot
      </Button>

      <ParkingDetailSheet
        location={selected}
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        hasAccess={hasAccess}
        onUpgrade={() => setShowUpgrade(true)}
      />
      <AddParkingModal open={showAdd} onOpenChange={setShowAdd} />
      <ProUpgradeModal
        open={showUpgrade}
        onOpenChange={setShowUpgrade}
        featureName="Parking reports & rewards"
      />
    </div>
  );
}
