import { describe, expect, it } from 'vitest';
import { formatInvoiceNumber, getNextInvoiceSequenceNumber } from '../../lib/db/invoice-number-core';
import { assertInvoiceReadyForIssuing } from '../../lib/db/invoice-number';
import { InvoiceNotEditableError } from '../../lib/db/invoice-errors';

const readyInvoice = {
  hasLines: true,
  serviceDate: '2026-03-15',
  profile: {
    companyName: 'Werkstatt GmbH',
    street: 'Werkstattstraße 1',
    zip: '12345',
    city: 'Berlin',
    taxNumber: '12/345/67890',
    vatId: null,
  },
  buyerSnapshot: {
    street: 'Kundenstraße 2',
    zip: '54321',
    city: 'Hamburg',
  },
};

describe('invoice numbering', () => {
  it('starts at one and advances the stored sequence by one', () => {
    expect(getNextInvoiceSequenceNumber(0)).toBe(1);
    expect(getNextInvoiceSequenceNumber(241)).toBe(242);
  });

  it('formats the year and zero-padded sequence without truncating larger values', () => {
    expect(formatInvoiceNumber(2026, 1)).toBe('RE-2026-0001');
    expect(formatInvoiceNumber(2026, 10_000)).toBe('RE-2026-10000');
  });

  it('rejects invalid sequence state and invoice numbers', () => {
    expect(() => getNextInvoiceSequenceNumber(-1)).toThrow(RangeError);
    expect(() => getNextInvoiceSequenceNumber(2_147_483_647)).toThrow(RangeError);
    expect(() => formatInvoiceNumber(1999, 1)).toThrow(RangeError);
    expect(() => formatInvoiceNumber(2026, 0)).toThrow(RangeError);
  });

  it('requires an invoice line and service date before issuing', () => {
    expect(() => assertInvoiceReadyForIssuing({ ...readyInvoice, hasLines: false }))
      .toThrowError(new InvoiceNotEditableError('Die Rechnung benötigt mindestens eine Position.'));
    expect(() => assertInvoiceReadyForIssuing({ ...readyInvoice, serviceDate: null }))
      .toThrow(/Leistungsdatum/);
  });

  it.each([
    ['companyName', 'Firmenname'],
    ['street', 'Straße'],
    ['zip', 'Postleitzahl'],
    ['city', 'Ort'],
  ] as const)('requires the workshop profile field %s', (field, label) => {
    expect(() => assertInvoiceReadyForIssuing({
      ...readyInvoice,
      profile: { ...readyInvoice.profile, [field]: '   ' },
    })).toThrow(label);
  });

  it('requires a tax number or VAT ID, and accepts either one', () => {
    const profile = { ...readyInvoice.profile, taxNumber: null, vatId: null };
    expect(() => assertInvoiceReadyForIssuing({ ...readyInvoice, profile }))
      .toThrow('Steuernummer oder USt-IdNr.');
    expect(() => assertInvoiceReadyForIssuing({
      ...readyInvoice,
      profile: { ...profile, vatId: 'DE123456789' },
    })).not.toThrow();
  });

  it.each([
    ['street', 'Straße'],
    ['zip', 'Postleitzahl'],
    ['city', 'Ort'],
  ] as const)('requires buyer field %s', (field, label) => {
    expect(() => assertInvoiceReadyForIssuing({
      ...readyInvoice,
      buyerSnapshot: { ...readyInvoice.buyerSnapshot, [field]: '' },
    })).toThrow(label);
  });
});
