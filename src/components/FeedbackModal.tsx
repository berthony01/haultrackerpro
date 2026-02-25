import { useState } from 'react';
import { useFeedback } from '@/hooks/useFeedback';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Truck, ThumbsUp, AlertCircle, Bug, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

interface FeedbackModalProps {
  totalLoads: number;
  open: boolean;
  onClose: () => void;
}

const options = [
  { value: 'great', label: 'Great!', icon: ThumbsUp, description: "It's working well for me" },
  { value: 'needs_improvement', label: 'Needs improvement', icon: AlertCircle, description: 'Some things could be better' },
  { value: 'found_bug', label: 'Found a bug', icon: Bug, description: "Something isn't working right" },
];

export function FeedbackModal({ totalLoads, open, onClose }: FeedbackModalProps) {
  const { submitFeedback } = useFeedback();
  const [submitted, setSubmitted] = useState(false);

  const handleSelect = (response: string) => {
    submitFeedback.mutate(
      { response, loadsCount: totalLoads },
      {
        onSuccess: () => {
          setSubmitted(true);
          toast.success('Thanks for your feedback!');
          setTimeout(onClose, 1800);
        },
        onError: (e) => toast.error(e.message),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm rounded-2xl">
        {submitted ? (
          <div className="py-8 text-center space-y-3">
            <div className="inline-flex items-center justify-center rounded-2xl bg-success/10 p-4">
              <CheckCircle className="h-10 w-10 text-success" />
            </div>
            <p className="text-lg font-bold">Thank you!</p>
            <p className="text-sm text-muted-foreground">Your feedback helps us improve.</p>
          </div>
        ) : (
          <>
            <DialogHeader className="text-center">
              <div className="mx-auto mb-2 inline-flex items-center justify-center rounded-2xl bg-primary/10 p-4">
                <Truck className="h-8 w-8 text-primary" />
              </div>
              <DialogTitle className="text-xl font-heading">
                You've logged {totalLoads} loads!
              </DialogTitle>
              <DialogDescription>
                How's HaulTracker working for you?
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 pt-2">
              {options.map(opt => (
                <Button
                  key={opt.value}
                  variant="outline"
                  className="w-full h-14 justify-start gap-3 rounded-xl active:scale-[0.98] transition-transform"
                  onClick={() => handleSelect(opt.value)}
                  disabled={submitFeedback.isPending}
                >
                  <opt.icon className="h-5 w-5 text-primary shrink-0" />
                  <div className="text-left">
                    <p className="font-semibold text-sm">{opt.label}</p>
                    <p className="text-xs text-muted-foreground">{opt.description}</p>
                  </div>
                </Button>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
