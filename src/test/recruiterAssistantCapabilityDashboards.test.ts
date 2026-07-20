import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('Capability dashboards — recruiter + assistant first-class UX', () => {
  const app = read('src/App.tsx');
  const launcher = read('src/pages/CapabilityLauncher.tsx');
  const assistant = read('src/pages/AssistantDashboard.tsx');
  const recruiterEntry = read('src/components/opportunities/recruiter/RecruiterEntryRoute.tsx');

  it('exposes a first-class /recruiter route through the controlled recruiter entry', () => {
    expect(app).toMatch(/path="\/recruiter"/);
    expect(app).toMatch(/<RecruiterEntryRoute\s*\/>/);
    expect(recruiterEntry).toMatch(
      /recruiterStatus === 'setup'[\s\S]*\? '\/dashboard\?page=recruiter-access:onboarding'/,
    );
    expect(recruiterEntry).toMatch(
      /recruiterStatus === 'active' \|\| recruiterStatus === 'suspended'[\s\S]*\? '\/dashboard\?page=recruiter-access'/,
    );
    expect(recruiterEntry).toMatch(/navigate\(recruiterDestination, \{ replace: true \}\)/);
    // sub-views preserved
    expect(app).toMatch(/path="\/recruiter\/manage"/);
    expect(app).toMatch(/path="\/recruiter\/applications"/);
    expect(app).toMatch(/path="\/recruiter\/reports"/);
  });

  it('protects the /recruiter route behind auth (no intent= leakage)', () => {
    const line = app.split('\n').find((l) => l.includes('path="/recruiter"'));
    expect(line).toBeDefined();
    expect(line!).toMatch(/ProtectedRoute/);
    expect(app).not.toMatch(/intent=recruiter/);
    expect(app).not.toMatch(/intent=assistant/);
    expect(app).not.toMatch(/intent=agency/);
  });

  it('Capability launcher routes recruiter tile to /recruiter', () => {
    expect(launcher).toMatch(/to:\s*'\/recruiter'/);
    expect(launcher).not.toMatch(/dashboard\?page=recruiter-access/);
  });

  it('Assistant dashboard empty state offers Dashboard + Agency CTAs', () => {
    expect(assistant).toMatch(/No approved drivers yet/);
    expect(assistant).toMatch(/Go to my Dashboard/);
    expect(assistant).toMatch(/Create Agency Workspace/);
  });

  it('Assistant dashboard includes the agency upsell card routing to /agency', () => {
    expect(assistant).toMatch(/assistant-agency-cta/);
    expect(assistant).toMatch(/manage multiple drivers as a business/);
    expect(assistant).toMatch(/navigate\('\/agency'\)/);
  });

  it('Assistant dashboard uses AppShell + PageNav (theme + back nav preserved)', () => {
    expect(assistant).toMatch(/<AppShell>/);
    expect(assistant).toMatch(/<PageNav\b/);
  });

  it('Assistant quick actions remain permission-gated (hasPerm checks present)', () => {
    expect(assistant).toMatch(/hasPerm\(d\.permissions, 'manage_loads'\)/);
    expect(assistant).toMatch(/hasPerm\(d\.permissions, 'manage_expenses'\)/);
    expect(assistant).toMatch(/hasPerm\(d\.permissions, 'manage_fuel'\)/);
    expect(assistant).toMatch(/hasPerm\(d\.permissions, 'view_reports'\)/);
  });
});
