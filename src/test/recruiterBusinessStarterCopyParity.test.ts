/**
 * Stage-only regression: source copy parity for the public and authenticated
 * recruiter surfaces. Actual authorization/role behavior is exercised in the
 * referenced existing rendered and pure-helper tests.
 * No database, credentials, or production application access.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('Recruiter Business Starter copy integrity', () => {
  const surfaces = [
    'src/pages/Recruiters.tsx',
    'src/components/landing/RecruiterLanding.tsx',
    'src/components/opportunities/recruiter/RecruiterAccessPage.tsx',
  ];

  it.each(surfaces)('%s does not promise unlimited active free postings', path => {
    const body = source(path);
    expect(body).not.toMatch(/post unlimited standard opportunities/i);
    expect(body).not.toMatch(/unlimited standard opportunity posts/i);
    expect(body).not.toMatch(/unlimited standard posts/i);
  });

  it('primary public page accurately directs independent recruiters to the guide', () => {
    const body = source('src/pages/Recruiters.tsx');
    expect(body).toContain('Read the Recruiter Business Starter Guide');
    expect(body).toContain("navigate('/recruiter/guide')");
    expect(body).toContain('1 active opportunity, unlimited drafts');
  });

  it('authenticated recruiter incomplete-state guidance is conditional on carrier type', () => {
    const body = source('src/components/opportunities/recruiter/RecruiterAccessPage.tsx');
    expect(body).toContain('Only Carrier / Motor Carrier accounts need a DOT or MC number');
    expect(body).not.toContain('at least one of DOT or MC number, and accept the posting terms');
    expect(body).toContain('1 active standard opportunity with unlimited drafts');
  });

  it('the guide distinguishes off-platform commissions from actual recruiter features', () => {
    const body = source('src/pages/recruiter/RecruiterGuide.tsx');
    expect(body).toContain('id="business-starter"');
    expect(body).toContain('Carrier-client invoicing, commissions, and actual payment take place outside the platform');
  });
});
