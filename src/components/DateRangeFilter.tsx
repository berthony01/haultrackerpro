import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, format } from 'date-fns';
import { useUserSettings } from '@/hooks/useUserSettings';
import { weekStartDayToNumber } from '@/lib/loadUtils';

interface DateRangeFilterProps {
  onRangeChange: (from?: string, to?: string) => void;
}

export function DateRangeFilter({ onRangeChange }: DateRangeFilterProps) {
  const { settings } = useUserSettings();
  const wso = weekStartDayToNumber(settings?.week_start_day);

  const presets = [
    { label: 'This Week', getRange: () => ({ from: startOfWeek(new Date(), { weekStartsOn: wso }), to: endOfWeek(new Date(), { weekStartsOn: wso }) }) },
    { label: 'This Month', getRange: () => ({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) }) },
    { label: 'This Year', getRange: () => ({ from: startOfYear(new Date()), to: endOfYear(new Date()) }) },
    { label: 'All Time', getRange: () => ({ from: undefined, to: undefined }) },
  ];

  const [active, setActive] = useState('All Time');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const handlePreset = (label: string, from?: Date, to?: Date) => {
    setActive(label);
    setShowCustom(false);
    onRangeChange(from ? format(from, 'yyyy-MM-dd') : undefined, to ? format(to, 'yyyy-MM-dd') : undefined);
  };

  const handleCustom = () => {
    setActive('Custom');
    onRangeChange(customFrom || undefined, customTo || undefined);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {presets.map(p => {
          const { from, to } = p.getRange();
          return (
            <Button
              key={p.label}
              variant={active === p.label ? 'default' : 'outline'}
              size="sm"
              className="text-xs h-8"
              onClick={() => handlePreset(p.label, from, to)}
            >
              {p.label}
            </Button>
          );
        })}
        <Button
          variant={showCustom ? 'default' : 'outline'}
          size="sm"
          className="text-xs h-8"
          onClick={() => setShowCustom(!showCustom)}
        >
          Custom
        </Button>
      </div>
      {showCustom && (
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="h-8 text-xs" />
          </div>
          <span className="text-xs text-muted-foreground pb-1">to</span>
          <div className="flex-1">
            <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="h-8 text-xs" />
          </div>
          <Button size="sm" className="h-8 text-xs" onClick={handleCustom}>Apply</Button>
        </div>
      )}
    </div>
  );
}
