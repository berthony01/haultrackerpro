import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { PageNav } from '@/components/layout/PageNav';
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
import { Building2, Copy, Users, ShieldCheck } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useAgencyMembers,
  useAgencyMutations,
  useMyAgency,
} from '@/hooks/useAgency';
import { useToast } from '@/hooks/use-toast';
import { useAgencyClients } from '@/hooks/useAgencyWorkflow';
import { useAgencyWorkspacePermissions } from '@/hooks/useAgencyWorkspacePermissions';
import { ServicePackagesSection } from '@/components/agency/ServicePackagesSection';
import { ClientRequestsSection } from '@/components/agency/ClientRequestsSection';
import { ClientListSection } from '@/components/agency/ClientListSection';
import { WorkQueueSection } from '@/components/agency/WorkQueueSection';
import { AgencyAuditSection } from '@/components/agency/AgencyAuditSection';
import { AgencySettlementsPanel } from '@/components/settlements/AgencySettlementsPanel';
import { AgencySlugCard } from '@/components/agency/AgencySlugCard';
import { AgencyPlanLimitsCard } from '@/components/agency/AgencyPlanLimitsCard';
import {
  MyProfessionalProfileCard,
  ProfessionalProfileSummaryCard,
} from '@/components/profiles/ProfessionalProfileCard';
import { useAuthorizedProfessionalProfiles } from '@/hooks/useProfessionalProfile';

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
  // AM-1C-B: AM-1B workspace permissions gate the Packages and Requests tabs.
  // Role labels never decide those tabs. Fails closed while unsettled/errored.
  const {
    canViewPackages,
    canManagePackages,
    canViewClientRequests,
    canManageClientRequests,
    canViewClients,
  } = useAgencyWorkspacePermissions(agency?.id);

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
      <PageNav home={{ label: 'Agency', to: '/agency' }} trail={[{ label: 'Agency Console' }]} />
      <header className="space-y-2 rounded-lg border border-border/60 bg-card/40 p-4">
        <div className="flex items-center gap-2">
          <Building2 className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold">Agency Console</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Back-office workspace for managing client drivers. This is a separate
          workspace from your driver Dashboard and recruiter Console — nothing
          you do here touches your own loads, expenses, or fuel logs.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={() => navigate('/start')}>
            Switch workspace
          </Button>
        </div>
      </header>

      {!agency ? (
        <CreateAgencyCard />
      ) : (
        (() => {
          const role = agency.my_role;
          const isOwner = role === 'agency_owner';
          const isOwnerOrAdmin = isOwner || role === 'agency_admin';
          // Packages and Requests are decided by AM-1B workspace permissions
          // only; the remaining tabs stay on their existing rules.
          const showPackages = canViewPackages || canManagePackages;
          const showRequests = canViewClientRequests || canManageClientRequests;
          const tabs: { value: string; label: string; show: boolean }[] = [
            { value: 'overview', label: 'Overview', show: true },
            { value: 'packages', label: 'Packages', show: showPackages },
            { value: 'requests', label: 'Requests', show: showRequests },
            { value: 'clients', label: 'Clients', show: isOwnerOrAdmin },
            // Settlements are visible to every active member; PostgreSQL, not
            // this tab, decides who may prepare or change a statement.
            { value: 'settlements', label: 'Settlements', show: true },
            { value: 'work', label: 'Work queue', show: true },
            { value: 'activity', label: 'Activity', show: isOwner },
          ].filter((t) => t.show);
          const safeActive = tabs.some((t) => t.value === activeTab) ? activeTab : 'overview';
          return (
            <Tabs value={safeActive} onValueChange={setActiveTab} className="space-y-4">
              <TabsList className="flex flex-wrap">
                {tabs.map((t) => (
                  <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="overview" className="space-y-4">
                <MyProfessionalProfileCard context="agency" />
                <AgencyDetailCard agency={agency} />
                {isOwner && <AgencyPlanLimitsCard agencyId={agency.id} />}
                {!isOwner && (
                  <p className="text-xs text-muted-foreground">
                    Billing and plan limits are managed by the agency owner.
                  </p>
                )}
              </TabsContent>
              {showPackages && (
                <TabsContent value="packages">
                  <ServicePackagesSection agencyId={agency.id} />
                </TabsContent>
              )}
              {showRequests && (
                <TabsContent value="requests">
                  {/* isOwnerOrAdmin is passed ONLY as the transitional
                      delegation authority mirror; delegation backend is not
                      cut over to workspace permissions yet. */}
                  <ClientRequestsSection
                    agencyId={agency.id}
                    canCreateDelegation={isOwnerOrAdmin}
                  />
                </TabsContent>
              )}
              {isOwnerOrAdmin && (
                <TabsContent value="clients">
                  <ClientListSection agencyId={agency.id} />
                </TabsContent>
              )}
              <TabsContent value="settlements">
                <AgencySettlementsPanel agencyId={agency.id} />
              </TabsContent>
              <TabsContent value="work">


                <WorkQueueSection
                  agencyId={agency.id}
                  focusedWorkItemId={focusedWorkItemId}
                  canManage={isOwnerOrAdmin}
                />
              </TabsContent>
              {isOwner && (
                <TabsContent value="activity">
                  <AgencyAuditSection agencyId={agency.id} />
                </TabsContent>
              )}
            </Tabs>
          );
        })()
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
          For people who want to manage paperwork for multiple truckers as a side
          hustle or small business. Drivers still approve each delegation before
          anyone can access their account — this profile just keeps your business
          identity, packages, and team in one place.
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
}: {
  agency: NonNullable<ReturnType<typeof useMyAgency>['data']>;
}) {
  const { update, invite, revoke } = useAgencyMutations();
  const { data: members } = useAgencyMembers(agency.id);
  const { data: clients } = useAgencyClients(agency.id);
  const { toast } = useToast();

  const memberUserIds = useMemo(
    () => (members ?? []).map((member) => member.member_user_id),
    [members],
  );
  const { data: memberProfiles = {} } =
    useAuthorizedProfessionalProfiles(memberUserIds);

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
        <Stat
          label="Active clients"
          value={(clients ?? []).length}
          icon={<Users className="h-4 w-4" />}
        />
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
                <div key={m.id} className="p-3 text-sm space-y-3">
                  <div className="flex items-center justify-between gap-3">
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
                  <ProfessionalProfileSummaryCard
                    summary={
                      m.member_user_id
                        ? memberProfiles[m.member_user_id]
                        : null
                    }
                  />
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
