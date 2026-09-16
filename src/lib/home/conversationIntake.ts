/**
 * HP-2 — Pre-auth conversation intake (pure, deterministic, offline).
 *
 * This module holds the entire signed-out homepage conversation contract:
 * the question script, conservative keyword extraction, the truthful summary,
 * and the bounded sessionStorage snapshot that the authenticated Driver
 * Opportunity Preferences form later consumes for REVIEW only.
 *
 * Hard rules encoded here:
 *  - No network, no Supabase, no auth. This file imports nothing but types.
 *  - No opportunity/match/qualification claim is ever produced pre-auth.
 *  - No consent, visibility, contact-preference or completion flag is ever derived.
 *  - Owner Operator and Team are DRIVER types, never route types.
 */

export const HOME_INTAKE_SNAPSHOT_KEY = 'htp_home_intake_snapshot_v1';
export const HOME_INTAKE_SNAPSHOT_VERSION = 1 as const;
/** Bounded: anything larger is treated as corrupt and fails closed. */
export const HOME_INTAKE_SNAPSHOT_MAX_BYTES = 4000;
/** Snapshots older than this are treated as expired and fail closed. */
export const HOME_INTAKE_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Existing canonical destination: the real Driver Opportunity Preferences review surface. */
export const HOME_INTAKE_NEXT_PATH = '/dashboard?page=opportunities&view=driver-profile';

export const ROUTE_TYPE_CHOICES = ['Local', 'Regional', 'OTR', 'Dedicated'] as const;
export type RouteTypeChoice = (typeof ROUTE_TYPE_CHOICES)[number];

export const DRIVER_TYPE_CHOICES = ['Owner Operator', 'Team'] as const;
export type DriverTypeChoice = (typeof DRIVER_TYPE_CHOICES)[number];

/** The locked first-choice vocabulary, in locked order. */
export const WORK_TYPE_CHOICES = [
  ...ROUTE_TYPE_CHOICES,
  ...DRIVER_TYPE_CHOICES,
] as const;
export type WorkTypeChoice = (typeof WORK_TYPE_CHOICES)[number];

export const HOME_TIME_CHOICES = ['Daily', 'Weekly', 'Bi-weekly', '2-3 weeks out'] as const;
export const CDL_CLASS_CHOICES = ['A', 'B', 'C'] as const;
export const TRAILER_CHOICES = [
  'Dry Van',
  'Reefer',
  'Flatbed',
  'Step Deck',
  'Tanker',
  'Power Only',
  'Car Hauler',
  'Hopper',
] as const;

export interface IntakeAnswers {
  /** The driver's own words, preserved verbatim. */
  initialMessage?: string;
  preferred_route_type?: RouteTypeChoice;
  preferred_driver_type?: DriverTypeChoice;
  city?: string;
  state?: string;
  cdl_class?: (typeof CDL_CLASS_CHOICES)[number];
  years_experience?: number;
  preferred_home_time?: (typeof HOME_TIME_CHOICES)[number];
  trailer_experience?: string[];
  min_weekly_gross?: number;
}

export type IntakeStepId =
  | 'work-type'
  | 'location'
  | 'cdl-class'
  | 'experience'
  | 'home-time'
  | 'trailer'
  | 'pay-goal';

export interface IntakeStep {
  id: IntakeStepId;
  prompt: string;
  chips: readonly string[];
  placeholder: string;
  optional: boolean;
}

export const INTAKE_OPENING_PROMPT = 'What kind of trucking work are you looking for?';

