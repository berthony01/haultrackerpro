import { useState, useEffect } from 'react';
import { parseLoadText, ParsedLoadData } from '@/lib/parseLoadText';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ClipboardPaste, ChevronDown, ChevronUp, Sparkles, X, Info } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface PasteLoadParserProps {
  onParsed: (data: ParsedLoadData) => void;
  isPro?: boolean;
}

const WEEKLY_PARSE_LIMIT = 5;

function getWeekStart(): string {
  const now = new Date();
  const d = new Date(now);
  d.setDate(now.getDate() - now.getDay());
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function PasteLoadParser({ onParsed, isPro = false }: PasteLoadParserProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [stopsDetectedCount, setStopsDetectedCount] = useState<number | null>(null);
  const [weeklyCount, setWeeklyCount] = useState<number | null>(null);

  useEffect(() => {
    if (isPro) return;
    const fetchCount = async () => {
      const weekStart = getWeekStart();
      const { count, error } = await supabase
        .from('parse_usage')
        .select('*', { count: 'exact', head: true })
        .gte('used_at', weekStart);
      if (!error && count !== null) setWeeklyCount(count);
    };
    fetchCount();
  }, [isPro]);

  const handleParse = async () => {
    if (!text.trim()) {
      toast.error('Paste some load info first');
      return;
    }
    if (!isPro) {
      // Re-check server count before allowing
      const weekStart = getWeekStart();
      const { count } = await supabase
        .from('parse_usage')
        .select('*', { count: 'exact', head: true })
        .gte('used_at', weekStart);
      if (count !== null && count >= WEEKLY_PARSE_LIMIT) {
        toast.error(`Free limit reached (${WEEKLY_PARSE_LIMIT}/week). Upgrade to Pro for unlimited parsing.`);
        return;
      }
    }
    const parsed = parseLoadText(text);
    const fieldCount = Object.values(parsed).filter(Boolean).length;
    if (fieldCount === 0) {
      toast.error('Could not extract any fields. Try a different format.');
      return;
    }
    if (!isPro) {
      await supabase.from('parse_usage').insert({ user_id: (await supabase.auth.getUser()).data.user?.id });
      setWeeklyCount((prev) => (prev ?? 0) + 1);
    }
    onParsed(parsed);
    const extra = parsed.multiStopDetected ? ` (${parsed.detectedStopsCount} stops detected)` : '';
    toast.success(`Filled ${fieldCount} field${fieldCount > 1 ? 's' : ''}${extra} — please review`);
    if (parsed.needsMileageReview) {
      toast.warning('Mileage is ambiguous (only "total miles" found alongside deadhead). Please confirm loaded miles before saving.', { duration: 7000 });
    } else if (parsed.deadhead_miles && !parsed.loaded_miles) {
      toast.warning('Loaded/Trip miles not detected — please enter them manually.', { duration: 6000 });
    }
    setStopsDetectedCount(parsed.multiStopDetected ? (parsed.detectedStopsCount ?? null) : null);
    setText('');
    setOpen(false);
  };

  const handlePasteFromClipboard = async () => {
    try {
      const clipText = await navigator.clipboard.readText();
      if (clipText) {
        setText(clipText);
        toast.info('Pasted from clipboard');
      }
    } catch {
      toast.error('Could not read clipboard. Paste manually instead.');
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-between gap-2 rounded-lg bg-muted px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-muted/80 transition-colors"
      >
        <span className="flex items-center gap-2">
          <ClipboardPaste className="h-4 w-4 text-primary" />
          Paste Load Info
        </span>
        <ChevronDown className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-primary/20 bg-muted/50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium flex items-center gap-2">
          <ClipboardPaste className="h-4 w-4 text-primary" />
          Paste Load Info
        </p>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setOpen(false); setText(''); }}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <Textarea
        placeholder={"Paste load details here...\ne.g. \"Dallas TX to Atlanta GA, 780 mi, $2.45/mi, 35 DH\""}
        rows={4}
        value={text}
        onChange={e => setText(e.target.value)}
        className="text-sm bg-background"
      />
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={handlePasteFromClipboard} className="flex-1">
          <ClipboardPaste className="h-3.5 w-3.5 mr-1" />
          Clipboard
        </Button>
        <Button type="button" size="sm" onClick={handleParse} className="flex-1">
          <Sparkles className="h-3.5 w-3.5 mr-1" />
          Auto-Fill
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Extracts locations, miles, rate, deadhead, revenue & date. Always review before saving.
      </p>
    </div>
  );
}
