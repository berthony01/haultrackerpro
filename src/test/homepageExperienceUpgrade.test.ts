/**
 * Homepage Experience Upgrade: structural and safety regression checks.
 * This is static, read-only and requires no credentials or production services.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const landing = readFileSync(resolve(process.cwd(), 'src/pages/Landing.tsx'), 'utf8');
const intake = readFileSync(resolve(process.cwd(), 'src/components/home/HomeConversationFlow.tsx'), 'utf8');

describe('Homepage Experience Upgrade', () => {
  it('retains the functioning guided intake and existing stable test ids', () => {
    expect(landing).toContain('<HomeConversationHero');
    expect(landing).toContain('onContinue={continueToOpportunities}');
    expect(landing).toContain('saveIntakeSnapshot(answers)');
    for (const testId of ['how-it-works-section', 'free-find-work-guide-label', 'secondary-tools-section', 'trust-section']) {
      expect(landing).toContain(testId);
    }
    expect(intake).toContain('home-conversation-transcript');
    expect(intake).toContain('home-conversation-continue');
  });

  it('shows four role-specific entry points and keeps Dispatch separate from recruiting', () => {
    for (const role of ['drivers', 'recruiters', 'dispatchers', 'assistants']) {
      expect(landing).toContain(`key: '${role}'`);
    }
    expect(landing).toContain('Recruiting opportunities are not freight load assignments.');
    expect(landing).toContain("href: '/recruiter/guide'");
    expect(landing).not.toContain('every group member can dispatch');
  });

  it('links only to known public product, help and role pages', () => {
    for (const route of [
      '/features', '/recruiters', '/recruiter/guide', '/assistants-agencies',
      '/resources', '/docs', '/trucking-profit-calculator',
    ]) {
      expect(landing).toContain(route);
    }
    expect(landing).toContain("trackStarterKitCTAClicked('footer')");
  });

  it('includes explicit consent and no misleading AI or payment claims', () => {
    expect(landing).toContain('Review your Find Work answers before saving');
    expect(landing).toContain('Company Dispatch and client records require separate authorization.');
    expect(landing).toContain('Adding a Telegram bot does not grant everyone in a group Dispatch permissions.');
    expect(landing).toContain('HaulTracker Pro does not process service payments.');
    expect(landing).toContain('This is guided intake, not an AI-generated job offer.');
  });
});
