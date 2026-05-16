// Lightweight pipeline analytics — no overhauls, pure functions.

export interface PipelineEvent {
  event_type: string;
  actor_type: string;
  created_at: string;
  application_id: string;
}

export function pipelineCounts(apps: { status: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of apps) out[a.status] = (out[a.status] ?? 0) + 1;
  return out;
}

export function hireConversionRate(apps: { status: string }[]): number {
  if (!apps.length) return 0;
  const hired = apps.filter((a) => a.status === 'hired').length;
  return hired / apps.length;
}

/**
 * Average hours from `application_created` to the first recruiter-actor event
 * across all applications. Returns null if no measurable pairs.
 */
export function avgRecruiterResponseHours(events: PipelineEvent[]): number | null {
  const byApp = new Map<string, PipelineEvent[]>();
  for (const e of events) {
    const arr = byApp.get(e.application_id) ?? [];
    arr.push(e);
    byApp.set(e.application_id, arr);
  }
  const diffs: number[] = [];
  for (const arr of byApp.values()) {
    arr.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
    const created = arr.find((e) => e.event_type === 'application_created');
    const firstRecruiter = arr.find((e) => e.actor_type === 'recruiter');
    if (created && firstRecruiter) {
      diffs.push(
        (+new Date(firstRecruiter.created_at) - +new Date(created.created_at)) / 3_600_000,
      );
    }
  }
  if (!diffs.length) return null;
  return diffs.reduce((a, b) => a + b, 0) / diffs.length;
}
