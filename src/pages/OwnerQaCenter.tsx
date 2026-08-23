/**
 * Phase TG-2E3-O12 — Owner QA Center.
 *
 * Owner-only (super_admin) control surface for the EXISTING Owner QA session
 * architecture. It reuses `useOwnerQaPersona` exclusively — no new RPC, no new
 * table read, no billing/Stripe call, no fixture inspection, and no
 * client-side timer semantics (expiry comes from the server session row).
 */

import { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, FlaskConical, ShieldCheck, ExternalLink, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useOwnerQaPersona } from '@/hooks/useOwnerQaPersona';
import {
  useOwnerQaFixtureReset,
  OWNER_QA_RESET_CATEGORIES,
} from '@/hooks/useOwnerQaFixtureReset';
import {
  useOwnerQaRelationshipScenario,
  type OwnerQaRelationshipScenario,
} from '@/hooks/useOwnerQaRelationshipScenario';
import {
  OWNER_QA_AGENCY_PERSONAS,
  OWNER_QA_DRIVER_PERSONAS,
  OWNER_QA_PERSONA_LABELS,
  OWNER_QA_RECRUITER_PERSONAS,
  type OwnerQaDomain,
  type OwnerQaPersona,
} from '@/lib/billing/ownerQaPersona';


const CATEGORY_LABELS: Record<string, string> = {
  carrier_relationships: 'Carrier relationships',
  assistant_relationships: 'Assistant relationships',
  agency_delegations: 'Agency delegations',
  driver_profiles: 'Driver profiles',
  loads: 'Loads',
  expenses: 'Expenses',
  fuel_logs: 'Fuel logs',
  applications: 'Applications',
  application_events: 'Application events',
  referrals: 'Referrals',
  agency_work_items: 'Agency work items',
  settlements: 'Settlements',
  settlement_items: 'Settlement items',
  settlement_matches: 'Settlement matches',
  notifications: 'Notifications',
  lane_stats: 'Lane stats',
  broker_stats: 'Broker stats',
  operating_metrics: 'Operating metrics',
};


const DOMAIN_LABELS: Record<OwnerQaDomain, string> = {
  driver: 'Driver',
  recruiter: 'Recruiter',
  agency: 'Agency',
};

const PERSONA_GROUPS: ReadonlyArray<{
  domain: OwnerQaDomain;
  personas: readonly OwnerQaPersona[];
}> = [
  { domain: 'driver', personas: OWNER_QA_DRIVER_PERSONAS },
  { domain: 'recruiter', personas: OWNER_QA_RECRUITER_PERSONAS },
  { domain: 'agency', personas: OWNER_QA_AGENCY_PERSONAS },
];

/** Only routes that exist in App.tsx. */
const TEST_SURFACES: ReadonlyArray<{ to: string; label: string; hint: string }> = [
  { to: '/dashboard', label: 'Driver Dashboard', hint: 'Driver limits, insights and Pro gates' },
  { to: '/dashboard?page=opportunities', label: 'Opportunities', hint: 'Driver apply flow and saved opportunities' },
  { to: '/recruiter', label: 'Recruiter Hub', hint: 'Recruiter plan limits and posting gates' },
  { to: '/assistant', label: 'Assistant Dashboard', hint: 'Delegated driver access boundaries' },
  { to: '/agency', label: 'Agency Console', hint: 'Agency plan limits, members and clients' },
  { to: '/driver/assistant-control', label: 'Driver Assistant Control', hint: 'Driver-side permission enforcement' },
];

