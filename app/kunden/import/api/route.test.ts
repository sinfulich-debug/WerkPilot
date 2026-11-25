import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importCustomers } from '../../../../lib/db/customer-import';
import { getSessionContext, NoTenantError } from '../../../../lib/session';
import { POST } from './route';

vi.mock('../../../../lib/db/customer-import', () => ({ importCustomers: vi.fn() }));
vi.mock('../../../../lib/session', () => ({
  getSessionContext: vi.fn(),
  NoTenantError: class NoTenantError extends Error {},
}));

const sessionMock = vi.mocked(getSessionContext);
const importMock = vi.mocked(importCustomers);
const tenantId = 'fedcba98-7654-3210-fedc-ba9876543210';

function post(body: unknown) {
  return POST(new Request('http://localhost/kunden/import/api', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
}

describe('customer import API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMock.mockResolvedValue({ userId: '01234567-89ab-cdef-0123-456789abcdef', tenantId, role: 'office' });
    importMock.mockResolvedValue({ newCustomers: 1, existingCustomers: 0, newVehicles: 1, skippedVehicles: 0, invalidRows: 0 });
  });

  it('parses the file again on the server and imports the checked rows', async () => {
    const csv = 'Name;Kennzeichen;Marke;HU\nMax;M-AB 1;VW;05/2027\n';
    const response = await post({ csv, mapping: { name: 0, plate: 1, make: 2, huDueDate: 3 } });

    expect(response.status).toBe(200);
    expect(importMock).toHaveBeenCalledTimes(1);
    const [calledTenant, rows] = importMock.mock.calls[0];
    expect(calledTenant).toBe(tenantId);
    expect(rows[0].vehicle?.huDueDate).toBe('2027-05-31');
  });

  it('forbids mechanics', async () => {
    sessionMock.mockResolvedValue({ userId: '01234567-89ab-cdef-0123-456789abcdef', tenantId, role: 'mechanic' });
    const response = await post({ csv: 'Name\nA', mapping: { name: 0 } });
    expect(response.status).toBe(403);
    expect(importMock).not.toHaveBeenCalled();
  });

  it('answers 401 without a workshop', async () => {
    sessionMock.mockRejectedValue(new NoTenantError());
    expect((await post({ csv: 'Name\nA', mapping: { name: 0 } })).status).toBe(401);
  });

  it('rejects broken requests with 400', async () => {
    expect((await post('{nope')).status).toBe(400);
    expect((await post({ csv: '', mapping: {} })).status).toBe(400);
    expect((await post({ csv: 'Name\nA', mapping: { name: 3 } })).status).toBe(400);
    expect((await post({ csv: 'Name\nA', mapping: { secret: 0 } })).status).toBe(400);
    expect((await post({ csv: 'Telefon\n1', mapping: { phone: 0 } })).status).toBe(400);
    expect((await post({ csv: `Name\n${'x'.repeat(2 * 1024 * 1024)}`, mapping: { name: 0 } })).status).toBe(400);
    expect(importMock).not.toHaveBeenCalled();
  });

  it('answers 500 and says nothing was saved when the database fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    importMock.mockRejectedValue(new Error('db down'));
    const response = await post({ csv: 'Name\nA', mapping: { name: 0 } });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });
});
