import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * PHASE 1S-B2 — Recruiter ID / Email consistency contract.
 *
 * Source-contract assertions only. These protect an identity architecture that
 * is spread across several accepted hooks/components:
 *   - auth account identity  = user.id / user.email (login + security actions)
 *   - recruiter business id  = recruiter_profiles.id (ownership of opportunities)
 *   - recruiter_email        = CONTACT info only, never an authorization key
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const RECRUITER_OPPS = 'src/hooks/opportunities/useRecruiterOpportunities.ts';
const APPS_DASHBOARD = 'src/components/opportunities/RecruiterApplicationsDashboard.tsx';
const ADMIN_RECRUITERS = 'src/hooks/admin/useAdminRecruiters.ts';
const SETTINGS_VIEW = 'src/components/opportunities/recruiter/RecruiterSettingsView.tsx';
const ONBOARDING = 'src/components/opportunities/RecruiterOnboarding.tsx';
const ADMIN_PANEL = 'src/components/admin/opportunities/AdminRecruitersPanel.tsx';

describe('Phase 1S-B2 — recruiter identity contract', () => {
  it('1. recruiter opportunities are owned by the recruiter PROFILE id, not the auth user id', () => {
    const src = read(RECRUITER_OPPS);
    expect(src).toMatch(/const recruiterId = profile\?\.id \?\? null;/);
    // writes and filters use the recruiter profile id
    expect(src).toMatch(/recruiter_id: recruiterId!/);
    expect(src).toMatch(/\.eq\('recruiter_id', recruiterId!?\)/);
    // never the auth user id
    expect(src).not.toMatch(/recruiter_id:\s*user\.id/);
    expect(src).not.toMatch(/recruiter_id:\s*user\?\.id/);
    expect(src).not.toMatch(/\.eq\('recruiter_id',\s*user\??\.id\)/);
  });

  it('2. the recruiter applications dashboard passes the recruiter profile id as identity', () => {
    const src = read(APPS_DASHBOARD);
    expect(src).toMatch(/useOpportunityApplications\(\{\s*recruiterId:\s*profile\?\.id\s*\}\)/);
    expect(src).not.toMatch(/recruiterId:\s*user\??\.id/);
  });

  it('3. admin audit metadata keeps profile id and auth user id explicitly distinct', () => {
    const src = read(ADMIN_RECRUITERS);
    expect(src).toMatch(/recruiter_profile_id: id,/);
    expect(src).toMatch(/target_recruiter_user_id: prev\?\.user_id/);
  });

  it('4. recruiter settings renders both contact email and account email', () => {
    const src = read(SETTINGS_VIEW);
    expect(src).toMatch(
      /label="Recruiter contact email"\s+value=\{profile\.recruiter_email\}/,
    );
    expect(src).toMatch(/label="Account email"\s+value=\{user\?\.email \?\? '—'\}/);
  });

  it('5. password reset uses the auth account email, never the recruiter contact email', () => {
    const src = read(SETTINGS_VIEW);
    expect(src).toMatch(/resetPasswordForEmail\(user\.email,/);
    expect(src).not.toMatch(/resetPasswordForEmail\(\s*profile[.?]/);
  });

  it('6. onboarding labels the editable field as contact email and never binds it to user.email', () => {
    const src = read(ONBOARDING);
    expect(src).toContain('Recruiter Contact Email *');
    expect(src).not.toContain('label="Recruiter Email *"');
    // still persists the same payload field
    expect(src).toMatch(/recruiter_email: form\.recruiter_email/);
    // helper copy distinguishing contact vs sign-in email
    expect(src).toMatch(/sign-in \/ account email is managed separately/i);
    // never bound to the auth account email
    expect(src).not.toMatch(/recruiter_email:\s*user\??\.email/);
    expect(src).not.toMatch(/set\('recruiter_email',\s*user\??\.email/);
  });

  it('7. admin panel wording identifies recruiter_email as contact info while using the same field', () => {
    const src = read(ADMIN_PANEL);
    expect(src).toContain("'Recruiter Contact Email'");
    expect(src).toContain('Copy Contact Email');
    expect(src).toMatch(/label="Contact email" value=\{r\.recruiter_email \?\? '—'\}/);
    expect(src).toMatch(/k="Contact email" v=\{detail\.recruiter_email \?\? '—'\}/);
    // the underlying data source is unchanged
    expect(src).toMatch(/copyToClipboard\(r\.recruiter_email!/);
    expect(src).toMatch(/copyToClipboard\(detail\.recruiter_email!/);
    // no generic "Email" label left on the recruiter_email surfaces
    expect(src).not.toMatch(/label="Email" value=\{r\.recruiter_email/);
    expect(src).not.toMatch(/k="Email" v=\{detail\.recruiter_email/);
  });

  it('8. no email-based ownership filters and no user.id-derived opportunity ownership', () => {
    for (const p of [RECRUITER_OPPS, APPS_DASHBOARD, ADMIN_RECRUITERS]) {
      const src = read(p);
      expect(src, p).not.toMatch(/\.eq\('recruiter_email'/);
      expect(src, p).not.toMatch(/\.eq\('email'/);
      expect(src, p).not.toMatch(/recruiter_id:\s*user\??\.id/);
    }
  });

  it('9. this suite contains no skipped, todo, or focused tests', () => {
    const self = read('src/test/phase1sB2RecruiterIdentityConsistency.test.ts');
    expect(self).not.toMatch(/\b(it|describe|test)\.(skip|only|todo)\b/);
  });
});
