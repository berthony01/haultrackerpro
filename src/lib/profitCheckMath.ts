/**
 * Pure profit-check math helpers. NO Supabase / React / React Query imports.
 *
 * Hooks (e.g. `useProfitCheck`) import these so callers keep their existing
 * imports, while tests can import directly from `@/lib/profitCheckMath`.
 */

/**
 * Choose which cost-per-mile to use for the load (profile vs rolling
 * history) and report the source.
 *
 * Rule: a usable profile always wins. If the profile yields 0 CPM but
 * produced a warning (e.g. fixed costs entered but monthly miles missing),
 * we still report source = 'profile' so the warning surfaces in the UI
 * instead of being silently masked by history fallback.
 */
export function selectCostSource(args: {
  profileCpm: number;
  profileWarnings: string[];
  historyCpm: number;
}): { cpm: number; source: 'profile' | 'history' | 'none' } {
  const { profileCpm, profileWarnings, historyCpm } = args;
  if (profileCpm > 0) return { cpm: profileCpm, source: 'profile' };
  if (profileWarnings.length > 0) return { cpm: 0, source: 'profile' };
  if (historyCpm > 0) return { cpm: historyCpm, source: 'history' };
  return { cpm: 0, source: 'none' };
}