export const INTAKE_STEPS: readonly IntakeStep[] = [
  {
    id: 'work-type',
    prompt: INTAKE_OPENING_PROMPT,
    chips: WORK_TYPE_CHOICES,
    placeholder: 'Or say it your own way — “regional flatbed, home weekends”',
    optional: false,
  },
  {
    id: 'location',
    prompt: 'Where are you based? City and state, or just the state.',
    chips: [],
    placeholder: 'Houston, TX',
    optional: false,
  },
  {
    id: 'cdl-class',
    prompt: 'What CDL class do you hold?',
    chips: ['A', 'B', 'C'],
    placeholder: 'Class A',
    optional: false,
  },
  {
    id: 'experience',
    prompt: 'How many years of driving experience do you have?',
    chips: ['Less than 1', '1', '2', '3', '5+'],
    placeholder: '2',
    optional: false,
  },
  {
    id: 'home-time',
    prompt: 'How often do you want to be home?',
    chips: HOME_TIME_CHOICES,
    placeholder: 'Home weekly',
    optional: false,
  },
  {
    id: 'trailer',
    prompt: 'What equipment do you run? (optional)',
    chips: TRAILER_CHOICES,
    placeholder: 'Flatbed',
    optional: true,
  },
  {
    id: 'pay-goal',
    prompt: 'Do you have a weekly gross pay goal? (optional)',
    chips: [],
    placeholder: '1800',
    optional: true,
  },
];

/* ------------------------------------------------------------------ */
/* Conservative deterministic extraction                               */
/* ------------------------------------------------------------------ */

const STATE_ABBREVIATIONS = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME',
  'MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA',
  'RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]);

const STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Applies one of the six locked quick choices with the correct canonical mapping.
 * Owner Operator / Team NEVER become route types.
 */
export function applyWorkTypeChoice(answers: IntakeAnswers, choice: WorkTypeChoice): IntakeAnswers {
  if ((ROUTE_TYPE_CHOICES as readonly string[]).includes(choice)) {
    return { ...answers, preferred_route_type: choice as RouteTypeChoice };
  }
  return { ...answers, preferred_driver_type: choice as DriverTypeChoice };
}

/** Conservative, explicit-only hints. Absent evidence => nothing is invented. */
export function extractWorkTypeHints(text: string): {
  preferred_route_type?: RouteTypeChoice;
  preferred_driver_type?: DriverTypeChoice;
} {
  const t = ` ${text.toLowerCase()} `;
  const out: { preferred_route_type?: RouteTypeChoice; preferred_driver_type?: DriverTypeChoice } = {};
  if (/\bdedicated\b/.test(t)) out.preferred_route_type = 'Dedicated';
  else if (/\bregional\b/.test(t)) out.preferred_route_type = 'Regional';
  else if (/\blocal\b/.test(t)) out.preferred_route_type = 'Local';
  else if (/\botr\b|\bover[- ]the[- ]road\b|\blong haul\b/.test(t)) out.preferred_route_type = 'OTR';

  if (/\bowner[- ]operator\b|\bowner op\b|\bo\/o\b/.test(t)) out.preferred_driver_type = 'Owner Operator';
  else if (/\bteam driver\b|\bteam driving\b|\bteams?\b/.test(t)) out.preferred_driver_type = 'Team';
  return out;
}

export function extractLocation(text: string): { city?: string; state?: string } {
  const raw = text.trim();
  if (!raw) return {};
  const comma = raw.match(/^(.+?),\s*([A-Za-z]{2})\.?$/);
  if (comma && STATE_ABBREVIATIONS.has(comma[2].toUpperCase())) {
    return { city: titleCase(comma[1].trim()).slice(0, 60), state: comma[2].toUpperCase() };
  }
  const commaNamed = raw.match(/^(.+?),\s*([A-Za-z][A-Za-z\s]+)$/);
  if (commaNamed) {
    const st = STATE_NAMES[commaNamed[2].trim().toLowerCase()];
    if (st) return { city: titleCase(commaNamed[1].trim()).slice(0, 60), state: st };
  }
  const bare = raw.replace(/\.$/, '').trim();
  if (/^[A-Za-z]{2}$/.test(bare) && STATE_ABBREVIATIONS.has(bare.toUpperCase())) {
    return { state: bare.toUpperCase() };
  }
  const named = STATE_NAMES[bare.toLowerCase()];
  if (named) return { state: named };
  return { city: titleCase(bare).slice(0, 60) };
}

