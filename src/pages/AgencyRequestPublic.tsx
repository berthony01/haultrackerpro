import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  useAgencyPackages,
  useAgencyPublicView,
  useSubmitAgencyRequest,
} from '@/hooks/useAgencyWorkflow';

/**
 * Private agency request link. A driver who has been given this link can
 * review the agency's active service packages and request help.
 *
 * Critical: submitting a request never grants account access. The driver must
 * explicitly approve a specific assistant later through the delegation flow.
 */
export default function AgencyRequestPublic() {
  const { agencyId = '' } = useParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { data: agency, isLoading: agencyLoading } = useAgencyPublicView(agencyId);
  const { data: packages } = useAgencyPackages(agencyId, { publicView: true });
  const submit = useSubmitAgencyRequest();
  const { toast } = useToast();

  const [packageId, setPackageId] = useState<string>('');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);

  if (loading || agencyLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container mx-auto max-w-md px-4 py-8 space-y-4">
        <h1 className="text-xl font-semibold">Sign in to request help</h1>
        <p className="text-sm text-muted-foreground">
          You need a HaulTracker Pro driver account to send a request.
        </p>
        <Button onClick={() => navigate(`/auth?redirect=/agency/request/${agencyId}`)}>
          Sign in
        </Button>
      </div>
    );
  }

  if (!agency) {
    return (
      <div className="container mx-auto max-w-md px-4 py-8">
        <p className="text-sm text-muted-foreground">
          Agency not found or no longer accepting requests.
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{agency.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {agency.description && (
            <p className="text-sm text-muted-foreground whitespace-pre-line">
              {agency.description}
            </p>
          )}
          {agency.contact_email && (
            <p className="text-sm">
              Contact: <a className="underline" href={`mailto:${agency.contact_email}`}>{agency.contact_email}</a>
            </p>
          )}
          <p className="text-xs text-muted-foreground pt-2">
            Payment for agency services is handled outside HaulTracker Pro for now.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active service packages</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!packages || packages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This agency hasn't published any packages yet. You can still submit a request
              without selecting one.
            </p>
          ) : (
            packages.map((p) => (
              <label
                key={p.id}
                className={`block rounded-md border p-3 cursor-pointer ${
                  packageId === p.id ? 'border-primary bg-primary/5' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="pkg"
                        checked={packageId === p.id}
                        onChange={() => setPackageId(p.id)}
                      />
                      <span className="font-medium">{p.name}</span>
                    </div>
                    {p.description && (
                      <p className="text-xs text-muted-foreground mt-1">{p.description}</p>
                    )}
                  </div>
                  <div className="text-right text-xs text-muted-foreground shrink-0">
                    {p.price_display_text && <div>{p.price_display_text}</div>}
                    {p.billing_frequency_display_text && (
                      <div>{p.billing_frequency_display_text}</div>
                    )}
                  </div>
                </div>
              </label>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Send your request</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>Message</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="Tell the agency what you'd like help with."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Preferred contact</Label>
              <Input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="Email, phone, text"
              />
            </div>
            <div className="space-y-2">
              <Label>Phone (optional)</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <label className="flex items-start gap-2 text-xs">
            <Checkbox
              checked={consent}
              onCheckedChange={(v) => setConsent(v === true)}
              className="mt-0.5"
            />
            <span>
              I understand that sending this request <Badge variant="outline">does not</Badge>{' '}
              grant the agency access to my account. Access requires my explicit approval of a
              specific assistant.
            </span>
          </label>
          <Button
            disabled={!consent || submit.isPending}
            onClick={async () => {
              try {
                await submit.mutateAsync({
                  agency_id: agencyId,
                  selected_package_id: packageId || null,
                  message,
                  preferred_contact_method: contact,
                  phone,
                  consent,
                });
                toast({ title: 'Request sent' });
                navigate('/');
              } catch (e: any) {
                toast({
                  title: 'Could not send request',
                  description: e?.message,
                  variant: 'destructive',
                });
              }
            }}
          >
            Send request
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
