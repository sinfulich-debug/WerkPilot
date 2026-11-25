import { describe, expect, it } from 'vitest';
import type { Absence } from './absences';
import type { Appointment } from './appointments';
import { DEFAULT_CALENDAR_SETTINGS } from './calendar-settings';
import { formatUtilizationHours, getUtilization, sumUtilization } from './utilization';

const settings = DEFAULT_CALENDAR_SETTINGS; // 08:00-17:00, lunch 12:00-13:00 => 480 min per worker
const max = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const eva = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const tuesday = '2026-11-17';

function appointment(time: string, durationMinutes: number, date = tuesday): Appointment {
  return {
    id: `${date}-${time}`, date, time, durationMinutes, bay: 'Reifen 1', customer: 'A', vehicle: 'V', plate: 'P',
    reason: 'R', status: 'Bestätigt', tone: 'success',
  };
}

describe('getUtilization', () => {
  it('divides booked minutes by working time minus lunch', () => {
    const result = getUtilization({ date: tuesday, appointments: [appointment('09:00', 120)], workers: [max], settings, absences: [] });
    expect(result).toEqual({ bookedMinutes: 120, availableMinutes: 480, percent: 25 });
  });

  it('adds up the capacity of several mechanics', () => {
    const result = getUtilization({ date: tuesday, appointments: [appointment('09:00', 240)], workers: [max, eva], settings, absences: [] });
    expect(result).toMatchObject({ availableMinutes: 960, percent: 25 });
  });

  it('removes a mechanic who is away from the capacity', () => {
    const absences: Absence[] = [{ id: '1', mechanicId: eva, startDate: tuesday, endDate: tuesday, type: 'Krank' }];
    const result = getUtilization({ date: tuesday, appointments: [appointment('09:00', 240)], workers: [max, eva], settings, absences });
    expect(result).toMatchObject({ availableMinutes: 480, percent: 50 });
  });

  it('has no capacity when everybody is away, and no percentage', () => {
    const absences: Absence[] = [{ id: '1', mechanicId: max, startDate: '2026-11-16', endDate: '2026-11-20', type: 'Urlaub' }];
    expect(getUtilization({ date: tuesday, appointments: [], workers: [max], settings, absences })).toEqual({
      bookedMinutes: 0, availableMinutes: 0, percent: null,
    });
  });

  it('has no capacity on a public holiday of the Bundesland, but only there', () => {
    const saxony = { ...settings, bundesland: 'SN' as const };
    const holiday = '2026-11-18'; // Buß- und Bettag
    expect(getUtilization({ date: holiday, appointments: [], workers: [undefined], settings: saxony, absences: [] }).percent).toBeNull();
    expect(getUtilization({ date: holiday, appointments: [], workers: [undefined], settings, absences: [] }).percent).toBe(0);
  });

  it('only counts the part of an appointment inside working hours', () => {
    const result = getUtilization({ date: tuesday, appointments: [appointment('07:00', 120)], workers: [max], settings, absences: [] });
    expect(result.bookedMinutes).toBe(60);
  });

  it('can exceed 100 percent when overbooked', () => {
    const result = getUtilization({ date: tuesday, appointments: [appointment('08:00', 540), appointment('09:00', 60)], workers: [max], settings, absences: [] });
    expect(result.percent).toBe(Math.round((600 / 480) * 100));
  });

  it('ignores appointments of other days and handles an empty worker list', () => {
    const other = appointment('09:00', 600, '2026-11-18');
    expect(getUtilization({ date: tuesday, appointments: [other], workers: [max], settings, absences: [] }).bookedMinutes).toBe(0);
    expect(getUtilization({ date: tuesday, appointments: [], workers: [], settings, absences: [] })).toMatchObject({ availableMinutes: 0, percent: null });
  });

  it('treats a weekend as closed unless something is booked on it', () => {
    const saturday = '2026-11-21';
    expect(getUtilization({ date: saturday, appointments: [], workers: [max], settings, absences: [] }).availableMinutes).toBe(0);
    const open = getUtilization({ date: saturday, appointments: [appointment('09:00', 120, saturday)], workers: [max], settings, absences: [] });
    expect(open).toMatchObject({ availableMinutes: 480, percent: 25 });
  });

  it('works without lunch break', () => {
    const noLunch = { ...settings, lunchStart: '12:00', lunchEnd: '12:00' };
    expect(getUtilization({ date: tuesday, appointments: [], workers: [max], settings: noLunch, absences: [] }).availableMinutes).toBe(540);
  });
});

describe('week total', () => {
  it('sums booked and available minutes over the days', () => {
    const days = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];
    const appointments = [appointment('09:00', 480, '2026-11-16'), appointment('09:00', 240, '2026-11-17')];
    const week = sumUtilization(days.map((date) => getUtilization({ date, appointments, workers: [max], settings, absences: [] })));
    // five working days of 480 minutes, weekend closed: 720 of 2400 minutes
    expect(week).toEqual({ bookedMinutes: 720, availableMinutes: 2400, percent: 30 });
  });

  it('is null for an empty list', () => {
    expect(sumUtilization([]).percent).toBeNull();
  });

  it('formats hours for a tooltip in German', () => {
    expect(formatUtilizationHours({ bookedMinutes: 330, availableMinutes: 480, percent: 69 })).toBe('5,5 von 8 Std.');
  });
});
