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
    <Card className="shadow-card border-primary/10 bg-primary/5">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="h-4 w-4 text-primary" />
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Pro Saved You Time</p>
        </div>
        <div className="text-center mb-3">
          <p className="text-3xl font-black font-mono text-primary">{totalMinutes}</p>
          <p className="text-xs text-muted-foreground">minutes saved this week</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {items.map(item => (
            <div key={item.label} className="text-center rounded-lg bg-background/60 p-2">
              <item.icon className="h-3.5 w-3.5 mx-auto text-muted-foreground mb-1" />
              <p className="text-xs font-bold">{item.count}</p>
              <p className="text-[10px] text-muted-foreground">{item.label}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
