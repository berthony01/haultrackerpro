import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { useDriverReferrals } from '@/hooks/opportunities/useDriverReferrals';
import { useRecruiterReferralSettings } from '@/hooks/opportunities/useRecruiterReferralSettings';
import { ReferralTermsDisplay } from './ReferralTermsDisplay';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunityId: string;
  recruiterId: string;
  opportunityTitle?: string | null;
  companyName?: string | null;
  isPro?: boolean;
  onUpgrade?: () => void;
}

export function ReferDriverDialog({
  open,
  onOpenChange,
  opportunityId,
  recruiterId,
  opportunityTitle,
  companyName,
  isPro = true,
  onUpgrade,
}: Props) {
  const { create } = useDriverReferrals();
  const { settings, isLoading: settingsLoading } = useRecruiterReferralSettings(recruiterId);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');

  const reset = () => {
    setName('');
    setEmail('');
    setPhone('');
    setNote('');
  };

  const hasContact =
    name.trim().length > 0 || email.trim().length > 0 || phone.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPro) {
      toast.error('Driver referrals are a Pro feature.');
      return;
    }
    if (!hasContact) {
      toast.error('Add at least a name, email, or phone number.');
      return;
    }
    create.mutate(
      {
        opportunity_id: opportunityId,
        recruiter_id: recruiterId,
        referred_driver_name: name,
        referred_driver_email: email,
        referred_driver_phone: phone,
        referred_driver_note: note,
      },
      {
        onSuccess: () => {
          toast.success('Referral sent. You can track progress in My Referrals.');
          reset();
          onOpenChange(false);
        },
        onError: (e: Error) => toast.error(e.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Refer a Driver</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {opportunityTitle ? <>For <span className="text-foreground font-semibold">{opportunityTitle}</span>{companyName ? <> at {companyName}</> : null}.</> : 'Share this opportunity with a driver you know.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ref-name">Driver name</Label>
            <Input
              id="ref-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Smith"
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ref-email">Email</Label>
            <Input
              id="ref-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="driver@example.com"
              maxLength={200}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ref-phone">Phone</Label>
            <Input
              id="ref-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-5555"
              maxLength={40}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ref-note">Note (optional)</Label>
            <Textarea
              id="ref-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything the recruiter should know"
              maxLength={500}
              rows={3}
            />
          </div>

          <ReferralTermsDisplay settings={settings} isLoading={settingsLoading} />

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !hasContact}>
              {create.isPending ? 'Sending…' : 'Send Referral'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
