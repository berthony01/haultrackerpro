import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Building2, ArrowLeft, Copy, Users, ShieldCheck } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useAgencyMembers,
  useAgencyMutations,
  useMyAgency,
} from '@/hooks/useAgency';
import { useToast } from '@/hooks/use-toast';
import { useActingContext } from '@/hooks/useActingContext';
import { ServicePackagesSection } from '@/components/agency/ServicePackagesSection';
import { ClientRequestsSection } from '@/components/agency/ClientRequestsSection';
import { ClientListSection } from '@/components/agency/ClientListSection';
import { WorkQueueSection } from '@/components/agency/WorkQueueSection';
import { AgencyAuditSection } from '@/components/agency/AgencyAuditSection';
import { AgencySlugCard } from '@/components/agency/AgencySlugCard';
import { AgencyPlanLimitsCard } from '@/components/agency/AgencyPlanLimitsCard';

/**
 * Private agency area. Anyone signed-in can create one personal agency profile
 * to manage their bookkeeping side-hustle. Members never gain access to a
 * driver's account just by joining — driver delegation stays explicit through
 * Driver Assistants invites.
 */
export default function AgencyDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: agency, isLoading } = useMyAgency();
  const { managedDrivers } = useActingContext();

  // Notification deep-link: /agency?workItem=:id focuses the work queue tab.
  const focusedWorkItemId = new URLSearchParams(location.search).get('workItem');
  const [activeTab, setActiveTab] = useState<string>(focusedWorkItemId ? 'work' : 'overview');
  useEffect(() => {
    if (focusedWorkItemId) setActiveTab('work');
  }, [focusedWorkItemId]);

  if (!user) {
    return (
      <AppShell>
        <div className="container mx-auto px-4 py-8">
          <p>Please sign in.</p>
        </div>
      </AppShell>
    );
  }
  if (isLoading) {
    return (
      <AppShell>
        <div className="container mx-auto px-4 py-8">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
    <div className="container mx-auto max-w-3xl px-4 py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/assistant')}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Building2 className="h-6 w-6 text-primary" />
          Agency
        </h1>
      </div>

      {!agency ? (
        <CreateAgencyCard />
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="flex flex-wrap">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="packages">Packages</TabsTrigger>
            <TabsTrigger value="requests">Requests</TabsTrigger>
            <TabsTrigger value="clients">Clients</TabsTrigger>
            <TabsTrigger value="work">Work queue</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="space-y-4">
            <AgencyDetailCard agency={agency} drivers={managedDrivers.length} />
            <AgencyPlanLimitsCard agencyId={agency.id} />
          </TabsContent>
          <TabsContent value="packages">
            <ServicePackagesSection agencyId={agency.id} />
          </TabsContent>
          <TabsContent value="requests">
            <ClientRequestsSection agencyId={agency.id} />
          </TabsContent>
          <TabsContent value="clients">
            <ClientListSection agencyId={agency.id} />
          </TabsContent>
          <TabsContent value="work">
            <WorkQueueSection agencyId={agency.id} focusedWorkItemId={focusedWorkItemId} />
          </TabsContent>
          <TabsContent value="activity">
            <AgencyAuditSection agencyId={agency.id} />
          </TabsContent>
        </Tabs>
      )}
    </div>
    </AppShell>
  );
}

function CreateAgencyCard() {
  const { create } = useAgencyMutations();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Create your agency profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          For people who want to manage paperwork for multiple truckers as a side hustle or
          small business. Drivers still invite you individually — this profile just keeps your
          business identity in one place.
        </p>
        <div className="space-y-2">
          <Label htmlFor="ag-name">Agency name</Label>
          <Input
            id="ag-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sunrise Back Office"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ag-desc">Description (optional)</Label>
          <Textarea
            id="ag-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What services do you offer?"
            rows={3}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ag-email">Contact email (optional)</Label>
          <Input
            id="ag-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@business.com"
          />
        </div>
        <Button
          disabled={create.isPending || name.trim().length < 2}
          onClick={async () => {
            try {
              await create.mutateAsync({
                name: name.trim(),
                description: description.trim() || undefined,
                contact_email: email.trim() || undefined,
              });
              toast({ title: 'Agency created' });
            } catch (e: any) {
              toast({
                title: 'Could not create agency',
                description: e?.message,
                variant: 'destructive',
              });
            }
          }}
        >
          Create agency
        </Button>
      </CardContent>
    </Card>
  );
}

