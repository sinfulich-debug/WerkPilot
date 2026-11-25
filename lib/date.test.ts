import { describe, expect, it } from 'vitest';
import {
  addDaysToDateString,
  getDateStringInTimeZone,
  getTimeStringInTimeZone,
  getYearInTimeZone,
  INVOICE_TIME_ZONE,
  isAfterTodayInTimeZone,
} from './date';

describe('isAfterTodayInTimeZone', () => {
  const now = new Date('2026-11-18T22:30:00.000Z'); // 23:30 in Berlin, 18.11.

  it('compares Berlin calendar days, not UTC instants', () => {
    expect(isAfterTodayInTimeZone(new Date('2026-11-18T22:59:00.000Z'), now)).toBe(false); // 23:59 Berlin
    expect(isAfterTodayInTimeZone(new Date('2026-11-18T23:00:00.000Z'), now)).toBe(true); // 00:00 Berlin, 19.11.
    expect(isAfterTodayInTimeZone(new Date('2026-11-17T23:00:00.000Z'), now)).toBe(false); // 00:00 Berlin, 18.11.
  });

  it('handles the summer time switch and the year boundary', () => {
    const summerNow = new Date('2026-07-01T21:30:00.000Z'); // 23:30 Berlin (UTC+2)
    expect(isAfterTodayInTimeZone(new Date('2026-07-01T21:59:00.000Z'), summerNow)).toBe(false);
    expect(isAfterTodayInTimeZone(new Date('2026-07-01T22:00:00.000Z'), summerNow)).toBe(true);
    const newYearsEve = new Date('2026-12-31T22:00:00.000Z'); // 23:00 Berlin
    expect(isAfterTodayInTimeZone(new Date('2026-12-31T23:00:00.000Z'), newYearsEve)).toBe(true); // 01.01.2027 Berlin
  });

  it('rejects an invalid date instead of silently allowing it', () => {
    expect(() => isAfterTodayInTimeZone(new Date('kaputt'), now)).toThrow(RangeError);
  });
});

describe('invoice calendar dates', () => {
  it('uses the Berlin calendar date and year across the UTC year boundary', () => {
    const instant = new Date('2025-12-31T23:30:00.000Z');

    expect(getDateStringInTimeZone(instant, INVOICE_TIME_ZONE)).toBe('2026-01-01');
    expect(getYearInTimeZone(instant, INVOICE_TIME_ZONE)).toBe(2026);
  });

  it('adds due-date offsets as calendar days across daylight-saving changes', () => {
    expect(addDaysToDateString('2026-03-22', 14)).toBe('2026-04-05');
  });

  it('reads the Berlin clock across standard time and daylight saving', () => {
    expect(getTimeStringInTimeZone(new Date('2026-01-15T08:30:00.000Z'), INVOICE_TIME_ZONE)).toBe('09:30');
    expect(getTimeStringInTimeZone(new Date('2026-07-15T08:30:00.000Z'), INVOICE_TIME_ZONE)).toBe('10:30');
    expect(getTimeStringInTimeZone(new Date('2026-11-16T23:30:00.000Z'), INVOICE_TIME_ZONE)).toBe('00:30');
  });

  it('rejects invalid dates and non-integer offsets', () => {
    expect(() => addDaysToDateString('2026-02-31', 14)).toThrow(RangeError);
    expect(() => addDaysToDateString('2026-03-22', 1.5)).toThrow(RangeError);
    expect(() => getYearInTimeZone(new Date(Number.NaN), INVOICE_TIME_ZONE)).toThrow(RangeError);
  });
});
