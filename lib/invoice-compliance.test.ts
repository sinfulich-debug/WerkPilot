import { describe, expect, it } from 'vitest';
import { checkInvoiceCompliance } from './invoice-compliance';

const complete = {
  status: 'issued' as const,
  number: 'RE-2026-0001',
  issuedAt: '2026-11-17T10:00:00.000Z',
  serviceDate: '2026-11-17',
  cancelsInvoiceId: undefined,
  cancelsNumber: undefined,
  lines: [{ id: '1', description: 'Ölwechsel', quantity: 1, unitPrice: 89.5 }],
  sellerSnapshot: {
    companyName: 'Kfz Meier', ownerName: null, street: 'Werkstattstr. 1', zip: '70173', city: 'Stuttgart',
    phone: null, email: null, website: null, taxNumber: '12/345/67890', vatId: null, bankName: null, iban: null, bic: null,
  },
  buyerSnapshot: { name: 'Anna Müller', vehiclePlate: null, email: null, phone: null, street: 'Kundenweg 2', zip: '70174', city: 'Stuttgart' },
};

const codes = (invoice: Parameters<typeof checkInvoiceCompliance>[0]) => checkInvoiceCompliance(invoice).map((gap) => gap.code);

describe('checkInvoiceCompliance', () => {
  it('finds nothing missing on a complete invoice', () => {
    expect(checkInvoiceCompliance(complete)).toEqual([]);
  });

  it('accepts a VAT ID instead of a tax number', () => {
    const seller = { ...complete.sellerSnapshot, taxNumber: null, vatId: 'DE123456789' };
    expect(codes({ ...complete, sellerSnapshot: seller })).toEqual([]);
  });

  it('reports the missing tax identification of the seller', () => {
    const seller = { ...complete.sellerSnapshot, taxNumber: '  ', vatId: null };
    expect(codes({ ...complete, sellerSnapshot: seller })).toEqual(['seller-tax-id']);
  });

  it('reports incomplete addresses of seller and buyer', () => {
    const seller = { ...complete.sellerSnapshot, zip: null };
    const buyer = { ...complete.buyerSnapshot, street: '' };
    expect(codes({ ...complete, sellerSnapshot: seller, buyerSnapshot: buyer })).toEqual(['seller-address', 'buyer-address']);
  });

  it('does not expect number and issue date on a draft, but on every issued invoice', () => {
    expect(codes({ ...complete, status: 'draft', number: null, issuedAt: null })).toEqual([]);
    expect(codes({ ...complete, number: null, issuedAt: null })).toEqual(['number', 'issue-date']);
  });

  it('needs a service date and at least one proper line', () => {
    expect(codes({ ...complete, serviceDate: '' })).toEqual(['service-date']);
    expect(codes({ ...complete, lines: [] })).toEqual(['lines']);
    expect(codes({ ...complete, lines: [{ id: '1', description: ' ', quantity: 0, unitPrice: 5 }] })).toEqual([
      'line-1-description',
      'line-1-quantity',
    ]);
  });

  it('keeps negative quantities of a Storno valid and wants the reference to the cancelled invoice', () => {
    const lines = [{ id: '1', description: 'Storno: Ölwechsel', quantity: -1, unitPrice: 89.5 }];
    expect(codes({ ...complete, lines, cancelsInvoiceId: 'abc', cancelsNumber: 'RE-2026-0001' })).toEqual([]);
    expect(codes({ ...complete, lines, cancelsInvoiceId: 'abc', cancelsNumber: undefined })).toEqual(['storno-reference']);
  });

  it('gives a German message for every gap', () => {
    const gaps = checkInvoiceCompliance({ ...complete, number: null, serviceDate: '', lines: [] });
    expect(gaps.length).toBe(3);
    for (const gap of gaps) expect(gap.message).toMatch(/fehlt|enthält keine/);
  });
});
