import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MapPin, Search, Plus, Loader2, Lock, X, Sparkles } from 'lucide-react';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { useParkingLocations, useRecentParkingReports, computeConfidence, ParkingLocation } from '@/hooks/useParkingLocations';
import { useRecentParkingVerifications } from '@/hooks/useParkingVerifications';
import { useGeolocation, distanceMiles } from '@/hooks/useGeolocation';
import { ParkingCard } from './ParkingCard';
import { ParkingDetailSheet } from './ParkingDetailSheet';
import { AddParkingModal } from './AddParkingModal';
import { ProUpgradeModal } from '@/components/ProUpgradeModal';

interface ParkingFinderProps {
  hasAccess: boolean;
  subscriptionLoading?: boolean;
}

type ConfidenceFilter = 'any' | 'high' | 'medium' | 'low';

const PAGE_SIZE = 24;

function buildPageList(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | 'ellipsis')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push('ellipsis');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push('ellipsis');
  pages.push(total);
  return pages;
}

export function ParkingFinder({ hasAccess, subscriptionLoading = false }: ParkingFinderProps) {
  const { data: locations = [], isLoading } = useParkingLocations();
  const { data: recentReports = [] } = useRecentParkingReports();
  const { data: recentVerifications = [] } = useRecentParkingVerifications();
  const geo = useGeolocation();

  const [search, setSearch] = useState('');
  const [paidFilter, setPaidFilter] = useState<'any' | 'free' | 'paid'>('any');
  const [overnightOnly, setOvernightOnly] = useState(false);
  const [truckOnly, setTruckOnly] = useState(false);
  const [confFilter, setConfFilter] = useState<ConfidenceFilter>('any');
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState<ParkingLocation | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const handleAddClick = () => {
    if (!hasAccess) {
      setShowUpgrade(true);
      return;
    }
    setShowAdd(true);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = locations.filter((loc) => {
      if (q) {
        const hay = `${loc.name} ${loc.address ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (paidFilter === 'free' && loc.is_paid) return false;
      if (paidFilter === 'paid' && !loc.is_paid) return false;
      if (overnightOnly && !loc.overnight_allowed) return false;
      if (truckOnly && !loc.truck_friendly) return false;
      if (confFilter !== 'any') {
        const { level } = computeConfidence(recentReports, recentVerifications, loc.id);
        if (level !== confFilter) return false;
      }
      return true;
    });

    if (geo.coords) {
      list = [...list].sort(
        (a, b) => distanceMiles(geo.coords!, a) - distanceMiles(geo.coords!, b),
      );
    }
    return list;
  }, [locations, search, paidFilter, overnightOnly, truckOnly, confFilter, recentReports, recentVerifications, geo.coords]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  // Reset to page 1 whenever filters or sort context change.
  useEffect(() => {
    setPage(1);
  }, [search, paidFilter, overnightOnly, truckOnly, confFilter, geo.coords]);

  // Clamp page if it ever exceeds totalPages.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const filtersActive =
    !!search.trim() ||
    paidFilter !== 'any' ||
    overnightOnly ||
    truckOnly ||
    confFilter !== 'any';

  const resetFilters = () => {
    setSearch('');
    setPaidFilter('any');
    setOvernightOnly(false);
    setTruckOnly(false);
    setConfFilter('any');
  };

  const SegBtn = ({
    active, onClick, children,
  }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 h-8 text-xs font-medium rounded-md transition-colors ${
        active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );

  const rangeStart = filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, filtered.length);
  const pageList = buildPageList(page, totalPages);

  return (
    <div className="space-y-4">
      {/* Search + location */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search city, zip, or name"
            className="pl-9 pr-9 h-10"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-muted text-muted-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Button
          variant="outline"
          onClick={geo.request}
          disabled={geo.isPending}
          className="shrink-0 h-10"
          aria-label="Use my location"
        >
          {geo.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
          <span className="hidden sm:inline ml-1.5">Near me</span>
        </Button>
        <Button
          onClick={handleAddClick}
          className="shrink-0 h-10"
          disabled={subscriptionLoading}
          aria-label={subscriptionLoading ? 'Add a parking spot' : hasAccess ? 'Add a parking spot' : 'Add a parking spot (Pro)'}
        >
          {subscriptionLoading ? (
            <Plus className="h-4 w-4 opacity-60" />
          ) : hasAccess ? (
            <Plus className="h-4 w-4" />
          ) : (
            <Lock className="h-4 w-4" />
          )}
          <span className="hidden sm:inline ml-1.5">Add spot</span>
          {!subscriptionLoading && !hasAccess && (
            <span className="hidden sm:inline ml-1 text-[10px] opacity-80">Pro</span>
          )}
        </Button>
      </div>
      {geo.error && <p className="text-xs text-destructive">{geo.error}</p>}

      {/* Filter segments */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-muted/50 rounded-lg border border-border/50">
          <SegBtn active={paidFilter === 'any'} onClick={() => setPaidFilter('any')}>All</SegBtn>
          <SegBtn active={paidFilter === 'free'} onClick={() => setPaidFilter('free')}>Free</SegBtn>
          <SegBtn active={paidFilter === 'paid'} onClick={() => setPaidFilter('paid')}>Paid</SegBtn>
        </div>

        <div className="inline-flex items-center gap-1.5">
          <Button
            size="sm"
            variant={overnightOnly ? 'default' : 'outline'}
            className="h-8 text-xs rounded-full px-3"
            onClick={() => setOvernightOnly((v) => !v)}
          >
            Overnight
          </Button>
          <Button
            size="sm"
            variant={truckOnly ? 'default' : 'outline'}
            className="h-8 text-xs rounded-full px-3"
            onClick={() => setTruckOnly((v) => !v)}
          >
            Truck-friendly
          </Button>
        </div>

        <div className="inline-flex items-center gap-1 p-1 bg-muted/50 rounded-lg border border-border/50">
          <span className="text-[10px] uppercase font-semibold text-muted-foreground px-2">Confidence</span>
          <SegBtn active={confFilter === 'any'} onClick={() => setConfFilter('any')}>Any</SegBtn>
          <SegBtn active={confFilter === 'high'} onClick={() => setConfFilter('high')}>High</SegBtn>
          <SegBtn active={confFilter === 'medium'} onClick={() => setConfFilter('medium')}>Med</SegBtn>
          <SegBtn active={confFilter === 'low'} onClick={() => setConfFilter('low')}>Low</SegBtn>
        </div>

        {filtersActive && (
          <button
            type="button"
            onClick={resetFilters}
            className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          >
            Reset
          </button>
        )}
      </div>

      {/* Result meta */}
      {!isLoading && filtered.length > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing <span className="font-semibold text-foreground">{rangeStart}–{rangeEnd}</span> of{' '}
            <span className="font-semibold text-foreground">{filtered.length}</span> spots
          </span>
          <span className="hidden sm:inline">{PAGE_SIZE} per page</span>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="premium-card p-4 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="premium-card p-8 text-center space-y-3">
          <p className="text-sm text-muted-foreground">No parking matches your filters.</p>
          <div className="flex items-center justify-center gap-2">
            {filtersActive && (
              <Button variant="outline" size="sm" onClick={resetFilters}>
                Clear filters
              </Button>
            )}
            <Button onClick={handleAddClick} size="sm">
              {hasAccess ? <Plus className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              <span className="ml-1">Add a location</span>
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {pageItems.map((loc) => (
            <ParkingCard
              key={loc.id}
              location={loc}
              reports={recentReports}
              verifications={recentVerifications}
              userCoords={geo.coords}
              onSelect={setSelected}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!isLoading && totalPages > 1 && (
        <>
          {/* Mobile compact */}
          <div className="flex sm:hidden items-center justify-between pt-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </Button>
            <span className="text-xs text-muted-foreground">
              Page <span className="font-semibold text-foreground">{page}</span> of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>

          {/* Desktop full */}
          <Pagination className="hidden sm:flex pt-2">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(e) => { e.preventDefault(); setPage((p) => Math.max(1, p - 1)); }}
                  className={page <= 1 ? 'pointer-events-none opacity-50' : ''}
                />
              </PaginationItem>
              {pageList.map((p, idx) =>
                p === 'ellipsis' ? (
                  <PaginationItem key={`e-${idx}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={p}>
                    <PaginationLink
                      href="#"
                      isActive={p === page}
                      onClick={(e) => { e.preventDefault(); setPage(p); }}
                    >
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                ),
              )}
              <PaginationItem>
                <PaginationNext
                  href="#"
                  onClick={(e) => { e.preventDefault(); setPage((p) => Math.min(totalPages, p + 1)); }}
                  className={page >= totalPages ? 'pointer-events-none opacity-50' : ''}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </>
      )}

      {/* Bottom CTA */}
      <div className="premium-card p-4 flex items-center justify-between gap-3 border-dashed">
        <div className="min-w-0">
          <p className="text-sm font-bold flex items-center gap-1.5 text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            Spotted parking we don't have?
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Add it to help the network — earn points for every contribution.
          </p>
        </div>
        <Button onClick={handleAddClick} className="shrink-0" size="sm">
          {hasAccess ? <Plus className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
          <span className="ml-1">Add spot</span>
          {!hasAccess && <span className="ml-1 text-[10px] opacity-80">Pro</span>}
        </Button>
      </div>

      <ParkingDetailSheet
        location={selected}
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        hasAccess={hasAccess}
        onUpgrade={() => setShowUpgrade(true)}
      />
      <AddParkingModal open={showAdd} onOpenChange={setShowAdd} />
      <ProUpgradeModal
        open={showUpgrade}
        onOpenChange={setShowUpgrade}
        featureName="Parking reports & rewards"
      />
    </div>
  );
}
