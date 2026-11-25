import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSessionContext, type Role } from './session';
import { ForbiddenError, requireRole } from './requireRole';

vi.mock('./session', () => ({
  getSessionContext: vi.fn(),
}));

const getSessionContextMock = vi.mocked(getSessionContext);

describe('requireRole', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['owner', 'office'] as const)('allows %s to access finance pages', async (role: Role) => {
    getSessionContextMock.mockResolvedValue({
      userId: '01234567-89ab-cdef-0123-456789abcdef',
      tenantId: 'fedcba98-7654-3210-fedc-ba9876543210',
      role,
    });

    await expect(requireRole(['owner', 'office'])).resolves.toMatchObject({ role });
  });

  it('lets mechanics through only where the list names them (invoices and payments, decision of the owner)', async () => {
    getSessionContextMock.mockResolvedValue({
      userId: '01234567-89ab-cdef-0123-456789abcdef',
      tenantId: 'fedcba98-7654-3210-fedc-ba9876543210',
      role: 'mechanic',
    });

    await expect(requireRole(['owner', 'office', 'mechanic'])).resolves.toMatchObject({ role: 'mechanic' });
  });

  it('rejects office from owner-only actions such as staff management', async () => {
    getSessionContextMock.mockResolvedValue({
      userId: '01234567-89ab-cdef-0123-456789abcdef',
      tenantId: 'fedcba98-7654-3210-fedc-ba9876543210',
      role: 'office',
    });

    await expect(requireRole(['owner'])).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects mechanics from owner/office-only pages (change log, process documentation)', async () => {
    getSessionContextMock.mockResolvedValue({
      userId: '01234567-89ab-cdef-0123-456789abcdef',
      tenantId: 'fedcba98-7654-3210-fedc-ba9876543210',
      role: 'mechanic',
    });

    await expect(requireRole(['owner', 'office'])).rejects.toBeInstanceOf(ForbiddenError);
  });
});
