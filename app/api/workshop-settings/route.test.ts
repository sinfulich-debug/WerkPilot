import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getWorkshopSettings } from '../../../lib/db/workshop';
import { ForbiddenError, requireRole } from '../../../lib/requireRole';
import { NoTenantError } from '../../../lib/session';
import { DEFAULT_WHATSAPP_TEMPLATE } from '../../../lib/workshop-settings';
import { GET } from './route';

vi.mock('../../../lib/db/workshop', () => ({
  getWorkshopSettings: vi.fn(),
}));

vi.mock('../../../lib/requireRole', () => ({
  requireRole: vi.fn(),
  ForbiddenError: class ForbiddenError extends Error {},
}));

vi.mock('../../../lib/session', () => ({
  NoTenantError: class NoTenantError extends Error {},
}));

const getWorkshopSettingsMock = vi.mocked(getWorkshopSettings);
const requireRoleMock = vi.mocked(requireRole);
const tenantId = 'fedcba98-7654-3210-fedc-ba9876543210';

const settings = {
  companyName: 'Werkstatt GmbH',
  hourlyRateCents: 11_000,
  whatsappTemplate: DEFAULT_WHATSAPP_TEMPLATE,
  hasCustomTemplate: false,
  bankName: 'Werkstattbank',
  iban: 'DE02120300000000202051',
  bic: 'BYLADEM1001',
  isSmallBusiness: false,
};

describe('workshop settings API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkshopSettingsMock.mockResolvedValue(settings);
  });

  it.each(['owner', 'office', 'mechanic'] as const)('returns the settings of the own workshop to %s', async (role) => {
    requireRoleMock.mockResolvedValue({ userId: '01234567-89ab-cdef-0123-456789abcdef', tenantId, role });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, settings });
    expect(requireRoleMock).toHaveBeenCalledWith(['owner', 'office', 'mechanic']);
    expect(getWorkshopSettingsMock).toHaveBeenCalledWith(tenantId);
  });

  it('answers 401 without a workshop', async () => {
    requireRoleMock.mockRejectedValue(new NoTenantError());
    const response = await GET();
    expect(response.status).toBe(401);
    expect(getWorkshopSettingsMock).not.toHaveBeenCalled();
  });

  it('answers 403 for a role that is not allowed', async () => {
    requireRoleMock.mockRejectedValue(new ForbiddenError());
    const response = await GET();
    expect(response.status).toBe(403);
    expect(getWorkshopSettingsMock).not.toHaveBeenCalled();
  });

  it('answers 500 with a plain message when the database fails', async () => {
    requireRoleMock.mockResolvedValue({ userId: '01234567-89ab-cdef-0123-456789abcdef', tenantId, role: 'owner' });
    getWorkshopSettingsMock.mockRejectedValue(new Error('connection refused to secret-host'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await GET();
    const body = await response.json();
    spy.mockRestore();
    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret-host');
  });
});
