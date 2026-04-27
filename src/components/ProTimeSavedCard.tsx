import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Zap, Mic, Camera, ClipboardPaste } from 'lucide-react';
import { startOfWeek, endOfWeek } from 'date-fns';

interface ProTimeSavedCardProps {
  isPro: boolean;
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

const TIME_PER_VOICE_LOG = 2;
const TIME_PER_RECEIPT_SCAN = 3;
const TIME_PER_PASTE_PARSE = 1.5;

export function ProTimeSavedCard({ isPro, weekStartsOn = 0 }: ProTimeSavedCardProps) {
  const { user } = useAuth();
  const isProUser = isPro;

  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn }).toISOString();
  const weekEnd = endOfWeek(now, { weekStartsOn }).toISOString();

  const automationQuery = useQuery({
    queryKey: ['automation-week-count', user?.id, weekStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expense_automation_logs')
        .select('source')
        .eq('user_id', user!.id)
        .gte('created_at', weekStart)
        .lte('created_at', weekEnd);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && isProUser,
    staleTime: 60_000,
  });

  const parseQuery = useQuery({
    queryKey: ['parse-week-count', user?.id, weekStart],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('parse_usage')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user!.id)
        .gte('used_at', weekStart);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!user && isProUser,
    staleTime: 60_000,
  });

  const stats = useMemo(() => {
    const logs = automationQuery.data ?? [];
    const voice = logs.filter(l => l.source === 'voice').length;
    const receipt = logs.filter(l => l.source === 'receipt').length;
    const paste = parseQuery.data ?? 0;
    const totalMinutes = (voice * TIME_PER_VOICE_LOG) + (receipt * TIME_PER_RECEIPT_SCAN) + (paste * TIME_PER_PASTE_PARSE);
    return { voice, receipt, paste, totalMinutes, totalActions: voice + receipt + paste };
  }, [automationQuery.data, parseQuery.data]);

  if (!isProUser || !user || stats.totalActions === 0) return null;

  const chips: { icon: typeof Mic; count: number; label: string }[] = [];
  if (stats.voice > 0) chips.push({ icon: Mic, count: stats.voice, label: 'voice' });
  if (stats.receipt > 0) chips.push({ icon: Camera, count: stats.receipt, label: 'scans' });
  if (stats.paste > 0) chips.push({ icon: ClipboardPaste, count: stats.paste, label: 'pastes' });

  return (
    <Card className="border border-success/15 bg-success/[0.03]">
      <CardContent className="p-3.5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-success/10 flex items-center justify-center shrink-0">
            <Zap className="h-5 w-5 text-success" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-bold leading-tight">~{Math.round(stats.totalMinutes)} min saved</p>
              <span className="text-[9px] font-bold text-success bg-success/10 px-1.5 py-0.5 rounded-full">THIS WEEK</span>
            </div>
            <div className="flex items-center gap-2.5 mt-1">
              {chips.map(chip => (
                <span key={chip.label} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <chip.icon className="h-3 w-3" />
                  {chip.count} {chip.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
