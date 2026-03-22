import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Clock, Mic, Camera, ClipboardPaste } from 'lucide-react';
import { startOfWeek, endOfWeek } from 'date-fns';

interface ProTimeSavedCardProps {
  isPro?: boolean;
  isTrialing?: boolean;
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

const TIME_PER_ACTION = { voice: 2, receipt: 3, paste: 1.5 };

export function ProTimeSavedCard({ isPro = false, isTrialing = false, weekStartsOn = 0 }: ProTimeSavedCardProps) {
  const { user } = useAuth();
  const isProUser = isPro || isTrialing;

  const now = new Date();
  const ws = startOfWeek(now, { weekStartsOn }).toISOString();
  const we = endOfWeek(now, { weekStartsOn }).toISOString();

  const { data } = useQuery({
    queryKey: ['pro-time-saved', user?.id, ws],
    queryFn: async () => {
      if (!user) return null;

      const [autoLogs, parseUsage] = await Promise.all([
        supabase
          .from('expense_automation_logs')
          .select('source')
          .eq('user_id', user.id)
          .gte('created_at', ws)
          .lte('created_at', we),
        supabase
          .from('parse_usage')
          .select('id')
          .eq('user_id', user.id)
          .gte('used_at', ws)
          .lte('used_at', we),
      ]);

      const voiceCount = (autoLogs.data ?? []).filter(l => l.source === 'voice').length;
      const receiptCount = (autoLogs.data ?? []).filter(l => l.source === 'receipt').length;
      const pasteCount = (parseUsage.data ?? []).length;

      return { voiceCount, receiptCount, pasteCount };
    },
    enabled: !!user && isProUser,
    staleTime: 60_000,
  });

  if (!isProUser || !data) return null;

  const totalMinutes = Math.round(
    data.voiceCount * TIME_PER_ACTION.voice +
    data.receiptCount * TIME_PER_ACTION.receipt +
    data.pasteCount * TIME_PER_ACTION.paste
  );

  if (totalMinutes === 0) return null;

  const items = [
    { icon: Mic, label: 'Voice', count: data.voiceCount, mins: data.voiceCount * TIME_PER_ACTION.voice },
    { icon: Camera, label: 'Receipts', count: data.receiptCount, mins: data.receiptCount * TIME_PER_ACTION.receipt },
    { icon: ClipboardPaste, label: 'Paste', count: data.pasteCount, mins: data.pasteCount * TIME_PER_ACTION.paste },
  ].filter(i => i.count > 0);

  return (
    <Card className="shadow-card overflow-hidden border-primary/10">
      <CardContent className="p-0">
        {/* Header strip */}
        <div className="flex items-center gap-2 px-4 py-2.5 bg-primary/5 border-b border-primary/10">
          <Clock className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-primary">Pro Saved You Time</span>
          <span className="ml-auto text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">This Week</span>
        </div>

        <div className="p-3 space-y-2">
          {/* Hero stat */}
          <div className="relative text-center py-3">
            <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent rounded-xl pointer-events-none" />
            <p className="relative text-4xl font-black font-mono text-primary leading-none">{totalMinutes}</p>
            <p className="relative text-[11px] text-muted-foreground mt-1.5 font-medium">minutes saved with Pro tools</p>
          </div>

          {/* Breakdown chips */}
          <div className="grid grid-cols-3 gap-2">
            {items.map(item => (
              <div key={item.label} className="text-center rounded-xl bg-secondary/80 border border-border/50 p-2.5 hover:border-primary/20 transition-colors">
                <div className="inline-flex items-center justify-center rounded-lg bg-primary/10 p-1.5 mb-1.5">
                  <item.icon className="h-3.5 w-3.5 text-primary" />
                </div>
                <p className="text-sm font-black font-mono">{item.count}</p>
                <p className="text-[10px] text-muted-foreground font-medium">{item.label}</p>
                <p className="text-[9px] text-muted-foreground/60 mt-0.5">{Math.round(item.mins)} min</p>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
