import { supabase } from '@/integrations/supabase/client';
import { validateJobSearchCardPayload, type JobSearchCardPayload } from './jobSearchCardContract';

export type CardFailure = 'unavailable' | 'denied' | 'stale' | 'no_card' | 'invalid' | 'unknown';
export class JobSearchCardError extends Error {
  constructor(public readonly kind: CardFailure) { super(kind); }
}
export interface DiscoveryCard {
  id: string;
  revision: number;
  published_at: string;
  expires_at: string;
  payload: JobSearchCardPayload;
}
export interface OwnCard extends DiscoveryCard {
  status: 'published' | 'paused' | 'withdrawn' | 'expired';
  audience: 'approved_recruiters';
  consent_version: 'job_search_card_v1';
  created_at: string;
  updated_at: string;
}
export interface RequestIdentity { userId: string; sessionUserId: string; accessToken: string }
export interface CardCommand {
  action: 'publish' | 'pause' | 'withdraw';
  revision: number;
  commandId: string;
  payload?: JobSearchCardPayload;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const baseKeys = ['id', 'revision', 'published_at', 'expires_at', 'payload'];
const ownerKeys = [...baseKeys, 'status', 'audience', 'consent_version', 'created_at', 'updated_at'];
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new JobSearchCardError('unknown');
  const r = value as Record<string, unknown>;
  if (Object.keys(r).length !== keys.length || keys.some(k => !Object.prototype.hasOwnProperty.call(r, k))) throw new JobSearchCardError('unknown');
  return r;
}
// PostgreSQL precision is microseconds. Normalize only for comparison; retain
// the original string for exact cursor round trips. Reject Date.parse rollover.
function timestampMicros(value: unknown): bigint {
  if (typeof value !== 'string') throw new JobSearchCardError('unknown');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new JobSearchCardError('unknown');
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction, zone] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText), second = Number(secondText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) throw new JobSearchCardError('unknown');
  const zoneHour = zone === 'Z' ? 0 : Number(zone.slice(1, 3));
  const zoneMinute = zone === 'Z' ? 0 : Number(zone.slice(4, 6));
  if (zoneHour > 23 || zoneMinute > 59) throw new JobSearchCardError('unknown');
  const offsetMinutes = (zoneHour * 60 + zoneMinute) * (zone.startsWith('-') ? -1 : 1);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return BigInt(date.getTime() - offsetMinutes * 60000) * BigInt(1000) + BigInt((fraction ?? '').padEnd(6, '0'));
}
function timestamp(value: unknown): string {
  timestampMicros(value);
  return value as string;
}
export function compareCardTuple(a: Pick<DiscoveryCard, 'published_at' | 'id'>, b: Pick<DiscoveryCard, 'published_at' | 'id'>): number {
  if (!uuid.test(a.id) || !uuid.test(b.id)) throw new JobSearchCardError('unknown');
  const left = timestampMicros(a.published_at), right = timestampMicros(b.published_at);
  if (left !== right) return left < right ? -1 : 1;
  const leftId = a.id.toLowerCase(), rightId = b.id.toLowerCase();
  return leftId === rightId ? 0 : leftId < rightId ? -1 : 1;
}
function base(r: Record<string, unknown>): DiscoveryCard {
  if (typeof r.id !== 'string' || !uuid.test(r.id) || typeof r.revision !== 'number' || !Number.isInteger(r.revision) || r.revision < 1) throw new JobSearchCardError('unknown');
  let payload: JobSearchCardPayload;
  try { payload = validateJobSearchCardPayload(r.payload); } catch { throw new JobSearchCardError('unknown'); }
  const published_at = timestamp(r.published_at), expires_at = timestamp(r.expires_at);
  if (timestampMicros(expires_at) <= timestampMicros(published_at)) throw new JobSearchCardError('unknown');
  return { id: r.id, revision: r.revision, published_at, expires_at, payload };
}
export function parseOwnCard(value: unknown): OwnCard | null {
  if (value === null) return null;
  const r = record(value, ownerKeys);
  if (!['published', 'paused', 'withdrawn', 'expired'].includes(String(r.status)) || r.audience !== 'approved_recruiters' || r.consent_version !== 'job_search_card_v1') throw new JobSearchCardError('unknown');
  return { ...base(r), status: r.status as OwnCard['status'], audience: 'approved_recruiters', consent_version: 'job_search_card_v1', created_at: timestamp(r.created_at), updated_at: timestamp(r.updated_at) };
}
export function parseDiscoveryCards(value: unknown, limit = 20): DiscoveryCard[] {
  if (!Array.isArray(value) || value.length > limit || limit < 1 || limit > 50) throw new JobSearchCardError('unknown');
  const rows = value.map(v => base(record(v, baseKeys)));
  const ids = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], previous = rows[i - 1];
    if (ids.has(row.id.toLowerCase()) || (previous && compareCardTuple(row, previous) >= 0)) throw new JobSearchCardError('unknown');
    ids.add(row.id.toLowerCase());
  }
  return rows;
}
function failure(error: unknown): JobSearchCardError {
  const e = error as { code?: string; message?: string } | null;
  const kind: CardFailure = e?.code === 'PGRST202' || e?.code === '42883' ? 'unavailable'
    : e?.code === '42501' ? 'denied' : e?.code === '40001' ? 'stale'
    : e?.code === '22023' ? (e.message === 'No card' ? 'no_card' : 'invalid') : 'unknown';
  return new JobSearchCardError(kind);
}
// Existing installed PostgrestBuilder API. No duplicate client or token storage.
export async function boundCardRpc(name: string, args: Record<string, unknown>, identity: RequestIdentity, current: () => boolean): Promise<unknown> {
  if (!current() || !identity.userId || identity.userId !== identity.sessionUserId || !identity.accessToken) throw new JobSearchCardError('denied');
  try {
    const request = (supabase as unknown as { rpc: (n: string, a: Record<string, unknown>) => { setHeader: (n: string, v: string) => PromiseLike<{ data: unknown; error: unknown }> } }).rpc(name, args);
    const result = await request.setHeader('Authorization', `Bearer ${identity.accessToken}`);
    if (!current()) throw new JobSearchCardError('denied');
    if (result.error) throw failure(result.error);
    return result.data;
  } catch (e) { throw e instanceof JobSearchCardError ? e : failure(e); }
}
export async function getOwnCard(identity: RequestIdentity, current: () => boolean) {
  return parseOwnCard(await boundCardRpc('manage_my_job_search_card', { _action: 'get' }, identity, current));
}
export async function manageOwnCard(command: CardCommand, identity: RequestIdentity, current: () => boolean) {
  if (!uuid.test(command.commandId) || !Number.isInteger(command.revision) || command.revision < 0) throw new JobSearchCardError('invalid');
  const payload = command.action === 'publish' ? validateJobSearchCardPayload(command.payload) : null;
  return parseOwnCard(await boundCardRpc('manage_my_job_search_card', {
    _action: command.action, _payload: payload, _expected_revision: command.revision,
    _client_command_id: command.commandId, _consent_version: command.action === 'publish' ? 'job_search_card_v1' : null,
  }, identity, current));
}
export async function listRecruiterCards(recruiterId: string, cursor: DiscoveryCard | null, identity: RequestIdentity, current: () => boolean) {
  if (!uuid.test(recruiterId)) throw new JobSearchCardError('invalid');
  const rows = parseDiscoveryCards(await boundCardRpc('list_recruiter_job_search_cards', {
    _recruiter_id: recruiterId, _limit: 20,
    _after_published_at: cursor?.published_at ?? null, _after_card_id: cursor?.id ?? null,
  }, identity, current));
  if (cursor && rows.some(r => compareCardTuple(r, cursor) >= 0)) throw new JobSearchCardError('unknown');
  return rows;
}
