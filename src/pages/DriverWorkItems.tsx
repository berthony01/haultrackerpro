import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ClipboardList, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  useDriverRespondWorkItem,
  useMyWaitingWorkItem,
  useMyWaitingWorkItems,
} from '@/hooks/useAgencyWorkflow';

/**
 * Phase 4C — Driver-side view of tasks an agency has flagged as
 * "waiting on driver". Used both as a list and as a notification deep link.
 *
 * Routes:
 *   /driver/work-items           → list
 *   /driver/work-items/:id       → single item with response form
 */
export default function DriverWorkItems() {
  const { id } = useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!user) {
    const target = id ? `/driver/work-items/${id}` : '/driver/work-items';
    navigate(`/auth?next=${encodeURIComponent(target)}`);
    return null;
  }


  return (
    <div className="container mx-auto max-w-2xl px-4 py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-primary" />
          {id ? 'Agency request' : 'Agency requests'}
        </h1>
      </div>

      {id ? <SingleItem id={id} /> : <ListAll />}
    </div>
  );
}

function ListAll() {
  const { data, isLoading } = useMyWaitingWorkItems();

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nothing waiting on you right now.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {data.map((w) => (
        <Link key={w.id} to={`/driver/work-items/${w.id}`}>
          <Card className="transition hover:border-primary/60">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-sm">{w.title}</CardTitle>
                <Badge variant="outline">{w.priority}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{w.agency_name}</p>
            </CardHeader>
            <CardContent className="pt-0 text-xs text-muted-foreground line-clamp-2">
              {w.description ?? 'Tap to view and respond.'}
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

function SingleItem({ id }: { id: string }) {
  const { data: item, isLoading } = useMyWaitingWorkItem(id);
  const respond = useDriverRespondWorkItem();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [text, setText] = useState('');

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!item) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          This request is no longer available. Your agency may have already closed it.
        </CardContent>
      </Card>
    );
  }

  const alreadyResponded =
    item.status !== 'waiting_on_driver' && !!item.last_driver_response_at;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{item.title}</CardTitle>
          <Badge variant="outline">{(item.status ?? '').replace(/_/g, ' ')}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          From {item.agency_name}
          {item.due_date ? ` · due ${item.due_date}` : ''}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {item.description && (
          <p className="text-sm whitespace-pre-line">{item.description}</p>
        )}

        {alreadyResponded ? (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="text-xs font-medium text-muted-foreground">Your reply</p>
            <p className="mt-1 whitespace-pre-line">{item.last_driver_response}</p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Your agency has been notified.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="dr-reply">Your response</Label>
            <Textarea
              id="dr-reply"
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Share what the agency needs to know."
            />
            <Button
              disabled={respond.isPending || text.trim().length < 1}
              onClick={async () => {
                try {
                  await respond.mutateAsync({ id, response: text.trim() });
                  toast({ title: 'Reply sent' });
                  navigate('/driver/work-items');
                } catch (e: any) {
                  toast({
                    title: 'Could not send',
                    description: e?.message,
                    variant: 'destructive',
                  });
                }
              }}
            >
              Send reply
            </Button>
            <p className="text-[11px] text-muted-foreground">
              This sends your message to the agency. It does <strong>not</strong> grant the
              agency new access to your account.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
