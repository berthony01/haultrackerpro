import { useCallback } from 'react';
import { toast } from 'sonner';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useRecurringExpenses } from '@/hooks/useRecurringExpenses';

/**
 * Shared hook for Home Time Mode. Used by the dashboard card and the
 * Recurring Expenses page so both surfaces stay in sync.
 *
 * - start(): pauses all currently-active templates with reason "Home time mode",
 *   records their IDs in user_settings.home_time_paused_template_ids, and flips
 *   home_time_mode = true.
 * - end(): resumes only the templates that home time itself paused (so manually
 *   paused templates stay paused) and flips home_time_mode = false.
 */
export function useHomeTimeMode() {
  const { settings, updateSettings } = useUserSettings();
  const { pauseAllTemplates, resumeAllTemplates } = useRecurringExpenses();

  const isActive = !!settings?.home_time_mode;
  const startedAt = settings?.home_time_started_at ?? null;

  const start = useCallback(
    (opts?: { onDone?: () => void }) => {
      pauseAllTemplates.mutate('Home time mode', {
        onSuccess: (pausedIds) => {
          updateSettings.mutate(
            {
              home_time_mode: true,
              home_time_started_at: new Date().toISOString(),
              home_time_paused_template_ids: pausedIds ?? [],
            },
            {
              onSuccess: () => {
                toast.success('Home Time started — recurring expenses paused');
                opts?.onDone?.();
              },
              onError: (e) => toast.error(e.message),
            }
          );
        },
        onError: (e) => toast.error(e.message),
      });
    },
    [pauseAllTemplates, updateSettings]
  );

  const end = useCallback(
    (opts?: { onDone?: () => void }) => {
      const idsToResume = (settings?.home_time_paused_template_ids as string[] | null) ?? [];
      resumeAllTemplates.mutate(idsToResume, {
        onSuccess: () => {
          updateSettings.mutate(
            {
              home_time_mode: false,
              home_time_ended_at: new Date().toISOString(),
              home_time_paused_template_ids: [],
            },
            {
              onSuccess: () => {
                toast.success('Welcome back on the road — recurring expenses resumed');
                opts?.onDone?.();
              },
              onError: (e) => toast.error(e.message),
            }
          );
        },
        onError: (e) => toast.error(e.message),
      });
    },
    [resumeAllTemplates, updateSettings, settings?.home_time_paused_template_ids]
  );

  const isPending =
    pauseAllTemplates.isPending || resumeAllTemplates.isPending || updateSettings.isPending;

  return { isActive, startedAt, start, end, isPending };
}
