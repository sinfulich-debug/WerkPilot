import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getJournalInvoices } from '../../../lib/db/invoice-journal';
import { getSessionContext, NoTenantError } from '../../../lib/session';
import { GET } from './route';

vi.mock('../../../lib/db/invoice-journal', () => ({ getJournalInvoices: vi.fn() }));
vi.mock('../../../lib/session', () => ({
  getSessionContext: vi.fn(),
  NoTenantError: class NoTenantError extends Error {},
}));

const tenantId = 'fedcba98-7654-3210-fedc-ba9876543210';
const getJournalInvoicesMock = vi.mocked(getJournalInvoices);
const getSessionContextMock = vi.mocked(getSessionContext);

const issued = {
  id: 'a',
  number: 'RE-2026-0001',
  issuedAt: '2026-11-03T10:00:00.000Z',
  serviceDate: '2026-11-03',
  customer: 'Anna Müller',
  status: 'issued' as const,
  dueDate: '2026-11-17',
  lines: [{ qtyMilli: 1_000, unitPriceCents: 10_000, taxRateBp: 1_900 }],
  paidCents: 0,
};

const request = (query: string) => new Request(`http://localhost/finanzen/journal?${query}`);

describe('invoice journal route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionContextMock.mockResolvedValue({ userId: '01234567-89ab-cdef-0123-456789abcdef', tenantId, role: 'owner' });
    getJournalInvoicesMock.mockResolvedValue([issued]);
  });

  it('answers with the journal and the VAT summary as JSON', async () => {
    const response = await GET(request('from=2026-11-01&to=2026-11-30'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ number: 'RE-2026-0001', grossCents: 11_900 });
    expect(body.summary.groups).toEqual([{ taxRateBp: 1_900, netCents: 10_000, taxCents: 1_900, grossCents: 11_900 }]);
    expect(getJournalInvoicesMock).toHaveBeenCalledWith(tenantId, { from: '2026-11-01', to: '2026-11-30' });
  });

  it('delivers a CSV download with a BOM, a file name with the period and no caching', async () => {
    const response = await GET(request('from=2026-11-01&to=2026-11-30&format=csv'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="rechnungsjournal_2026-11-01_2026-11-30.csv"');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    // text() strips a BOM, so check the raw bytes: EF BB BF tells Excel the file is UTF-8
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const text = await response.text();
    expect(text).toContain('RE-2026-0001;03.11.2026');
    expect(text).toContain('Summe;');
  });

  it('answers 400 with a German message for a bad period', async () => {
    for (const query of ['from=2026-11-30&to=2026-11-01', 'from=heute&to=2026-11-30', 'from=2026-01-01&to=2028-01-01', '']) {
      const response = await GET(request(query));
      expect(response.status).toBe(400);
      expect(typeof (await response.json()).error).toBe('string');
    }
    expect(getJournalInvoicesMock).not.toHaveBeenCalled();
  });

  it('refuses an unknown role and users without a workshop', async () => {
    getSessionContextMock.mockResolvedValue({ userId: '01234567-89ab-cdef-0123-456789abcdef', tenantId, role: 'guest' as never });
    expect((await GET(request('from=2026-11-01&to=2026-11-30'))).status).toBe(403);

    getSessionContextMock.mockRejectedValue(new NoTenantError());
    expect((await GET(request('from=2026-11-01&to=2026-11-30'))).status).toBe(401);
    expect(getJournalInvoicesMock).not.toHaveBeenCalled();
  });

  it('does not leak internals when the database fails', async () => {
    getJournalInvoicesMock.mockRejectedValue(new Error('password authentication failed for user postgres'));
    const response = await GET(request('from=2026-11-01&to=2026-11-30'));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('postgres');
  });
});
