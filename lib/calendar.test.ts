import { describe, expect, it } from 'vitest';
import { calendarBounds, LUNCH_END, LUNCH_START, WORKDAY_END, WORKDAY_START } from './calendar-config';
import {
  availableMinutes,
  buildDaySlots,
  eventsOverlap,
  formatLongGermanDateWithWeekday,
  formatWeekRange,
  getIsoWeek,
  getIsoWeekDates,
  getIsoWeekNumber,
  getIsoWeekStart,
  getNowMarker,
  getWeekdayLabel,
  layoutDayAppointments,
  layoutOverlappingEvents,
  mergeIntervals,
  parseTimeToMinutes,
  snapMinutes,
  utilizationPercent,
} from './calendar';

describe('ISO week', () => {
  it('numbers weeks by the Thursday rule, including week 53 and the next year', () => {
    expect(getIsoWeekNumber('2005-01-01')).toBe(53);
    expect(getIsoWeekNumber('2005-01-02')).toBe(53);
    expect(getIsoWeekNumber('2005-01-03')).toBe(1);
    expect(getIsoWeekNumber('2008-12-29')).toBe(1);
    expect(getIsoWeekNumber('2009-12-31')).toBe(53);
    expect(getIsoWeekNumber('2026-11-09')).toBe(46);
  });

  it('starts the week on Monday and labels Mo–So', () => {
    expect(getIsoWeekStart('2026-11-12')).toBe('2026-11-09');
    expect(getIsoWeekStart('2026-11-15')).toBe('2026-11-09');
    expect(getIsoWeekDates('2026-11-15')).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
    ]);
    expect(getWeekdayLabel('2026-11-09')).toBe('Mo');
    expect(getWeekdayLabel('2026-11-15')).toBe('So');
    expect(getIsoWeekStart('2026-01-01')).toBe('2025-12-29');
  });

  it('rejects a calendar date that does not exist', () => {
    expect(() => getIsoWeekNumber('2026-02-31')).toThrow(RangeError);
    expect(() => parseTimeToMinutes('24:00')).toThrow(RangeError);
  });
});

describe('ISO week with year', () => {
  it('returns the year the week belongs to, which can differ from the calendar year', () => {
    expect(getIsoWeek('2024-12-30')).toEqual({ year: 2025, week: 1 });
    expect(getIsoWeek('2021-01-03')).toEqual({ year: 2020, week: 53 });
    expect(getIsoWeek('2026-11-09')).toEqual({ year: 2026, week: 46 });
    expect(getIsoWeek('2026-11-15')).toEqual({ year: 2026, week: 46 });
  });
});

describe('snapMinutes', () => {
  it('rounds to the nearest 15 minutes, halves up', () => {
    expect(snapMinutes(0)).toBe(0);
    expect(snapMinutes(7)).toBe(0);
    expect(snapMinutes(8)).toBe(15);
    expect(snapMinutes(7.5)).toBe(15);
    expect(snapMinutes(9 * 60 + 22)).toBe(9 * 60 + 15);
    expect(snapMinutes(9 * 60 + 23)).toBe(9 * 60 + 30);
    expect(snapMinutes(50, 30)).toBe(60);
  });

  it('rejects bad input', () => {
    expect(() => snapMinutes(Number.NaN)).toThrow(RangeError);
    expect(() => snapMinutes(10, 0)).toThrow(RangeError);
    expect(() => snapMinutes(10, 7.5)).toThrow(RangeError);
  });
});

describe('mergeIntervals', () => {
  it('joins overlapping and touching ranges and sorts the result', () => {
    expect(
      mergeIntervals([
        { startMinutes: 600, endMinutes: 660 },
        { startMinutes: 480, endMinutes: 540 },
        { startMinutes: 540, endMinutes: 570 },
        { startMinutes: 560, endMinutes: 590 },
      ]),
    ).toEqual([
      { startMinutes: 480, endMinutes: 590 },
      { startMinutes: 600, endMinutes: 660 },
    ]);
  });

  it('keeps a range that sits inside another one absorbed, drops empty ranges and does not change the input', () => {
    const input = [
      { startMinutes: 480, endMinutes: 720 },
      { startMinutes: 500, endMinutes: 520 },
      { startMinutes: 900, endMinutes: 900 },
    ];
    expect(mergeIntervals(input)).toEqual([{ startMinutes: 480, endMinutes: 720 }]);
    expect(input[0]).toEqual({ startMinutes: 480, endMinutes: 720 });
    expect(mergeIntervals([])).toEqual([]);
  });

  it('rejects a range that ends before it starts', () => {
    expect(() => mergeIntervals([{ startMinutes: 100, endMinutes: 50 }])).toThrow(RangeError);
  });
});