export function extractCdlClass(text: string): IntakeAnswers['cdl_class'] | undefined {
  const m = text.match(/\b(?:class\s*)?([abc])\b/i);
  if (!m) return undefined;
  const v = m[1].toUpperCase() as 'A' | 'B' | 'C';
  return v;
}

export function extractYearsExperience(text: string): number | undefined {
  if (/less than\s*1|under\s*1|\bnew\b|\bstudent\b/i.test(text)) return 0;
  const m = text.match(/\d{1,2}/);
  if (!m) return undefined;
  const n = Number(m[0]);
  if (!Number.isFinite(n) || n < 0 || n > 60) return undefined;
  return n;
}

export function extractHomeTime(text: string): IntakeAnswers['preferred_home_time'] | undefined {
  const t = text.toLowerCase();
  if (/bi-?weekly|every other week|two weeks/.test(t)) return 'Bi-weekly';
  if (/daily|every ?night|every day|home each night/.test(t)) return 'Daily';
  if (/weekly|weekend/.test(t)) return 'Weekly';
  if (/2-3 weeks|three weeks|3 weeks|weeks out/.test(t)) return '2-3 weeks out';
  return undefined;
}

export function extractTrailers(text: string): string[] {
  const t = text.toLowerCase();
  const found = TRAILER_CHOICES.filter((tr) => t.includes(tr.toLowerCase()));
  if (found.length) return [...found];
  if (/\bvan\b/.test(t)) return ['Dry Van'];
  if (/\breefer|refrigerated\b/.test(t)) return ['Reefer'];
  return [];
}

export function extractPayGoal(text: string): number | undefined {
  const cleaned = text.replace(/[,$]/g, '');
  const m = cleaned.match(/\d{3,6}/);
  if (!m) return undefined;
  const n = Number(m[0]);
  if (!Number.isFinite(n) || n <= 0 || n > 100000) return undefined;
  return n;
}

/** Applies a free-text reply for a given step, extracting only what is explicit. */
export function applyStepAnswer(
  answers: IntakeAnswers,
  stepId: IntakeStepId,
  text: string,
): IntakeAnswers {
  const value = text.trim();
  if (!value) return answers;
  switch (stepId) {
    case 'work-type': {
      const hints = extractWorkTypeHints(value);
      return { ...answers, ...hints };
    }
    case 'location': {
      const loc = extractLocation(value);
      return { ...answers, ...loc };
    }
    case 'cdl-class': {
      const cdl = extractCdlClass(value);
      return cdl ? { ...answers, cdl_class: cdl } : answers;
    }
    case 'experience': {
      const years = extractYearsExperience(value);
      return years === undefined ? answers : { ...answers, years_experience: years };
    }
    case 'home-time': {
      const ht = extractHomeTime(value);
      return ht ? { ...answers, preferred_home_time: ht } : answers;
    }
    case 'trailer': {
      const trailers = extractTrailers(value);
      return trailers.length ? { ...answers, trailer_experience: trailers } : answers;
    }
    case 'pay-goal': {
      const pay = extractPayGoal(value);
      return pay === undefined ? answers : { ...answers, min_weekly_gross: pay };
    }
    default:
      return answers;
  }
}

export function isStepAnswered(answers: IntakeAnswers, stepId: IntakeStepId): boolean {
  switch (stepId) {
    case 'work-type':
      return Boolean(answers.preferred_route_type || answers.preferred_driver_type);
    case 'location':
      return Boolean(answers.state || answers.city);
    case 'cdl-class':
      return Boolean(answers.cdl_class);
    case 'experience':
      return answers.years_experience !== undefined;
    case 'home-time':
      return Boolean(answers.preferred_home_time);
    case 'trailer':
      return Boolean(answers.trailer_experience?.length);
    case 'pay-goal':
      return answers.min_weekly_gross !== undefined;
    default:
      return false;
  }
}

/** Progressive: only ever returns a step the driver has not already answered or skipped. */
export function nextStep(
  answers: IntakeAnswers,
  skipped: readonly IntakeStepId[] = [],
): IntakeStep | null {
  for (const step of INTAKE_STEPS) {
    if (isStepAnswered(answers, step.id)) continue;
    if (skipped.includes(step.id)) continue;
    return step;
  }
  return null;
}

