import { describe, expect, it } from 'vitest';
import { BUNDESLAENDER, getBussUndBettag, getEasterSunday, getHolidayName, getHolidays } from './holidays';

describe('Easter Sunday', () => {
  it('matches the known reference dates', () => {
    expect(getEasterSunday(2024)).toBe('2024-03-31');
    expect(getEasterSunday(2025)).toBe('2025-04-20');
    expect(getEasterSunday(2026)).toBe('2026-04-05');
    expect(getEasterSunday(2027)).toBe('2027-03-28');
  });

  it('handles the earliest and latest possible Easter', () => {
    expect(getEasterSunday(1818)).toBe('1818-03-22');
    expect(getEasterSunday(1943)).toBe('1943-04-25');
  });

  it('rejects years outside the Gregorian calendar', () => {
    expect(() => getEasterSunday(1500)).toThrow(RangeError);
    expect(() => getEasterSunday(2026.5)).toThrow(RangeError);
  });
});

describe('Buß- und Bettag', () => {
  it('is the Wednesday before 23 November', () => {
    expect(getBussUndBettag(2026)).toBe('2026-11-18');
    expect(getBussUndBettag(2025)).toBe('2025-11-19');
    expect(getBussUndBettag(2024)).toBe('2024-11-20');
    // 22 November itself is a Wednesday: it counts.
    expect(getBussUndBettag(2023)).toBe('2023-11-22');
    // 23 November is a Wednesday: the one a week earlier counts.
    expect(getBussUndBettag(2022)).toBe('2022-11-16');
  });

  it('is a holiday only in Saxony', () => {
    expect(getHolidayName('2026-11-18', 'SN')).toBe('Buß- und Bettag');
    expect(getHolidayName('2026-11-18', 'BY')).toBeNull();
  });
});

describe('holidays per Bundesland, 2026', () => {
  it('counts the statutory holidays', () => {
    expect(getHolidays(2026, 'BE')).toHaveLength(10);
    expect(getHolidays(2026, 'BY')).toHaveLength(12);
    expect(getHolidays(2026, 'BW')).toHaveLength(12);
    expect(getHolidays(2026, 'SN')).toHaveLength(11);
    expect(getHolidays(2026, 'BB')).toHaveLength(12);
    expect(getHolidays(2026, 'HH')).toHaveLength(10);
  });

  it('always includes the nine nationwide holidays, sorted and unique', () => {
    for (const state of BUNDESLAENDER) {
      const holidays = getHolidays(2026, state);
      const dates = holidays.map((holiday) => holiday.date);
      expect(holidays.length).toBeGreaterThanOrEqual(9);
      expect(dates).toEqual([...dates].sort());
      expect(new Set(dates).size).toBe(dates.length);
      expect(dates).toContain('2026-01-01');
      expect(dates).toContain('2026-12-26');
    }
  });

  it('computes the Easter-based dates', () => {
    const bavaria = getHolidays(2026, 'BY');
    const byName = (name: string) => bavaria.find((holiday) => holiday.name === name)?.date;
    expect(byName('Karfreitag')).toBe('2026-04-03');
    expect(byName('Ostermontag')).toBe('2026-04-06');
    expect(byName('Christi Himmelfahrt')).toBe('2026-05-14');
    expect(byName('Pfingstmontag')).toBe('2026-05-25');
    expect(byName('Fronleichnam')).toBe('2026-06-04');
  });

  it('lists the regional holidays only where they apply', () => {
    expect(getHolidayName('2026-01-06', 'BW')).toBe('Heilige Drei Könige');
    expect(getHolidayName('2026-01-06', 'NW')).toBeNull();
    expect(getHolidayName('2026-03-08', 'BE')).toBe('Frauentag');
    expect(getHolidayName('2026-03-08', 'BY')).toBeNull();
    expect(getHolidayName('2026-10-31', 'SN')).toBe('Reformationstag');
    expect(getHolidayName('2026-10-31', 'BY')).toBeNull();
    expect(getHolidayName('2026-11-01', 'NW')).toBe('Allerheiligen');
    expect(getHolidayName('2026-08-15', 'SL')).toBe('Mariä Himmelfahrt');
    expect(getHolidayName('2026-08-15', 'BY')).toBeNull();
    expect(getHolidayName('2026-09-20', 'TH')).toBe('Weltkindertag');
    expect(getHolidayName('2026-04-05', 'BB')).toBe('Ostersonntag');
    expect(getHolidayName('2026-04-05', 'BY')).toBeNull();
    expect(getHolidayName('2026-05-24', 'BB')).toBe('Pfingstsonntag');
  });

  it('returns null on a normal working day and rejects invalid input', () => {
    expect(getHolidayName('2026-11-16', 'BY')).toBeNull();
    expect(() => getHolidayName('2026-02-31', 'BY')).toThrow(RangeError);
    expect(() => getHolidays(2026, 'XX' as never)).toThrow(RangeError);
  });
});
