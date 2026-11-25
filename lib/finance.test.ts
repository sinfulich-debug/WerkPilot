import { describe, expect, it } from 'vitest';
import { euroToCents, getInvoiceTotals, quantityToMilli } from './finance';

describe('finance amount conversions', () => {
  it('converts quantities and euro amounts to integer database units', () => {
    expect(quantityToMilli(1.25)).toBe(1_250);
    expect(euroToCents(12.5)).toBe(1_250);
  });

  it('calculates tax after grouping net amounts by rate', () => {
    expect(getInvoiceTotals([
      { id: 'one', description: 'A', quantity: 1, unitPrice: 0.03 },
      { id: 'two', description: 'B', quantity: 1, unitPrice: 0.03 },
    ], 'standard19')).toEqual({ net: 0.06, tax: 0.01, gross: 0.07 });
  });

  it('keeps negative quantities so a Storno shows the exact negative of the original', () => {
    const original = [
      { id: '1', description: 'A', quantity: 1, unitPrice: 0.5 },
      { id: '2', description: 'B', quantity: 2.5, unitPrice: 19.99 },
    ];
    const storno = original.map((line) => ({ ...line, quantity: -line.quantity }));
    const before = getInvoiceTotals(original, 'standard19');
    const after = getInvoiceTotals(storno, 'standard19');

    expect(after.gross).toBeLessThan(0);
    expect(after.net).toBe(-before.net);
    expect(after.tax).toBe(-before.tax);
    expect(after.gross).toBe(-before.gross);
    expect(Math.round((before.gross + after.gross) * 100)).toBe(0);
  });

  it('ignores lines with quantity zero', () => {
    expect(getInvoiceTotals([{ id: '1', description: 'A', quantity: 0, unitPrice: 5 }], 'standard19')).toEqual({
      net: 0,
      tax: 0,
      gross: 0,
    });
  });

  it('rejects precision and values that do not fit PostgreSQL integer columns', () => {
    expect(() => quantityToMilli(0.0001)).toThrow(RangeError);
    expect(() => euroToCents(1.234)).toThrow(RangeError);
    expect(() => euroToCents(21_474_836.48)).toThrow(RangeError);
  });
});
