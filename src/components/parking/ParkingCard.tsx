import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MapPin, Shield, ChevronRight } from 'lucide-react';
import { ParkingLocation, computeConfidence, ParkingReportRow, Confidence } from '@/hooks/useParkingLocations';
import { Coords, distanceMiles } from '@/hooks/useGeolocation';
import { formatDistanceToNowStrict } from 'date-fns';

interface ParkingCardProps {
  location: ParkingLocation;
  reports: ParkingReportRow[];
  userCoords: Coords | null;
  onSelect: (loc: ParkingLocation) => void;
}

function confidenceColor(level: Confidence): string {
  switch (level) {
    case 'high': return 'bg-success/15 text-success border-success/30';
    case 'medium': return 'bg-warning/15 text-warning border-warning/30';
    case 'low': return 'bg-muted text-muted-foreground border-border';
  }
}

function confidenceLabel(level: Confidence): string {
  return level === 'high' ? 'High' : level === 'medium' ? 'Medium' : 'Low';
}

export function ParkingCard({ location, reports, userCoords, onSelect }: ParkingCardProps) {
  const { level, lastReportAt } = computeConfidence(reports, location.id);
  const distance = userCoords ? distanceMiles(userCoords, location) : null;

  return (
    <Card
      className="shadow-card hover:shadow-md transition-all active:scale-[0.99] cursor-pointer"
      onClick={() => onSelect(location)}
    >
      <CardContent className="p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm truncate">{location.name}</h3>
              <Badge variant="outline" className={`text-[10px] px-2 py-0 h-5 ${confidenceColor(level)}`}>
                {confidenceLabel(level)}
              </Badge>
            </div>
            {location.address && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate flex items-center gap-1">
                <MapPin className="h-3 w-3 shrink-0" />
                {location.address}
              </p>
            )}
            <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground flex-wrap">
              {distance != null && (
                <span className="font-medium text-foreground">{distance.toFixed(1)} mi</span>
              )}
              {location.is_paid ? (
                <span>Paid</span>
              ) : (
                <span className="text-success">Free</span>
              )}
              {location.overnight_allowed && <span>Overnight</span>}
              {location.truck_friendly && (
                <span className="flex items-center gap-0.5">
                  <Shield className="h-3 w-3" /> Truck-friendly
                </span>
              )}
              {location.total_spots != null && <span>{location.total_spots} spots</span>}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              {lastReportAt
                ? `Last verified ${formatDistanceToNowStrict(new Date(lastReportAt))} ago`
                : 'No recent reports'}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
        </div>
      </CardContent>
    </Card>
  );
}
