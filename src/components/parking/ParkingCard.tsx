import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, Shield, ChevronRight, DollarSign, BadgeCheck } from 'lucide-react';
import { ParkingLocation, computeConfidence, ParkingReportRow, Confidence } from '@/hooks/useParkingLocations';
import { ParkingVerificationRow } from '@/hooks/useParkingVerifications';
import { Coords, distanceMiles } from '@/hooks/useGeolocation';
import { formatDistanceToNowStrict } from 'date-fns';

interface ParkingCardProps {
  location: ParkingLocation;
  reports: ParkingReportRow[];
  verifications?: ParkingVerificationRow[];
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

const STATUS_TITLE: Record<string, string> = {
  available: 'Available',
  limited: 'Limited',
  full: 'Full',
};

export function ParkingCard({ location, reports, verifications = [], userCoords, onSelect }: ParkingCardProps) {
  const { level, lastSignalAt, lastSignalKind, lastSignalStatus } = computeConfidence(
    reports,
    verifications,
    location.id,
  );
  const distance = userCoords ? distanceMiles(userCoords, location) : null;

  const verifiedLabel =
    lastSignalAt && lastSignalKind === 'verification' && lastSignalStatus
      ? `Verified ${STATUS_TITLE[lastSignalStatus]} · ${formatDistanceToNowStrict(new Date(lastSignalAt))} ago`
      : lastSignalAt
        ? `Last reported ${formatDistanceToNowStrict(new Date(lastSignalAt))} ago`
        : 'No recent reports';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(location)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(location); } }}
      className={`premium-card p-4 cursor-pointer transition-all hover:border-primary/30 hover:-translate-y-px active:scale-[0.99] border-l-2 ${confidenceBorder(level)}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-sm text-foreground truncate">{location.name}</h3>
            <Badge variant="outline" className={`text-[10px] px-2 py-0 h-5 ${confidenceColor(level)}`}>
              {level === 'high' && (
                <span className="mr-1 h-1.5 w-1.5 rounded-full bg-success inline-block" />
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
          <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
            {location.is_paid ? (
              <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-0.5 border-border/60">
                <DollarSign className="h-2.5 w-2.5" /> Paid
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-success border-success/30 bg-success/10">
                Free
              </Badge>
            )}
            {location.overnight_allowed && (
              <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-border/60">Overnight</Badge>
            )}
            {location.truck_friendly && (
              <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-0.5 border-border/60">
                <Shield className="h-2.5 w-2.5" /> Truck-friendly
              </Badge>
            )}
            {location.total_spots != null && (
              <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-border/60 font-mono">{location.total_spots} spots</Badge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1">
            {lastSignalKind === 'verification' && <BadgeCheck className="h-3 w-3 text-primary" />}
            {verifiedLabel}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {distance != null && (
            <Badge variant="outline" className="text-[10px] h-5 px-2 font-mono font-bold border-primary/30 text-primary bg-primary/10">
              {distance.toFixed(1)} mi
            </Badge>
          )}
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}
