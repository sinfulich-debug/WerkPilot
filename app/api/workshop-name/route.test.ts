import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getWorkshopProfile } from '../../../lib/db/workshop';
import { requireRole } from '../../../lib/requireRole';
import { GET } from './route';

vi.mock('../../../lib/db/workshop', () => ({
  getWorkshopProfile: vi.fn(),
}));

vi.mock('../../../lib/requireRole', () => ({
  requireRole: vi.fn(),
}));

vi.mock('../../../lib/session', () => ({
  NoTenantError: class NoTenantError extends Error {},
}));

const getWorkshopProfileMock = vi.mocked(getWorkshopProfile);
const requireRoleMock = vi.mocked(requireRole);

describe('workshop name API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkshopProfileMock.mockResolvedValue({
      companyName: 'Werkstatt GmbH',
    } as Awaited<ReturnType<typeof getWorkshopProfile>>);
  });

  it.each(['owner', 'office', 'mechanic'] as const)(
    'returns only the company name to %s',
    async (role) => {
      requireRoleMock.mockResolvedValue({
        userId: '01234567-89ab-cdef-0123-456789abcdef',
        tenantId: 'fedcba98-7654-3210-fedc-ba9876543210',
        role,
      });

      const response = await GET();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ companyName: 'Werkstatt GmbH' });
      expect(getWorkshopProfileMock).toHaveBeenCalledWith('fedcba98-7654-3210-fedc-ba9876543210');
    },
  );
});
