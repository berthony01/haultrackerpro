/**
 * Helpers for the legacy `benefits` column on `opportunities`.
 *
 * Historically, two distinct concepts were being written into the same
 * `benefits` text field by different steps of the recruiter form:
 *   - Step 2 "Typical Lanes" (e.g. "Dallas → Houston")
 *   - Step 4 "Additional Requirements" (e.g. "1yr OTR experience...")
 *
 * Both textareas bound to `form.benefits`, so whichever was edited last
 * silently overwrote the other. To preserve backward compatibility with
 * existing rows (no schema change), we now serialize both fields into the
 * same column using clear section markers and split them back on load.
 */
export const LANES_HEADER = 'Typical Lanes:';
export const REQUIREMENTS_HEADER = 'Requirements:';

export interface SplitBenefits {
  typical_lanes: string;
  requirements: string;
}

/**
 * Split a stored `benefits` value into its lanes/requirements parts.
 * Falls back to treating the entire text as requirements when no
 * markers are present (legacy rows).
 */
export function splitBenefits(stored: string | null | undefined): SplitBenefits {
  const raw = (stored ?? '').trim();
  if (!raw) return { typical_lanes: '', requirements: '' };

  const lanesIdx = raw.indexOf(LANES_HEADER);
  const reqsIdx = raw.indexOf(REQUIREMENTS_HEADER);

  // No markers at all → legacy free-text, treat as requirements.
  if (lanesIdx === -1 && reqsIdx === -1) {
    return { typical_lanes: '', requirements: raw };
  }

  let typical_lanes = '';
  let requirements = '';

  if (lanesIdx !== -1) {
    const afterLanes = raw.slice(lanesIdx + LANES_HEADER.length);
    const stopAt = reqsIdx > lanesIdx ? raw.indexOf(REQUIREMENTS_HEADER, lanesIdx) - (lanesIdx + LANES_HEADER.length) : afterLanes.length;
    typical_lanes = afterLanes.slice(0, stopAt).trim();
  }
  if (reqsIdx !== -1) {
    requirements = raw.slice(reqsIdx + REQUIREMENTS_HEADER.length).trim();
  } else if (lanesIdx === -1) {
    requirements = raw;
  }

  return { typical_lanes, requirements };
}

/**
 * Combine lanes + requirements into a single `benefits` string for storage.
 * Omits sections that are empty so we don't write dangling headers.
 */
export function joinBenefits({ typical_lanes, requirements }: SplitBenefits): string {
  const parts: string[] = [];
  const lanes = (typical_lanes ?? '').trim();
  const reqs = (requirements ?? '').trim();
  if (lanes) parts.push(`${LANES_HEADER}\n${lanes}`);
  if (reqs) parts.push(`${REQUIREMENTS_HEADER}\n${reqs}`);
  return parts.join('\n\n');
}
