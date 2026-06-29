import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { featureList, generateFeatureMarkdown } from '@/lib/featureList';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('Phase 4 cleanup — assistant/agency showcase wiring', () => {
  const landing = read('src/pages/Landing.tsx');
  const features = read('src/pages/Features.tsx');
  const pricing = read('src/pages/Pricing.tsx');
  const aaPage = read('src/pages/AssistantsAgencies.tsx');
  const dcc = read('src/pages/DriverAssistantControl.tsx');
  const wq = read('src/components/agency/WorkQueueSection.tsx');
  const respondMig = read(
    'supabase/migrations/20260629214611_9d9d944a-523d-4f5d-9a5c-c156a02f613c.sql',
  );
  const sitemap = read('public/sitemap.xml');

  it('Landing hero positions for drivers, recruiters, assistants, and agencies', () => {
    expect(landing).toMatch(/back-office side hustle/i);
    expect(landing).toMatch(/driver\s*\n?\s*assistants and agencies|assistants and agencies/i);
    // Not framed only as drivers/recruiters
    expect(landing).not.toMatch(/honest trucking platform/i);
  });

  it('Landing nav exposes Assistants & Agencies', () => {
    expect(landing).toMatch(/Assistants & Agencies/);
    expect(landing).toMatch(/\/assistants-agencies/);
  });

  it('Landing FAQ includes side-hustle / driver-approval / no-payment-processing entries', () => {
    expect(landing).toMatch(/side hustle/i);
    expect(landing).toMatch(/revoke/i);
    expect(landing).toMatch(/outside HaulTracker Pro/i);
  });

  it('Landing does not promise guaranteed income or clients', () => {
    expect(landing).not.toMatch(/guaranteed income/i);
    expect(landing).not.toMatch(/guaranteed clients/i);
    expect(landing).not.toMatch(/public marketplace/i);
  });

  it('Features page describes Team & Agency Workflow with private (not public) request links', () => {
    expect(features).toMatch(/team & agency|Team & Agency/);
    expect(features).toMatch(/private operating system|approved to manage/i);
    expect(features).not.toMatch(/public marketplace/i);
  });

  it('featureList uses Private Agency Request Links wording', () => {
    const flat = JSON.stringify(featureList.map((c) => c.features.map((f) => `${f.title}|${f.description}`)));
    expect(flat).toMatch(/Private Agency Request Links/);
    expect(flat).not.toMatch(/Public Agency Request Links/);
    expect(flat).toMatch(/sign in to submit/i);
  });

  it('Generated feature sheet markdown calls out side-hustle/agency opportunity safely', () => {
    const md = generateFeatureMarkdown();
    expect(md).toMatch(/side-hustle|side hustle/i);
    expect(md).toMatch(/driver-approved/i);
    expect(md).not.toMatch(/guaranteed income/i);
    expect(md).not.toMatch(/public marketplace/i);
  });

  it('Pricing page includes Assistants & Agencies payment-limitation copy', () => {
    expect(pricing).toMatch(/Assistants & Agencies/);
    expect(pricing).toMatch(/does\s*<\/?b?>?\s*not\s*<\/?b?>?\s*currently process payments|does not currently process payments/i);
    expect(pricing).not.toMatch(/guaranteed income/i);
  });

  it('AssistantsAgencies page exists with required sections and SEO', () => {
    expect(aaPage).toMatch(/Turn trucking paperwork into a/i);
    expect(aaPage).toMatch(/Driver Assistant/);
    expect(aaPage).toMatch(/Back-Office Agency/);
    expect(aaPage).toMatch(/Driver Control/);
    expect(aaPage).toMatch(/outside HaulTracker Pro/);
    expect(aaPage).not.toMatch(/guaranteed income/i);
  });

  it('sitemap includes /assistants-agencies', () => {
    expect(sitemap).toMatch(/haultrackerpro\.com\/assistants-agencies/);
  });

  it('Driver Control Center separates active, pending invites, and past', () => {
    expect(dcc).toMatch(/status === 'active'/);
    expect(dcc).toMatch(/status === 'pending'/);
    expect(dcc).toMatch(/status === 'revoked' \|\| a\.status === 'expired'/);
  });

  it('driver_respond_to_work_item RPC passes title/body/payload to create_notification', () => {
    expect(respondMig).toMatch(/Driver responded to a work item/);
    expect(respondMig).toMatch(/'The driver replied to: '/);
    expect(respondMig).toMatch(/create_notification\(\s*_owner,\s*'agency_work_item_driver_responded',\s*_title,\s*_body,\s*_payload/);
    expect(respondMig).toMatch(/'work_item_id',\s*_id/);
    expect(respondMig).toMatch(/'driver_user_id',\s*_w\.driver_user_id/);
  });

  it('Work queue deep links require active delegation and use existing fuel-log flow', () => {
    expect(wq).toMatch(/useActingContext/);
    // Deep links are gated on a managed delegation lookup.
    expect(wq).toMatch(/managedDrivers\.find/);
    // Fuel routes to existing fuel-log flow (add_fuel page), not duplicate expense.
    expect(wq).toMatch(/add_fuel/);
    // Reports use the read permission name.
    expect(wq).toMatch(/view_reports/);
    // Without delegation, show the no-access message instead of management actions.
    expect(wq).toMatch(/don't currently have driver account access/);
  });
});
