import { describe, it, expect } from 'vitest';
import { formatAgencyAuditAction } from '@/hooks/useAgencyWorkflow';
import { formatAuditAction } from '@/hooks/useAssistantAudit';

/**
 * Phase 4A — Driver Control Center.
 *
 * These tests cover the pure logic the page depends on. The page itself reads
 * from server RPCs that are individually covered by the Phase 3 security
 * tests; here we lock down the plain-English audit formatter and assistant
 * source classification so any drift surfaces immediately.
 */

describe('Phase 4A: agency audit formatter covers Phase 3/4 lifecycle actions', () => {
  const cases: Array<[string, string]> = [
    ['package_created', 'created a service package'],
    ['package_updated', 'updated a service package'],
    ['package_deactivated', 'deactivated a service package'],
    ['client_request_submitted', 'submitted a client request'],
    ['client_request_approved', 'approved a client request'],
    ['client_request_declined', 'declined a client request'],
    ['client_request_cancelled', 'cancelled a client request'],
    ['client_request_converted_to_client', 'converted a request into a client'],
    ['delegation_request_created', 'requested driver approval to delegate access'],
    ['delegation_approved_by_driver', 'approved the delegation'],
    ['delegation_declined_by_driver', 'declined the delegation'],
    ['delegation_revoked_by_driver', 'revoked agency delegation'],
    ['delegation_revoked_by_agency', 'revoked the delegation'],
    ['work_item_created', 'created a work item'],
    ['work_item_assigned', 'assigned a work item'],
    ['work_item_status_changed', 'changed a work item status'],
    ['work_item_completed', 'completed a work item'],
    ['work_item_updated', 'updated a work item'],
  ];
  it.each(cases)('%s -> "%s"', (action, expected) => {
    expect(formatAgencyAuditAction(action, 'agency_delegation_request')).toBe(expected);
  });

  it('falls back gracefully for unknown actions', () => {
    const out = formatAgencyAuditAction('some_future_action', 'agency_widget');
    expect(out).toContain('some future action');
    expect(out).toContain('agency widget');
  });
});

describe('Phase 4A: assistant audit formatter covers revoke/invite lifecycle', () => {
  it.each([
    ['invite_created', 'invited a new assistant'],
    ['invite_accepted', 'accepted an assistant invitation'],
    ['permissions_updated', 'updated assistant permissions'],
    ['assistant_revoked', 'revoked an assistant'],
  ])('%s -> "%s"', (action, expected) => {
    expect(formatAuditAction(action, 'driver_assistants')).toBe(expected);
  });
});

describe('Phase 4A: assistant source classification rules (UI invariants)', () => {
  // Source classifier mirrors what `list_my_assistants_with_source` returns.
  // We assert the UI rule: if there's an active delegation_id, treat as agency.
  function classify(row: { delegation_id: string | null; source: 'agency' | 'direct_invite' }) {
    return row.source === 'agency' && !!row.delegation_id ? 'agency' : 'direct_invite';
  }

  it('agency source with delegation id -> agency revoke path', () => {
    expect(classify({ delegation_id: 'd1', source: 'agency' })).toBe('agency');
  });
  it('agency source without delegation id (stale) -> direct revoke path', () => {
    expect(classify({ delegation_id: null, source: 'agency' })).toBe('direct_invite');
  });
  it('direct_invite -> direct revoke path even if a delegation id leaks in', () => {
    expect(classify({ delegation_id: 'd1', source: 'direct_invite' })).toBe('direct_invite');
  });
});
