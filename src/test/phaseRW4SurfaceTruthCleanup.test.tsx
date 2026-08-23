/**
 * Phase RW-4 — Surface truth cleanup (copy-only).
 *
 * These are durable source-contract assertions over the user-facing copy
 * surfaces corrected in RW-4, plus regression guards proving the already
 * canonical recruiter surfaces were not edited and that no authorization,
 * billing, or routing behavior was introduced by this phase.
 *
 * Product truth asserted here (do not weaken):
 *  - Standard recruiter posting requires recruiter workspace readiness +
 *    current posting terms + non-suspended state. No admin approval,
 *    no paid plan.
 *  - Verified Recruiter badge review is separate and optional.
 *  - Driver Assistant access begins through a driver invite / approved
 *    delegation; signing in alone never grants access to a driver account.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const AUTH = 'src/pages/Auth.tsx';
const FAQ = 'src/pages/FAQ.tsx';
const FEATURES = 'src/pages/recruiter/RecruiterFeatures.tsx';
const GUIDE = 'src/pages/recruiter/RecruiterGuide.tsx';
const AA = 'src/pages/AssistantsAgencies.tsx';
const DOCS = 'src/pages/Docs.tsx';
const RECRUITERS = 'src/pages/Recruiters.tsx';
const RECRUITER_FAQ = 'src/pages/recruiter/RecruiterFAQ.tsx';

const RECRUITER_TRUTH =
  'Complete, active recruiter workspaces can post standard opportunities without admin approval; Verified Recruiter badge review is separate and optional.';

describe('RW-4 A — Auth surface recruiter/assistant/agency copy', () => {
  const src = read(AUTH);

  it('1. no stale recruiter approval-gate copy', () => {
    expect(src).not.toMatch(/Apply for recruiter access/i);
    expect(src).not.toMatch(/require approval before posting/i);
    expect(src).not.toMatch(/Recruiter accounts require approval/i);
  });

  it('2. recruiter helper states workspace readiness, current posting terms, no admin approval, optional badge review', () => {
    expect(src).toContain(
      'Add the recruiter workspace, complete the required recruiter details, and accept the current posting terms. ' +
        RECRUITER_TRUTH,
    );
  });

  it('3. assistant/agency login + signup titles are the canonical strings', () => {
    expect(src).toContain("login: 'Continue to Assistant Access Center'");
    expect(src).toContain("signup: 'Create your account for Assistant Access'");
    expect(src).toContain("login: 'Continue to Agency Console'");
    expect(src).toContain("signup: 'Create your account to start an agency workspace'");
    expect(src).not.toContain('Continue to assistant dashboard');
    expect(src).not.toContain('Continue to agency workspace');
  });

  it('4. assistant helper preserves invite/approved-delegation truth and no auto-grant', () => {
    expect(src).toMatch(/access begins through a driver invite or approved delegation/i);
    expect(src).toMatch(/do not auto-grant access to any driver account/i);
  });

  it('4b. auth next-defaults and capability routing are unchanged', () => {
    expect(src).toContain("nextDefault: '/assistant'");
    expect(src).toContain("nextDefault: '/agency'");
    expect(src).toMatch(/htp_auth_intent/);
    expect(src).toMatch(/htp_workspace_intent/);
  });
});

describe('RW-4 B — Main FAQ opportunity + recruiter posting answers', () => {
  const src = read(FAQ);

  it('5. what-are-opportunities uses current-posting-requirements wording', () => {
    expect(src).not.toContain('submitted by approved recruiters and carriers');
    expect(src).toContain(
      'Opportunities are structured trucking listings submitted by recruiters and carriers whose workspaces meet the current posting requirements. Drivers can review estimated pay, RPM, deadhead, deductions, and request more information.',
    );
  });

  it('6. how-recruiters-post remains canonical (readiness + terms, no admin/badge gate)', () => {
    expect(src).toContain('accepts the current posting terms');
    expect(src).toContain(
      'Standard posting is not gated on Verified Recruiter badge approval or on admin approval.',
    );
  });
});

describe('RW-4 C — Recruiter Features CTA truth', () => {
  const src = read(FEATURES);

  it('7. stale application/verification funnel copy is gone; new truth + CTA present; route unchanged', () => {
    expect(src).not.toMatch(/Apply for recruiter access/i);
    expect(src).not.toMatch(/Apply for Recruiter Access/);
    expect(src).not.toMatch(/get verified/i);
    expect(src).toContain(
      'Add the recruiter workspace, complete the required profile details, and accept the current posting terms. ' +
        RECRUITER_TRUTH,
    );
    expect(src).toContain('Add Recruiter Workspace');
    expect(src).toContain("navigate('/auth?intent=recruiter')");
  });
});

describe('RW-4 D — Recruiter Guide step count and hero line', () => {
  const src = read(GUIDE);

  it('8. exactly 8 steps, 8-step flow heading, workspace-setup hero line', () => {
    for (const n of ['01', '02', '03', '04', '05', '06', '07', '08']) {
      expect(src).toContain(`num: '${n}'`);
    }
    expect(src).not.toContain("num: '09'");
    expect(src.match(/num: '\d{2}'/g)?.length).toBe(8);
    expect(src).toContain('The 8-step flow');
    expect(src).not.toContain('The 7-step flow');
    expect(src).toContain('From workspace setup to hired driver');
    expect(src).not.toContain('From application to hired driver');
  });
});

describe('RW-4 — already-canonical recruiter surfaces remain untouched', () => {
  it('9. Recruiters.tsx still states no admin approval and badge-not-required for standard posting', () => {
    const src = read(RECRUITERS);
    expect(src).toContain(
      'Complete, active recruiter profiles can use standard posting — no admin approval or paid plan required',
    );
    expect(src).toContain(
      'Verified Recruiter badge review controls the Verified Recruiter badge only, not the right to post',
    );
  });

  it('10. RecruiterFAQ.tsx still states no admin/verification gate and separate badge review', () => {
    const src = read(RECRUITER_FAQ);
    expect(src).toContain(
      'No admin approval, no verification gate, and no paid plan are required to post a standard opportunity.',
    );
    expect(src).toContain(
      'The Verified Recruiter badge is a separate trust-display process and does not gate standard posting.',
    );
  });
});

describe('RW-4 E — Assistants & Agencies CTA display labels', () => {
  const src = read(AA);

  it('11. canonical display labels present, misleading label absent, handlers/routes preserved', () => {
    expect(src).toContain('Open Assistant Access Center');
    expect(src).toContain('Sign in for Assistant Access');
    expect(src).not.toContain('Sign in to become a Driver Assistant');
    expect(src).not.toContain("cta: 'Become a Driver Assistant'");
    expect(src).toContain("navigate('/auth?next=%2Fassistant')");
    expect(src).toContain("navigate('/assistant')");
    expect(src).toContain("navigate('/auth?next=%2Fagency')");
    expect(src).toContain("navigate('/agency')");
  });

  it('11b. driver-approval and permission-bounded truth preserved', () => {
    expect(src).toMatch(/Each driver approves you and chooses your permissions/);
    expect(src).toMatch(/Driver-approved delegation, never silent access/);
  });
});

describe('RW-4 F — Docs landing copy', () => {
  const src = read(DOCS);

  it('12. workspace-and-audience intro and workspace search placeholder', () => {
    expect(src).toContain('Guides are organized by workspace and audience —');
    expect(src).toContain('Search guides by title, topic or workspace…');
    expect(src).not.toContain('organized by role');
    expect(src).not.toContain('topic or role');
  });
});

describe('RW-4 — scope guard: copy-only, no new backend/billing/authorization', () => {
  const COPY_FILES = [AUTH, FAQ, FEATURES, GUIDE, AA, DOCS];

  it('13a. copy surfaces introduce no direct database/RPC/billing calls', () => {
    for (const rel of [FAQ, FEATURES, GUIDE, AA, DOCS]) {
      const src = read(rel);
      expect(src, `${rel} must not query the database directly`).not.toMatch(/supabase\s*\.\s*(from|rpc|functions)\b/);
      expect(src, `${rel} must not invoke checkout/billing`).not.toMatch(/create-checkout|customer-portal|stripe/i);
    }
  });

  it('13b. copy surfaces declare no role/permission grants', () => {
    for (const rel of COPY_FILES) {
      const src = read(rel);
      expect(src, `${rel} must not assign roles/permissions`).not.toMatch(
        /user_roles|has_role\(|grant_permission|is_admin\s*=/,
      );
    }
  });

  it('14. suite contains no skipped or todo tests', () => {
    const self = read('src/test/phaseRW4SurfaceTruthCleanup.test.tsx');
    expect(self).not.toMatch(/\b(it|test|describe)\.(skip|todo)\b/);
  });
});
