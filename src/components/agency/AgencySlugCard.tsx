import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Copy, Link2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSetAgencySlug } from '@/hooks/useAgencyWorkflow';
import { useAgencyEntitlement } from '@/hooks/useAgencyEntitlement';


/**
 * Owner-only: pick a memorable public slug so drivers can reach the agency
 * request page at /a/<slug> instead of /agency/request/<uuid>.
 */
export function AgencySlugCard({ agencyId, isOwner }: { agencyId: string; isOwner: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const set = useSetAgencySlug();
  const { data: slug } = useQuery({
    queryKey: ['agency-profile-slug', agencyId],
    enabled: !!agencyId,
    staleTime: 60_000,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await (supabase as any)
        .from('agency_profiles')
        .select('slug')
        .eq('id', agencyId)
        .maybeSingle();
      if (error) throw error;
      return (data?.slug as string | null) ?? null;
    },
  });

  const [value, setValue] = useState(slug ?? '');
  useEffect(() => {
    setValue(slug ?? '');
  }, [slug]);

  const publicUrl = slug
    ? `${window.location.origin}/a/${slug}`
    : `${window.location.origin}/agency/request/${agencyId}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" />
          Public request link
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Share this link with drivers so they can request help. They still must approve any
          specific assistant before you can act on their account.
        </p>

        {isOwner ? (
          <div className="space-y-2">
            <Label htmlFor="ag-slug">Custom URL slug (optional)</Label>
            <div className="flex gap-2">
              <Input
                id="ag-slug"
                value={value}
                onChange={(e) => setValue(e.target.value.toLowerCase())}
                placeholder="sunrise-bookkeeping"
                maxLength={40}
              />
              <Button
                size="sm"
                disabled={set.isPending || value === (slug ?? '')}
                onClick={async () => {
                  try {
                    await set.mutateAsync({
                      agencyId,
                      slug: value.trim() === '' ? null : value.trim(),
                    });
                    qc.invalidateQueries({ queryKey: ['agency-profile-slug', agencyId] });
                    toast({ title: 'Slug saved' });
                  } catch (e: any) {
                    toast({
                      title: 'Could not save slug',
                      description: e?.message,
                      variant: 'destructive',
                    });
                  }
                }}
              >
                Save
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              3–40 chars, lowercase letters, digits, or dashes. Leave blank to remove.
            </p>
          </div>
        ) : null}

        <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-2">
          <p className="font-medium">Share this link</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-background px-2 py-1">{publicUrl}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(publicUrl);
                toast({ title: 'Link copied' });
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
