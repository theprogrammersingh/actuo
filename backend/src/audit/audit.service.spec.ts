import { describe, expect, it, vi } from 'vitest';
import type { AuditLogRepository } from '../supabase/repositories.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { AuditService } from './audit.service.js';

const USER: AuthenticatedUser = {
  userId: 'user-1',
  orgId: 'org-1',
  email: 'priya@actuo.demo',
  role: 'owner',
};

function createService() {
  const list = vi.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
  const repo = { append: vi.fn(), list } as unknown as AuditLogRepository;
  return { service: new AuditService(repo), list };
}

describe('AuditService.list', () => {
  it('defaults to 50 newest entries', async () => {
    const { service, list } = createService();
    await service.list(USER, {});
    expect(list).toHaveBeenCalledWith('org-1', { entity: undefined, limit: 50, offset: 0 });
  });

  it('passes an entity filter through', async () => {
    const { service, list } = createService();
    await service.list(USER, { entity: 'expense' });
    expect(list.mock.calls[0][1]).toMatchObject({ entity: 'expense' });
  });

  /** The DTO caps at 200 too; this is the second line, in case it is bypassed. */
  it('caps the page size', async () => {
    const { service, list } = createService();
    await service.list(USER, { limit: 5000 });
    expect(list.mock.calls[0][1]).toMatchObject({ limit: 200 });
  });

  /**
   * `orgId` comes from the verified session, never the query. This endpoint
   * spans everybody's actions, so a client that could name its own org would be
   * reading another tenant's history.
   */
  it('scopes to the caller’s org, ignoring anything the client sends', async () => {
    const { service, list } = createService();
    await service.list({ ...USER, orgId: 'org-mine' }, {
      // Not part of the DTO; present here to prove it cannot influence the call.
      orgId: 'org-theirs',
    } as never);
    expect(list.mock.calls[0][0]).toBe('org-mine');
  });
});
