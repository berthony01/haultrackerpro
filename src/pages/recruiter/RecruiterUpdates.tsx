import { useNavigate } from 'react-router-dom';
import SEOHead from '@/components/SEOHead';
import { buildBreadcrumbSchema } from '@/lib/breadcrumbSchema';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, Sparkles, Check, ArrowRight, ShieldCheck, Truck } from 'lucide-react';
import { RECRUITER_RELEASE_NOTES } from '@/lib/recruiterReleaseNotes';

function formatDate(iso: string): string {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return iso; }
}

export default function RecruiterUpdates() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background pb-16">
      <SEOHead
        title="What's New for Recruiters | HaulTrackerPro"
        description="Recent updates and improvements for HaulTrackerPro recruiters."
        path="/recruiter/updates"
        jsonLd={buildBreadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'For Recruiters', path: '/recruiters' }, { name: 'Recruiter Updates', path: '/recruiter/updates' }])}
      />

      <nav className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-3xl mx-auto flex items-center justify-between px-4 py-3">
          <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold">HaulTrackerPro</span>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto p-4 space-y-5 pt-8">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card to-primary/5 p-5 shadow-card">
          <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-primary/10 blur-2xl pointer-events-none" />
          <div className="relative flex items-start gap-3">
            <div className="rounded-xl bg-primary/15 p-2.5 shrink-0">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-primary/15 text-primary mb-1.5">
                <ShieldCheck className="h-3 w-3" /> For Recruiters
              </div>
              <h1 className="text-2xl font-black font-heading leading-tight">What's New</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Recruiter-side updates and improvements.</p>
            </div>
          </div>
        </div>

        {RECRUITER_RELEASE_NOTES.map((release) => (
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
                    <Button key={link.to} variant="outline" size="sm" className="rounded-xl gap-1" onClick={() => navigate(link.to)}>
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
    </div>
  );
}
