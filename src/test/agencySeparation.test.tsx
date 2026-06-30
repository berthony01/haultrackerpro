import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

/**
 * Phase audit — Back-Office Agency UI must not bleed into the driver or
 * recruiter dashboards. These are static-source assertions because the real
 * regressions we're guarding against are wiring choices (which hook supplies
 * the stat, which route the home button points to, what label the work-queue
 * uses), not render-time behavior.
 */
describe('Back-Office Agency separation from driver/recruiter', () => {
  it('AgencyDashboard does not import the assistant-delegation context', () => {
    const src = readFileSync('src/pages/AgencyDashboard.tsx', 'utf8');
    expect(src).not.toContain("from '@/hooks/useActingContext'");
    // The overview stat must come from agency clients, not managedDrivers.
    expect(src).toContain('Active clients');
    expect(src).not.toContain('Drivers managed (you)');
  });

  it('AgencyDashboard PageNav home button returns to /agency, not /dashboard', () => {
    const src = readFileSync('src/pages/AgencyDashboard.tsx', 'utf8');
    expect(src).toContain("home={{ label: 'Agency', to: '/agency' }}");
  });

  it('AssistantDashboard PageNav home button returns to /assistant', () => {
    const src = readFileSync('src/pages/AssistantDashboard.tsx', 'utf8');
    expect(src).toContain("home={{ label: 'Assistant', to: '/assistant' }}");
  });

  it('Agency work queue uses client-scoped labels (not raw driver-load terminology)', () => {
    const src = readFileSync('src/components/agency/WorkQueueSection.tsx', 'utf8');
    expect(src).toContain('Log load for client');
    expect(src).toContain('Log expense for client');
    expect(src).toContain('Log fuel for client');
    // Caption explaining these are agency tasks, not the client's own records.
    expect(src).toContain("not the client's own loads");
  });
});
