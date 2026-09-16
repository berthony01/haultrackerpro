/**
 * HP-3B — Pure presentation helpers for the signed-out homepage opportunity
 * preview.
 *
 * Hard rules encoded here:
 *  - No network, no Supabase, no auth. This module is pure and deterministic.
 *  - No computed pay: every money value rendered is a verbatim recruiter-authored
 *    field. No derived, combined, or converted money values.
 *  - Ranking is coarse and never surfaced as a number to the driver.
 *  - Qualification wording describes ONLY the structured criteria the recruiter
 *    listed, compared against what the driver told the conversation.
 */

import type { Database } from '@/integrations/supabase/types';
import type { QualificationStatus } from '@/lib/opportunities/opportunityQualification';
import type { IntakeAnswers } from '@/lib/home/conversationIntake';

export type PublicTeaserRow =
  Database['public']['Functions']['list_public_opportunity_teasers']['Returns'][number];

/** Maximum teaser cards rendered pre-auth. */
export const MAX_PREVIEW_CARDS = 3;
/** Bounded server fetch size. Never presented as an inventory total. */
export const TEASER_FETCH_LIMIT = 12;

export const QUALIFICATION_LABELS: Record<QualificationStatus, string> = {
  meets_known_criteria: 'Meets the requirements this recruiter listed',
  needs_driver_information: 'Needs a bit more from you',
  does_not_meet_known_criteria: "Doesn't match one listed requirement",
  no_structured_criteria: 'No specific requirements listed',
};

export const ADDITIONAL_REQUIREMENTS_NOTE = 'The recruiter may have additional requirements.';
export const EMPTY_RESULTS_COPY = 'No open listings match what you told us right now.';
export const MORE_RESULTS_COPY = 'More open listings after you continue.';
export const LOAD_FAILURE_COPY = "Listings couldn't load right now.";

/**
 * Adapts a public teaser row to the existing structured evaluator's input.
 * The public teaser deliberately carries no recruiter free text — only the
 * derived boolean — so the evaluator receives a neutral marker rather than any
 * recruiter-authored content.
 */
export function toQualificationOpportunity(row: PublicTeaserRow) {
  return {
    min_years_experience: row.min_years_experience ?? null,
    required_cdl_class: row.required_cdl_class ?? null,
    required_endorsements: row.required_endorsements ?? null,
    requirements: row.has_additional_requirements ? 'Additional requirements listed' : null,
  };
}

/**
 * The conversation never collects endorsements, so `endorsements` is left
 * undefined on purpose: any endorsement requirement then resolves to unknown
 * (fail-closed) instead of a assumed pass.
 */
export function toQualificationDriver(answers: IntakeAnswers) {
  return {
    cdl_class: answers.cdl_class ?? null,
    years_experience: answers.years_experience ?? null,
  };
}

function normalize(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Coarse overlap ranking from teaser fields only. The number is internal and is
 * never rendered.
 */
export function teaserRelevance(row: PublicTeaserRow, answers: IntakeAnswers): number {
  let score = 0;

  if (answers.state) {
    const state = answers.state.toUpperCase();
    if (normalize(row.hiring_state).toUpperCase() === state) score += 3;
    else if (Array.isArray(row.hiring_states) && row.hiring_states.includes(state)) score += 3;
  }

  if (answers.preferred_route_type && normalize(row.route_type) === normalize(answers.preferred_route_type)) {
    score += 2;
  }

  if (answers.trailer_experience?.length && row.trailer_type) {
    const trailer = normalize(row.trailer_type);
    if (answers.trailer_experience.some((t) => normalize(t) === trailer)) score += 1;
  }

  if (answers.preferred_home_time && row.home_time) {
    if (normalize(row.home_time).includes(normalize(answers.preferred_home_time))) score += 1;
  }

  if (row.featured) score += 0.5;

  return score;
}

export function rankTeasers(
  rows: readonly PublicTeaserRow[],
  answers: IntakeAnswers,
): PublicTeaserRow[] {
  return [...rows].sort((a, b) => teaserRelevance(b, answers) - teaserRelevance(a, answers));
}

function money(value: number): string {
  return `$${value.toLocaleString('en-US')}`;
}

/**
 * Verbatim recruiter-authored pay only. Nothing is computed, combined, or
 * converted.
 */
export function formatRecruiterPay(row: PublicTeaserRow): string | null {
  if (typeof row.flat_weekly_pay === 'number' && row.flat_weekly_pay > 0) {
    return `${money(row.flat_weekly_pay)} flat weekly (recruiter listed)`;
  }
  if (typeof row.salary_amount === 'number' && row.salary_amount > 0) {
    const freq = row.salary_frequency ? ` ${row.salary_frequency}` : '';
    return `${money(row.salary_amount)}${freq} salary (recruiter listed)`;
  }
  if (typeof row.percentage_pay === 'number' && row.percentage_pay > 0) {
    const basis = row.percentage_basis_label ? ` of ${row.percentage_basis_label}` : '';
    return `${row.percentage_pay}%${basis} (recruiter listed)`;
  }
  if (typeof row.cpm === 'number' && row.cpm > 0) {
    return `${row.cpm} CPM (recruiter listed)`;
  }
  if (row.other_pay_method_label) {
    return `${row.other_pay_method_label} (recruiter listed)`;
  }
  return null;
}

/** Only ever shown with an explicit "recruiter estimate" label. */
export function formatRecruiterWeeklyEstimate(row: PublicTeaserRow): string | null {
  if (typeof row.estimated_weekly_gross === 'number' && row.estimated_weekly_gross > 0) {
    return `${money(row.estimated_weekly_gross)}/wk gross — recruiter estimate`;
  }
  return null;
}

export function formatDriverGoal(answers: IntakeAnswers): string | null {
  if (answers.min_weekly_gross === undefined) return null;
  return `Your goal: ${money(answers.min_weekly_gross)}/wk`;
}

export function formatTeaserLocation(row: PublicTeaserRow): string | null {
  if (row.hiring_city && row.hiring_state) return `${row.hiring_city}, ${row.hiring_state}`;
  if (row.hiring_state) return row.hiring_state;
  if (Array.isArray(row.hiring_states) && row.hiring_states.length) {
    return row.hiring_states.length > 4
      ? `${row.hiring_states.slice(0, 4).join(', ')} +${row.hiring_states.length - 4} more states`
      : row.hiring_states.join(', ');
  }
  return null;
}

export function teaserTags(row: PublicTeaserRow): string[] {
  const tags: string[] = [];
  if (row.route_type) tags.push(row.route_type);
  if (row.trailer_type) tags.push(row.trailer_type);
  if (row.home_time) tags.push(`Home: ${row.home_time}`);
  return tags;
}
