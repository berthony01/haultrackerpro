/**
 * Phase 1T-F3C — carrier settlement mobile horizontal-overflow repair.
 *
 * Source-contract proofs only. No jsdom layout claims are made here; the
 * rendered acceptance was performed separately in a temporary browser harness.
 * These tests lock the exact shrink constraints that fixed the measured
 * 583px document scrollWidth on the carrier/recruiter surface.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const recruiterAccessPagePath = resolve(
  __dirname,
  '../components/opportunities/recruiter/RecruiterAccessPage.tsx',
);
const carrierPanelPath = resolve(
  __dirname,
  '../components/settlements/CarrierSettlementsPanel.tsx',
);
const businessManagerPath = resolve(
  __dirname,
  '../components/settlements/BusinessSettlementManager.tsx',
);

const recruiterAccessPage = readFileSync(recruiterAccessPagePath, 'utf8');
const carrierPanel = readFileSync(carrierPanelPath, 'utf8');
const businessManager = readFileSync(businessManagerPath, 'utf8');

const IMPLEMENTATION_SOURCES: ReadonlyArray<readonly [string, string]> = [
  ['RecruiterAccessPage.tsx', recruiterAccessPage],
  ['CarrierSettlementsPanel.tsx', carrierPanel],
  ['BusinessSettlementManager.tsx', businessManager],
];

/** Extract the carrier candidate select's className attribute value. */
function carrierCandidateSelectClass(): string {
  const selectBlock = carrierPanel.slice(
    carrierPanel.indexOf('id="carrier-candidate"'),
    carrierPanel.indexOf('data-testid="carrier-candidate-select"'),
  );
  const match = selectBlock.match(/className="([^"]+)"/);
  expect(match, 'carrier candidate select className not found').toBeTruthy();
  return match![1];
}

