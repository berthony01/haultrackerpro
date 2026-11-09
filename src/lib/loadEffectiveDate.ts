/** Confirmed delivery date for completed dispatch loads; legacy dates otherwise. */
export function getEffectiveDate(load: { status?: string | null; actual_delivery_date?: string | null; dropoff_date?: string | null; load_date: string }): string {
  return (load.status === 'completed' ? load.actual_delivery_date : null) ?? load.dropoff_date ?? load.load_date;
}
