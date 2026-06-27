/**
 * Direct-DB cleanup helper for the driver-journey E2E runner.
 *
 * Signs in as the disposable QA driver via the public anon key and deletes
 * rows tagged with `QA TEST DELETE - <runId>`. RLS keeps deletes scoped to
 * that user. Reads Supabase URL + anon key from env (no hardcoded values).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.E2E_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  '';
const SUPABASE_ANON_KEY =
  process.env.E2E_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  '';

export interface CleanupResult {
  loads: number;
  fuel: number;
  expenses: number;
  remaining: { loads: number; fuel: number; expenses: number };
  errors: string[];
}

export async function cleanupRun(runId: string): Promise<CleanupResult> {
  const email = process.env.E2E_DRIVER_EMAIL;
  const password = process.env.E2E_DRIVER_PASSWORD;
  const result: CleanupResult = {
    loads: 0, fuel: 0, expenses: 0,
    remaining: { loads: 0, fuel: 0, expenses: 0 },
    errors: [],
  };
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    result.errors.push('E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY not set (and no VITE fallback).');
    return result;
  }
  if (!email || !password) {
    result.errors.push('E2E_DRIVER_EMAIL / E2E_DRIVER_PASSWORD not set; skipping DB cleanup.');
    return result;
  }
  const marker = `QA TEST DELETE - ${runId}`;
  const pattern = `%${marker}%`;
  const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr) {
    result.errors.push(`sign-in failed: ${signInErr.message}`);
    return result;
  }

  // Delete across every candidate column and SUM the rows. Never short-circuit.
  const deleteAll = async (table: string, columns: string[]): Promise<number> => {
    let total = 0;
    for (const col of columns) {
      const { data, error } = await supabase
        .from(table).delete().ilike(col, pattern).select('id');
      if (error) {
        result.errors.push(`${table}.${col} delete: ${error.message}`);
        continue;
      }
      total += data?.length ?? 0;
    }
    return total;
  };

  // Verify no marker rows remain in any candidate column.
  const countRemaining = async (table: string, columns: string[]): Promise<number> => {
    let total = 0;
    for (const col of columns) {
      const { count, error } = await supabase
        .from(table).select('id', { count: 'exact', head: true }).ilike(col, pattern);
      if (error) {
        result.errors.push(`${table}.${col} verify: ${error.message}`);
        continue;
      }
      total += count ?? 0;
    }
    return total;
  };

  const loadCols = ['load_number', 'notes'];
  const fuelCols = ['notes'];
  const expenseCols = ['description', 'notes'];

  result.loads = await deleteAll('loads', loadCols);
  result.fuel = await deleteAll('fuel_logs', fuelCols);
  result.expenses = await deleteAll('expenses', expenseCols);

  result.remaining.loads = await countRemaining('loads', loadCols);
  result.remaining.fuel = await countRemaining('fuel_logs', fuelCols);
  result.remaining.expenses = await countRemaining('expenses', expenseCols);

  if (result.remaining.loads + result.remaining.fuel + result.remaining.expenses > 0) {
    result.errors.push(
      `verify: marker rows still present (loads=${result.remaining.loads}, fuel=${result.remaining.fuel}, expenses=${result.remaining.expenses})`,
    );
  }

  await supabase.auth.signOut();
  return result;
}
