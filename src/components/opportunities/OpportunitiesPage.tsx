import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  BriefcaseBusiness,
  Search,
  ShieldCheck,
  DollarSign,
  Gauge,
  Inbox,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { useOpportunities } from '@/hooks/opportunities/useOpportunities';
import { useSavedOpportunities } from '@/hooks/opportunities/useSavedOpportunities';
import { useSubscription } from '@/hooks/useSubscription';
import { useDriverOpportunityProfile } from '@/hooks/opportunities/useDriverOpportunityProfile';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { OpportunityCard } from './OpportunityCard';
import { OpportunityDetail } from './OpportunityDetail';
import { DriverOpportunityProfile } from './DriverOpportunityProfile';
import { RecruiterOnboarding } from './RecruiterOnboarding';
import { UserCog, ArrowRight, CheckCircle2, Building2, Clock, AlertTriangle, Ban } from 'lucide-react';

interface Props {
  onUpgrade: () => void;
}

const ANY = 'any';

export function OpportunitiesPage({ onUpgrade }: Props) {
  const { opportunities, isLoading, isError, error, refetch } = useOpportunities();
  const { saved, save, unsave } = useSavedOpportunities();
  const { isPro } = useSubscription();
  const { profile, isLoading: profileLoading } = useDriverOpportunityProfile();
  const { profile: recruiterProfile, isLoading: recruiterLoading } = useRecruiterProfile();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showRecruiter, setShowRecruiter] = useState(false);
  const [search, setSearch] = useState('');
  const [driverType, setDriverType] = useState<string>(ANY);
  const [routeType, setRouteType] = useState<string>(ANY);
  const [trailerType, setTrailerType] = useState<string>(ANY);
  const [minGross, setMinGross] = useState<string>('');
  const [paidDeadheadOnly, setPaidDeadheadOnly] = useState(false);

  const savedIds = useMemo(() => new Set(saved.map((s) => s.opportunity_id)), [saved]);

  const driverTypes = useMemo(
    () => Array.from(new Set(opportunities.map((o) => o.driver_type).filter(Boolean))) as string[],
    [opportunities]
  );
  const routeTypes = useMemo(
    () => Array.from(new Set(opportunities.map((o) => o.route_type).filter(Boolean))) as string[],
    [opportunities]
  );
  const trailerTypes = useMemo(
    () => Array.from(new Set(opportunities.map((o) => o.trailer_type).filter(Boolean))) as string[],
    [opportunities]
  );

  const filtered = useMemo(() => {
    const min = Number(minGross) || 0;
    const q = search.trim().toLowerCase();
    return opportunities.filter((o) => {
      if (q) {
        const hay = [o.title, o.company_name, o.hiring_city, o.hiring_state]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (driverType !== ANY && o.driver_type !== driverType) return false;
      if (routeType !== ANY && o.route_type !== routeType) return false;
      if (trailerType !== ANY && o.trailer_type !== trailerType) return false;
      if (min > 0 && (Number(o.estimated_weekly_gross) || 0) < min) return false;
      if (paidDeadheadOnly && o.deadhead_paid !== true) return false;
      return true;
    });
  }, [opportunities, search, driverType, routeType, trailerType, minGross, paidDeadheadOnly]);

  const kpis = useMemo(() => {
    const recruiterIds = new Set(opportunities.map((o) => o.recruiter_id));
    const grosses = opportunities.map((o) => Number(o.estimated_weekly_gross) || 0);
    const rpms = opportunities.map((o) => {
      const miles = Number(o.estimated_loaded_miles) || Number(o.estimated_weekly_miles) || 0;
      const gross = Number(o.estimated_weekly_gross) || 0;
      return miles > 0 ? gross / miles : 0;
    });
    return {
      count: opportunities.length,
      recruiters: recruiterIds.size,
      maxGross: grosses.length ? Math.max(...grosses) : 0,
      bestRpm: rpms.length ? Math.max(...rpms) : 0,
    };
  }, [opportunities]);

  const handleToggleSave = (id: string) => {
    const isSaved = savedIds.has(id);
    const m = isSaved ? unsave : save;
    m.mutate(id, {
      onSuccess: () => toast.success(isSaved ? 'Removed from saved' : 'Saved successfully'),
      onError: (e: Error) => toast.error(e.message),
    });
  };

  const selected = useMemo(
    () => opportunities.find((o) => o.id === selectedId) || null,
    [opportunities, selectedId]
  );

  if (isError) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Card className="p-6 border-border/60 bg-gradient-to-br from-card via-card to-primary/5">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-primary p-3 shadow-primary shrink-0">
              <BriefcaseBusiness className="h-6 w-6 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground mb-1">
                Opportunities
              </h1>
              <p className="text-sm text-muted-foreground">
                Profit-first trucking opportunities with real pay clarity.
              </p>
            </div>
          </div>
        </Card>
        <EmptyState
          title="Unable to load opportunities"
          body={error && (error as Error).message ? (error as Error).message : 'Something went wrong while loading opportunities. Please try again.'}
          action={
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          }
        />
      </div>
    );
  }

  if (showRecruiter) {
    return <RecruiterOnboarding onBack={() => setShowRecruiter(false)} />;
  }

  if (showProfile) {
    return <DriverOpportunityProfile onBack={() => setShowProfile(false)} />;
  }

  if (selected) {
    return (
      <OpportunityDetail
        opportunity={selected}
        onBack={() => setSelectedId(null)}
        isPro={isPro}
        onUpgrade={onUpgrade}
        driverProfile={profile}
      />
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <Card className="p-6 border-border/60 bg-gradient-to-br from-card via-card to-primary/5">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-primary p-3 shadow-primary shrink-0">
            <BriefcaseBusiness className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground mb-1">
              Opportunities
            </h1>
            <p className="text-sm text-muted-foreground">
              Profit-first trucking opportunities with real pay clarity.
            </p>
          </div>
        </div>
      </Card>

      {/* Driver Profile entry card */}
      {!profileLoading && (
        <ProfileEntryCard
          state={!profile ? 'none' : profile.profile_completed ? 'complete' : 'incomplete'}
          profile={profile}
          onClick={() => setShowProfile(true)}
        />
      )}

      {/* Recruiter access CTA */}
      {!recruiterLoading && (
        <RecruiterEntryCard
          profile={recruiterProfile}
          onClick={() => setShowRecruiter(true)}
        />
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={BriefcaseBusiness} label="Available" value={kpis.count.toString()} />
        <Kpi icon={ShieldCheck} label="Active Recruiters" value={kpis.recruiters.toString()} />
        <Kpi
          icon={DollarSign}
          label="Highest Weekly Gross"
          value={kpis.maxGross > 0 ? `$${Math.round(kpis.maxGross).toLocaleString()}` : '—'}
        />
        <Kpi
          icon={Gauge}
          label="Best Effective RPM"
          value={kpis.bestRpm > 0 ? `$${kpis.bestRpm.toFixed(2)}` : '—'}
        />
      </div>

      {/* Filters */}
      <Card className="p-4 border-border/60 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search title, company, location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <FilterSelect label="Driver type" value={driverType} onChange={setDriverType} options={driverTypes} />
          <FilterSelect label="Route type" value={routeType} onChange={setRouteType} options={routeTypes} />
          <FilterSelect label="Trailer" value={trailerType} onChange={setTrailerType} options={trailerTypes} />
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Min weekly gross</label>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="0"
              value={minGross}
              onChange={(e) => setMinGross(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Switch checked={paidDeadheadOnly} onCheckedChange={setPaidDeadheadOnly} id="paid-dh" />
          <label htmlFor="paid-dh" className="text-sm text-foreground cursor-pointer">
            Paid deadhead only
          </label>
        </div>
      </Card>

      {/* List */}
      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      ) : opportunities.length === 0 ? (
        <EmptyState
          title="No opportunities yet"
          body="Recruiters are joining HaulTrackerPro now. Check back soon for profit-first openings."
          action={
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No results match your filters"
          body="Try clearing filters or broadening your minimum weekly gross."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setSearch('');
                setDriverType(ANY);
                setRouteType(ANY);
                setTrailerType(ANY);
                setMinGross('');
                setPaidDeadheadOnly(false);
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((o) => (
            <OpportunityCard
              key={o.id}
              opportunity={o}
              isSaved={savedIds.has(o.id)}
              onView={() => setSelectedId(o.id)}
              onToggleSave={() => handleToggleSave(o.id)}
              saving={save.isPending || unsave.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value }: { icon: typeof BriefcaseBusiness; label: string; value: string }) {
  return (
    <Card className="p-4 border-border/60">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
        <div className="rounded-lg bg-primary/10 p-1.5"><Icon className="h-3.5 w-3.5 text-primary" /></div>
      </div>
      <p className="font-mono text-xl font-black text-foreground whitespace-nowrap">{value}</p>
    </Card>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Any" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any</SelectItem>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <Card className="p-10 border-dashed border-border/60 text-center">
      <div className="mx-auto mb-3 inline-flex rounded-2xl bg-muted/40 p-3">
        <Inbox className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="text-base font-bold text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">{body}</p>
      {action}
    </Card>
  );
}

function ProfileEntryCard({
  state,
  profile,
  onClick,
}: {
  state: 'none' | 'incomplete' | 'complete';
  profile: ReturnType<typeof useDriverOpportunityProfile>['profile'];
  onClick: () => void;
}) {
  const cfg =
    state === 'none'
      ? {
          title: 'Set Up Your Driver Opportunity Profile',
          body: 'Create a profile so HaulTrackerPro can help match you with opportunities that fit your pay goals, experience, home time, and equipment preferences.',
          cta: 'Create Profile',
          icon: UserCog,
        }
      : state === 'incomplete'
      ? {
          title: 'Finish Your Driver Profile',
          body: 'A few more details unlock better-matched opportunities and richer recruiter context.',
          cta: 'Complete Profile',
          icon: UserCog,
        }
      : {
          title: 'Your Driver Profile Is Ready',
          body: 'Recruiters will see this context when you request info on an opportunity.',
          cta: 'Edit Profile',
          icon: CheckCircle2,
        };

  const Icon = cfg.icon;

  return (
    <Card className="p-5 border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card">
      <div className="flex items-start gap-4">
        <div className="rounded-2xl bg-primary/15 p-3 shrink-0">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-foreground mb-1">{cfg.title}</h3>
          <p className="text-sm text-muted-foreground mb-3">{cfg.body}</p>
          {state === 'complete' && profile && (
            <div className="flex flex-wrap gap-2 mb-3 text-xs">
              {profile.preferred_driver_type && (
                <Badge variant="outline">{profile.preferred_driver_type}</Badge>
              )}
              {profile.preferred_route_type && (
                <Badge variant="outline">{profile.preferred_route_type}</Badge>
              )}
              {(profile.min_weekly_net || profile.min_weekly_gross) && (
                <Badge variant="outline">
                  Min ${Number(profile.min_weekly_net || profile.min_weekly_gross).toLocaleString()}/wk
                  {profile.min_weekly_net ? ' net' : ' gross'}
                </Badge>
              )}
              <Badge variant="outline" className="capitalize">
                {String(profile.visibility).replace('_', ' ')}
              </Badge>
            </div>
          )}
          <Button onClick={onClick} variant={state === 'complete' ? 'outline' : 'default'}>
            {cfg.cta} <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
