/**
 * Direct-DB cleanup helper for the driver-journey E2E runner.
 *
 * Uses the disposable QA driver's own credentials (E2E_DRIVER_EMAIL /
 * E2E_DRIVER_PASSWORD) to sign in via the public anon key and delete
 * rows tagged with the run marker `QA TEST DELETE - <runId>`. RLS keeps
 * this scoped to that user only — no service-role key is needed and none
 * is added to the app codebase.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pngptztxwbtozwxrtbwo.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBuZ3B0enR4d2J0b3p3eHJ0YndvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NzYwOTAsImV4cCI6MjA4NzU1MjA5MH0.Y4X4nJdsAVEOuhyWPF9hSYv0RXyH_3D-SjXWxpJdn0s';

export interface CleanupResult {
  loads: number;
  fuel: number;
  expenses: number;
  errors: string[];
}

export async function cleanupRun(runId: string): Promise<CleanupResult> {
  const email = process.env.E2E_DRIVER_EMAIL;
  const password = process.env.E2E_DRIVER_PASSWORD;
  const result: CleanupResult = { loads: 0, fuel: 0, expenses: 0, errors: [] };
  if (!email || !password) {
    result.errors.push('E2E_DRIVER_EMAIL / E2E_DRIVER_PASSWORD not set; skipping DB cleanup.');
    return result;
  }
  const marker = `QA TEST DELETE - ${runId}`;
  const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr) {
    result.errors.push(`sign-in failed: ${signInErr.message}`);
    return result;
  }
  const tryDelete = async (table: string, columns: string[]) => {
    for (const col of columns) {
      const { data, error } = await supabase
        .from(table)
        .delete()
        .ilike(col, `%${marker}%`)
        .select('id');
      if (error) {
        result.errors.push(`${table}.${col}: ${error.message}`);
        continue;
      }
      return data?.length ?? 0;
    }
    return 0;
  };
  result.loads = await tryDelete('loads', ['load_number', 'notes']);
  result.fuel = await tryDelete('fuel_logs', ['notes']);
  result.expenses = await tryDelete('expenses', ['description', 'notes']);
  await supabase.auth.signOut();
  return result;
}
