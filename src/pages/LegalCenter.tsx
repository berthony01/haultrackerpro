import { Link } from 'react-router-dom';
import { ArrowLeft, Scale, ShieldCheck, Clock, ExternalLink } from 'lucide-react';
import SEOHead from '@/components/SEOHead';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  getAllPolicies,
  isPolicyLinkable,
  POLICY_METADATA_PENDING_LABEL,
  type PolicyEntry,
} from '@/lib/legal/policyRegistry';

const statusLabel = (entry: PolicyEntry): string => {
  switch (entry.status) {
    case 'live':
      return 'Available now';
    case 'attorney_review_required':
      return 'Attorney review required before final publication';
    case 'planned':
    default:
      return 'In preparation';
  }
};

const statusVariant = (entry: PolicyEntry): 'secondary' | 'outline' => {
  return entry.status === 'live' ? 'secondary' : 'outline';
};

const PolicyCard = ({ entry }: { entry: PolicyEntry }) => {
  const linkable = isPolicyLinkable(entry);
  const versionText =
    entry.version && entry.effectiveDate
      ? `Version ${entry.version} — effective ${entry.effectiveDate}`
      : POLICY_METADATA_PENDING_LABEL;

  const inner = (
    <Card
      className={
        'h-full transition-shadow ' +
        (linkable ? 'hover:shadow-lg border-primary/20' : 'border-dashed opacity-90')
      }
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug">{entry.title}</CardTitle>
          <Badge variant={statusVariant(entry)} className="shrink-0">
            {entry.status === 'live'
              ? 'Live'
              : entry.status === 'attorney_review_required'
              ? 'Legal review'
              : 'Planned'}
          </Badge>
        </div>
        <CardDescription className="text-sm leading-relaxed">
          {entry.description}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          {versionText}
        </p>
        <p className="text-xs font-medium text-muted-foreground">{statusLabel(entry)}</p>
        {linkable && (
          <span className="inline-flex items-center text-sm font-medium text-primary">
            Read policy <ExternalLink className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
          </span>
        )}
      </CardContent>
    </Card>
  );

  if (linkable) {
    return (
      <Link to={entry.route} aria-label={`Read ${entry.title}`} className="block h-full">
        {inner}
      </Link>
    );
  }

  return (
    <div
      role="group"
      aria-label={`${entry.title} — ${statusLabel(entry)}`}
      aria-disabled="true"
      className="block h-full cursor-not-allowed"
    >
      {inner}
    </div>
  );
};

const LegalCenter = () => {
  const policies = getAllPolicies();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEOHead
        title="Legal Center | HaulTrackerPro"
        description="Directory of HaulTrackerPro legal policies. Terms of Service and Privacy Policy are available today; additional policies are being prepared for publication and legal review."
        path="/legal"
      />

      <header className="border-b border-border/60 bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to home
          </Link>
          <Link to="/docs" className="text-sm text-muted-foreground hover:text-primary">
            Help Center →
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <Scale className="h-6 w-6 text-primary" aria-hidden="true" />
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Legal Center</h1>
          </div>
          <p className="max-w-3xl text-base sm:text-lg text-muted-foreground leading-relaxed">
            The <strong>Terms of Service</strong> and <strong>Privacy Policy</strong> are
            currently available. Additional policies — including an Acceptable Use Policy,
            a Subscription / Cancellation / Refund Policy, an Account Deletion & Data
            Retention Policy, and Recruiting & Opportunity Posting Rules — are being
            prepared and, where applicable, are undergoing legal review before publication.
          </p>
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
          {policies.map((entry) => (
            <PolicyCard key={entry.slug} entry={entry} />
          ))}
        </section>

        <section
          aria-labelledby="legal-disclaimer"
          className="rounded-xl border border-primary/30 bg-primary/5 p-5 sm:p-6"
        >
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-primary mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <h2 id="legal-disclaimer" className="text-lg font-semibold mb-2">
                Informational only
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                This directory is informational and does not replace professional legal
                advice. For product instructions and role-specific guides, visit the{' '}
                <Link to="/docs" className="text-primary underline">Help Center</Link>.
              </p>
            </div>
          </div>
        </section>

        <div className="mt-10 flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link to="/">Back to home</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link to="/docs">Help Center</Link>
          </Button>
        </div>
      </main>
    </div>
  );
};

export default LegalCenter;