function AgencyDetailCard({
  agency,
  drivers,
}: {
  agency: NonNullable<ReturnType<typeof useMyAgency>['data']>;
  drivers: number;
}) {
  const { update, invite, revoke } = useAgencyMutations();
  const { data: members } = useAgencyMembers(agency.id);
  const { toast } = useToast();
  const [name, setName] = useState(agency.name);
  const [desc, setDesc] = useState(agency.description ?? '');
  const [email, setEmail] = useState(agency.contact_email ?? '');
  const [inviteEmail, setInviteEmail] = useState('');
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
  const isOwner = agency.my_role === 'agency_owner';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{agency.name}</CardTitle>
            <Badge variant="outline">{agency.my_role.replace('agency_', '')}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isOwner ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="agn">Agency name</Label>
                <Input id="agn" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agd">Description</Label>
                <Textarea
                  id="agd"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="age">Contact email</Label>
                <Input
                  id="age"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={update.isPending}
                onClick={async () => {
                  try {
                    await update.mutateAsync({
                      name: name.trim(),
                      description: desc.trim() || null,
                      contact_email: email.trim() || null,
                      status: 'active',
                    });
                    toast({ title: 'Agency updated' });
                  } catch (e: any) {
                    toast({
                      title: 'Could not save',
                      description: e?.message,
                      variant: 'destructive',
                    });
                  }
                }}
              >
                Save changes
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{agency.description ?? '—'}</p>
          )}
        </CardContent>
      </Card>

      <AgencySlugCard agencyId={agency.id} isOwner={isOwner} />


      <div className="grid grid-cols-2 gap-3">
        <Stat label="Drivers managed (you)" value={drivers} icon={<Users className="h-4 w-4" />} />
        <Stat
          label="Active members"
          value={(members ?? []).filter((m) => m.status === 'active').length}
          icon={<ShieldCheck className="h-4 w-4" />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Members do <strong>not</strong> automatically get access to any driver's account.
            Each driver must still invite each assistant directly through Driver Assistants.
          </p>

          {isOwner && (
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-2">
                <Label htmlFor="im">Invite member by email</Label>
                <Input
                  id="im"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="teammate@example.com"
                />
              </div>
              <Button
                disabled={invite.isPending || inviteEmail.trim() === ''}
                onClick={async () => {
                  try {
                    const r = await invite.mutateAsync({
                      agency_id: agency.id,
                      email: inviteEmail.trim(),
                    });
                    const link = `${window.location.origin}/agency/invite/${r.invite_token}`;
                    setLastInviteLink(link);
                    setInviteEmail('');
                    toast({ title: 'Invite created — share the link' });
                  } catch (e: any) {
                    toast({
                      title: 'Could not invite',
                      description: e?.message,
                      variant: 'destructive',
                    });
                  }
                }}
              >
                Invite
              </Button>
            </div>
          )}

          {lastInviteLink && (
            <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-2">
              <p className="font-medium">Share this link with your teammate</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-background px-2 py-1">
                  {lastInviteLink}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(lastInviteLink);
                    toast({ title: 'Link copied' });
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          {!members || members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No members yet.</p>
          ) : (
            <div className="rounded-md border divide-y">
              {members.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{m.invite_email}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.role.replace('agency_', '')} · {m.status}
                    </p>
                  </div>
                  {isOwner && m.role !== 'agency_owner' && m.status !== 'revoked' && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                        >
                          Revoke
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove this member?</AlertDialogTitle>
                          <AlertDialogDescription>
                            {m.invite_email} will lose access to your agency. Their driver
                            delegations are not affected.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={async () => {
                              try {
                                await revoke.mutateAsync(m.id);
                                toast({ title: 'Member removed' });
                              } catch (e: any) {
                                toast({
                                  title: 'Could not remove',
                                  description: e?.message,
                                  variant: 'destructive',
                                });
                              }
                            }}
                          >
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