/** Truthful summary — only facts the driver supplied. No counts, no matches. */
export function summarizeIntake(answers: IntakeAnswers): string[] {
  const parts: string[] = [];
  if (answers.preferred_route_type) parts.push(answers.preferred_route_type);
  if (answers.preferred_driver_type) parts.push(answers.preferred_driver_type);
  if (answers.city && answers.state) parts.push(`${answers.city}, ${answers.state}`);
  else if (answers.state) parts.push(answers.state);
  else if (answers.city) parts.push(answers.city);
  if (answers.cdl_class) parts.push(`CDL-${answers.cdl_class}`);
  if (answers.years_experience !== undefined) {
    parts.push(answers.years_experience === 1 ? '1 year' : `${answers.years_experience} years`);
  }
  if (answers.preferred_home_time) parts.push(`Home ${answers.preferred_home_time.toLowerCase()}`);
  if (answers.trailer_experience?.length) parts.push(answers.trailer_experience.join(' / '));
  if (answers.min_weekly_gross !== undefined) {
    parts.push(`$${answers.min_weekly_gross.toLocaleString('en-US')}/wk goal`);
  }
  return parts;
}

/* ------------------------------------------------------------------ */
/* Bounded pre-auth snapshot                                           */
/* ------------------------------------------------------------------ */

export interface HomeIntakeSnapshot extends IntakeAnswers {
  version: typeof HOME_INTAKE_SNAPSHOT_VERSION;
  createdAt: string;
}

export function buildIntakeSnapshot(
  answers: IntakeAnswers,
  now: Date = new Date(),
): HomeIntakeSnapshot {
  const snap: HomeIntakeSnapshot = {
    version: HOME_INTAKE_SNAPSHOT_VERSION,
    createdAt: now.toISOString(),
  };
  if (answers.initialMessage) snap.initialMessage = answers.initialMessage.slice(0, 500);
  if (answers.preferred_route_type) snap.preferred_route_type = answers.preferred_route_type;
  if (answers.preferred_driver_type) snap.preferred_driver_type = answers.preferred_driver_type;
  if (answers.city) snap.city = answers.city.slice(0, 60);
  if (answers.state) snap.state = answers.state.slice(0, 2);
  if (answers.cdl_class) snap.cdl_class = answers.cdl_class;
  if (answers.years_experience !== undefined) snap.years_experience = answers.years_experience;
  if (answers.preferred_home_time) snap.preferred_home_time = answers.preferred_home_time;
  if (answers.trailer_experience?.length) {
    snap.trailer_experience = answers.trailer_experience.slice(0, 8);
  }
  if (answers.min_weekly_gross !== undefined) snap.min_weekly_gross = answers.min_weekly_gross;
  return snap;
}

export function saveIntakeSnapshot(answers: IntakeAnswers, now: Date = new Date()): boolean {
  try {
    const payload = JSON.stringify(buildIntakeSnapshot(answers, now));
    if (payload.length > HOME_INTAKE_SNAPSHOT_MAX_BYTES) return false;
    sessionStorage.setItem(HOME_INTAKE_SNAPSHOT_KEY, payload);
    return true;
  } catch {
    return false;
  }
}

