import { CDL_CLASS_CHOICES, DRIVER_TYPE_CHOICES, HOME_TIME_CHOICES, ROUTE_TYPE_CHOICES, TRAILER_CHOICES } from '../home/conversationIntake';

/** Copied from the existing intake validator, whose state set is not exported. */
export const JOB_SEARCH_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'] as const;
export const JOB_SEARCH_CARD_CONSENT_VERSION = 'job_search_card_v1' as const;
export const JOB_SEARCH_CARD_AUDIENCE = 'approved_recruiters' as const;
export const JOB_SEARCH_CARD_REVIEW_DAYS = 14;
export interface JobSearchCardPayload {
  state: typeof JOB_SEARCH_STATES[number];
  cdl_class: typeof CDL_CLASS_CHOICES[number];
  years_experience: number;
  experience_qualifier: 'exact' | 'at_least' | 'less_than';
  preferred_route_type: typeof ROUTE_TYPE_CHOICES[number];
  preferred_home_time: typeof HOME_TIME_CHOICES[number];
  trailer_experience?: Array<typeof TRAILER_CHOICES[number]>;
  preferred_driver_type?: typeof DRIVER_TYPE_CHOICES[number];
  available_start_date?: string;
  min_weekly_gross?: number;
}
const required = ['state','cdl_class','years_experience','experience_qualifier','preferred_route_type','preferred_home_time'] as const;
const optional = ['trailer_experience','preferred_driver_type','available_start_date','min_weekly_gross'] as const;
function choice(value: unknown, choices: readonly string[]): boolean { return typeof value === 'string' && choices.includes(value); }
function hasOwn(value: object, key: string): boolean { return Object.prototype.hasOwnProperty.call(value,key); }
function calendarDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value;
}
/** Fail closed; no coercion, contact information, profile copying or persistence. */
export function validateJobSearchCardPayload(input: unknown): JobSearchCardPayload {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RangeError('Invalid job-search card');
  const p = input as Record<string, unknown>;
  if (Object.keys(p).some(k => !([...required,...optional] as readonly string[]).includes(k)) || required.some(k => !hasOwn(p,k))) throw new RangeError('Invalid job-search fields');
  if (!choice(p.state, JOB_SEARCH_STATES) || !choice(p.cdl_class, CDL_CLASS_CHOICES) || !choice(p.preferred_route_type, ROUTE_TYPE_CHOICES) || !choice(p.preferred_home_time, HOME_TIME_CHOICES)) throw new RangeError('Invalid job-search choices');
  if (typeof p.years_experience !== 'number' || !Number.isInteger(p.years_experience) || p.years_experience < 0 || p.years_experience > 60 || !choice(p.experience_qualifier,['exact','at_least','less_than']) || (p.experience_qualifier === 'less_than' && p.years_experience === 0)) throw new RangeError('Explicit experience and qualifier required');
  if (hasOwn(p,'preferred_driver_type') && !choice(p.preferred_driver_type,DRIVER_TYPE_CHOICES)) throw new RangeError('Invalid driver type');
  if (hasOwn(p,'available_start_date') && !calendarDate(p.available_start_date)) throw new RangeError('Invalid calendar date');
  if (hasOwn(p,'min_weekly_gross') && (typeof p.min_weekly_gross !== 'number' || !Number.isFinite(p.min_weekly_gross) || p.min_weekly_gross <= 0 || p.min_weekly_gross > 100000)) throw new RangeError('Invalid weekly gross');
  if (hasOwn(p,'trailer_experience') && (!Array.isArray(p.trailer_experience) || p.trailer_experience.length > TRAILER_CHOICES.length || p.trailer_experience.some(t => !choice(t,TRAILER_CHOICES)) || new Set(p.trailer_experience).size !== p.trailer_experience.length)) throw new RangeError('Invalid trailer experience');
  const result = Object.fromEntries([...required,...optional].filter(k => hasOwn(p,k)).map(k => [k,p[k]])) as unknown as JobSearchCardPayload;
  if (result.trailer_experience) result.trailer_experience = [...result.trailer_experience].sort();
  return result;
}
/** Deterministic reviewed snapshot, containing ONLY the explicit card fields. */
export function buildJobSearchCardReview(input: unknown) {
  const payload = validateJobSearchCardPayload(input);
  const prefix = payload.experience_qualifier === 'at_least' ? 'At least ' : payload.experience_qualifier === 'less_than' ? 'Less than ' : '';
  return { payload, audience: JOB_SEARCH_CARD_AUDIENCE, consent_version: JOB_SEARCH_CARD_CONSENT_VERSION,
    review_days: JOB_SEARCH_CARD_REVIEW_DAYS, experience: `${prefix}${payload.years_experience} ${payload.years_experience === 1 ? 'year' : 'years'}` };
}