describe('Phase 1T-F3C — carrier settlement mobile overflow repair', () => {
  it('1. recruiter approved layout still uses the two-column grid contract', () => {
    expect(recruiterAccessPage).toContain(
      '<div className="grid lg:grid-cols-[1.5fr_1fr] gap-6">',
    );
  });

  it('2. the left grid child carrying the settlement mount can shrink below min-content', () => {
    const gridIndex = recruiterAccessPage.indexOf(
      '<div className="grid lg:grid-cols-[1.5fr_1fr] gap-6">',
    );
    expect(gridIndex).toBeGreaterThan(-1);
    const leftColumn = recruiterAccessPage.slice(gridIndex);
    const leftChildIndex = leftColumn.indexOf('<div className="min-w-0 space-y-6">');
    expect(leftChildIndex).toBeGreaterThan(-1);

    // The settlement panel mount must live inside that shrinkable left child.
    const settlementIndex = leftColumn.indexOf('<CarrierSettlementsPanel');
    expect(settlementIndex).toBeGreaterThan(leftChildIndex);
  });

  it('3. carrier candidate select carries every mobile-safe sizing class', () => {
    const cls = carrierCandidateSelectClass();
    for (const token of ['h-10', 'w-full', 'min-w-0', 'flex-1', 'sm:min-w-[14rem]']) {
      expect(cls, `missing ${token}`).toContain(token);
    }
  });

  it('4. carrier candidate select no longer sets an unscoped 14rem mobile minimum', () => {
    const cls = carrierCandidateSelectClass();
    const tokens = cls.split(/\s+/).filter(Boolean);
    expect(tokens).not.toContain('min-w-[14rem]');
    expect(tokens).toContain('sm:min-w-[14rem]');
  });

  it('5. candidate select parent still wraps its action naturally', () => {
    expect(carrierPanel).toContain(
      '<div className="flex flex-wrap items-center gap-2">',
    );
  });

  it('6. carrier relationship human label is a shrinkable truncating flex item', () => {
    expect(carrierPanel).toContain(
      'className="min-w-0 max-w-full truncate text-sm font-medium"',
    );
    expect(carrierPanel).not.toContain('className="truncate text-sm font-medium"');
  });

  it('7. business statement-history human label is a shrinkable truncating flex item', () => {
    const rowIndex = businessManager.indexOf('data-testid="business-settlement-row"');
    expect(rowIndex).toBeGreaterThan(-1);
    expect(businessManager).toContain(
      'className="min-w-0 max-w-full truncate text-sm font-medium"',
    );
    expect(businessManager).not.toContain('className="truncate text-sm font-medium"');
  });

  it('8. no overflow-hiding or clipping band-aid was introduced', () => {
    for (const [name, source] of IMPLEMENTATION_SOURCES) {
      expect(source, `${name} must not clip or scroll horizontally`).not.toMatch(
        /overflow-x-hidden|overflow-x-auto|overflow-x-scroll|max-w-screen/,
      );
    }
    // The recruiter grid root, its shrinkable left child, and the carrier /
    // business settlement panel roots must not mask the defect by clipping.
    const roots = [
      '<div className="grid lg:grid-cols-[1.5fr_1fr] gap-6">',
      '<div className="min-w-0 space-y-6">',
      // F3D reformatted this root onto multiple lines and appended
      // touch-target rules only; it still must not clip.
      'data-testid="carrier-settlements-panel"',
    ];
    for (const root of roots) {
      expect(recruiterAccessPage + carrierPanel).toContain(root);
      expect(root).not.toContain('overflow');
    }
    // The single pre-existing `overflow-hidden` (recruiter hero Card) is
    // untouched by this unit; no new occurrence was added anywhere.
    const total = IMPLEMENTATION_SOURCES.reduce(
      (sum, [, source]) => sum + (source.match(/overflow-hidden/g) ?? []).length,
      0,
    );
    expect(total).toBe(1);
  });


  it('9. F3D touch-target rules coexist with the unchanged F3C shrink contract', () => {
    // Phase 1T-F3D deliberately supersedes the old F3C "no touch-target
    // sizing" ban: touch sizing is now in scope and must be root-scoped.
    const mobileRules = [
      '[&_button]:min-h-11 sm:[&_button]:min-h-0',
      '[&_select]:min-h-11 sm:[&_select]:min-h-0',
      '[&_input]:min-h-11 sm:[&_input]:min-h-0',
    ];
    for (const rule of mobileRules) {
      expect(carrierPanel, `carrier root missing ${rule}`).toContain(rule);
      expect(businessManager, `business manager missing ${rule}`).toContain(rule);
    }
    // Both business trees (list + detail) carry the shared touch rules.
    for (const testid of ['business-settlement-manager', 'business-settlement-detail']) {
      const idx = businessManager.indexOf(`data-testid="${testid}"`);
      expect(idx, `${testid} root not found`).toBeGreaterThan(-1);
      const rootBlock = businessManager.slice(Math.max(0, idx - 400), idx);
      for (const rule of mobileRules) {
        expect(rootBlock, `${testid} root missing ${rule}`).toContain(rule);
      }
    }
    // The accepted F3C shrink contract on the candidate select is untouched.
    const cls = carrierCandidateSelectClass();
    for (const token of ['h-10', 'w-full', 'min-w-0', 'flex-1', 'sm:min-w-[14rem]']) {
      expect(cls, `missing ${token}`).toContain(token);
    }
    expect(cls.split(/\s+/).filter(Boolean)).not.toContain('min-w-[14rem]');
  });


  it('10. no settlement/backend transport was added by this unit', () => {
    for (const [name, source] of IMPLEMENTATION_SOURCES) {
      expect(source, `${name} must not call rpc directly`).not.toContain('.rpc(');
      expect(source, `${name} must not query tables directly`).not.toContain('.from(');
      expect(source, `${name} must not import the backend client`).not.toContain(
        '@/integrations/supabase/client',
      );
    }
  });
});
