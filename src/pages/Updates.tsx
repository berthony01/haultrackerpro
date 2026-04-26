import { useNavigate } from 'react-router-dom';
import SEOHead from '@/components/SEOHead';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, Sparkles, Check, ArrowRight } from 'lucide-react';
import { BottomNav } from '@/components/BottomNav';
import { RELEASE_NOTES } from '@/lib/releaseNotes';

function formatDate(iso: string): string {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function Updates() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background pb-24">
      <SEOHead
        title="What's New | HaulTrackerPro"
        description="Recent updates and improvements to HaulTrackerPro."
        path="/updates"
        noindex
      />
      <div className="max-w-3xl mx-auto p-4 space-y-5">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/dashboard')}
          className="h-8 px-2 -ml-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
        </Button>

        <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card to-primary/5 p-5 shadow-card">
          <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-primary/10 blur-2xl pointer-events-none" />
          <div className="relative flex items-start gap-3">
            <div className="rounded-xl bg-primary/15 p-2.5 shrink-0">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-black font-heading leading-tight">What's New</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Recent updates, improvements, and new features.
              </p>
            </div>
          </div>
        </div>

        {RELEASE_NOTES.map((release) => (
          <Card key={release.id} className="shadow-card">
            <CardContent className="p-5 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-primary/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                  {release.version}
                </span>
                <span className="text-xs text-muted-foreground">{formatDate(release.date)}</span>
              </div>
              <h2 className="text-lg font-bold leading-tight">{release.title}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{release.summary}</p>

              <ul className="space-y-2 pt-1">
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
                      onClick={() => navigate(link.to)}
                    >
                      {link.label}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <BottomNav active="dashboard" onNavigate={() => navigate('/dashboard')} />
    </div>
  );
}
