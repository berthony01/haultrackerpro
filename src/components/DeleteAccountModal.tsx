import { useState } from 'react';
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
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader className="text-center">
          <div className="mx-auto mb-2 inline-flex items-center justify-center rounded-2xl bg-destructive/10 p-4">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <DialogTitle className="text-lg font-heading">Delete Account</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
            This will permanently delete your account and all associated data including loads, expenses, snapshots, and reports. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-2">
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
