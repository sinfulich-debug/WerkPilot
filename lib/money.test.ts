import { describe, expect, it } from 'vitest';
import {
  formatEuro,
  discountedUnitPriceCents,
  invoiceTotals,
  lineNetCents,
  parseEuroToCents,
  workOrderTotals,
} from './money';

describe('lineNetCents', () => {
  it('adds cent values without floating-point decimal drift', () => {
    expect(lineNetCents(1_000, 10) + lineNetCents(1_000, 20)).toBe(30);
  });

  it('rounds positive and negative half-cent values away from zero', () => {
    expect(lineNetCents(500, 5)).toBe(3);
    expect(lineNetCents(-500, 5)).toBe(-3);
    expect(lineNetCents(100, 5)).toBe(1);
    expect(lineNetCents(-100, 5)).toBe(-1);
  });

  it('supports negative reversal positions and large amounts', () => {
    expect(lineNetCents(-1_000, 12_345)).toBe(-12_345);
    expect(lineNetCents(1_000, 900_000_000_000)).toBe(900_000_000_000);
  });

  it('rejects non-integer, non-finite, and unsafe inputs', () => {
    expect(() => lineNetCents(Number.NaN, 100)).toThrow(RangeError);
    expect(() => lineNetCents(1_000, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => lineNetCents(1.5, 100)).toThrow(RangeError);
    expect(() => lineNetCents(1_000, 1.25)).toThrow(RangeError);
  });
});

describe('invoiceTotals', () => {
  it('groups net amounts by 19%, 7%, and 0% tax rates', () => {
    expect(invoiceTotals([
      { qtyMilli: 1_000, unitPriceCents: 10, taxRateBp: 1_900 },
      { qtyMilli: 1_000, unitPriceCents: 20, taxRateBp: 1_900 },
      { qtyMilli: 1_000, unitPriceCents: 100, taxRateBp: 700 },
      { qtyMilli: 1_000, unitPriceCents: 100, taxRateBp: 0 },
    ])).toEqual({
      groups: [
        { taxRateBp: 0, netCents: 100, taxCents: 0 },
        { taxRateBp: 700, netCents: 100, taxCents: 7 },
        { taxRateBp: 1_900, netCents: 30, taxCents: 6 },
      ],
      netCents: 230,
      taxCents: 13,
      grossCents: 243,
    });
  });

  it('calculates tax after grouping and retains negative reversal amounts', () => {
    expect(invoiceTotals([
      { qtyMilli: 1_000, unitPriceCents: 1, taxRateBp: 1_900 },
      { qtyMilli: 1_000, unitPriceCents: 1, taxRateBp: 1_900 },
      { qtyMilli: 1_000, unitPriceCents: 1, taxRateBp: 1_900 },
      { qtyMilli: 1_000, unitPriceCents: -100, taxRateBp: 1_900 },
    ])).toEqual({
      groups: [{ taxRateBp: 1_900, netCents: -97, taxCents: -18 }],
      netCents: -97,
      taxCents: -18,
      grossCents: -115,
    });
  });

  it('rounds positive and negative half-cent tax amounts away from zero', () => {
    const totalsFor = (netCents: number) => invoiceTotals([
      { qtyMilli: 1_000, unitPriceCents: netCents, taxRateBp: 5_000 },
    ]);

    expect(totalsFor(5).taxCents).toBe(3);
    expect(totalsFor(-5).taxCents).toBe(-3);
    expect(totalsFor(1).taxCents).toBe(1);
    expect(totalsFor(-1).taxCents).toBe(-1);
  });

  it('fully reverses any line and invoice totals to zero', () => {
    const invoiceLines = [
      { qtyMilli: 500, unitPriceCents: 5, taxRateBp: 1_900 },
      { qtyMilli: 1_000, unitPriceCents: 1_250, taxRateBp: 700 },
      { qtyMilli: 1_500, unitPriceCents: 2_000, taxRateBp: 0 },
    ];
    const reversals = invoiceLines.map((line) => ({ ...line, qtyMilli: -line.qtyMilli }));

    invoiceLines.forEach((line) => {
      expect(
        lineNetCents(line.qtyMilli, line.unitPriceCents) +
          lineNetCents(-line.qtyMilli, line.unitPriceCents),
      ).toBe(0);
    });

    expect(invoiceTotals([...invoiceLines, ...reversals])).toEqual({
      groups: [
        { taxRateBp: 0, netCents: 0, taxCents: 0 },
        { taxRateBp: 700, netCents: 0, taxCents: 0 },
        { taxRateBp: 1_900, netCents: 0, taxCents: 0 },
      ],
      netCents: 0,
      taxCents: 0,
      grossCents: 0,
    });
  });

  it('returns zero totals for an empty invoice', () => {
    expect(invoiceTotals([])).toEqual({
      groups: [],
      netCents: 0,
      taxCents: 0,
      grossCents: 0,
    });
  });
});

describe('workOrderTotals', () => {
  it('applies discounts and returns labor, parts, and combined totals separately', () => {
    expect(workOrderTotals([
      { kind: 'labor', qtyMilli: 1_000, unitPriceCents: 10_000, discountBp: 1_000, taxRateBp: 1_900 },
      { kind: 'part', qtyMilli: 2_000, unitPriceCents: 5_000, discountBp: 2_000, taxRateBp: 1_900 },
    ])).toEqual({
      labor: {
        groups: [{ taxRateBp: 1_900, netCents: 9_000, taxCents: 1_710 }],
        netCents: 9_000,
        taxCents: 1_710,
        grossCents: 10_710,
      },
      part: {
        groups: [{ taxRateBp: 1_900, netCents: 8_000, taxCents: 1_520 }],
        netCents: 8_000,
        taxCents: 1_520,
        grossCents: 9_520,
      },
      total: {
        groups: [{ taxRateBp: 1_900, netCents: 17_000, taxCents: 3_230 }],
        netCents: 17_000,
        taxCents: 3_230,
        grossCents: 20_230,
      },
      marginCents: 0,
    });
  });

  it('calculates margin from discounted sale price and the purchase-price snapshot', () => {
    expect(workOrderTotals([
      {
        kind: 'part',
        qtyMilli: 2_000,
        unitPriceCents: 10_000,
        purchasePriceCents: 6_000,
        discountBp: 1_000,
        taxRateBp: 1_900,
      },
      {
        kind: 'part',
        qtyMilli: 1_000,
        unitPriceCents: 5_000,
        purchasePriceCents: null,
        discountBp: 0,
        taxRateBp: 1_900,
      },
    ]).marginCents).toBe(6_000);
  });

  it('rounds discounted unit prices to cents and validates basis points', () => {
    expect(discountedUnitPriceCents(1_000, 1_250)).toBe(875);
    expect(() => discountedUnitPriceCents(1_000, -1)).toThrow(RangeError);
    expect(() => discountedUnitPriceCents(1_000, 10_001)).toThrow(RangeError);
  });
});

describe('Euro parsing and formatting', () => {
  it('parses comma decimals, dot decimals, and German thousands separators as cents', () => {
    expect(parseEuroToCents('12,50')).toBe(1_250);
    expect(parseEuroToCents('12.5')).toBe(1_250);
    expect(parseEuroToCents('1.234,56')).toBe(123_456);
    expect(parseEuroToCents('-0,05')).toBe(-5);
  });

  it('formats cents using German euro notation', () => {
    expect(formatEuro(1_234_567)).toBe('12.345,67 €');
  });

  it('rejects malformed, over-precise, and unsafe amounts', () => {
    for (const input of ['', '12,345', '1,2.3', '1.234,567', '1,234.56', '90071992547410,00']) {
      expect(() => parseEuroToCents(input)).toThrow(RangeError);
    }
  });
});
