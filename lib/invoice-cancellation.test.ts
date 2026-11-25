import { describe, expect, it } from 'vitest';
import {
  buildCancellationLines,
  getCancellationBlocker,
  STORNO_PREFIX,
  type CancellableLine,
} from './invoice-cancellation';
import { invoiceTotals } from './money';

const issued = { status: 'issued' as const, cancelsInvoiceId: null, alreadyCancelled: false };

describe('getCancellationBlocker', () => {
  it('allows an issued invoice that has not been cancelled', () => {
    expect(getCancellationBlocker(issued)).toBeNull();
  });

  it('refuses drafts, cancellations of cancellations and double cancellation', () => {
    expect(getCancellationBlocker({ ...issued, status: 'draft' })).toContain('gelöscht');
    expect(getCancellationBlocker({ ...issued, cancelsInvoiceId: 'x' })).toContain('Stornorechnung');
    expect(getCancellationBlocker({ ...issued, status: 'cancelled' })).toContain('bereits storniert');
    expect(getCancellationBlocker({ ...issued, alreadyCancelled: true })).toContain('bereits storniert');
  });
});

describe('buildCancellationLines', () => {
  const original: CancellableLine[] = [
    { description: 'Ölwechsel', qtyMilli: 1_000, unitPriceCents: 8_950, taxRateBp: 1_900 },
    { description: 'Bremsscheiben', qtyMilli: 2_000, unitPriceCents: 12_345, taxRateBp: 1_900 },
  ];

  it('negates the quantity and keeps price, tax rate and order', () => {
    const lines = buildCancellationLines(original);
    expect(lines.map((line) => line.qtyMilli)).toEqual([-1_000, -2_000]);
    expect(lines.map((line) => line.unitPriceCents)).toEqual([8_950, 12_345]);
    expect(lines.every((line) => line.taxRateBp === 1_900)).toBe(true);
    expect(lines[0].description).toBe(`${STORNO_PREFIX}Ölwechsel`);
  });

  it('keeps the unit of each line', () => {
    const lines = buildCancellationLines([
      { description: 'Arbeit', qtyMilli: 1_500, unitPriceCents: 9_500, taxRateBp: 1_900, unitCode: 'HUR' },
      { description: 'Teil', qtyMilli: 1_000, unitPriceCents: 500, taxRateBp: 1_900 },
    ]);
    expect(lines[0].unitCode).toBe('HUR');
    expect(lines[1]).not.toHaveProperty('unitCode');
  });

  it('does not mutate the original lines and does not prefix twice', () => {
    const lines = buildCancellationLines(original);
    expect(original[0].qtyMilli).toBe(1_000);
    expect(buildCancellationLines(lines)[0].description).toBe(`${STORNO_PREFIX}Ölwechsel`);
  });

  it('never produces negative zero', () => {
    const [line] = buildCancellationLines([{ description: 'x', qtyMilli: 0, unitPriceCents: 100, taxRateBp: 0 }]);
    expect(Object.is(line.qtyMilli, 0)).toBe(true);
  });
});

describe('original and cancellation always add up to zero', () => {
  function assertPairIsZero(original: CancellableLine[]) {
    const before = invoiceTotals(original);
    const after = invoiceTotals(buildCancellationLines(original));
    expect(after.netCents).toBe(0 - before.netCents);
    expect(after.taxCents).toBe(0 - before.taxCents);
    expect(after.grossCents).toBe(0 - before.grossCents);
    expect(before.netCents + after.netCents).toBe(0);
    expect(before.taxCents + after.taxCents).toBe(0);
    expect(before.grossCents + after.grossCents).toBe(0);
    after.groups.forEach((group, index) => {
      expect(group.netCents).toBe(0 - before.groups[index].netCents);
      expect(group.taxCents).toBe(0 - before.groups[index].taxCents);
    });
  }

  it('rounds a half cent away from zero in both directions (0.5 cent -> 1 cent, -0.5 cent -> -1 cent)', () => {
    // 0.5 * 0.01 EUR ... qty 500 milli x 1 cent = 0.5 cent -> rounds to 1 cent; the Storno gives -1 cent.
    const original: CancellableLine[] = [{ description: 'Kleinteil', qtyMilli: 500, unitPriceCents: 1, taxRateBp: 0 }];
    expect(invoiceTotals(original).netCents).toBe(1);
    expect(invoiceTotals(buildCancellationLines(original)).netCents).toBe(-1);
    assertPairIsZero(original);
  });

  it('is symmetric for the tax of a half cent', () => {
    // net 50 cents x 19 % = 9.5 cents -> 10 cents; Storno: -50 x 19 % = -9.5 -> -10
    const original: CancellableLine[] = [{ description: 'Teil', qtyMilli: 1_000, unitPriceCents: 50, taxRateBp: 1_900 }];
    expect(invoiceTotals(original).taxCents).toBe(10);
    expect(invoiceTotals(buildCancellationLines(original)).taxCents).toBe(-10);
    assertPairIsZero(original);
  });

  it('is symmetric with mixed tax rates, fractional quantities and many small lines', () => {
    const original: CancellableLine[] = [
      { description: 'Arbeit', qtyMilli: 1_250, unitPriceCents: 9_500, taxRateBp: 1_900 },
      { description: 'Buch', qtyMilli: 3_000, unitPriceCents: 333, taxRateBp: 700 },
      { description: 'Spende', qtyMilli: 1_000, unitPriceCents: 2_500, taxRateBp: 0 },
      ...Array.from({ length: 25 }, (_, index) => ({
        description: `Schraube ${index}`,
        qtyMilli: 333 + index,
        unitPriceCents: 7 + index,
        taxRateBp: 1_900,
      })),
    ];
    assertPairIsZero(original);
  });

  it('holds for a spread of generated lines', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const line: CancellableLine = {
        description: `L${seed}`,
        qtyMilli: (seed * 137) % 9_999 + 1,
        unitPriceCents: (seed * 7_919) % 100_000,
        taxRateBp: [0, 700, 1_900][seed % 3],
      };
      assertPairIsZero([line, { ...line, description: 'zweite', qtyMilli: line.qtyMilli + 1 }]);
    }
  });
});
