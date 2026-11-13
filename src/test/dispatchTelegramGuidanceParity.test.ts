/**
 * Public education copy parity with the current Dispatch and Telegram product.
 * Read-only checks. No network, user account, Telegram or production SQL actions.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GUIDE_TOPICS } from '@/components/assistant/guidedTopics';
import { searchDocs } from '@/lib/docs/docsRegistry';
import { featureList } from '@/lib/featureList';
import { recruiterFeatureList } from '@/lib/recruiterFeatureList';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Dispatch, Telegram Mini App and permissions in public guidance', () => {
  it('explains company Dispatch separately from public recruiting on both landing pages', () => {
    const home = read('src/pages/Landing.tsx');
    const recruiter = read('src/pages/Recruiters.tsx');
    expect(home).toContain('authorized company Dispatch workspace');
    expect(recruiter).toContain('Company Dispatch and Telegram Mini App');
    expect(recruiter).toContain('drivers who accepted a company connection');
    const about = read('src/pages/About.tsx');
    expect(about).toContain('structured opportunities from an eligible recruiter workspace');
    expect(about).not.toContain('Post verified opportunities');
  });

  it('documents the signed Mini App, 15-minute group linking and consent lifecycle', () => {
    const guide = read('src/pages/recruiter/RecruiterGuide.tsx');
    expect(guide).toContain('id="dispatch"');
    expect(guide).toContain('Posting a job does not assign a load');
    expect(guide).toContain('verified driver reviews and accepts');
    expect(guide).toContain('/start dispatch');
    expect(guide).toContain('within 15 minutes');
    expect(guide).toContain('driver interface labels this clearly');
    expect(guide).toContain('Drivers do not need company staff or Telegram bot access');
  });

  it('surfaces safe Dispatch and Telegram routes in role-aware guided help and searchable docs', () => {
    const company = GUIDE_TOPICS.recruiter.find(topic => topic.id === 'dispatch');
    expect(company?.links?.some(link => link.to === '/dispatch')).toBe(true);
    expect(company?.links?.some(link => link.to === '/recruiter/guide#dispatch')).toBe(true);
    const driver = GUIDE_TOPICS.self_driver.find(topic => topic.id === 'company-loads');
    expect(driver?.links?.some(link => link.to === '/driver/company-connections')).toBe(true);
    expect(searchDocs('telegram').some(doc => doc.route === '/recruiter/guide')).toBe(true);
    expect(searchDocs('dispatch').some(doc => doc.route === '/recruiter/guide')).toBe(true);
  });

  it('does not confuse messaging, staff Dispatch, group review or direct assistant subscription', () => {
    const faq = read('src/pages/recruiter/RecruiterFAQ.tsx');
    expect(faq).toContain('An opportunity is a job listing');
    expect(faq).toContain('group members Dispatch permissions');
    expect(faq).toContain('Use your authorized Conversations inbox');
    expect(faq).not.toContain('In-app messaging is on the roadmap');
    const team = featureList.find(cat => cat.category === 'Team & Agency Workflow');
    const assistant = team?.features.find(f => f.title === 'Driver Assistants');
    expect(assistant?.description).toContain('active Driver Pro plan');
    expect(assistant?.description).not.toContain('without a Driver Pro subscription');
    expect(featureList.some(cat => cat.category === 'Company Dispatch & Telegram')).toBe(true);
    expect(recruiterFeatureList.some(cat => cat.category === 'Company Dispatch & Telegram Mini App')).toBe(true);
  });
});
