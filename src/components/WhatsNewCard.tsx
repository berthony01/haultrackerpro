import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sparkles, X, ArrowRight } from 'lucide-react';
import { LATEST_RELEASE } from '@/lib/releaseNotes';

interface WhatsNewCardProps {
  onOpen: () => void;
  onDismiss: () => void;
}

export function WhatsNewCard({ onOpen, onDismiss }: WhatsNewCardProps) {
  return (
    <Card className="relative overflow-hidden border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card shadow-card">
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss what's new"
        className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
      <CardContent className="p-4">
        <div className="flex items-start gap-3 pr-6">
          <div className="rounded-xl bg-primary/15 p-2 shrink-0">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
                What's New
              </p>
              <h3 className="text-sm font-bold leading-tight mt-0.5">{LATEST_RELEASE.title}</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">
                {LATEST_RELEASE.summary}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-lg text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
              onClick={onOpen}
            >
              See updates
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
