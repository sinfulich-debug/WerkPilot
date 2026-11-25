import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InvoiceNotEditableError,
  InvoiceNotFoundError,
  addPayment,
  cancelInvoice,
  createInvoice,
  deleteInvoice,
  getInvoices,
  issueInvoice,
  updateInvoice,
} from '../../../lib/db/invoices';
import { getSessionContext, NoTenantError } from '../../../lib/session';
import { GET, POST } from './route';

vi.mock('../../../lib/db/invoices', () => ({
  InvoiceNotEditableError: class InvoiceNotEditableError extends Error {},
  InvoiceNotFoundError: class InvoiceNotFoundError extends Error {},
  addPayment: vi.fn(),
  cancelInvoice: vi.fn(),
  createInvoice: vi.fn(),
  deleteInvoice: vi.fn(),
  getInvoices: vi.fn(),
  issueInvoice: vi.fn(),
  updateInvoice: vi.fn(),
}));

vi.mock('../../../lib/session', () => ({
  getSessionContext: vi.fn(),
  NoTenantError: class NoTenantError extends Error {},
}));

const getSessionContextMock = vi.mocked(getSessionContext);
const getInvoicesMock = vi.mocked(getInvoices);
const createInvoiceMock = vi.mocked(createInvoice);
const updateInvoiceMock = vi.mocked(updateInvoice);
const issueInvoiceMock = vi.mocked(issueInvoice);
const deleteInvoiceMock = vi.mocked(deleteInvoice);
const addPaymentMock = vi.mocked(addPayment);
const cancelInvoiceMock = vi.mocked(cancelInvoice);

const tenantId = 'fedcba98-7654-3210-fedc-ba9876543210';
const invoiceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const customerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const invoiceInput = {
  customerId,
  vehicleId: undefined,
  serviceDate: '2026-11-14',
  dueAt: '2026-11-28',
  taxMode: 'standard19' as const,
  lines: [{ description: 'Arbeitsleistung', quantity: 1.5, unitPrice: 95 }],
};
const invoice = {
  id: invoiceId,
  customerId,
  vehicleId: null,
  number: null,
  customer: 'Anna Müller',
  plate: '–',
  lines: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', ...invoiceInput.lines[0] }],
  taxMode: 'standard19' as const,
  serviceDate: invoiceInput.serviceDate,
  dueAt: invoiceInput.dueAt,
  issuedAt: null,
  status: 'draft' as const,
  paidAmount: 0,
  sellerSnapshot: {
    companyName: 'Werkstatt Müller',
    ownerName: null,
    street: null,
    zip: null,
    city: null,
    phone: null,
    email: null,
    website: null,
    taxNumber: null,
    vatId: null,
    bankName: null,
    iban: null,
    bic: null,
  },
  buyerSnapshot: {
    name: 'Anna Müller',
    vehiclePlate: null,
    email: null,
    phone: null,
    street: null,
    zip: null,
    city: null,
  },
};

