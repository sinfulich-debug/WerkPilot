import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissOnboarding, getOnboardingFacts } from '../../../lib/db/onboarding';
import { getSessionContext, NoTenantError } from '../../../lib/session';
import { GET, POST } from './route';

vi.mock('../../../lib/db/onboarding', () => ({ getOnboardingFacts: vi.fn(), dismissOnboarding: vi.fn() }));
vi.mock('../../../lib/session', () => ({
  getSessionContext: vi.fn(),
  NoTenantError: class NoTenantError extends Error {},
}));

const sessionMock = vi.mocked(getSessionContext);
const factsMock = vi.mocked(getOnboardingFacts);
const dismissMock = vi.mocked(dismissOnboarding);
const tenantId = 'fedcba98-7654-3210-fedc-ba9876543210';
const userId = '01234567-89ab-cdef-0123-456789abcdef';

describe('onboarding API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMock.mockResolvedValue({ userId, tenantId, role: 'owner' });
    factsMock.mockResolvedValue({
      profile: null,
      calendarConfirmed: false,
      activeMembers: 1,
      appointments: 0,
      customers: 0,
      dismissed: false,
    });
    dismissMock.mockResolvedValue(true);
  });

  it('returns the checklist for the owner', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(factsMock).toHaveBeenCalledWith(tenantId);
    expect(data.status.visible).toBe(true);
    expect(data.status.requiredCount).toBe(4);
  });

  it('returns no checklist for mechanics and does not read the database', async () => {
    sessionMock.mockResolvedValue({ userId, tenantId, role: 'mechanic' });
    const response = await GET();
    await expect(response.json()).resolves.toEqual({ ok: true, status: null });
    expect(factsMock).not.toHaveBeenCalled();
  });

  it('answers 401 without a workshop', async () => {
    sessionMock.mockRejectedValue(new NoTenantError());
    expect((await GET()).status).toBe(401);
  });

  it('lets owner and office hide the checklist, but not mechanics', async () => {
    expect((await POST()).status).toBe(200);
    expect(dismissMock).toHaveBeenCalledWith(tenantId);

    sessionMock.mockResolvedValue({ userId, tenantId, role: 'mechanic' });
    expect((await POST()).status).toBe(403);
  });

  it('answers 409 when there is no workshop profile yet', async () => {
    dismissMock.mockResolvedValue(false);
    expect((await POST()).status).toBe(409);
  });
});