describe('availableMinutes and utilizationPercent', () => {
  const workday = { startMinutes: 8 * 60, endMinutes: 17 * 60 };
  const lunch = { startMinutes: 12 * 60, endMinutes: 13 * 60 };

  it('subtracts the lunch break from the working day', () => {
    expect(availableMinutes(workday)).toBe(540);
    expect(availableMinutes(workday, [lunch])).toBe(480);
  });

  it('counts overlapping absences only once and ignores the part outside working hours', () => {
    const morningOff = { startMinutes: 7 * 60, endMinutes: 10 * 60 };
    const overlapsLunch = { startMinutes: 11 * 60 + 30, endMinutes: 13 * 60 + 30 };
    // free: 10:00-11:30 (90) + 13:30-17:00 (210) = 300
    expect(availableMinutes(workday, [lunch, morningOff, overlapsLunch])).toBe(300);
  });

  it('returns 0 when the whole day is blocked', () => {
    expect(availableMinutes(workday, [{ startMinutes: 0, endMinutes: 24 * 60 }])).toBe(0);
  });

  it('calculates the booked share as a whole percent', () => {
    expect(utilizationPercent(240, 480)).toBe(50);
    expect(utilizationPercent(0, 480)).toBe(0);
    expect(utilizationPercent(1, 3)).toBe(33);
    expect(utilizationPercent(2, 3)).toBe(67);
    expect(utilizationPercent(600, 480)).toBe(125);
  });

  it('returns 0 instead of dividing by zero when nothing is available', () => {
    expect(utilizationPercent(120, 0)).toBe(0);
    expect(() => utilizationPercent(-1, 480)).toThrow(RangeError);
  });
});

describe('week range label', () => {
  it('formats the visible week in German', () => {
    expect(formatWeekRange('2026-11-09', '2026-11-15')).toBe('9. November 2026 – 15. November 2026');
    expect(formatLongGermanDateWithWeekday('2026-11-16')).toBe('Montag, 16. November 2026');
  });
});

describe('visual overlap', () => {
  it('treats touching endpoints as separate and contained ranges as overlapping', () => {
    const morning = { id: 'a', startMinutes: 9 * 60, endMinutes: 10 * 60 };
    const next = { id: 'b', startMinutes: 10 * 60, endMinutes: 11 * 60 };
    const inside = { id: 'c', startMinutes: 9 * 60 + 15, endMinutes: 9 * 60 + 45 };

    expect(eventsOverlap(morning, next)).toBe(false);
    expect(eventsOverlap(morning, inside)).toBe(true);
    expect(eventsOverlap(inside, morning)).toBe(true);
  });

  it('splits the day column only while appointments are beside each other', () => {
    const placed = layoutOverlappingEvents([
      { id: 'bay-1', startMinutes: 8 * 60, endMinutes: 10 * 60 },
      { id: 'bay-2', startMinutes: 9 * 60, endMinutes: 11 * 60 },
      { id: 'later', startMinutes: 13 * 60, endMinutes: 14 * 60 },
    ]);

    expect(placed.find((item) => item.id === 'bay-1')).toMatchObject({ column: 0, columnSpan: 1, columnCount: 2 });
    expect(placed.find((item) => item.id === 'bay-2')).toMatchObject({ column: 1, columnSpan: 1, columnCount: 2 });
    expect(placed.find((item) => item.id === 'later')).toMatchObject({ column: 0, columnSpan: 1, columnCount: 1 });
  });

  it('reuses a free column and lets a later appointment grow into the gap', () => {
    const placed = layoutOverlappingEvents([
      { id: 'long', startMinutes: 60, endMinutes: 600 },
      { id: 'left', startMinutes: 60, endMinutes: 120 },
      { id: 'right', startMinutes: 60, endMinutes: 120 },
      { id: 'after', startMinutes: 480, endMinutes: 540 },
    ]);

    expect(placed.find((item) => item.id === 'long')).toMatchObject({ column: 0, columnSpan: 1, columnCount: 3 });
    expect(placed.find((item) => item.id === 'left')).toMatchObject({ column: 1, columnSpan: 1, columnCount: 3 });
    expect(placed.find((item) => item.id === 'right')).toMatchObject({ column: 2, columnSpan: 1, columnCount: 3 });
    expect(placed.find((item) => item.id === 'after')).toMatchObject({ column: 1, columnSpan: 2, columnCount: 3 });
  });

  it('rejects an interval that ends before it starts', () => {
    expect(() => layoutOverlappingEvents([{ id: 'bad', startMinutes: 120, endMinutes: 60 }])).toThrow(RangeError);
  });
});