/** Fail-closed parse: anything unexpected yields null. Never throws. */
export function parseIntakeSnapshot(
  raw: string | null | undefined,
  now: Date = new Date(),
): HomeIntakeSnapshot | null {
  if (!raw || typeof raw !== 'string') return null;
  if (raw.length > HOME_INTAKE_SNAPSHOT_MAX_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  if (o.version !== HOME_INTAKE_SNAPSHOT_VERSION) return null;
  if (typeof o.createdAt !== 'string') return null;
  const created = Date.parse(o.createdAt);
  if (!Number.isFinite(created)) return null;
  const age = now.getTime() - created;
  if (age < -60_000 || age > HOME_INTAKE_SNAPSHOT_MAX_AGE_MS) return null;

  const out: HomeIntakeSnapshot = {
    version: HOME_INTAKE_SNAPSHOT_VERSION,
    createdAt: o.createdAt,
  };
  const str = (v: unknown, max: number) =>
    typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined;

  const msg = str(o.initialMessage, 500);
  if (msg) out.initialMessage = msg;
  if (typeof o.preferred_route_type === 'string' &&
      (ROUTE_TYPE_CHOICES as readonly string[]).includes(o.preferred_route_type)) {
    out.preferred_route_type = o.preferred_route_type as RouteTypeChoice;
  }
  if (typeof o.preferred_driver_type === 'string' &&
      (DRIVER_TYPE_CHOICES as readonly string[]).includes(o.preferred_driver_type)) {
    out.preferred_driver_type = o.preferred_driver_type as DriverTypeChoice;
  }
  const city = str(o.city, 60);
  if (city) out.city = city;
  const state = str(o.state, 2);
  if (state && /^[A-Za-z]{2}$/.test(state)) out.state = state.toUpperCase();
  if (typeof o.cdl_class === 'string' &&
      (CDL_CLASS_CHOICES as readonly string[]).includes(o.cdl_class)) {
    out.cdl_class = o.cdl_class as IntakeAnswers['cdl_class'];
  }
  if (typeof o.years_experience === 'number' &&
      Number.isFinite(o.years_experience) &&
      o.years_experience >= 0 &&
      o.years_experience <= 60) {
    out.years_experience = o.years_experience;
  }
  if (typeof o.preferred_home_time === 'string' &&
      (HOME_TIME_CHOICES as readonly string[]).includes(o.preferred_home_time)) {
    out.preferred_home_time = o.preferred_home_time as IntakeAnswers['preferred_home_time'];
  }
  if (Array.isArray(o.trailer_experience)) {
    const trailers = o.trailer_experience
      .filter((t): t is string => typeof t === 'string')
      .filter((t) => (TRAILER_CHOICES as readonly string[]).includes(t))
      .slice(0, 8);
    if (trailers.length) out.trailer_experience = trailers;
  }
  if (typeof o.min_weekly_gross === 'number' &&
      Number.isFinite(o.min_weekly_gross) &&
      o.min_weekly_gross > 0 &&
      o.min_weekly_gross <= 100000) {
    out.min_weekly_gross = o.min_weekly_gross;
  }
  return out;
}

/**
 * Reads the stored snapshot. Invalid/expired snapshots fail closed AND are
 * cleared, because they can never become valid again.
 */
export function readIntakeSnapshot(now: Date = new Date()): HomeIntakeSnapshot | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(HOME_INTAKE_SNAPSHOT_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const parsed = parseIntakeSnapshot(raw, now);
  if (!parsed) {
    clearIntakeSnapshot();
    return null;
  }
  return parsed;
}

export function clearIntakeSnapshot(): void {
  try {
    sessionStorage.removeItem(HOME_INTAKE_SNAPSHOT_KEY);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}

/**
 * The only fields a pre-auth conversation may seed into the Driver Opportunity
 * Preferences form. Deliberately excludes identity, contact, visibility,
 * recruiter-contact consent, and profile completion.
 */
export interface DriverProfileSeed {
  city?: string;
  state?: string;
  cdl_class?: string;
  years_experience?: string;
  trailer_experience?: string[];
  preferred_driver_type?: string;
  preferred_route_type?: string;
  preferred_home_time?: string;
  min_weekly_gross?: string;
}

export function toDriverProfileSeed(snapshot: HomeIntakeSnapshot): DriverProfileSeed {
  const seed: DriverProfileSeed = {};
  if (snapshot.city) seed.city = snapshot.city;
  if (snapshot.state) seed.state = snapshot.state;
  if (snapshot.cdl_class) seed.cdl_class = snapshot.cdl_class;
  if (snapshot.years_experience !== undefined) {
    seed.years_experience = String(snapshot.years_experience);
  }
  if (snapshot.trailer_experience?.length) seed.trailer_experience = [...snapshot.trailer_experience];
  if (snapshot.preferred_driver_type) seed.preferred_driver_type = snapshot.preferred_driver_type;
  if (snapshot.preferred_route_type) seed.preferred_route_type = snapshot.preferred_route_type;
  if (snapshot.preferred_home_time) seed.preferred_home_time = snapshot.preferred_home_time;
  if (snapshot.min_weekly_gross !== undefined) {
    seed.min_weekly_gross = String(snapshot.min_weekly_gross);
  }
  return seed;
}

/* ------------------------------------------------------------------ */
/* HP-4A — bounded deterministic multi-field first-message extraction  */
/* ------------------------------------------------------------------ */

/**
 * HP-4A hard rules:
 *  - Pure. No network, no storage, no AI, no inference beyond literal evidence.
 *  - PREFERENCE dimensions only. Facts (cdl_class, years_experience,
 *    endorsements) are NEVER derived here; they stay explicit-step questions.
 *  - Ambiguity fails closed: if a dimension carries more than one distinct
 *    recognized value, the dimension stays unset and the normal step asks it.
 */

/** The only fields this pass may ever populate. */
export const FIRST_MESSAGE_PREFERENCE_FIELDS = [
  'preferred_route_type',
  'preferred_driver_type',
  'preferred_home_time',
  'trailer_experience',
  'city',
  'state',
  'min_weekly_gross',
] as const;

const ROUTE_PATTERNS: Record<RouteTypeChoice, RegExp> = {
  Local: /\blocal\b/,
  Regional: /\bregional\b/,
  OTR: /\botr\b|\bover[- ]the[- ]road\b|\blong haul\b/,
  Dedicated: /\bdedicated\b/,
};

const DRIVER_TYPE_PATTERNS: Record<DriverTypeChoice, RegExp> = {
  'Owner Operator': /\bowner[- ]operator\b|\bowner op\b|\bo\/o\b/,
  Team: /\bteam driver\b|\bteam driving\b|\bteams?\b/,
};

const BIWEEKLY_PATTERN = /bi-?weekly|every other week|every 2 weeks|every two weeks/g;

/** Returns the single matching value, or undefined when zero or 2+ distinct values match. */
function soleMatch<T extends string>(text: string, patterns: Record<T, RegExp>): T | undefined {
  const hits = (Object.keys(patterns) as T[]).filter((key) => patterns[key].test(text));
  return hits.length === 1 ? hits[0] : undefined;
}

/** Distinct home-time values literally present. Bi-weekly phrases never also count as Weekly. */
function homeTimeMatches(text: string): string[] {
  const withoutBiweekly = text.replace(BIWEEKLY_PATTERN, ' ');
  const hits: string[] = [];
  if (BIWEEKLY_PATTERN.test(text)) hits.push('Bi-weekly');
  BIWEEKLY_PATTERN.lastIndex = 0;
  if (/daily|every ?night|every day|home each night/.test(withoutBiweekly)) hits.push('Daily');
  if (/\bweekly\b|weekend/.test(withoutBiweekly)) hits.push('Weekly');
  if (/2-3 weeks|three weeks|3 weeks|weeks out/.test(withoutBiweekly)) hits.push('2-3 weeks out');
  return hits;
}

/**
 * Only an explicit "City, ST" fragment counts — never a whole sentence. The
 * city segment must start the message or follow a clause break / locational
 * preposition, is bounded to three words, and has known sentence lead-ins
 * stripped, so surrounding words can never be absorbed into the city name.
 * Two or more distinct state codes anywhere in the message fail closed.
 */
const FIRST_MESSAGE_LOCATION_PATTERN =
  /(?:^|[,.;:]|\b(?:in|from|near|around|based in|out of)\s)\s*([A-Za-z][A-Za-z.'-]*(?:\s[A-Za-z][A-Za-z.'-]*){0,2}),\s*([A-Za-z]{2})\b/g;

/** Any "…, ST" occurrence, used only to detect multiple locations. */
const ANY_COMMA_STATE_PATTERN = /,\s*([A-Za-z]{2})\b/g;

const LOCATION_LEAD_INS = new Set([
  'running','run','driving','drive','hauling','haul','based','live','living','located',
  'looking','want','need','prefer','im',"i'm",'i','am','out','of','or','and','the','a',
  'work','working','stay','staying','currently','also','me','my','home',
]);

function stripLocationLeadIns(segment: string): string {
  const words = segment.trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && LOCATION_LEAD_INS.has(words[0].toLowerCase())) words.shift();
  return words.length && LOCATION_LEAD_INS.has(words[0].toLowerCase()) ? '' : words.join(' ');
}

