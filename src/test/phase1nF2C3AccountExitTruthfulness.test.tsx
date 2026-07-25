import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

const MODAL = 'src/components/DeleteAccountModal.tsx';
const FAQ = 'src/pages/FAQ.tsx';
const RSV = 'src/components/opportunities/recruiter/RecruiterSettingsView.tsx';
const DOCS = 'src/lib/docs/docsArticles.ts';
const SELF = 'src/test/phase1nF2C3AccountExitTruthfulness.test.tsx';

const modalSrc = read(MODAL);
const faqSrc = read(FAQ);
const rsvSrc = read(RSV);
const docsSrc = read(DOCS);

// Prohibited phrase fragments built at runtime so this test file itself
// cannot self-match a source scan.
const PHRASE_ALL_ASSOC = ['all', 'associated', 'data'].join(' ');
const PHRASE_EVERYTHING_TIED = ['everything', 'tied', 'to', 'your', 'account'].join(' ');

const isolateFaqDeleteEntry = (src: string): string => {
  const idx = src.indexOf("id: 'delete-account'");
  expect(idx, 'FAQ must contain id: delete-account').toBeGreaterThan(-1);
  // Walk forward from `{` before the id to matching closing `}`.
  let start = src.lastIndexOf('{', idx);
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unterminated FAQ entry');
};

