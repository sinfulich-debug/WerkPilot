import { describe, expect, it } from 'vitest';
import { DEFAULT_UNIT, isUnitCode, UNIT_CODES, unitForWorkOrderLine, unitLabel, UNITS } from './units';

describe('units', () => {
  it('uses the UN/ECE codes the e-invoice format needs, each with a German label', () => {
    expect(UNIT_CODES).toEqual(['C62', 'HUR', 'LS', 'SET', 'LTR', 'KGM', 'MTR']);
    for (const unit of UNITS) {
      expect(unit.code).toMatch(/^[A-Z0-9]{2,3}$/);
      expect(unit.label.length).toBeGreaterThan(0);
    }
    expect(DEFAULT_UNIT).toBe('C62');
  });

  it('knows which values are valid unit codes', () => {
    expect(isUnitCode('HUR')).toBe(true);
    expect(isUnitCode('hur')).toBe(false);
    expect(isUnitCode('XYZ')).toBe(false);
    expect(isUnitCode(undefined)).toBe(false);
    expect(isUnitCode(1)).toBe(false);
  });

  it('labels units for the invoice and falls back to the piece label', () => {
    expect(unitLabel('HUR')).toBe('Std.');
    expect(unitLabel('LS')).toBe('pauschal');
    expect(unitLabel('C62')).toBe('Stk.');
    expect(unitLabel('???')).toBe('Stk.');
    expect(unitLabel(null)).toBe('Stk.');
  });

  it('bills labor in hours and parts by the piece', () => {
    expect(unitForWorkOrderLine('labor')).toBe('HUR');
    expect(unitForWorkOrderLine('part')).toBe('C62');
  });
});
