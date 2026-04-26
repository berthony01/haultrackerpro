import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, Shield, ChevronRight, DollarSign } from 'lucide-react';
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

function confidenceBorder(level: Confidence): string {
  switch (level) {
    case 'high': return 'border-l-success';
    case 'medium': return 'border-l-warning';
    case 'low': return 'border-l-border';
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
      className={`shadow-card hover:shadow-md transition-all active:scale-[0.99] cursor-pointer border-l-2 ${confidenceBorder(level)}`}
      onClick={() => onSelect(location)}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm truncate">{location.name}</h3>
              <Badge variant="outline" className={`text-[10px] px-2 py-0 h-5 ${confidenceColor(level)}`}>
                {level === 'high' && (
                  <span className="mr-1 h-1.5 w-1.5 rounded-full bg-success animate-pulse inline-block" />
                )}
                {confidenceLabel(level)}
              </Badge>
            </div>
            {location.address && (
              <p className="text-xs text-muted-foreground mt-1 truncate flex items-center gap-1">
                <MapPin className="h-3 w-3 shrink-0" />
                {location.address}
              </p>
            )}
            <div className="flex items-center gap-2 mt-2.5 flex-wrap">
              {location.is_paid ? (
                <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-0.5">
                  <DollarSign className="h-2.5 w-2.5" /> Paid
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-success border-success/30">
                  Free
                </Badge>
              )}
              {location.overnight_allowed && (
                <Badge variant="outline" className="text-[10px] h-5 px-1.5">Overnight</Badge>
              )}
              {location.truck_friendly && (
                <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-0.5">
                  <Shield className="h-2.5 w-2.5" /> Truck-friendly
                </Badge>
              )}
              {location.total_spots != null && (
                <Badge variant="outline" className="text-[10px] h-5 px-1.5">{location.total_spots} spots</Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              {lastReportAt
                ? `Last verified ${formatDistanceToNowStrict(new Date(lastReportAt))} ago`
                : 'No recent reports'}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            {distance != null && (
              <Badge variant="secondary" className="text-[10px] h-5 px-2 font-bold">
                {distance.toFixed(1)} mi
              </Badge>
            )}
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
