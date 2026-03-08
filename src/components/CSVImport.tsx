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

interface CSVImportProps {
  isPro: boolean;
}

const EXPECTED_COLUMNS = [
  'date', 'pickup', 'dropoff', 'loaded_miles', 'deadhead_miles', 'rate_per_mile', 'actual_pay'
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

  const patterns: [string, string[]][] = [
    ['date', ['date', 'loaddate', 'pickupdate']],
    ['pickup', ['pickup', 'pickuplocation', 'origin', 'from']],
    ['dropoff', ['dropoff', 'dropofflocation', 'destination', 'to', 'delivery']],
    ['loaded_miles', ['loadedmiles', 'miles', 'distance']],
    ['deadhead_miles', ['deadheadmiles', 'deadhead', 'dh', 'emptymiles']],
    ['rate_per_mile', ['ratepermile', 'rate', 'rpm', 'cpm']],
    ['actual_pay', ['actualpay', 'pay', 'amount', 'total', 'revenue']],
  ];

  for (const [field, keywords] of patterns) {
    const idx = normalized.findIndex(h => keywords.some(k => h.includes(k)));
    if (idx >= 0) mapping[field] = idx;
  }

  return mapping;
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
      <Card className="shadow-card">
        <CardContent className="p-4 text-center space-y-3">
          <div className="inline-flex items-center justify-center rounded-2xl bg-muted p-4">
            <Upload className="h-8 w-8 text-muted-foreground/30" />
          </div>
          <p className="font-bold">CSV Load Import</p>
          <p className="text-sm text-muted-foreground">Import loads from CSV files with automatic column mapping.</p>
          <Button className="gap-1.5 rounded-xl font-bold" onClick={() => navigate('/pricing')}>
            <Crown className="h-3.5 w-3.5" /> Upgrade to Pro
          </Button>
        </CardContent>
      </Card>
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

        const loadData: any = {
          user_id: user.id,
          load_date: parsedDate,
          pickup_location: pickup,
          dropoff_location: dropoff,
          loaded_miles: mapping.loaded_miles != null ? parseFloat(row[mapping.loaded_miles]) || 0 : 0,
          deadhead_miles: mapping.deadhead_miles != null ? parseFloat(row[mapping.deadhead_miles]) || 0 : 0,
          rate_per_mile: mapping.rate_per_mile != null ? parseFloat(row[mapping.rate_per_mile]) || 0 : 0,
          actual_pay_received: mapping.actual_pay != null && row[mapping.actual_pay]?.trim() ? parseFloat(row[mapping.actual_pay]) : null,
          status: 'completed',
        };

        // Calculate estimated pay
        loadData.estimated_pay = (loadData.loaded_miles * loadData.rate_per_mile);

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
    <Card className="shadow-card">
      <CardContent className="p-4 space-y-4">
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
                    value={mapping[field]?.toString() ?? ''}
                    onValueChange={(v) => updateMapping(field, v)}
                  >
                    <SelectTrigger className="h-9 text-xs rounded-lg">
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">-- Not mapped --</SelectItem>
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
      </CardContent>
    </Card>
  );
}
