import { useState, useRef } from 'react';
import { LoadInsert } from '@/hooks/useLoads';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, FileText, Check, AlertTriangle, Crown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { computeLoadPay } from '@/lib/computeLoadPay';
import { isPayModel, PayModel } from '@/lib/payModels';

interface CSVImportProps {
  isPro: boolean;
}

const EXPECTED_COLUMNS = [
  'date', 'dropoff_date', 'pickup', 'dropoff', 'loaded_miles', 'deadhead_miles', 'total_miles',
  'rate_per_mile', 'deadhead_rate_per_mile', 'flat_rate', 'pay_model',
  'expected_gross_pay', 'actual_pay',
];

function parseCSV(text: string): string[][] {
  const lines = text.trim().split(/\r?\n/);
  return lines.map(line => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    result.push(current.trim());
    return result;
  });
}

function autoMapColumns(headers: string[]): Record<string, number> {
  const mapping: Record<string, number> = {};
  const normalized = headers.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));

  // Order matters: more-specific patterns (e.g. dropoff_date) must run before
  // generic ones (e.g. 'date') so a "Delivery Date" header is not stolen by
  // pickup-date. We also skip already-claimed headers via `used`.
  const patterns: [string, string[]][] = [
    ['dropoff_date', ['dropoffdate', 'deliverydate', 'delivereddate', 'unloaddate', 'dropdate']],
    ['date', ['loaddate', 'pickupdate', 'date']],
    ['pickup', ['pickup', 'pickuplocation', 'origin', 'from']],
    ['dropoff', ['dropoff', 'dropofflocation', 'destination', 'to', 'delivery']],
    ['loaded_miles', ['loadedmiles', 'tripmiles', 'linehaul', 'miles', 'distance']],
    ['deadhead_miles', ['deadheadmiles', 'deadhead', 'dhmiles', 'emptymiles']],
    ['total_miles', ['totalmiles', 'allmiles']],
    ['rate_per_mile', ['ratepermile', 'loadedrate', 'linehaulrate', 'rate', 'rpm', 'cpm']],
    ['deadhead_rate_per_mile', ['deadheadrate', 'dhrate', 'dhratepermile', 'emptyrate']],
    ['flat_rate', ['flatrate', 'flatpay', 'flatamount']],
    ['pay_model', ['paymodel', 'paytype', 'paymentmodel']],
    ['expected_gross_pay', ['expectedgrosspay', 'expectedpay', 'estimatedpay', 'gross']],
    ['actual_pay', ['actualpay', 'pay', 'amount', 'total', 'revenue']],
  ];

  const used = new Set<number>();
  for (const [field, keywords] of patterns) {
    const idx = normalized.findIndex((h, i) => !used.has(i) && keywords.some(k => h.includes(k)));
    if (idx >= 0) {
      mapping[field] = idx;
      used.add(idx);
    }
  }

  return mapping;
}

function normalizePayModelLabel(raw: string | undefined): PayModel | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (isPayModel(v)) return v;
  // Friendly synonyms
  if (v.includes('flat')) return 'flat_rate';
  if (v.includes('total')) return 'total_miles';
  if (v.includes('manual')) return 'manual';
  if (v.includes('deadhead') || v.includes('plus')) return 'loaded_plus_deadhead';
  if (v.includes('loaded')) return 'loaded_miles_only';
  return null;
}