function firstMessageLocation(text: string): { city?: string; state?: string } {
  const stateTokens = new Set(
    [...text.matchAll(ANY_COMMA_STATE_PATTERN)]
      .map((m) => m[1].toUpperCase())
      .filter((code) => STATE_ABBREVIATIONS.has(code)),
  );
  if (stateTokens.size > 1) return {};

  const matches = [...text.matchAll(FIRST_MESSAGE_LOCATION_PATTERN)];
  const resolved = matches
    .map((m) => {
      const city = stripLocationLeadIns(m[1]);
      return city ? extractLocation(`${city}, ${m[2]}`) : extractLocation(m[2]);
    })
    .filter((loc) => Boolean(loc.state));
  const distinct = new Set(resolved.map((loc) => `${loc.city ?? ''}|${loc.state ?? ''}`));
  return distinct.size === 1 ? resolved[0] : {};
}



/** Only a number with explicit money or per-week context counts. */
function firstMessagePayGoal(text: string): number | undefined {
  const candidates = new Set<number>();
  for (const m of text.matchAll(/\$\s?(\d[\d,]{2,6})/g)) {
    const n = extractPayGoal(m[1]);
    if (n !== undefined) candidates.add(n);
  }
  for (const m of text.matchAll(
    /\b(\d[\d,]{2,6})\s*(?:\/\s*wk|\/\s*week|a week|per week|weekly)\b/gi,
  )) {
    const n = extractPayGoal(m[1]);
    if (n !== undefined) candidates.add(n);
  }
  return candidates.size === 1 ? [...candidates][0] : undefined;
}

