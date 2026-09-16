/**
 * Phase CF-1C-A — Structured qualification foundation (pure library).
 *
 * This module evaluates ONLY deterministic, recruiter-declared structured
 * criteria (minimum years of experience, required CDL class, required
 * endorsements). It is intentionally separate from the existing fit engine
 * (`calculateOpportunityMatch`), which remains the authority on fit scoring.
 *
 * It never claims guaranteed employment or legal qualification. A
 * `meets_known_criteria` result means only that the KNOWN STRUCTURED CRITERIA
 * recorded on the opportunity are satisfied by the driver's recorded profile.
 * Free-text `requirements` may contain additional recruiter requirements that
 * are not represented structurally; that is surfaced via `manualReviewRequired`.
 *
 * Pure and deterministic: no database, network, AI, or Supabase imports.
 */

export type QualificationStatus =
  | 'meets_known_criteria'
  | 'does_not_meet_known_criteria'
  | 'needs_driver_information'
  | 'no_structured_criteria';

export type QualificationCriterionKey = 'experience' | 'cdl_class' | 'endorsements';

export type QualificationOutcome = 'met' | 'failed' | 'unknown';

export interface QualificationCriterionResult {
  key: QualificationCriterionKey;
  outcome: QualificationOutcome;
  /** Short, non-legal, human-readable explanation. */
  detail: string;
  required?: string;
  driverValue?: string;
}

export interface QualificationResult {
  status: QualificationStatus;
  met: QualificationCriterionResult[];
  failed: QualificationCriterionResult[];
  unknown: QualificationCriterionResult[];
  /** Every evaluated criterion, in stable order. */
  evaluated: QualificationCriterionResult[];
  /**
   * True when the opportunity carries nonblank free-text requirements. This is
   * independent of `status` and never downgrades or overrides it.
   */
  manualReviewRequired: boolean;
}

export interface QualificationOpportunityInput {
  min_years_experience?: number | string | null;
  required_cdl_class?: string | null;
  required_endorsements?: string[] | null;
  requirements?: string | null;
}

export interface QualificationDriverInput {
  years_experience?: number | string | null;
  cdl_class?: string | null;
  endorsements?: string[] | null;
}

/** Canonical endorsement codes supported by this phase. */
export const SUPPORTED_ENDORSEMENT_CODES = ['H', 'N', 'P', 'S', 'T', 'X'] as const;
export type EndorsementCode = (typeof SUPPORTED_ENDORSEMENT_CODES)[number];

/** Minimum-class hierarchy: A is the broadest known class, C the narrowest. */
const CDL_CLASS_RANK: Record<string, number> = { A: 3, B: 2, C: 1 };

export function normalizeCdlClass(value: unknown): 'A' | 'B' | 'C' | null {
  if (typeof value !== 'string') return null;
  const match = value.toUpperCase().match(/\b([ABC])\b/);
  if (match) return match[1] as 'A' | 'B' | 'C';
  const stripped = value.toUpperCase().replace(/[^ABC]/g, '');
  return stripped.length === 1 ? (stripped as 'A' | 'B' | 'C') : null;
}

export function normalizeEndorsementCode(value: unknown): EndorsementCode | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toUpperCase();
  if (trimmed.length === 0) return null;
  const leading = trimmed[0];
  if ((SUPPORTED_ENDORSEMENT_CODES as readonly string[]).includes(leading)) {
    // Covers raw codes ("H") and Driver Work Profile labels ("H (Hazmat)",
    // "N (Tanker)", "X (Hazmat+Tanker)", "T (Doubles/Triples)",
    // "P (Passenger)", "S (School Bus)").
    if (trimmed.length === 1 || /^[A-Z][\s(]/.test(trimmed)) {
      return leading as EndorsementCode;
    }
  }
  return null;
}

