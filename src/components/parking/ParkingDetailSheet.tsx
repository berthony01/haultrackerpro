import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, AlertTriangle, XCircle, Lock, Star } from 'lucide-react';
import { ParkingLocation, useParkingReportsForLocation } from '@/hooks/useParkingLocations';
import { useSubmitParkingReport } from '@/hooks/useParkingReports';
import { formatDistanceToNowStrict } from 'date-fns';

interface ParkingDetailSheetProps {
  location: ParkingLocation | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasAccess: boolean;
  onUpgrade: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  available: 'Available',
  limited: 'Limited',
  full: 'Full',
};

export function ParkingDetailSheet({ location, open, onOpenChange, hasAccess, onUpgrade }: ParkingDetailSheetProps) {
  const { data: reports = [] } = useParkingReportsForLocation(location?.id ?? null);
  const submit = useSubmitParkingReport();
  const [notes, setNotes] = useState('');
  const [safety, setSafety] = useState<number>(0);

  const handleReport = async (status: 'available' | 'limited' | 'full') => {
    if (!hasAccess) {
      onUpgrade();
      return;
    }
    if (!location) return;
    try {
      await submit.mutateAsync({
        parkingId: location.id,
        status,
        safetyRating: safety > 0 ? safety : undefined,
        notes: notes.trim() || undefined,
      });
      setNotes('');
      setSafety(0);
    } catch {
      // toast handled in hook
    }
  };

  const ratings = reports.map((r) => r.safety_rating).filter((r): r is number => !!r);
  const avgSafety = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
        {location && (
          <>
            <SheetHeader className="text-left">
              <SheetTitle>{location.name}</SheetTitle>
              <SheetDescription>{location.address ?? 'No address on file'}</SheetDescription>
            </SheetHeader>

            <div className="flex flex-wrap gap-2 mt-3">
              <Badge variant="outline">{location.type.replace('_', ' ')}</Badge>
              {location.is_paid ? <Badge variant="outline">Paid</Badge> : <Badge variant="outline" className="text-success border-success/30">Free</Badge>}
              {location.overnight_allowed && <Badge variant="outline">Overnight OK</Badge>}
              {location.truck_friendly && <Badge variant="outline">Truck-friendly</Badge>}
              {location.total_spots != null && <Badge variant="outline">{location.total_spots} spots</Badge>}
            </div>

            <div className="mt-5">
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">1-tap report</p>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  variant="outline"
                  className="h-14 flex-col gap-1 border-success/40 text-success hover:bg-success/10"
                  onClick={() => handleReport('available')}
                  disabled={submit.isPending}
                >
                  {hasAccess ? <CheckCircle2 className="h-5 w-5" /> : <Lock className="h-4 w-4" />}
                  <span className="text-xs font-bold">Available</span>
                </Button>
                <Button
                  variant="outline"
                  className="h-14 flex-col gap-1 border-warning/40 text-warning hover:bg-warning/10"
                  onClick={() => handleReport('limited')}
                  disabled={submit.isPending}
                >
                  {hasAccess ? <AlertTriangle className="h-5 w-5" /> : <Lock className="h-4 w-4" />}
                  <span className="text-xs font-bold">Limited</span>
                </Button>
                <Button
                  variant="outline"
                  className="h-14 flex-col gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={() => handleReport('full')}
                  disabled={submit.isPending}
                >
                  {hasAccess ? <XCircle className="h-5 w-5" /> : <Lock className="h-4 w-4" />}
                  <span className="text-xs font-bold">Full</span>
                </Button>
              </div>
              {!hasAccess && (
                <p className="text-[11px] text-muted-foreground mt-2">
                  Reporting earns +5 points. Upgrade to Pro to participate.
                </p>
              )}
            </div>

            {hasAccess && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Optional details</p>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setSafety(safety === n ? 0 : n)}
                      className="p-1 active:scale-95 transition-transform"
                      aria-label={`${n} star safety`}
                    >
                      <Star
                        className={`h-5 w-5 ${n <= safety ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`}
                      />
                    </button>
                  ))}
                  <span className="text-xs text-muted-foreground ml-2">
                    {safety > 0 ? `${safety}/5 safety` : 'Tap to rate safety'}
                  </span>
                </div>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notes (optional) — gates, lighting, security…"
                  rows={2}
                  maxLength={300}
                />
              </div>
            )}

            <div className="mt-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Recent reports</p>
                {avgSafety != null && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                    {avgSafety.toFixed(1)}/5
                  </span>
                )}
              </div>
              {reports.length === 0 ? (
                <p className="text-xs text-muted-foreground">No reports yet — be the first.</p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {reports.slice(0, 10).map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-xs border-b border-border/40 py-1.5">
                      <span className="font-medium">{STATUS_LABEL[r.status] ?? r.status}</span>
                      <span className="text-muted-foreground">{formatDistanceToNowStrict(new Date(r.created_at))} ago</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