function post(action: string, body: unknown): Request {
  return new Request(`http://localhost/finanzen/api?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('finances API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionContextMock.mockResolvedValue({
      userId: '01234567-89ab-cdef-0123-456789abcdef',
      tenantId,
      role: 'owner',
    });
    getInvoicesMock.mockResolvedValue([]);
    createInvoiceMock.mockResolvedValue(invoice);
    updateInvoiceMock.mockResolvedValue(invoice);
    issueInvoiceMock.mockResolvedValue('RE-2026-0001');
    deleteInvoiceMock.mockResolvedValue();
    addPaymentMock.mockResolvedValue({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      invoiceId,
      amount: 169.58,
      paidAt: '2026-11-14T10:00:00.000Z',
    });
  });

  it('loads invoices for the active tenant', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(getInvoicesMock).toHaveBeenCalledWith(tenantId);
    await expect(response.json()).resolves.toEqual({ ok: true, invoices: [] });
  });

  it('returns 401 when the user has no tenant membership', async () => {
    getSessionContextMock.mockRejectedValue(new NoTenantError());

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });

  it('lets mechanics work with invoices like the office (decision of the owner)', async () => {
    getSessionContextMock.mockResolvedValue({
      userId: '01234567-89ab-cdef-0123-456789abcdef',
      tenantId,
      role: 'mechanic',
    });
    getInvoicesMock.mockResolvedValue([]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(getInvoicesMock).toHaveBeenCalledWith(tenantId);
  });

  it('refuses an unknown role', async () => {
    getSessionContextMock.mockResolvedValue({
      userId: '01234567-89ab-cdef-0123-456789abcdef',
      tenantId,
      role: 'guest' as never,
    });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(getInvoicesMock).not.toHaveBeenCalled();
  });

  it('trims and creates a draft for the active tenant', async () => {
    const response = await POST(post('createInvoice', {
      ...invoiceInput,
      lines: [{ ...invoiceInput.lines[0], description: ' Arbeitsleistung ' }],
    }));

    expect(response.status).toBe(200);
    expect(createInvoiceMock).toHaveBeenCalledWith(tenantId, invoiceInput);
    await expect(response.json()).resolves.toMatchObject({ ok: true, invoice });
  });

  it.each([
    [{ ...invoiceInput, customerId: 'invalid' }, 'Kennung'],
    [{ ...invoiceInput, serviceDate: '2026-02-31' }, 'YYYY-MM-DD'],
    [{ ...invoiceInput, lines: [{ ...invoiceInput.lines[0], description: ' ' }] }, 'Bezeichnung'],
    [{ ...invoiceInput, lines: [{ ...invoiceInput.lines[0], quantity: 0 }] }, 'Menge oder Einzelpreis'],
  ])('rejects invalid invoice data', async (body, expectedError) => {
    const response = await POST(post('createInvoice', body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining(expectedError),
    });
    expect(createInvoiceMock).not.toHaveBeenCalled();
  });

  it('accepts a valid unit on a line and passes it on', async () => {
    const response = await POST(post('createInvoice', {
      ...invoiceInput,
      lines: [{ ...invoiceInput.lines[0], unit: 'HUR' }],
    }));

    expect(response.status).toBe(200);
    expect(createInvoiceMock).toHaveBeenCalledWith(tenantId, {
      ...invoiceInput,
      lines: [{ ...invoiceInput.lines[0], unit: 'HUR' }],
    });
  });

  it('rejects an unknown unit with a German message', async () => {
    const response = await POST(post('createInvoice', {
      ...invoiceInput,
      lines: [{ ...invoiceInput.lines[0], unit: 'XYZ' }],
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('Einheit') });
    expect(createInvoiceMock).not.toHaveBeenCalled();
  });

  it('returns 409 when an issued invoice cannot be edited', async () => {
    issueInvoiceMock.mockRejectedValue(new InvoiceNotEditableError());

    const response = await POST(post('issueInvoice', { id: invoiceId }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });

  it('updates, issues, deletes and records payments within the tenant context', async () => {
    const updateResponse = await POST(post('updateInvoice', { id: invoiceId, ...invoiceInput }));
    const issueResponse = await POST(post('issueInvoice', { id: invoiceId }));
    const deleteResponse = await POST(post('deleteInvoice', { id: invoiceId }));
    const paymentResponse = await POST(post('addPayment', {
      invoiceId,
      amount: 169.58,
      paidAt: '2026-11-14T10:00:00.000Z',
    }));

    expect(updateResponse.status).toBe(200);
    expect(updateInvoiceMock).toHaveBeenCalledWith(tenantId, invoiceId, invoiceInput);
    expect(issueResponse.status).toBe(200);
    expect(issueInvoiceMock).toHaveBeenCalledWith(tenantId, invoiceId, '01234567-89ab-cdef-0123-456789abcdef');
    expect(deleteResponse.status).toBe(200);
    expect(deleteInvoiceMock).toHaveBeenCalledWith(tenantId, invoiceId);
    expect(paymentResponse.status).toBe(200);
    expect(addPaymentMock).toHaveBeenCalledWith(tenantId, invoiceId, 169.58, '2026-11-14T10:00:00.000Z');
  });

  describe('issued and cancelled invoices stay untouched (checked live on RE-2026-0020)', () => {
    it('never answers ok for an update that saved nothing', async () => {
      updateInvoiceMock.mockResolvedValue(null);
      const response = await POST(post('updateInvoice', { id: invoiceId, ...invoiceInput }));
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ ok: false });
    });

    it.each([
      ['update', 'updateInvoice', () => ({ id: invoiceId, ...invoiceInput })],
      ['delete', 'deleteInvoice', () => ({ id: invoiceId })],
    ] as const)('answers 409 to %s of an invoice that is no draft', async (_label, action, body) => {
      const mock = action === 'updateInvoice' ? updateInvoiceMock : deleteInvoiceMock;
      mock.mockRejectedValue(new InvoiceNotEditableError('Nur Rechnungsentwürfe können geändert werden.'));
      const response = await POST(post(action, body()));
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/Rechnungsentwürfe/) });
    });

    it.each([
      ['update', 'updateInvoice', () => ({ id: invoiceId, ...invoiceInput })],
      ['delete', 'deleteInvoice', () => ({ id: invoiceId })],
    ] as const)('answers 404 to %s of an unknown invoice', async (_label, action, body) => {
      const mock = action === 'updateInvoice' ? updateInvoiceMock : deleteInvoiceMock;
      mock.mockRejectedValue(new InvoiceNotFoundError('Die Rechnung wurde nicht gefunden.'));
      expect((await POST(post(action, body()))).status).toBe(404);
    });
  });

  describe('payments (checked live in the browser as a mechanic on RE-2026-0020)', () => {
    // 22:30 UTC = 23:30 in Berlin on 18.11.2026: the Berlin day is still the 18th
    const NOW = new Date('2026-11-18T22:30:00.000Z');

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
      getSessionContextMock.mockResolvedValue({
        userId: '01234567-89ab-cdef-0123-456789abcdef',
        tenantId,
        role: 'mechanic',
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('lets a mechanic record a part payment for today', async () => {
      const response = await POST(post('addPayment', { invoiceId, amount: 75.53, paidAt: '2026-11-18T11:00:00.000Z' }));
      expect(response.status).toBe(200);
      expect(addPaymentMock).toHaveBeenCalledWith(tenantId, invoiceId, 75.53, '2026-11-18T11:00:00.000Z');
    });

    it.each([
      ['zero', 0, /größer als 0/],
      ['negative', -5, /größer als 0/],
      ['three decimals', 1.234, /zwei Nachkommastellen/],
      ['a string instead of a number', '50', /größer als 0/],
      ['null', null, /größer als 0/],
      ['infinity (sent as a huge number)', 1e309, /größer als 0/],
    ])('answers 400 for %s and records nothing', async (_label, amount, message) => {
      const response = await POST(post('addPayment', { invoiceId, amount, paidAt: '2026-11-18T11:00:00.000Z' }));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(message) });
      expect(addPaymentMock).not.toHaveBeenCalled();
    });

    it.each([
      ['no date', undefined],
      ['an empty date', '  '],
      ['text that is no date', 'kein datum'],
    ])('answers 400 for %s', async (_label, paidAt) => {
      const response = await POST(post('addPayment', { invoiceId, amount: 10, paidAt }));
      expect(response.status).toBe(400);
      expect(addPaymentMock).not.toHaveBeenCalled();
    });

    it('refuses a payment date in the future (Berlin calendar day), even when the browser is bypassed', async () => {
      // 23:30 UTC on the 18th is already 00:30 on the 19th in Berlin
      const tomorrowInBerlin = await POST(post('addPayment', { invoiceId, amount: 10, paidAt: '2026-11-18T23:30:00.000Z' }));
      const nextYear = await POST(post('addPayment', { invoiceId, amount: 10, paidAt: '2027-01-05T10:00:00.000Z' }));

      for (const response of [tomorrowInBerlin, nextYear]) {
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/Zukunft/) });
      }
      expect(addPaymentMock).not.toHaveBeenCalled();
    });

    it('accepts a payment late in the Berlin evening of today and one in the past', async () => {
      // 22:59 UTC = 23:59 Berlin, still the 18th
      expect((await POST(post('addPayment', { invoiceId, amount: 10, paidAt: '2026-11-18T22:59:00.000Z' }))).status).toBe(200);
      expect((await POST(post('addPayment', { invoiceId, amount: 10, paidAt: '2025-12-31T23:30:00.000Z' }))).status).toBe(200);
      expect(addPaymentMock).toHaveBeenCalledTimes(2);
    });

    it('answers 409 when the amount is higher than what is still open (checked in the database)', async () => {
      addPaymentMock.mockRejectedValue(new InvoiceNotEditableError('Der Zahlungsbetrag überschreitet den offenen Rechnungsbetrag.'));
      const response = await POST(post('addPayment', { invoiceId, amount: 100.01, paidAt: '2026-11-18T11:00:00.000Z' }));
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/überschreitet/) });
    });

    it('answers 404 when the invoice does not exist in this workshop', async () => {
      addPaymentMock.mockRejectedValue(new InvoiceNotFoundError('Die Rechnung wurde nicht gefunden.'));
      const response = await POST(post('addPayment', { invoiceId, amount: 1, paidAt: '2026-11-18T11:00:00.000Z' }));
      expect(response.status).toBe(404);
    });
  });

  it('cancels an issued invoice and returns the number of the Storno', async () => {
    cancelInvoiceMock.mockResolvedValue({ number: 'RE-2026-0002', cancellationId: invoiceId });

    const response = await POST(post('cancelInvoice', { id: invoiceId }));

    expect(response.status).toBe(200);
    expect(cancelInvoiceMock).toHaveBeenCalledWith(tenantId, invoiceId, '01234567-89ab-cdef-0123-456789abcdef');
    await expect(response.json()).resolves.toEqual({
      ok: true,
      number: 'RE-2026-0002',
      cancellationId: invoiceId,
    });
  });

  it('answers 409 with the reason when the invoice cannot be cancelled', async () => {
    cancelInvoiceMock.mockRejectedValue(new InvoiceNotEditableError('Diese Rechnung wurde bereits storniert.'));

    const response = await POST(post('cancelInvoice', { id: invoiceId }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });

  it('answers 404 when the invoice to cancel does not exist', async () => {
    cancelInvoiceMock.mockRejectedValue(new InvoiceNotFoundError());

    const response = await POST(post('cancelInvoice', { id: invoiceId }));

    expect(response.status).toBe(404);
  });

  it('rejects an invalid id when cancelling and refuses an unknown role', async () => {
    const invalid = await POST(post('cancelInvoice', { id: 'nope' }));
    expect(invalid.status).toBe(400);

    getSessionContextMock.mockResolvedValue({
      userId: '01234567-89ab-cdef-0123-456789abcdef',
      tenantId,
      role: 'guest' as never,
    });
    const forbidden = await POST(post('cancelInvoice', { id: invoiceId }));
    expect(forbidden.status).toBe(403);
    expect(cancelInvoiceMock).not.toHaveBeenCalled();
  });
});