/** RW-2 — the locked scenario vocabulary, grouped for the owner surface. */
const SCENARIO_GROUPS: ReadonlyArray<{
  key: string;
  title: string;
  scenarios: ReadonlyArray<{ key: OwnerQaRelationshipScenario; label: string }>;
}> = [
  {
    key: 'assistant',
    title: 'Driver Assistant',
    scenarios: [
      { key: 'assistant_none', label: 'No drivers' },
      { key: 'assistant_one', label: 'One driver' },
      { key: 'assistant_many', label: 'Two drivers — mixed permissions' },
    ],
  },
  {
    key: 'agency',
    title: 'Agency',
    scenarios: [
      { key: 'agency_owner_populated', label: 'Owner — populated' },
      { key: 'agency_admin', label: 'Admin' },
      { key: 'agency_member', label: 'Member' },
    ],
  },
  {
    key: 'recruiter',
    title: 'Recruiter',
    scenarios: [
      { key: 'recruiter_staff_one', label: 'Staff — one workspace' },
      { key: 'recruiter_admin_multi', label: 'Admin — two workspaces' },
    ],
  },
];

const SCENARIO_LABELS: Record<string, string> = Object.fromEntries(
  SCENARIO_GROUPS.flatMap((g) =>
    g.scenarios.map((s) => [s.key, `${g.title} · ${s.label}`]),
  ),
);



function remainingCopy(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return 'Expiring now';
  return `${Math.max(1, Math.round(ms / 60_000))} min remaining`;
}

