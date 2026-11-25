import { describe, expect, it } from 'vitest';
import { eurosToCents, getPaymentSummary, paymentLabel, type PaymentSummaryInput } from './payment-status';

const base: PaymentSummaryInput = {
  status: 'issued',
  grossCents: 9_520,
  paidCents: 0,
  dueDate: '2026-12-01',
  today: '2026-11-17',
};

describe('getPaymentSummary', () => {
  it('is open until something is paid', () => {
    expect(getPaymentSummary(base)).toEqual({ kind: 'open', grossCents: 9_520, paidCents: 0, openCents: 9_520, overdueDays: 0 });
  });

  it('is partial with the remaining amount after a part payment', () => {
    expect(getPaymentSummary({ ...base, paidCents: 2_000 })).toMatchObject({ kind: 'partial', openCents: 7_520 });
  });

  it('is paid when the full amount arrived, and never shows a negative open amount', () => {
    expect(getPaymentSummary({ ...base, paidCents: 9_520 })).toMatchObject({ kind: 'paid', openCents: 0 });
    expect(getPaymentSummary({ ...base, paidCents: 9_999 })).toMatchObject({ kind: 'paid', openCents: 0 });
  });

  it('counts overdue days only after the due date and only while something is open', () => {
    expect(getPaymentSummary({ ...base, today: '2026-12-01' }).overdueDays).toBe(0); // due today is not overdue yet
    expect(getPaymentSummary({ ...base, today: '2026-12-02' }).overdueDays).toBe(1);
    expect(getPaymentSummary({ ...base, today: '2026-12-31', paidCents: 2_000 })).toMatchObject({ kind: 'partial', overdueDays: 30 });
    expect(getPaymentSummary({ ...base, today: '2026-12-31', paidCents: 9_520 }).overdueDays).toBe(0);
    expect(getPaymentSummary({ ...base, dueDate: null, today: '2030-01-01' }).overdueDays).toBe(0);
  });

  it('counts days correctly across month and year boundaries', () => {
    expect(getPaymentSummary({ ...base, dueDate: '2026-12-28', today: '2027-01-05' }).overdueDays).toBe(8);
  });

  it('treats drafts, cancelled invoices and Storno documents as no receivable', () => {
    expect(getPaymentSummary({ ...base, status: 'draft' })).toMatchObject({ kind: 'draft', openCents: 0, overdueDays: 0 });
    expect(getPaymentSummary({ ...base, status: 'cancelled', today: '2030-01-01' })).toMatchObject({ kind: 'cancelled', openCents: 0, overdueDays: 0 });
    expect(getPaymentSummary({ ...base, grossCents: -9_520, cancelsInvoiceId: 'x' })).toMatchObject({ kind: 'storno', openCents: 0 });
  });
});

describe('eurosToCents', () => {
  it('converts euro amounts without float drift', () => {
    expect(eurosToCents(95.2)).toBe(9_520);
    expect(eurosToCents(0.07)).toBe(7);
    expect(eurosToCents(1.15)).toBe(115);
    expect(eurosToCents(177.79)).toBe(17_779);
    expect(() => eurosToCents(Number.NaN)).toThrow(RangeError);
  });
});

describe('paymentLabel', () => {
  it('names each state in German', () => {
    expect(paymentLabel(getPaymentSummary(base), base.dueDate)).toBe('Offen bis 01.12.2026');
    expect(paymentLabel(getPaymentSummary({ ...base, paidCents: 2_000 }), base.dueDate)).toBe('Teilbezahlt');
    expect(paymentLabel(getPaymentSummary({ ...base, paidCents: 9_520 }), base.dueDate)).toBe('Bezahlt');
    expect(paymentLabel(getPaymentSummary({ ...base, status: 'draft' }), base.dueDate)).toBe('Entwurf');
  });

  it('adds the overdue days, with singular and plural', () => {
    expect(paymentLabel(getPaymentSummary({ ...base, today: '2026-12-02' }), base.dueDate)).toBe('Überfällig (1 Tag)');
    expect(paymentLabel(getPaymentSummary({ ...base, today: '2026-12-12' }), base.dueDate)).toBe('Überfällig (11 Tage)');
    expect(paymentLabel(getPaymentSummary({ ...base, today: '2026-12-12', paidCents: 2_000 }), base.dueDate)).toBe(
      'Teilbezahlt · überfällig (11 Tage)',
    );
  });
});
