import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Phase DA-1 — narrow, report-only settings read for a MANAGED driver.
 *
 * Backed exclusively by the `get_driver_report_settings` RPC, which returns
 * only report-relevant fields and authorizes the caller server-side (driver
 * themself, or an active assistant holding view_reports / export_reports for
 * that exact driver). No broad user_settings access is granted.
 */
export interface DriverReportSettings {
  company_name: string | null;
  company_start_date: string | null;
  week_start_day: string | null;
  currency: string | null;
  tax_estimator_enabled: boolean | null;
  federal_tax_percent: number | null;
  state_tax_percent: number | null;
  include_se_tax: boolean | null;
  se_tax_percent: number | null;
  buffer_percent: number | null;
  tax_base_type: string | null;
}

export function useDriverReportSettings(driverUserId: string | null | undefined) {
  return useQuery({
    queryKey: ['driver-report-settings', driverUserId],
    enabled: !!driverUserId,
    staleTime: 60_000,
    queryFn: async (): Promise<DriverReportSettings | null> => {
      const { data, error } = await (supabase as any).rpc('get_driver_report_settings', {
        _driver_user_id: driverUserId,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as DriverReportSettings | null;
    },
  });
}