export default function OwnerQaCenter() {
  const {
    isOwner,
    isActive,
    domain,
    persona,
    label,
    expiresAt,
    setPersona,
    disable,
    isLoading,
    isMutating,
    error,
  } = useOwnerQaPersona();

  const {
    preview,
    isLoading: resetLoading,
    isResetting,
    reset,
    error: resetError,
  } = useOwnerQaFixtureReset();

  const [confirmOpen, setConfirmOpen] = useState(false);

  const remaining = useMemo(() => remainingCopy(expiresAt), [expiresAt]);

  const totalRows = preview?.totalRows ?? 0;
  const nothingToReset = !resetLoading && totalRows === 0;

  // Owner-only. Non-owners follow the app's established redirect behavior.
  if (isLoading) return null;
  if (!isOwner) return <Navigate to="/dashboard" replace />;

  const handleSelect = async (d: OwnerQaDomain, p: OwnerQaPersona) => {
    try {
      await setPersona(d, p);
      toast.success(`QA Mode: ${OWNER_QA_PERSONA_LABELS[p]}`);
    } catch {
      toast.error('Could not update QA Mode.');
    }
  };

  const handleEnd = async () => {
    try {
      await disable();
      toast.success('Returned to actual account');
    } catch {
      toast.error('Could not end QA Mode.');
    }
  };

  const handleReset = async () => {
    setConfirmOpen(false);
    try {
      const result = await reset();
      toast.success(`QA test data reset — ${result?.totalRows ?? 0} rows removed`);
    } catch {
      toast.error('Could not reset QA test data.');
    }
  };


  return (
    <main
      data-testid="owner-qa-center"
      className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6"
    >
      <header className="space-y-2">
        <Link
          to="/admin"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Admin Console
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
          <FlaskConical className="h-6 w-6 text-primary" aria-hidden="true" />
          Owner QA Center
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          QA mode simulates paid entitlements for owner testing only, on the
          server as well as the UI. It does not change Stripe, subscriptions, or
          any real billing record, and it does not bypass security, membership,
          permission, or relationship checks.
        </p>
      </header>

      <Card data-testid="owner-qa-state-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Current QA State
            <Badge
              variant={isActive ? 'default' : 'secondary'}
              data-testid="owner-qa-state-badge"
            >
              {isActive ? 'Active' : 'Inactive'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isActive ? (
            <div className="grid gap-3 rounded-lg border border-primary/40 bg-primary/10 p-4 sm:grid-cols-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Domain</p>
                <p className="text-sm font-semibold" data-testid="owner-qa-current-domain">
                  {domain ? DOMAIN_LABELS[domain] : '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Persona</p>
                <p className="text-sm font-semibold" data-testid="owner-qa-current-persona">
                  {label ?? '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Session</p>
                <p className="text-sm font-semibold" data-testid="owner-qa-expiry">
                  {remaining ?? 'Server-managed'}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No QA session is active — your actual account entitlements apply.
              Selecting a persona below starts or updates a short-lived QA
              session managed entirely by the server.
            </p>
          )}

          {isActive && (
            <Button
              variant="outline"
              size="sm"
              disabled={isMutating}
              onClick={() => void handleEnd()}
              data-testid="owner-qa-end"
            >
              End QA Mode
            </Button>
          )}

          {error && (
            <p className="text-xs text-destructive">QA Mode is unavailable right now.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Persona Switcher</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {PERSONA_GROUPS.map((group) => (
            <div key={group.domain} className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                {DOMAIN_LABELS[group.domain]}
              </p>
              <div className="flex flex-wrap gap-2">
                {group.personas.map((p) => {
                  const selected = isActive && domain === group.domain && persona === p;
                  return (
                    <Button
                      key={`${group.domain}:${p}`}
                      type="button"
                      size="sm"
                      variant={selected ? 'default' : 'outline'}
                      aria-pressed={selected}
                      disabled={isMutating}
                      data-testid={`owner-qa-persona-${group.domain}-${p}`}
                      onClick={() => void handleSelect(group.domain, p)}
                    >
                      {OWNER_QA_PERSONA_LABELS[p]}
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
          <Separator />
          <p className="text-xs text-muted-foreground">
            Switching a persona never opens checkout and never contacts Stripe.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Test Surfaces</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {TEST_SURFACES.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              data-testid="owner-qa-shortcut"
              className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5 transition-colors hover:bg-muted/60"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{s.label}</span>
                <span className="block text-xs text-muted-foreground">{s.hint}</span>
              </span>
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          ))}
        </CardContent>
      </Card>

      <Card data-testid="owner-qa-reset-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
            QA Data Reset
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Removes only the QA operational test data and relationships seeded
            under your registered QA fixture roots. QA roots, test identities,
            QA opportunities, billing/subscriptions, and Telegram are preserved.
          </p>

          {resetLoading ? (
            <p className="text-sm text-muted-foreground" data-testid="owner-qa-reset-loading">
              Loading preview…
            </p>
          ) : resetError ? (
            <p className="text-xs text-destructive" data-testid="owner-qa-reset-error">
              QA reset preview is unavailable right now.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-semibold" data-testid="owner-qa-reset-total">
                {totalRows} rows would be removed
              </p>
              {totalRows > 0 && (
                <div className="grid gap-1 sm:grid-cols-3" data-testid="owner-qa-reset-breakdown">
                  {OWNER_QA_RESET_CATEGORIES.filter(
                    (c) => (preview?.counts[c] ?? 0) > 0,
                  ).map((c) => (
                    <div
                      key={c}
                      className="flex items-center justify-between gap-2 rounded border border-border bg-muted/30 px-2 py-1 text-xs"
                    >
                      <span className="truncate text-muted-foreground">
                        {CATEGORY_LABELS[c] ?? c}
                      </span>
                      <span className="font-semibold">{preview?.counts[c] ?? 0}</span>
                    </div>
                  ))}
                </div>
              )}
              {nothingToReset && (
                <p className="text-sm text-muted-foreground" data-testid="owner-qa-reset-empty">
                  QA test data is already reset.
                </p>
              )}
            </div>
          )}

          <Button
            variant="destructive"
            size="sm"
            disabled={isResetting || resetLoading || nothingToReset}
            onClick={() => setConfirmOpen(true)}
            data-testid="owner-qa-reset-button"
          >
            Reset QA Test Data
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="owner-qa-reset-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset QA test data?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the QA operational test data and
              relationships under your QA fixture roots. It preserves the QA
              fixture roots and test identities, QA opportunities, billing and
              subscriptions, and Telegram links. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="owner-qa-reset-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="owner-qa-reset-confirm-action"
              onClick={() => void handleReset()}
            >
              Reset QA Test Data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>



      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <p>
          QA mode changes effective entitlements only for this owner test
          context. Real billing and subscriptions remain untouched, and Telegram
          linking stays real — it is never simulated.
        </p>
      </div>
    </main>
  );
}
