import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface DeleteAccountModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteAccountModal({ open, onOpenChange }: DeleteAccountModalProps) {
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (confirmation !== 'DELETE') return;
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('delete-account', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (response.error) throw new Error(response.error.message || 'Failed to delete account');

      toast.success('Account deleted successfully.');
      await supabase.auth.signOut();
      window.location.href = '/auth';
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete account');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader className="text-center">
          <div className="mx-auto mb-2 inline-flex items-center justify-center rounded-2xl bg-destructive/10 p-4">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <DialogTitle className="text-lg font-heading">Delete Account</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground leading-relaxed text-left">
            This deletes your <span className="font-semibold text-foreground">entire personal login</span> — not only the driver or recruiter role you are currently viewing.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 pt-1 text-xs text-muted-foreground leading-relaxed list-disc pl-5">
          <li>
            Any driver and recruiter subscriptions owned by this login are <span className="font-semibold text-foreground">cancelled as part of permanent deletion</span> before database cleanup. This is different from a normal cancel-at-period-end cancellation from the billing portal.
          </li>
          <li>
            Personal operational records — <span className="font-semibold text-foreground">loads, expenses, fuel logs, settings</span>, and similar direct account data — are targeted for transactional cleanup.
          </li>
          <li>
            Some shared, audit, billing/payment, application, signature, security, fraud-prevention, dispute, legal, compliance, backup, or third-party-held records <span className="font-semibold text-foreground">may be retained, detached, anonymized</span>, or remain outside HaulTrackerPro where operationally or lawfully necessary.
          </li>
          <li>
            If you <span className="font-semibold text-foreground">own an agency</span>, personal deletion is blocked until agency ownership is transferred or the agency is closed through support.
          </li>
          <li>
            <span className="font-semibold text-foreground">Export anything you need first.</span> Successful deletion has no self-service undo.
          </li>
        </ul>

        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs">
          <Link
            to="/docs/account-deletion-data-retention"
            className="text-primary hover:underline font-medium"
            onClick={(e) => e.stopPropagation()}
          >
            What deletion removes and may retain
          </Link>
          <Link
            to="/docs/billing-cancellation"
            className="text-primary hover:underline font-medium"
            onClick={(e) => e.stopPropagation()}
          >
            Cancellation vs. permanent deletion
          </Link>
        </div>

        <div className="space-y-3 pt-3">
          <p className="text-xs font-semibold text-muted-foreground">
            Type <span className="font-mono text-destructive">DELETE</span> to confirm:
          </p>
          <Input
            value={confirmation}
            onChange={e => setConfirmation(e.target.value)}
            placeholder="Type DELETE"
            className="rounded-xl font-mono"
          />
          <Button
            variant="destructive"
            className="w-full h-11 rounded-xl font-bold"
            disabled={confirmation !== 'DELETE' || loading}
            onClick={handleDelete}
          >
            {loading ? 'Deleting...' : 'Permanently Delete Account'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
