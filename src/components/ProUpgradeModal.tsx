import { forwardRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Crown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ProUpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  featureName: string;
}

export const ProUpgradeModal = forwardRef<HTMLDivElement, ProUpgradeModalProps>(function ProUpgradeModal(
  { open, onOpenChange, featureName },
  _ref,
) {
  const navigate = useNavigate();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="text-center items-center">
          <div className="rounded-2xl bg-primary/10 p-4 mb-2">
            <Crown className="h-8 w-8 text-primary" />
          </div>
          <DialogTitle className="font-heading text-lg">Pro Feature</DialogTitle>
          <DialogDescription className="text-sm">
            {featureName} is available with the Pro plan.
          </DialogDescription>
        </DialogHeader>
        <Button
          className="w-full h-11 font-bold mt-2"
          onClick={() => {
            onOpenChange(false);
            window.location.hash = '';
            navigate('/pricing');
          }}
        >
          <Crown className="h-4 w-4 mr-2" />
          Upgrade to Pro
        </Button>
      </DialogContent>
    </Dialog>
  );
}
