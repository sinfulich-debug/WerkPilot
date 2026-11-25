import { describe, expect, it } from 'vitest';
import { calculateInvoiceTotalsCents } from '../../lib/db/money';

describe('invoice totals in cents', () => {
  it('calculates line-level VAT in integer cents', () => {
    expect(calculateInvoiceTotalsCents([
      { quantityMilli: 1_000, unitNetPriceCents: 10_000, taxRateBps: 1_900 },
      { quantityMilli: 1_000, unitNetPriceCents: 5_000, taxRateBps: 700 },
    ])).toEqual({
      netTotalCents: 15_000,
      taxTotalCents: 2_250,
      grossTotalCents: 17_250,
    });
  });

  it('rounds fractional quantities and tax per line to the nearest cent', () => {
    expect(calculateInvoiceTotalsCents([
      { quantityMilli: 375, unitNetPriceCents: 1_999, taxRateBps: 1_900 },
    ])).toEqual({
      netTotalCents: 750,
      taxTotalCents: 143,
      grossTotalCents: 893,
    });
  });

  it('returns zero totals for no lines and rejects invalid monetary inputs', () => {
    expect(calculateInvoiceTotalsCents([])).toEqual({
      netTotalCents: 0,
      taxTotalCents: 0,
      grossTotalCents: 0,
    });
    expect(() => calculateInvoiceTotalsCents([
      { quantityMilli: 0, unitNetPriceCents: 100, taxRateBps: 1_900 },
    ])).toThrow(RangeError);
    expect(() => calculateInvoiceTotalsCents([
      { quantityMilli: 1_000, unitNetPriceCents: 100, taxRateBps: 10_001 },
    ])).toThrow(RangeError);
  });
});