function normalizeEndorsementList(values: readonly string[]): EndorsementCode[] {
  const out: EndorsementCode[] = [];
  for (const raw of values) {
    const code = normalizeEndorsementCode(raw);
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

/** X (Hazmat + Tanker) implies H and N. H + N alone does NOT imply X. */
function expandHeldEndorsements(codes: readonly EndorsementCode[]): Set<EndorsementCode> {
  const held = new Set<EndorsementCode>(codes);
  if (held.has('X')) {
    held.add('H');
    held.add('N');
  }
  return held;
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isNonBlank(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Evaluate the opportunity's known structured criteria against the driver's
 * recorded profile. Fail-closed: anything unparseable becomes `unknown`, never
 * an assumed pass.
 */
export function evaluateKnownOpportunityQualification(
  opportunity: QualificationOpportunityInput | null | undefined,
  driver: QualificationDriverInput | null | undefined,
): QualificationResult {
  const evaluated: QualificationCriterionResult[] = [];
  const opp = opportunity ?? {};
  const drv = driver ?? {};

  // --- Experience ---------------------------------------------------------
  const minYears = parseFiniteNumber(opp.min_years_experience);
  if (minYears !== null && minYears >= 0) {
    const driverYears = parseFiniteNumber(drv.years_experience);
    if (driverYears === null || driverYears < 0) {
      evaluated.push({
        key: 'experience',
        outcome: 'unknown',
        detail: 'Years of driving experience are not recorded on your profile.',
        required: `${minYears}+ years`,
      });
    } else if (driverYears < minYears) {
      evaluated.push({
        key: 'experience',
        outcome: 'failed',
        detail: `Recorded experience is below the ${minYears}-year minimum.`,
        required: `${minYears}+ years`,
        driverValue: `${driverYears} years`,
      });
    } else {
      evaluated.push({
        key: 'experience',
        outcome: 'met',
        detail: `Recorded experience meets the ${minYears}-year minimum.`,
        required: `${minYears}+ years`,
        driverValue: `${driverYears} years`,
      });
    }
  }

  // --- CDL class ----------------------------------------------------------
  const requiredClass = normalizeCdlClass(opp.required_cdl_class);
  if (requiredClass) {
    const driverClass = normalizeCdlClass(drv.cdl_class);
    if (!driverClass) {
      evaluated.push({
        key: 'cdl_class',
        outcome: 'unknown',
        detail: 'A recognized CDL class is not recorded on your profile.',
        required: `Class ${requiredClass}`,
      });
    } else if (CDL_CLASS_RANK[driverClass] >= CDL_CLASS_RANK[requiredClass]) {
      evaluated.push({
        key: 'cdl_class',
        outcome: 'met',
        detail: `Recorded Class ${driverClass} covers the required Class ${requiredClass}.`,
        required: `Class ${requiredClass}`,
        driverValue: `Class ${driverClass}`,
      });
    } else {
      evaluated.push({
        key: 'cdl_class',
        outcome: 'failed',
        detail: `Recorded Class ${driverClass} does not cover the required Class ${requiredClass}.`,
        required: `Class ${requiredClass}`,
        driverValue: `Class ${driverClass}`,
      });
    }
  }

  // --- Endorsements -------------------------------------------------------
  const requiredEndorsements = Array.isArray(opp.required_endorsements)
    ? normalizeEndorsementList(opp.required_endorsements)
    : [];
  if (requiredEndorsements.length > 0) {
    const driverEndorsementsField = drv.endorsements;
    if (driverEndorsementsField === null || driverEndorsementsField === undefined) {
      evaluated.push({
        key: 'endorsements',
        outcome: 'unknown',
        detail: 'Endorsements are not recorded on your profile.',
        required: requiredEndorsements.join(', '),
      });
    } else if (!Array.isArray(driverEndorsementsField)) {
      evaluated.push({
        key: 'endorsements',
        outcome: 'unknown',
        detail: 'Endorsements are not recorded on your profile.',
        required: requiredEndorsements.join(', '),
      });
    } else {
      const heldCodes = normalizeEndorsementList(driverEndorsementsField);
      const held = expandHeldEndorsements(heldCodes);
      const missing = requiredEndorsements.filter((code) => !held.has(code));
      if (missing.length > 0) {
        evaluated.push({
          key: 'endorsements',
          outcome: 'failed',
          detail: `Missing required endorsement(s): ${missing.join(', ')}.`,
          required: requiredEndorsements.join(', '),
          driverValue: heldCodes.join(', '),
        });
      } else {
        evaluated.push({
          key: 'endorsements',
          outcome: 'met',
          detail: `Recorded endorsements cover: ${requiredEndorsements.join(', ')}.`,
          required: requiredEndorsements.join(', '),
          driverValue: heldCodes.join(', '),
        });
      }
    }
  }

  const met = evaluated.filter((c) => c.outcome === 'met');
  const failed = evaluated.filter((c) => c.outcome === 'failed');
  const unknown = evaluated.filter((c) => c.outcome === 'unknown');

  let status: QualificationStatus;
  if (failed.length > 0) {
    status = 'does_not_meet_known_criteria';
  } else if (unknown.length > 0) {
    status = 'needs_driver_information';
  } else if (evaluated.length === 0) {
    status = 'no_structured_criteria';
  } else {
    status = 'meets_known_criteria';
  }

  return {
    status,
    met,
    failed,
    unknown,
    evaluated,
    manualReviewRequired: isNonBlank(opp.requirements),
  };
}
