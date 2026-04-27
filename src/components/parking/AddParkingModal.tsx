import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { toast } from 'sonner';

interface AddParkingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type LocType = 'truck_stop' | 'rest_area' | 'warehouse' | 'street' | 'private';

export function AddParkingModal({ open, onOpenChange }: AddParkingModalProps) {
  const { user } = useAuth();
  const { isPro } = useSubscription();
  const hasAccess = isPro;
  const qc = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [type, setType] = useState<LocType>('truck_stop');
  const [isPaid, setIsPaid] = useState(false);
  const [overnight, setOvernight] = useState(true);
  const [truckFriendly, setTruckFriendly] = useState(true);

  const reset = () => {
    setName(''); setAddress(''); setLatitude(''); setLongitude('');
    setType('truck_stop'); setIsPaid(false); setOvernight(true); setTruckFriendly(true);
  };

  const handleSubmit = async () => {
    if (!user) return;
    if (!hasAccess) {
      toast.error('Adding parking spots is a Pro feature');
      return;
    }
    const trimmedName = name.trim();
    if (trimmedName.length < 3) {
      toast.error('Name must be at least 3 characters');
      return;
    }
    if (trimmedName.length > 64) {
      toast.error('Name must be 64 characters or less');
      return;
    }
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      toast.error('Latitude must be between -90 and 90');
      return;
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      toast.error('Longitude must be between -180 and 180');
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.from('parking_locations').insert({
      name: trimmedName,
      address: address.trim() || null,
      latitude: lat,
      longitude: lng,
      type,
      is_paid: isPaid,
      overnight_allowed: overnight,
      truck_friendly: truckFriendly,
      created_by: user.id,
    });
    setSubmitting(false);

    if (error) {
      // 23505 = unique_violation from parking_locations_dedupe
      if ((error as { code?: string }).code === '23505') {
        toast.error('A parking spot with that name and location already exists');
      } else {
        toast.error(error.message);
      }
      return;
    }
    toast.success('Parking spot added — thanks for helping the network');
    qc.invalidateQueries({ queryKey: ['parking-locations'] });
    reset();
    onOpenChange(false);
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation not supported');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude.toFixed(6));
        setLongitude(pos.coords.longitude.toFixed(6));
      },
      (err) => toast.error(err.message),
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a parking spot</DialogTitle>
          <DialogDescription>Help drivers find safe places to park.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="pname">Name</Label>
            <Input id="pname" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pilot Travel Center" />
          </div>
          <div>
            <Label htmlFor="paddr">Address</Label>
            <Input id="paddr" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Main St, City, ST" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="plat">Latitude</Label>
              <Input id="plat" inputMode="decimal" value={latitude} onChange={(e) => setLatitude(e.target.value)} placeholder="35.4423" />
            </div>
            <div>
              <Label htmlFor="plng">Longitude</Label>
              <Input id="plng" inputMode="decimal" value={longitude} onChange={(e) => setLongitude(e.target.value)} placeholder="-97.6300" />
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={useMyLocation}>
            Use my current location
          </Button>
          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as LocType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="truck_stop">Truck stop</SelectItem>
                <SelectItem value="rest_area">Rest area</SelectItem>
                <SelectItem value="warehouse">Warehouse</SelectItem>
                <SelectItem value="street">Street</SelectItem>
                <SelectItem value="private">Private lot</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="ppaid">Paid parking</Label>
            <Switch id="ppaid" checked={isPaid} onCheckedChange={setIsPaid} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="povr">Overnight allowed</Label>
            <Switch id="povr" checked={overnight} onCheckedChange={setOvernight} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="ptrk">Truck-friendly</Label>
            <Switch id="ptrk" checked={truckFriendly} onCheckedChange={setTruckFriendly} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Adding…' : 'Add spot'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
