import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getWorkshopProfile, saveWorkshopProfile } from '../../../lib/db/workshop';
import { getSessionContext } from '../../../lib/session';
import { GET, POST } from './route';

vi.mock('../../../lib/db/workshop', () => ({
  getWorkshopProfile: vi.fn(),
  saveWorkshopProfile: vi.fn(),
}));

vi.mock('../../../lib/session', () => ({
  getSessionContext: vi.fn(),
  NoTenantError: class NoTenantError extends Error {},
}));

const getSessionContextMock = vi.mocked(getSessionContext);
const saveWorkshopProfileMock = vi.mocked(saveWorkshopProfile);
const getWorkshopProfileMock = vi.mocked(getWorkshopProfile);

describe('settings profile API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionContextMock.mockResolvedValue({
      userId: '01234567-89ab-cdef-0123-456789abcdef',
      tenantId: 'fedcba98-7654-3210-fedc-ba9876543210',
      role: 'owner',
    });
    saveWorkshopProfileMock.mockResolvedValue(undefined);
  });

  it('saves with only the company name when other optional fields are null', async () => {
    const response = await POST(
      new Request('http://localhost/einstellungen/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: 'Werkstatt Müller',
          street: null,
          zip: null,
          city: null,
          phone: null,
          email: null,
          taxNumber: null,
          vatId: null,
          iban: null,
          bic: null,
          isSmallBusiness: null,
          whatsappTemplate: null,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(saveWorkshopProfileMock).toHaveBeenCalledWith(
      'fedcba98-7654-3210-fedc-ba9876543210',
      expect.objectContaining({
        companyName: 'Werkstatt Müller',
        street: undefined,
        zip: undefined,
        city: undefined,
        phone: undefined,
        email: undefined,
        taxNumber: undefined,
        vatId: undefined,
        iban: undefined,
        bic: undefined,
        isSmallBusiness: undefined,
        whatsappTemplate: undefined,
      }),
    );
  });

  it.each(['office', 'owner'] as const)('lets %s read and save the workshop data', async (role) => {
    getSessionContextMock.mockResolvedValue({
      userId: '01234567-89ab-cdef-0123-456789abcdef',
      tenantId: 'fedcba98-7654-3210-fedc-ba9876543210',
      role,
    });
    getWorkshopProfileMock.mockResolvedValue(null);
    expect((await GET()).status).toBe(200);
    const save = await POST(
      new Request('http://localhost/einstellungen/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName: 'Werkstatt Müller' }),
      }),
    );
    expect(save.status).toBe(200);
  });

  it('refuses mechanics on read and save and writes nothing', async () => {
    getSessionContextMock.mockResolvedValue({
      userId: '01234567-89ab-cdef-0123-456789abcdef',
      tenantId: 'fedcba98-7654-3210-fedc-ba9876543210',
      role: 'mechanic',
    });
    expect((await GET()).status).toBe(403);
    const save = await POST(
      new Request('http://localhost/einstellungen/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName: 'Gehackt GmbH' }),
      }),
    );
    expect(save.status).toBe(403);
    expect(getWorkshopProfileMock).not.toHaveBeenCalled();
    expect(saveWorkshopProfileMock).not.toHaveBeenCalled();
  });

  const postJson = (body: unknown) =>
    POST(
      new Request('http://localhost/einstellungen/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  it('passes the hourly rate (whole cents) and the reminder text to persistence', async () => {
    const response = await postJson({ companyName: 'Werkstatt Müller', hourlyRateCents: 11_000, whatsappTemplate: '  Hallo {Kundenname}  ' });
    expect(response.status).toBe(200);
    expect(saveWorkshopProfileMock).toHaveBeenCalledWith(
      'fedcba98-7654-3210-fedc-ba9876543210',
      expect.objectContaining({ hourlyRateCents: 11_000, whatsappTemplate: 'Hallo {Kundenname}' }),
    );
  });

  it('keeps the stored hourly rate and text when they are not sent', async () => {
    await postJson({ companyName: 'Werkstatt Müller' });
    const saved = saveWorkshopProfileMock.mock.calls[0][1];
    expect(saved.hourlyRateCents).toBeUndefined();
    expect(saved.whatsappTemplate).toBeUndefined();
  });

  it('turns an empty reminder text into null (back to the default text)', async () => {
    await postJson({ companyName: 'Werkstatt Müller', whatsappTemplate: '   ' });
    expect(saveWorkshopProfileMock.mock.calls[0][1].whatsappTemplate).toBeNull();
  });

  it.each([95.5, '9500', -1, 1_000_001, true])('refuses the invalid hourly rate %s with 400 and saves nothing', async (rate) => {
    const response = await postJson({ companyName: 'Werkstatt Müller', hourlyRateCents: rate });
    expect(response.status).toBe(400);
    expect(saveWorkshopProfileMock).not.toHaveBeenCalled();
  });

  it('refuses a reminder text that is too long or not text with 400', async () => {
    expect((await postJson({ companyName: 'Werkstatt Müller', whatsappTemplate: 'x'.repeat(1_001) })).status).toBe(400);
    expect((await postJson({ companyName: 'Werkstatt Müller', whatsappTemplate: 5 })).status).toBe(400);
    expect(saveWorkshopProfileMock).not.toHaveBeenCalled();
  });

  it('passes all workshop contact and bank fields to persistence', async () => {
    const response = await POST(
      new Request('http://localhost/einstellungen/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: 'Werkstatt Müller',
          ownerName: 'Max Müller',
          phone: '+49 711 123456',
          email: 'info@example.de',
          website: 'https://example.de',
          bankName: 'Werkstattbank',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(saveWorkshopProfileMock).toHaveBeenCalledWith(
      'fedcba98-7654-3210-fedc-ba9876543210',
      expect.objectContaining({
        companyName: 'Werkstatt Müller',
        ownerName: 'Max Müller',
        phone: '+49 711 123456',
        email: 'info@example.de',
        website: 'https://example.de',
        bankName: 'Werkstattbank',
      }),
    );
  });
});