export function CSVImport({ isPro }: CSVImportProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(0);

  if (!isPro) {
    return (
      <div className="premium-card p-4 text-center space-y-3">
          <div className="inline-flex items-center justify-center rounded-2xl bg-muted p-4">
            <Upload className="h-8 w-8 text-muted-foreground/30" />
          </div>
          <p className="font-bold">CSV Load Import</p>
          <p className="text-sm text-muted-foreground">Import loads from CSV files with automatic column mapping.</p>
          <Button className="gap-1.5 rounded-xl font-bold" onClick={() => navigate('/pricing')}>
            <Crown className="h-3.5 w-3.5" /> Upgrade to Pro
          </Button>
        </div>
    );
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.csv')) {
      toast.error('Please select a CSV file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCSV(text);
      if (parsed.length < 2) {
        toast.error('CSV must have a header row and at least one data row');
        return;
      }
      const hdrs = parsed[0];
      const data = parsed.slice(1).filter(row => row.some(cell => cell.trim()));
      setHeaders(hdrs);
      setRows(data);
      setMapping(autoMapColumns(hdrs));
      setImported(0);
      toast.success(`Loaded ${data.length} rows from CSV`);
    };
    reader.readAsText(file);
  };

  const updateMapping = (field: string, colIndex: string) => {
    setMapping(prev => ({
      ...prev,
      [field]: colIndex === '' ? -1 : parseInt(colIndex),
    }));
  };

  const handleImport = async () => {
    if (!user) return;
    const { date: dateIdx, pickup: pickupIdx, dropoff: dropoffIdx } = mapping;
    if (dateIdx == null || pickupIdx == null || dropoffIdx == null) {
      toast.error('Date, Pickup, and Dropoff columns are required');
      return;
    }

    setImporting(true);
    let successCount = 0;

    for (const row of rows) {
      try {
        const dateVal = row[dateIdx]?.trim();
        const pickup = row[pickupIdx]?.trim();
        const dropoff = row[dropoffIdx]?.trim();
        if (!dateVal || !pickup || !dropoff) continue;

        // Parse date - try multiple formats
        let parsedDate = dateVal;
        if (dateVal.includes('/')) {
          const parts = dateVal.split('/');
          if (parts.length === 3) {
            const [m, d, y] = parts;
            const year = y.length === 2 ? `20${y}` : y;
            parsedDate = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
          }
        }

        const num = (idx: number | undefined): number => {
          if (idx == null || idx < 0) return 0;
          const v = parseFloat(row[idx]); return Number.isFinite(v) && v >= 0 ? v : 0;
        };
        const optNum = (idx: number | undefined): number | null => {
          if (idx == null || idx < 0 || !row[idx]?.trim()) return null;
          const v = parseFloat(row[idx]); return Number.isFinite(v) && v >= 0 ? v : null;
        };

        const loadedMiles = num(mapping.loaded_miles);
        const deadheadMiles = num(mapping.deadhead_miles);
        const totalMiles = optNum(mapping.total_miles);
        const ratePerMile = num(mapping.rate_per_mile);
        const deadheadRpm = optNum(mapping.deadhead_rate_per_mile);
        const flatRate = optNum(mapping.flat_rate);
        const expectedGrossPay = optNum(mapping.expected_gross_pay);
        const actualPay = optNum(mapping.actual_pay);
        const payModel = normalizePayModelLabel(mapping.pay_model != null && mapping.pay_model >= 0 ? row[mapping.pay_model] : undefined)
          ?? (flatRate != null ? 'flat_rate'
              : deadheadRpm != null ? 'loaded_plus_deadhead'
              : (totalMiles != null && loadedMiles === 0) ? 'total_miles'
              : 'loaded_miles_only');

        // Single source of truth for expected pay across the app.
        const calc = computeLoadPay({
          payModel,
          loadedMiles,
          deadheadMiles,
          totalMiles: totalMiles ?? undefined,
          loadedRpm: ratePerMile,
          dhRpm: deadheadRpm ?? undefined,
          flatRate: flatRate ?? undefined,
          manualGross: expectedGrossPay ?? undefined,
          fees: 0,
        });

        const loadData: any = {
          user_id: user.id,
          load_date: parsedDate,
          pickup_location: pickup,
          dropoff_location: dropoff,
          loaded_miles: loadedMiles,
          deadhead_miles: deadheadMiles,
          rate_per_mile: ratePerMile,
          total_miles: totalMiles,
          deadhead_rate_per_mile: deadheadRpm,
          flat_rate_amount: payModel === 'flat_rate' ? flatRate : null,
          pay_model: payModel,
          actual_pay_received: actualPay,
          status: 'completed',
          // Persist computed expected pay so dashboards/reports/exports stay aligned
          // with the imported pay model — replaces the old `loaded_miles * rate` math.
          estimated_pay: expectedGrossPay ?? Math.max(0, Number(calc.expectedGrossPay.toFixed(2))),
        };

        const { error } = await supabase.from('loads').insert(loadData);
        if (!error) successCount++;
      } catch {
        // Skip bad rows silently
      }
    }

    setImporting(false);
    setImported(successCount);
    toast.success(`Imported ${successCount} of ${rows.length} loads`);
  };

  return (
    <div className="premium-card p-4 space-y-4">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/10 p-2">
            <Upload className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-bold">CSV Load Import</p>
            <p className="text-[10px] text-muted-foreground">Import loads from spreadsheets</p>
          </div>
        </div>

        {/* File selector */}
        <div>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFileSelect} className="hidden" />
          <Button variant="outline" className="w-full h-11 rounded-xl font-bold gap-2" onClick={() => fileRef.current?.click()}>
            <FileText className="h-4 w-4" /> Select CSV File
          </Button>
        </div>

        {/* Column mapping */}
        {headers.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Map Columns</p>
            <div className="grid grid-cols-2 gap-2">
              {EXPECTED_COLUMNS.map(field => (
                <div key={field} className="space-y-1">
                  <Label className="text-[10px] font-semibold capitalize">{field.replace(/_/g, ' ')}</Label>
                  <Select
                    value={mapping[field] != null && mapping[field] >= 0 ? mapping[field].toString() : 'unmapped'}
                    onValueChange={(v) => updateMapping(field, v === 'unmapped' ? '' : v)}
                  >
                    <SelectTrigger className="h-9 text-xs rounded-lg">
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unmapped">-- Not mapped --</SelectItem>
                      {headers.map((h, i) => (
                        <SelectItem key={i} value={i.toString()}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {/* Preview */}
            <p className="text-xs text-muted-foreground">{rows.length} rows ready to import</p>

            {imported > 0 && (
              <div className="flex items-center gap-2 text-sm text-success">
                <Check className="h-4 w-4" /> {imported} loads imported successfully
              </div>
            )}

            <Button
              className="w-full h-11 rounded-xl font-bold gap-2"
              onClick={handleImport}
              disabled={importing || rows.length === 0}
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {importing ? 'Importing...' : `Import ${rows.length} Loads`}
            </Button>
          </div>
        )}
      </div>
  );
}