describe('day card layout', () => {
  const grid = { gridStart: '06:00', gridEnd: '20:00' };

  it('positions a card by its share of the visible day', () => {
    expect(layoutDayAppointments([{ id: 'x', time: '09:00', durationMinutes: 60 }], grid)).toEqual([
      {
        id: 'x',
        column: 0,
        columnSpan: 1,
        columnCount: 1,
        topPercent: (3 / 14) * 100,
        heightPercent: (1 / 14) * 100,
      },
    ]);
  });

  it('clips cards to the grid and ignores appointments that never enter it', () => {
    const placed = layoutDayAppointments(
      [
        { id: 'early', time: '05:00', durationMinutes: 90 },
        { id: 'hidden', time: '04:00', durationMinutes: 60 },
        { id: 'late', time: '19:00', durationMinutes: 180 },
        { id: 'bad', time: '9:00', durationMinutes: 30 },
        { id: 'empty', time: '10:00', durationMinutes: 0 },
      ],
      grid,
    );

    expect(placed.map((item) => item.id)).toEqual(['early', 'late']);
    expect(placed.find((item) => item.id === 'early')).toMatchObject({
      topPercent: 0,
      heightPercent: (30 / (14 * 60)) * 100,
    });
    expect(placed.find((item) => item.id === 'late')).toMatchObject({
      topPercent: (13 / 14) * 100,
      heightPercent: (1 / 14) * 100,
    });
  });

  it('shares width only for the part that is visible at the same time', () => {
    const placed = layoutDayAppointments(
      [
        { id: 'a', time: '05:00', durationMinutes: 90 },
        { id: 'b', time: '06:15', durationMinutes: 30 },
      ],
      grid,
    );

    expect(placed).toHaveLength(2);
    expect(placed.every((item) => item.columnCount === 2)).toBe(true);
  });
});

describe('working hours and lunch', () => {
  it('keeps the workshop day and the lunch break as fixed bounds', () => {
    expect(WORKDAY_START).toBe('08:00');
    expect(WORKDAY_END).toBe('17:00');
    expect(LUNCH_START).toBe('12:00');
    expect(LUNCH_END).toBe('13:00');
  });

  it('builds a 15-minute grid from 06:00 to 20:00 and shades closed time and lunch', () => {
    const slots = buildDaySlots(calendarBounds);

    expect(slots).toHaveLength(56);
    expect(slots[0]).toMatchObject({ time: '06:00', tone: 'outside', isHourStart: true });
    expect(slots.find((slot) => slot.time === '07:45')?.tone).toBe('outside');
    expect(slots.find((slot) => slot.time === '08:00')).toMatchObject({ tone: 'work', isHourStart: true });
    expect(slots.find((slot) => slot.time === '11:45')?.tone).toBe('work');
    expect(slots.find((slot) => slot.time === '12:00')?.tone).toBe('lunch');
    expect(slots.find((slot) => slot.time === '12:45')?.tone).toBe('lunch');
    expect(slots.find((slot) => slot.time === '13:00')?.tone).toBe('work');
    expect(slots.find((slot) => slot.time === '16:45')?.tone).toBe('work');
    expect(slots.find((slot) => slot.time === '17:00')?.tone).toBe('outside');
    expect(slots.at(-1)).toMatchObject({ time: '19:45', tone: 'outside', isHourStart: false });
    expect(() => buildDaySlots({ ...calendarBounds, slotMinutes: 0 })).toThrow(RangeError);
  });
});

describe('now line', () => {
  it('uses the Berlin clock and hides the line outside the grid', () => {
    expect(getNowMarker(new Date('2026-11-16T08:30:00.000Z'), 'Europe/Berlin', '06:00', '20:00')).toEqual({
      date: '2026-11-16',
      topPercent: (210 / 840) * 100,
    });
    expect(getNowMarker(new Date('2026-07-16T08:30:00.000Z'), 'Europe/Berlin', '06:00', '20:00')).toEqual({
      date: '2026-07-16',
      topPercent: (270 / 840) * 100,
    });
    expect(getNowMarker(new Date('2026-11-16T05:00:00.000Z'), 'Europe/Berlin', '06:00', '20:00')).toEqual({
      date: '2026-11-16',
      topPercent: 0,
    });
    expect(getNowMarker(new Date('2026-11-16T19:00:00.000Z'), 'Europe/Berlin', '06:00', '20:00')).toEqual({
      date: '2026-11-16',
      topPercent: 100,
    });
    expect(getNowMarker(new Date('2026-11-16T04:30:00.000Z'), 'Europe/Berlin', '06:00', '20:00')).toBeNull();
    expect(getNowMarker(new Date('2026-11-16T19:30:00.000Z'), 'Europe/Berlin', '06:00', '20:00')).toBeNull();
  });
});
