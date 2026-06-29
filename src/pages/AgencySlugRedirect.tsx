import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useResolveAgencySlug } from '@/hooks/useAgencyWorkflow';

/**
 * Phase 4C — Pretty agency URL. /a/:slug resolves to the agency id and
 * forwards to the existing /agency/request/:agencyId page.
 */
export default function AgencySlugRedirect() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const { data: agencyId, isLoading, isError } = useResolveAgencySlug(slug);

  useEffect(() => {
    if (agencyId) navigate(`/agency/request/${agencyId}`, { replace: true });
  }, [agencyId, navigate]);

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-10 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto" />
      </div>
    );
  }
  if (isError || !agencyId) {
    return (
      <div className="container mx-auto max-w-md px-4 py-10 text-center space-y-2">
        <h1 className="text-lg font-semibold">Agency not found</h1>
        <p className="text-sm text-muted-foreground">
          That link is no longer active. Ask the agency for an updated link.
        </p>
      </div>
    );
  }
  return null;
}
