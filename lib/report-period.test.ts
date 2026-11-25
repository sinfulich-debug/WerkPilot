import { describe, expect, it } from 'vitest';
import { getPresetPeriod, parseReportPeriod, ReportPeriodError } from './report-period';

describe('parseReportPeriod', () => {
  it('accepts a valid period, including a single day', () => {
    expect(parseReportPeriod('2026-11-01', '2026-11-30')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(parseReportPeriod('2026-11-17', '2026-11-17')).toEqual({ from: '2026-11-17', to: '2026-11-17' });
  });

  it('rejects missing, malformed and impossible dates with a German message', () => {
    expect(() => parseReportPeriod(null, '2026-11-30')).toThrow('Startdatum muss im Format');
    expect(() => parseReportPeriod('2026-11-01', '30.11.2026')).toThrow('Enddatum muss im Format');
    expect(() => parseReportPeriod('2026-02-31', '2026-03-01')).toThrow('kein gültiges Datum');
    expect(() => parseReportPeriod('2026-11-01', undefined)).toThrow(ReportPeriodError);
  });

  it('rejects an end before the start', () => {
    expect(() => parseReportPeriod('2026-11-30', '2026-11-01')).toThrow('nicht vor dem Startdatum');
  });

  it('limits a period to 366 days counting both ends', () => {
    expect(parseReportPeriod('2026-01-01', '2027-01-01').to).toBe('2027-01-01'); // 366 days
    expect(() => parseReportPeriod('2026-01-01', '2027-01-02')).toThrow('höchstens 366 Tage');
  });
});

describe('getPresetPeriod', () => {
  it('gives this month and last month, also in February and across the new year', () => {
    expect(getPresetPeriod('this-month', '2026-11-17')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(getPresetPeriod('this-month', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(getPresetPeriod('last-month', '2026-11-17')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(getPresetPeriod('last-month', '2026-01-05')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(getPresetPeriod('this-month', '2026-12-31')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('gives this and last quarter, also across the new year', () => {
    expect(getPresetPeriod('this-quarter', '2026-11-17')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(getPresetPeriod('this-quarter', '2026-03-31')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(getPresetPeriod('last-quarter', '2026-11-17')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(getPresetPeriod('last-quarter', '2026-02-01')).toEqual({ from: '2025-10-01', to: '2025-12-31' });
  });

  it('gives this and last year', () => {
    expect(getPresetPeriod('this-year', '2026-11-17')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(getPresetPeriod('last-year', '2026-11-17')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });

  it('every preset is a valid period', () => {
    for (const preset of ['this-month', 'last-month', 'this-quarter', 'last-quarter', 'this-year', 'last-year'] as const) {
      const period = getPresetPeriod(preset, '2026-11-17');
      expect(() => parseReportPeriod(period.from, period.to)).not.toThrow();
    }
  });
});
