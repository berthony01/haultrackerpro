import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('Phase 6 — theme & copy consistency', () => {
  describe('Public site copy accuracy', () => {
    it('Landing surfaces all four audiences', () => {
      const s = read('src/pages/Landing.tsx');
      expect(/driver/i.test(s)).toBe(true);
      expect(/recruiter/i.test(s)).toBe(true);
      expect(/assistant/i.test(s)).toBe(true);
      expect(/agency|agencies/i.test(s)).toBe(true);
    });

    it('AssistantsAgencies page disclaims guaranteed income/clients', () => {
      const s = read('src/pages/AssistantsAgencies.tsx');
      expect(/guarantee/i.test(s)).toBe(true);
      // Must NOT promise guaranteed income or clients
      expect(/guaranteed (income|client)/i.test(s)).toBe(false);
    });

    it('Pricing page includes assistant/agency payment limitation copy', () => {
      const s = read('src/pages/Pricing.tsx');
      expect(/does\s*<b>\s*not\s*<\/b>\s*currently process payments|does not currently process payments/i.test(s)).toBe(true);
      expect(/assistant|agency|agencies/i.test(s)).toBe(true);
    });

    it('No page uses "Public Agency Request Links" wording', () => {
      const files = [
        'src/pages/Landing.tsx',
        'src/pages/Features.tsx',
        'src/pages/Pricing.tsx',
        'src/pages/AssistantsAgencies.tsx',
        'src/lib/featureList.ts',
      ];
      for (const f of files) {
        expect(read(f)).not.toMatch(/Public Agency Request Link/i);
      }
    });

    it('No public page promises guaranteed income or guaranteed clients', () => {
      const files = [
        'src/pages/Landing.tsx',
        'src/pages/Features.tsx',
        'src/pages/Pricing.tsx',
        'src/pages/AssistantsAgencies.tsx',
      ];
      for (const f of files) {
        const s = read(f);
        expect(s).not.toMatch(/guaranteed income/i);
        expect(s).not.toMatch(/guaranteed clients/i);
      }
    });
  });

  describe('Auth page', () => {
    const s = read('src/pages/Auth.tsx');

    it('renders all four capability tiles', () => {
      expect(s).toMatch(/'driver'/);
      expect(s).toMatch(/'recruiter'/);
      expect(s).toMatch(/'assistant'/);
      expect(s).toMatch(/'agency'/);
    });

    it('syncs capability selection to URL (next=/assistant or /agency)', () => {
      // tile click must update the URL via navigate({pathname:'/auth', search})
      expect(s).toMatch(/navigate\(\s*\{\s*pathname:\s*'\/auth'/);
      // Default next for non-driver/recruiter capabilities defined in CAPABILITIES
      expect(s).toMatch(/nextDefault:\s*'\/assistant'/);
      expect(s).toMatch(/nextDefault:\s*'\/agency'/);
    });

    it('preserves recruiter intent through the intent= param', () => {
      expect(s).toMatch(/params\.set\(['"]intent['"],\s*['"]recruiter['"]\)/);
    });
  });

  describe('Driver Control Center', () => {
    const s = read('src/pages/DriverAssistantControl.tsx');
    it('still separates active / pending / past assistants', () => {
      expect(/active/i.test(s)).toBe(true);
      expect(/pending/i.test(s)).toBe(true);
      expect(/past|revoked/i.test(s)).toBe(true);
    });
  });

  describe('Agency dashboard structure', () => {
    const s = read('src/pages/AgencyDashboard.tsx');
    it('renders work queue / requests / clients sections', () => {
      expect(/work/i.test(s)).toBe(true);
      expect(/request/i.test(s)).toBe(true);
      expect(/client/i.test(s)).toBe(true);
    });
  });

  describe('Features page wording', () => {
    const s = read('src/pages/Features.tsx');
    it('does not use "Public Agency Request Link" wording', () => {
      expect(s).not.toMatch(/Public Agency Request Link/i);
    });
  });
});
