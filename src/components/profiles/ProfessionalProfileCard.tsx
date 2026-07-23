import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Briefcase, IdCard, ArrowRight } from 'lucide-react';
import {
  useMyProfessionalProfile,
  type ProfessionalProfileSummary,
} from '@/hooks/useProfessionalProfile';

/**
 * Compact entry card the user sees inside their Assistant Access Center
 * or Agency Console. Explicitly separates the personal Professional
 * Profile from the agency business profile and from access permissions.
 */
export function MyProfessionalProfileCard({
  context,
}: {
  context: 'assistant' | 'agency';
}) {
  const { data: profile, isLoading } = useMyProfessionalProfile();

  const heading = 'Your professional profile';
  const contextLine =
    context === 'agency'
      ? 'This is your personal professional identity — separate from the agency business profile, and separate from your sign-in account.'
      : 'This is your personal professional identity — separate from your sign-in account and from any driver Leaderboard Identity.';

  return (
    <Card data-testid="my-professional-profile-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <IdCard className="h-4 w-4 text-primary" />
          {heading}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {contextLine} Editing it never grants driver access, agency access, a role,
          or any permission.
        </p>

        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : profile ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <Briefcase className="h-3 w-3" /> {profile.availability}
            </Badge>
            <Badge variant="outline">{profile.visibility.replace('_', ' ')}</Badge>
            <span className="text-xs text-muted-foreground truncate">
              {profile.display_name}
              {profile.professional_title ? ` · ${profile.professional_title}` : ''}
            </span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            You haven't created a professional profile yet.
          </p>
        )}

        <div>
          <Button asChild size="sm" variant="outline">
            <Link to="/professional-profile">
              {profile ? 'Manage professional profile' : 'Create professional profile'}
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Reusable summary render for a connection's Professional Profile.
 * Accepts the batch RPC row or null. When no row is returned we show
 * neutral copy that never reveals whether the profile is missing,
 * private, or the caller is unauthorized.
 */
export const PROFESSIONAL_PROFILE_UNAVAILABLE_COPY =
  'No professional profile is available for this connection.';

export function ProfessionalProfileSummaryCard({
  summary,
}: {
  summary?: ProfessionalProfileSummary | null;
}) {
  if (!summary) {
    return (
      <p
        data-testid="professional-profile-summary-unavailable"
        className="text-xs text-muted-foreground"
      >
        {PROFESSIONAL_PROFILE_UNAVAILABLE_COPY}
      </p>
    );
  }

  const services = summary.services.slice(0, 4);
  const areas = summary.service_areas.slice(0, 4);

  return (
    <div
      data-testid="professional-profile-summary-card"
      className="rounded-md border bg-muted/30 p-3 text-xs space-y-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-sm">{summary.display_name}</span>
        {summary.professional_title && (
          <span className="text-muted-foreground">· {summary.professional_title}</span>
        )}
        <Badge variant="secondary" className="ml-auto gap-1">
          {summary.availability}
        </Badge>
      </div>

      {(summary.years_experience !== null || services.length > 0 || areas.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {summary.years_experience !== null && (
            <Badge variant="outline" className="text-[11px] font-normal">
              {summary.years_experience} yr{summary.years_experience === 1 ? '' : 's'}
            </Badge>
          )}
          {services.map((s) => (
            <Badge key={`s-${s}`} variant="outline" className="text-[11px] font-normal">
              {s}
            </Badge>
          ))}
          {areas.map((a) => (
            <Badge key={`a-${a}`} variant="outline" className="text-[11px] font-normal">
              {a}
            </Badge>
          ))}
        </div>
      )}

      {summary.bio && (
        <p className="text-muted-foreground line-clamp-3">{summary.bio}</p>
      )}

      {(summary.contact_email || summary.contact_phone) && (
        <div className="pt-1 text-muted-foreground">
          {summary.contact_email && <div>Contact email: {summary.contact_email}</div>}
          {summary.contact_phone && <div>Contact phone: {summary.contact_phone}</div>}
        </div>
      )}
    </div>
  );
}
