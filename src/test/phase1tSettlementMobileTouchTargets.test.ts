/**
 * Phase 1T-F3D — settlement mobile touch-target source contract.
 *
 * Source-contract proofs only; the rendered >=44px acceptance at 320/375/390
 * and the desktop `sm:` reset were proven separately in a temporary /tmp
 * browser harness. These tests lock the root-scoped strategy so a future edit
 * cannot silently drop mobile touch sizing or smuggle in a global Button
 * primitive change.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const driverViewPath = resolve(
  __dirname,
  '../components/settlements/DriverSettlementsView.tsx',
);
const businessManagerPath = resolve(
  __dirname,
  '../components/settlements/BusinessSettlementManager.tsx',
);
const carrierPanelPath = resolve(
  __dirname,
  '../components/settlements/CarrierSettlementsPanel.tsx',
);

const driverView = readFileSync(driverViewPath, 'utf8');
const businessManager = readFileSync(businessManagerPath, 'utf8');
const carrierPanel = readFileSync(carrierPanelPath, 'utf8');

const IMPLEMENTATION_SOURCES: ReadonlyArray<readonly [string, string]> = [
  ['DriverSettlementsView.tsx', driverView],
  ['BusinessSettlementManager.tsx', businessManager],
  ['CarrierSettlementsPanel.tsx', carrierPanel],
];

/** The exact mobile-only descendant rules + their desktop resets. */
const MOBILE_TOUCH_RULES = [
  '[&_button]:min-h-11 sm:[&_button]:min-h-0',
  '[&_select]:min-h-11 sm:[&_select]:min-h-0',
  '[&_input]:min-h-11 sm:[&_input]:min-h-0',
] as const;

/** Return the className text immediately preceding a root's data-testid. */
function rootBlock(source: string, testid: string): string {
  const idx = source.indexOf(`data-testid="${testid}"`);
  expect(idx, `${testid} root not found`).toBeGreaterThan(-1);
  return source.slice(Math.max(0, idx - 400), idx);
}

describe('Phase 1T-F3D — settlement mobile touch targets', () => {
  it('1. driver settlements root carries the three mobile rules and resets', () => {
    const block = rootBlock(driverView, 'driver-settlements-view');
    for (const rule of MOBILE_TOUCH_RULES) {
      expect(block, `driver root missing ${rule}`).toContain(rule);
    }
  });

  it('2. driver settlements root preserves its existing spacing contract', () => {
    expect(rootBlock(driverView, 'driver-settlements-view')).toContain('space-y-5');
  });

  it('3. business settlement manager (list) root carries the mobile rules', () => {
    const block = rootBlock(businessManager, 'business-settlement-manager');
    for (const rule of MOBILE_TOUCH_RULES) {
      expect(block, `business manager root missing ${rule}`).toContain(rule);
    }
    expect(block).toContain('space-y-4');
  });

  it('4. business settlement detail root carries the mobile rules', () => {
    const block = rootBlock(businessManager, 'business-settlement-detail');
    for (const rule of MOBILE_TOUCH_RULES) {
      expect(block, `business detail root missing ${rule}`).toContain(rule);
    }
    expect(block).toContain('space-y-4');
  });

  it('5. carrier settlements panel root carries the mobile rules', () => {
    const block = rootBlock(carrierPanel, 'carrier-settlements-panel');
    for (const rule of MOBILE_TOUCH_RULES) {
      expect(block, `carrier root missing ${rule}`).toContain(rule);
    }
    expect(block).toContain('space-y-4');
  });

  it('6. business ConfirmAction dialog controls size directly for the portal case', () => {
    const idx = businessManager.indexOf('function ConfirmAction(');
    expect(idx).toBeGreaterThan(-1);
    const confirmAction = businessManager.slice(idx);
    expect(confirmAction).toContain(
      '<AlertDialogCancel className="min-h-11 sm:min-h-0">',
    );
    // Both destructive and non-destructive action branches are sized.
    expect(confirmAction).toContain(
      "'min-h-11 sm:min-h-0 bg-destructive text-destructive-foreground hover:bg-destructive/90'",
    );
    expect(confirmAction).toContain("'min-h-11 sm:min-h-0'");
    expect(confirmAction).not.toContain(': undefined');
  });

  it('7. carrier end-connection dialog controls size directly for the portal case', () => {
    expect(carrierPanel).toContain('<AlertDialogCancel className="min-h-11 sm:min-h-0">');
    expect(carrierPanel).toContain(
      'className="min-h-11 sm:min-h-0 bg-destructive text-destructive-foreground hover:bg-destructive/90"',
    );
  });

  it('8. every mobile min-height rule ships with its sm: reset', () => {
    for (const [name, source] of IMPLEMENTATION_SOURCES) {
      const mobile = (source.match(/\[&_(?:button|select|input)\]:min-h-11/g) ?? []).length;
      const reset = (source.match(/sm:\[&_(?:button|select|input)\]:min-h-0/g) ?? []).length;
      expect(reset, `${name} reset count must match mobile rule count`).toBe(mobile);
      const directMobile = (source.match(/(?<!\]:)\bmin-h-11\b/g) ?? []).length;
      const directReset = (source.match(/(?<!\]:)\bsm:min-h-0\b/g) ?? []).length;
      expect(directReset, `${name} direct reset count must match`).toBe(directMobile);
    }
  });

  it('9. no global Button primitive or shared UI primitive is touched', () => {
    const buttonPrimitive = readFileSync(
      resolve(__dirname, '../components/ui/button.tsx'),
      'utf8',
    );
    expect(buttonPrimitive).not.toContain('min-h-11');
    expect(buttonPrimitive).not.toContain('sm:min-h-0');
  });

  it('10. no settlement/backend transport was added by this unit', () => {
    for (const [name, source] of IMPLEMENTATION_SOURCES) {
      expect(source, `${name} must not call rpc directly`).not.toContain('.rpc(');
      expect(source, `${name} must not import the backend client`).not.toContain(
        '@/integrations/supabase/client',
      );
    }
  });
});
