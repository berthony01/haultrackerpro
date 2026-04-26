import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles, ArrowRight, Check } from 'lucide-react';
import { LATEST_RELEASE } from '@/lib/releaseNotes';

interface WhatsNewModalProps {
  open: boolean;
  onClose: () => void;
}

export function WhatsNewModal({ open, onClose }: WhatsNewModalProps) {
  const navigate = useNavigate();
  const release = LATEST_RELEASE;

  const handleNavigate = (to: string) => {
    onClose();
    navigate(to);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="rounded-lg bg-primary/15 p-1.5">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-primary">
              What's New
            </span>
          </div>
          <DialogTitle className="text-xl leading-tight">{release.title}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed pt-1">
            {release.summary}
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 pt-2">
          {release.highlights.map((h, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <span className="text-foreground/90">{h}</span>
            </li>
          ))}
        </ul>

        {release.links && release.links.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {release.links.map((link) => (
              <Button
                key={link.to}
                variant="outline"
                size="sm"
                className="rounded-xl gap-1"
                onClick={() => handleNavigate(link.to)}
              >
                {link.label}
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            ))}
          </div>
        )}

        <DialogFooter className="pt-2">
          <Button onClick={onClose} className="w-full sm:w-auto rounded-xl font-bold">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
