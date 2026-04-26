import { useState } from 'react';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks, subMonths } from 'date-fns';
import { Download, FileText, FileSpreadsheet, Loader2, ParkingCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import type { Expense } from '@/hooks/useExpenses';
import type { Load } from '@/hooks/useLoads';
import { exportParkingCSV, exportParkingPDF, ParkingExportRange } from '@/lib/parkingExport';
import { useUserSettings } from '@/hooks/useUserSettings';
import { weekStartDayToNumber } from '@/lib/loadUtils';

interface Props {
  expenses: Expense[];
  loads: Load[];
}

type Preset = 'this_week' | 'last_week' | 'this_month' | 'last_month';

function rangeFromPreset(preset: Preset, weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6): ParkingExportRange {
  const now = new Date();
  switch (preset) {
    case 'this_week': {
      const start = startOfWeek(now, { weekStartsOn });
      const end = endOfWeek(now, { weekStartsOn });
      return { label: 'This Week', from: format(start, 'yyyy-MM-dd'), to: format(end, 'yyyy-MM-dd') };
    }
    case 'last_week': {
      const ref = subWeeks(now, 1);
      const start = startOfWeek(ref, { weekStartsOn });
      const end = endOfWeek(ref, { weekStartsOn });
      return { label: 'Last Week', from: format(start, 'yyyy-MM-dd'), to: format(end, 'yyyy-MM-dd') };
    }
    case 'this_month': {
      return { label: 'This Month', from: format(startOfMonth(now), 'yyyy-MM-dd'), to: format(endOfMonth(now), 'yyyy-MM-dd') };
    }
    case 'last_month': {
      const ref = subMonths(now, 1);
      return { label: 'Last Month', from: format(startOfMonth(ref), 'yyyy-MM-dd'), to: format(endOfMonth(ref), 'yyyy-MM-dd') };
    }
  }
}

export function ParkingExportButton({ expenses, loads }: Props) {
  const { settings } = useUserSettings();
  const weekStartsOn = weekStartDayToNumber(settings?.week_start_day);
  const [busy, setBusy] = useState<null | 'csv' | 'pdf'>(null);
  const [preset, setPreset] = useState<Preset>('this_week');

  const run = async (format: 'csv' | 'pdf') => {
    const range = rangeFromPreset(preset, weekStartsOn);
    setBusy(format);
    try {
      const driverName = settings?.company_name ?? undefined;
      const result =
        format === 'csv'
          ? exportParkingCSV(expenses, loads, range)
          : await exportParkingPDF(expenses, loads, range, driverName);
      if (result.count === 0) {
        toast.info('No parking expenses in that range', {
          description: 'Try a different period or log a parking expense first.',
        });
      } else {
        toast.success(`${format.toUpperCase()} exported — ${result.count} entr${result.count === 1 ? 'y' : 'ies'}`);
      }
    } catch (e) {
      toast.error('Export failed', { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl gap-1.5 text-xs font-bold"
          disabled={busy !== null}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ParkingCircle className="h-3.5 w-3.5" />}
          Export Parking
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs">Period</DropdownMenuLabel>
        {([
          ['this_week', 'This Week'],
          ['last_week', 'Last Week'],
          ['this_month', 'This Month'],
          ['last_month', 'Last Month'],
        ] as [Preset, string][]).map(([key, label]) => (
          <DropdownMenuItem
            key={key}
            onSelect={(e) => { e.preventDefault(); setPreset(key); }}
            className={`text-xs cursor-pointer ${preset === key ? 'bg-accent font-semibold' : ''}`}
          >
            {label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Format</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(e) => { e.preventDefault(); run('csv'); }}
          className="text-xs cursor-pointer gap-2"
        >
          <FileSpreadsheet className="h-3.5 w-3.5" /> Export as CSV
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => { e.preventDefault(); run('pdf'); }}
          className="text-xs cursor-pointer gap-2"
        >
          <FileText className="h-3.5 w-3.5" /> Export as PDF
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-[10px] text-muted-foreground flex items-center gap-1">
          <Download className="h-3 w-3" /> Filters Parking category only
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