/**
 * Bounded multi-field extraction for the driver's FIRST free-text reply only.
 * Returns only the fields with unambiguous literal evidence.
 */
export function extractFirstMessagePreferences(text: string): IntakeAnswers {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) return {};
  const t = ` ${value.toLowerCase()} `;
  const out: IntakeAnswers = {};

  const route = soleMatch(t, ROUTE_PATTERNS);
  if (route) out.preferred_route_type = route;

  const driverType = soleMatch(t, DRIVER_TYPE_PATTERNS);
  if (driverType) out.preferred_driver_type = driverType;

  const homeTimes = homeTimeMatches(t);
  if (homeTimes.length === 1) {
    out.preferred_home_time = homeTimes[0] as IntakeAnswers['preferred_home_time'];
  }

  const trailers = extractTrailers(value);
  if (trailers.length) out.trailer_experience = trailers;

  const loc = firstMessageLocation(value);
  if (loc.state) out.state = loc.state;
  if (loc.city) out.city = loc.city;

  const pay = firstMessagePayGoal(value);
  if (pay !== undefined) out.min_weekly_gross = pay;

  return out;
}

/**
 * Human-readable labels for what the first message captured, reusing the single
 * existing summary vocabulary. Never a claim of understanding, matching, or
 * qualification — just an echo of the driver's own words.
 */
export function describeCapturedPreferences(captured: IntakeAnswers): string[] {
  return summarizeIntake(captured);
}

/**
 * True when the first message captured at least one field BEYOND the work-type
 * dimension the step itself asked for. Only then is a disclosure line warranted.
 */
export function hasExtraCapturedPreferences(captured: IntakeAnswers): boolean {
  return (
    Boolean(captured.preferred_home_time) ||
    Boolean(captured.trailer_experience?.length) ||
    Boolean(captured.state) ||
    Boolean(captured.city) ||
    captured.min_weekly_gross !== undefined
  );
}
