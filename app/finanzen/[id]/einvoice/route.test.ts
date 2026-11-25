import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getInvoice } from '../../../../lib/db/invoices';
import type { Invoice } from '../../../../lib/finance';
import { getSessionContext, NoTenantError } from '../../../../lib/session';
import { GET } from './route';

vi.mock('../../../../lib/db/invoices', () => ({ getInvoice: vi.fn() }));
vi.mock('../../../../lib/session', () => ({
  getSessionContext: vi.fn(),
  NoTenantError: class NoTenantError extends Error {},
}));

const tenantId = 'fedcba98-7654-3210-fedc-ba9876543210';
const invoiceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const getInvoiceMock = vi.mocked(getInvoice);
const getSessionContextMock = vi.mocked(getSessionContext);

const invoice: Invoice = {
  id: invoiceId, customerId: 'c', vehicleId: null, number: 'RE-2026-0001', customer: 'Anna', plate: 'S-WN 1',
  lines: [{ id: 'a', description: 'Ölwechsel', quantity: 1, unitPrice: 89.5 }],
  taxMode: 'standard19', serviceDate: '2026-11-10', dueAt: '2026-12-01', issuedAt: '2026-11-17T10:00:00.000Z', status: 'issued', paidAmount: 0,
  sellerSnapshot: {
    companyName: 'Kfz Meier', ownerName: null, street: 'Werkstattstr. 1', zip: '70173', city: 'Stuttgart', phone: null, email: null,
    website: null, taxNumber: '12/345/67890', vatId: null, bankName: null, iban: null, bic: null,
  },
  buyerSnapshot: { name: 'Anna', vehiclePlate: null, email: null, phone: null, street: 'Kundenweg 2', zip: '70174', city: 'Stuttgart' },
};

const call = (id = invoiceId, query = '') => GET(new Request(`http://localhost/finanzen/${id}/einvoice${query}`), { params: { id } });

describe('e-invoice download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionContextMock.mockResolvedValue({ userId: '01234567-89ab-cdef-0123-456789abcdef', tenantId, role: 'owner' });
    getInvoiceMock.mockResolvedValue(invoice);
  });

  it('delivers the XML as a download named after the invoice number', async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/xml; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="e-rechnung_RE-2026-0001.xml"');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const xml = await response.text();
    expect(xml).toContain('<ram:ID>urn:cen.eu:en16931:2017</ram:ID>');
    expect(xml).toContain('<ram:GrandTotalAmount>106.51</ram:GrandTotalAmount>');
    expect(getInvoiceMock).toHaveBeenCalledWith(tenantId, invoiceId);
  });

  it('delivers the hybrid ZUGFeRD PDF with ?format=pdf', async () => {
    const response = await call(invoiceId, '?format=pdf');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="zugferd_RE-2026-0001.pdf"');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder('latin1').decode(bytes.slice(0, 8))).toBe('%PDF-1.7');
    expect(bytes.length).toBeGreaterThan(5_000);
  });

  it('also refuses the PDF for a draft (409) and keeps XML as the default format', async () => {
    getInvoiceMock.mockResolvedValue({ ...invoice, status: 'draft', number: null, issuedAt: null });
    expect((await call(invoiceId, '?format=pdf')).status).toBe(409);
    getInvoiceMock.mockResolvedValue(invoice);
    expect((await call(invoiceId, '?format=unknown')).headers.get('Content-Type')).toBe('application/xml; charset=utf-8');
  });

  it('answers 409 with the reason for a draft or an incomplete invoice', async () => {
    getInvoiceMock.mockResolvedValue({ ...invoice, status: 'draft', number: null, issuedAt: null });
    const draft = await call();
    expect(draft.status).toBe(409);
    expect((await draft.json()).error).toContain('ausgestellte');

    getInvoiceMock.mockResolvedValue({ ...invoice, sellerSnapshot: { ...invoice.sellerSnapshot, taxNumber: null } });
    const incomplete = await call();
    expect(incomplete.status).toBe(409);
    expect((await incomplete.json()).error).toContain('Steuernummer');
  });

  it('answers 404 for an unknown invoice and 400 for a malformed id', async () => {
    getInvoiceMock.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect((await call('nope')).status).toBe(400);
  });

  it('refuses an unknown role and users without a workshop', async () => {
    getSessionContextMock.mockResolvedValue({ userId: '01234567-89ab-cdef-0123-456789abcdef', tenantId, role: 'guest' as never });
    expect((await call()).status).toBe(403);
    getSessionContextMock.mockRejectedValue(new NoTenantError());
    expect((await call()).status).toBe(401);
    expect(getInvoiceMock).not.toHaveBeenCalled();
  });
});