describe('Phase 1N-F2-C3 — account-deletion truthfulness at decision surfaces', () => {
  describe('DeleteAccountModal — destructive behavior preserved', () => {
    it('still requires typing DELETE to enable destructive action', () => {
      expect(modalSrc).toMatch(/confirmation !== ['"]DELETE['"]/);
      expect(modalSrc).toMatch(/Type[\s\S]{0,200}DELETE[\s\S]{0,200}confirm/i);
    });

    it('still invokes the authenticated delete-account edge function', () => {
      expect(modalSrc).toMatch(/supabase\.functions\.invoke\(\s*['"]delete-account['"]/);
      expect(modalSrc).toMatch(/Bearer \$\{session\.access_token\}/);
    });

    it('still signs out and redirects to /auth on success', () => {
      expect(modalSrc).toMatch(/supabase\.auth\.signOut\(\)/);
      expect(modalSrc).toMatch(/window\.location\.href\s*=\s*['"]\/auth['"]/);
    });

    it('does not introduce direct Stripe / RPC / table / auth-admin calls from the browser', () => {
      expect(modalSrc).not.toMatch(/from\s+['"]stripe/i);
      expect(modalSrc).not.toMatch(/supabase\.rpc\(/);
      expect(modalSrc).not.toMatch(/supabase\.from\(/);
      expect(modalSrc).not.toMatch(/auth\.admin\./);
      expect(modalSrc).not.toMatch(/checkout\.sessions|billingPortal|subscriptions\.cancel/i);
    });
  });

  describe('DeleteAccountModal — no longer overpromises', () => {
    it('does not use the prohibited "all associated data" phrasing', () => {
      expect(modalSrc.toLowerCase()).not.toContain(PHRASE_ALL_ASSOC);
    });

    it('does not use the prohibited "everything tied to your account" phrasing', () => {
      expect(modalSrc.toLowerCase()).not.toContain(PHRASE_EVERYTHING_TIED);
    });

    it('does not unconditionally claim every record is erased', () => {
      expect(modalSrc).not.toMatch(/every\s+record/i);
      expect(modalSrc).not.toMatch(/erases\s+all/i);
      expect(modalSrc).not.toMatch(/purges\s+all/i);
      expect(modalSrc).not.toMatch(/backups?\s+are\s+(instantly|immediately)\s+purged/i);
    });

    it('covers all six product-truth concepts (C2)', () => {
      const lower = modalSrc.toLowerCase();
      // 1. entire personal login (not just current role)
      expect(lower).toMatch(/entire personal login/);
      expect(lower).toMatch(/driver or recruiter role/);
      // 2. subs cancelled as part of permanent deletion, distinct from portal
      expect(lower).toMatch(/subscriptions?[\s\S]{0,80}cancelled/);
      expect(lower).toMatch(/before database cleanup/);
      expect(lower).toMatch(/cancel-at-period-end|billing portal/);
      // 3. personal operational data listed & targeted for transactional cleanup
      expect(lower).toMatch(/loads/);
      expect(lower).toMatch(/expenses/);
      expect(lower).toMatch(/fuel logs/);
      expect(lower).toMatch(/settings/);
      expect(lower).toMatch(/transactional cleanup/);
      // 4. retained/detached/anonymized shared/etc records qualification
      expect(lower).toMatch(/retained,\s*detached,\s*anonymized/);
      expect(lower).toMatch(/shared[\s\S]{0,80}audit[\s\S]{0,200}billing/);
      expect(lower).toMatch(/third-party/);
      // 5. agency owner blocked until transfer/close
      expect(lower).toMatch(/agency/);
      expect(lower).toMatch(/transferred|transfer/);
      expect(lower).toMatch(/closed through support|closed/);
      // 6. export first + no self-service undo
      expect(lower).toMatch(/export/);
      expect(lower).toMatch(/no self-service undo/);
    });

    it('includes both canonical docs links inside the modal', () => {
      expect(modalSrc).toMatch(/to=["']\/docs\/account-deletion-data-retention["']/);
      expect(modalSrc).toMatch(/to=["']\/docs\/billing-cancellation["']/);
      expect(modalSrc).toMatch(/from ['"]react-router-dom['"]/);
    });
  });

  describe('FAQ — delete-account entry isolated and truthful', () => {
    const entry = isolateFaqDeleteEntry(faqSrc);
    const lower = entry.toLowerCase();

    it('does not contain either prohibited phrase', () => {
      expect(lower).not.toContain(PHRASE_ALL_ASSOC);
      expect(lower).not.toContain(PHRASE_EVERYTHING_TIED);
    });

    it('covers cancellation, cleanup, retention, agency-owner block, export/no-undo, and both docs links', () => {
      expect(lower).toMatch(/settings\s*[→>]\s*account\s*[→>]\s*delete account/);
      expect(lower).toMatch(/type\s+delete/);
      expect(lower).toMatch(/entire personal|full personal login/);
      expect(lower).toMatch(/subscriptions?[\s\S]{0,80}cancelled/);
      expect(lower).toMatch(/before database cleanup/);
      expect(lower).toMatch(/loads/);
      expect(lower).toMatch(/expenses/);
      expect(lower).toMatch(/fuel logs/);
      expect(lower).toMatch(/retained|detached|anonymized/);
      expect(lower).toMatch(/shared/);
      expect(lower).toMatch(/audit/);
      expect(lower).toMatch(/billing/);
      expect(lower).toMatch(/backup/);
      expect(lower).toMatch(/third-party/);
      expect(lower).toMatch(/agency/);
      expect(lower).toMatch(/transferred|transfer/);
      expect(lower).toMatch(/export/);
      expect(lower).toMatch(/no self-service undo/);
      expect(entry).toMatch(/to=["']\/docs\/account-deletion-data-retention["']/);
      expect(entry).toMatch(/to=["']\/docs\/billing-cancellation["']/);
    });

    it('leaves adjacent FAQ entries intact', () => {
      expect(faqSrc).toContain("id: 'edit-loads'");
      expect(faqSrc).toContain("id: 'weekly-closeout'");
      expect(faqSrc).toContain("id: 'multi-stop'");
      expect(faqSrc).toContain("id: 'rate-con-scanner'");
      expect(faqSrc).toContain("id: 'driver-scorecard'");
      expect(faqSrc).toContain("id: 'free-plan'");
      expect(faqSrc).toContain("id: 'upgrade-pro'");
    });
  });

  describe('RecruiterSettingsView — truthful account-exit paragraph', () => {
    const lower = rsvSrc.toLowerCase();

    it('contains the full-personal-login warning and multi-context cancellation', () => {
      expect(lower).toMatch(/entire personal login/);
      expect(lower).toMatch(/not only the recruiter profile/);
      expect(lower).toMatch(/driver and recruiter subscriptions/);
    });

    it('qualifies retained / shared records instead of promising full deletion', () => {
      expect(lower).toMatch(/shared applications/);
      expect(lower).toMatch(/audit/);
      expect(lower).toMatch(/billing/);
      expect(lower).toMatch(/signatures?/);
      expect(lower).toMatch(/legal\/compliance|legal, compliance/);
      expect(lower).toMatch(/backup/);
      expect(lower).toMatch(/third-party/);
      expect(lower).toMatch(/retained,\s*detached,\s*anonymized/);
    });

    it('explains the agency-owner block and links to the deletion docs article', () => {
      expect(lower).toMatch(/own an agency/);
      expect(lower).toMatch(/transferred|closed through support/);
      expect(rsvSrc).toMatch(/to=["']\/docs\/account-deletion-data-retention["']/);
      expect(rsvSrc).toMatch(/Review deletion and retention details/);
    });

    it('drops the prohibited old claim about permanently removing received applications', () => {
      expect(rsvSrc).not.toMatch(/permanently removes your recruiter profile,\s*opportunities,\s*and applications you received/i);
      expect(rsvSrc).not.toMatch(/all applications you received/i);
    });

    it('keeps the Delete Account button and Terms/Privacy/Legal controls intact', () => {
      expect(rsvSrc).toMatch(/Delete account/);
      expect(rsvSrc).toMatch(/setShowDelete\(true\)/);
      expect(rsvSrc).toMatch(/DeleteAccountModal/);
      expect(rsvSrc).toMatch(/navigate\(['"]\/terms['"]\)/);
      expect(rsvSrc).toMatch(/navigate\(['"]\/privacy['"]\)/);
      expect(rsvSrc).toMatch(/navigate\(['"]\/legal['"]\)/);
    });
  });

  describe('Canonical docs remain authoritative and unchanged in behavior', () => {
    it('deletion article still states HaulTrackerPro does not claim all data is deleted', () => {
      expect(docsSrc).toContain("slug: 'account-deletion-data-retention'");
      expect(docsSrc).toMatch(/does not claim that "all data" is deleted/);
      expect(docsSrc).toMatch(/retained, detached, anonymized/);
    });

    it('billing article distinguishes normal cancellation from permanent deletion', () => {
      expect(docsSrc).toContain("slug: 'billing-cancellation'");
      expect(docsSrc).toMatch(/permanent deletion/i);
      expect(docsSrc).toMatch(/deduplicates repeated subscription IDs/);
    });
  });

  describe('No policy/backend scope drift in edited surfaces', () => {
    const edited = [modalSrc, faqSrc, rsvSrc];

    it('does not import Terms / Privacy / policyRegistry / account-deletion backend / Stripe / migrations / Auth / Pricing / App', () => {
      for (const src of edited) {
        expect(src).not.toMatch(/from\s+['"]@\/pages\/Terms['"]/);
        expect(src).not.toMatch(/from\s+['"]@\/pages\/Privacy['"]/);
        expect(src).not.toMatch(/from\s+['"]@\/pages\/Auth['"]/);
        expect(src).not.toMatch(/from\s+['"]@\/pages\/Pricing['"]/);
        expect(src).not.toMatch(/from\s+['"]@\/App['"]/);
        expect(src).not.toMatch(/from\s+['"]@\/lib\/legal\/policyRegistry['"]/);
        expect(src).not.toMatch(/from\s+['"]stripe/i);
        expect(src).not.toMatch(/supabase\/(migrations|functions\/_shared\/account-deletion)/);
      }
    });

    it('does not embed brittle git-based HEAD / historical assertions', () => {
      const self = read(SELF);
      expect(self).not.toMatch(/execSync\(/);
      expect(self).not.toMatch(/git\s+(diff|rev-parse|merge-base)/);
    });
  });

  describe('Meta safety', () => {
    it('has no .only / .skip / .todo / xit / xdescribe', () => {
      const self = read(SELF);
      expect(self).not.toMatch(/\b(describe|it|test)\.(only|skip|todo)\b/);
      expect(self).not.toMatch(/\bxit\(|\bxdescribe\(/);
    });
  });
});
