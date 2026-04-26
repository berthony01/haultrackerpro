import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trophy, Crown, Loader2, Settings2 } from 'lucide-react';
import { useDriverLeaderboard, useMyLeaderboardRank, pointsSource } from '@/hooks/useDriverLeaderboard';
import { useAuth } from '@/hooks/useAuth';
import { tierFor } from '@/hooks/useDriverPoints';

interface DriverLeaderboardCardProps {
  /** Top N rows to show (5 on dashboard, 10 on scorecard). */
  limit?: number;
  /** Title override. */
  title?: string;
  /** Hide the explanatory footer. */
  hideHelp?: boolean;
  /** Optional handler for the "Customize handle" link. When provided, link is shown. */
  onCustomize?: () => void;
}

export function DriverLeaderboardCard({
  limit = 5,
  title = 'Top Drivers This Week',
  hideHelp,
  onCustomize,
}: DriverLeaderboardCardProps) {
  const { user } = useAuth();
  // Fetch a wider list so we can find current user's rank if outside top N.
  const { rows, me, isLoading } = useMyLeaderboardRank(Math.max(limit, 50));
  const top = rows.slice(0, limit);
  const meInTop = me ? top.some((r) => r.user_id === me.user_id) : false;

  return (
    <Card className="shadow-card">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-yellow-400" />
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {title}
            </p>
          </div>
          <span className="text-[10px] text-muted-foreground">Updated weekly</span>
        </div>

        {isLoading ? (
          <div className="py-6 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3">
            No leaderboard yet. Log a load or verify parking to get on the board.
          </p>
        ) : rows.length === 1 && me && rows[0].user_id === user?.id ? (
          <div className="space-y-2">
            <LeaderRow row={rows[0]} isMe />
            <p className="text-xs text-muted-foreground pt-1">
              You're on the board. Keep earning points to climb.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {top.map((r) => (
              <LeaderRow key={r.user_id} row={r} isMe={r.user_id === user?.id} />
            ))}
            {!meInTop && me && (
              <>
                <div className="text-[10px] uppercase font-semibold text-muted-foreground pt-2 pb-1">
                  Your rank
                </div>
                <LeaderRow row={me} isMe />
              </>
            )}
          </div>
        )}

        {!hideHelp && (
          <p className="text-[11px] text-muted-foreground mt-3">
            Earn points by logging loads, reporting parking, and verifying parking status.
          </p>
        )}
        {onCustomize && (
          <button
            type="button"
            onClick={onCustomize}
            className="mt-2 text-[11px] text-primary hover:underline focus:outline-none focus:underline"
          >
            Customize your leaderboard handle →
          </button>
        )}
      </CardContent>
    </Card>
  );
}

function LeaderRow({
  row,
  isMe,
}: {
  row: ReturnType<typeof useDriverLeaderboard>['data'] extends (infer T)[] | undefined ? T : never;
  isMe: boolean;
}) {
  const tier = tierFor(row.total_points);
  const source = pointsSource(row.parking_points, row.load_points);

  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-md px-2 py-2 text-sm ${
        isMe ? 'bg-primary/10 border border-primary/30' : ''
      }`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <RankBadge rank={row.rank} />
        <span className="truncate font-medium">
          {row.masked_display_name}
          {isMe && <span className="text-[10px] text-primary ml-1">(you)</span>}
        </span>
        <Badge variant="outline" className={`text-[10px] h-5 px-1.5 ${tier.color} border-current/30 shrink-0`}>
          {tier.name}
        </Badge>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] text-muted-foreground hidden sm:inline">{source}</span>
        <span className="font-bold text-sm tabular-nums">{row.weekly_points}p</span>
      </div>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-yellow-400/20 text-yellow-400">
        <Crown className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center justify-center h-6 w-6 rounded-full text-[11px] font-bold tabular-nums ${
        rank <= 3 ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
      }`}
    >
      {rank}
    </span>
  );
}
