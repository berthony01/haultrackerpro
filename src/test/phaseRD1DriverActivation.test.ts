import { describe, expect, it, vi } from 'vitest';
import { activateDriverWorkspaceRpc, deriveUserCapabilitiesView } from '@/lib/userCapabilities';
import { computeWorkspaceAccess } from '@/lib/workspaceAccess';

describe('RD-1 activateDriverWorkspaceRpc', () => {
  it('refuses without a user and never calls the server', async () => {
    const rpc = vi.fn();
    await expect(activateDriverWorkspaceRpc(null, rpc)).rejects.toThrow('Not authenticated');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('reports unavailable when the backend function is not installed', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    expect(await activateDriverWorkspaceRpc('u1', rpc)).toBe('unavailable');
  });
  it('passes through server status, including suspended', async () => {
    expect(await activateDriverWorkspaceRpc('u1', async () => ({ data: 'active', error: null }))).toBe('active');
    expect(await activateDriverWorkspaceRpc('u1', async () => ({ data: 'suspended', error: null }))).toBe('suspended');
  });
  it('rejects bogus status values', async () => {
    await expect(activateDriverWorkspaceRpc('u1', async () => ({ data: 'superuser', error: null }))).rejects.toThrow();
  });
});

describe('RD-1 recruiter-only account has no driver workspace', () => {
  it('recruiter capability alone does not allow driver pages', () => {
    const view = deriveUserCapabilitiesView([{ capability: 'recruiter', status: 'active', activated_at: null } as any]);
    expect(computeWorkspaceAccess(view).driverWorkspaceAllowed).toBe(false);
  });
  it('suspended driver does not allow driver pages', () => {
    const view = deriveUserCapabilitiesView([{ capability: 'driver', status: 'suspended', activated_at: null } as any]);
    expect(computeWorkspaceAccess(view).driverWorkspaceAllowed).toBe(false);
  });
});
