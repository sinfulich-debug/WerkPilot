import { describe, expect, it } from 'vitest';
import {
  CalendarSettingsError,
  DEFAULT_CALENDAR_SETTINGS,
  getLunchBreaks,
  getWorkWindow,
  parseCalendarSettings,
  toCalendarBounds,
} from './calendar-settings';
import { availableMinutes } from './calendar';
import { LUNCH_END, LUNCH_START, WORKDAY_END, WORKDAY_START } from './calendar-config';

describe('parseCalendarSettings', () => {
  it('accepts the defaults and they match the fixed calendar constants', () => {
    expect(parseCalendarSettings(DEFAULT_CALENDAR_SETTINGS)).toEqual(DEFAULT_CALENDAR_SETTINGS);
    expect(DEFAULT_CALENDAR_SETTINGS.workStart).toBe(WORKDAY_START);
    expect(DEFAULT_CALENDAR_SETTINGS.workEnd).toBe(WORKDAY_END);
    expect(DEFAULT_CALENDAR_SETTINGS.lunchStart).toBe(LUNCH_START);
    expect(DEFAULT_CALENDAR_SETTINGS.lunchEnd).toBe(LUNCH_END);
  });

  it('rejects an unknown Bundesland and bad times', () => {
    expect(() => parseCalendarSettings({ ...DEFAULT_CALENDAR_SETTINGS, bundesland: 'XX' })).toThrow('Bundesland');
    expect(() => parseCalendarSettings({ ...DEFAULT_CALENDAR_SETTINGS, workStart: '8:00' })).toThrow('HH:MM');
    expect(() => parseCalendarSettings({ ...DEFAULT_CALENDAR_SETTINGS, lunchEnd: '25:00' })).toThrow('HH:MM');
    expect(() => parseCalendarSettings(undefined)).toThrow(CalendarSettingsError);
  });

  it('keeps the hours in a sensible order inside the visible grid', () => {
    expect(() => parseCalendarSettings({ ...DEFAULT_CALENDAR_SETTINGS, workStart: '17:00', workEnd: '08:00' })).toThrow(
      'vor dem Arbeitsende',
    );
    expect(() => parseCalendarSettings({ ...DEFAULT_CALENDAR_SETTINGS, workStart: '05:00' })).toThrow('06:00 und 20:00');
    expect(() => parseCalendarSettings({ ...DEFAULT_CALENDAR_SETTINGS, workEnd: '21:00' })).toThrow('06:00 und 20:00');
    expect(() => parseCalendarSettings({ ...DEFAULT_CALENDAR_SETTINGS, lunchStart: '13:00', lunchEnd: '12:00' })).toThrow(
      'nicht vor ihrem Beginn',
    );
    expect(() => parseCalendarSettings({ ...DEFAULT_CALENDAR_SETTINGS, lunchStart: '16:30', lunchEnd: '17:30' })).toThrow(
      'innerhalb der Arbeitszeit',
    );
  });

  it('allows a workshop without lunch break', () => {
    const settings = parseCalendarSettings({ ...DEFAULT_CALENDAR_SETTINGS, lunchStart: '12:00', lunchEnd: '12:00' });
    expect(getLunchBreaks(settings)).toEqual([]);
  });
});

describe('derived values', () => {
  it('builds grid bounds from the workshop hours', () => {
    const bounds = toCalendarBounds({ ...DEFAULT_CALENDAR_SETTINGS, workStart: '07:30', workEnd: '16:00' });
    expect(bounds).toMatchObject({ gridStart: '06:00', gridEnd: '20:00', slotMinutes: 15, workStart: '07:30', workEnd: '16:00' });
  });

  it('gives the working window and lunch for the available-minutes calculation', () => {
    expect(getWorkWindow(DEFAULT_CALENDAR_SETTINGS)).toEqual({ startMinutes: 480, endMinutes: 1020 });
    expect(getLunchBreaks(DEFAULT_CALENDAR_SETTINGS)).toEqual([{ startMinutes: 720, endMinutes: 780 }]);
    expect(availableMinutes(getWorkWindow(DEFAULT_CALENDAR_SETTINGS), getLunchBreaks(DEFAULT_CALENDAR_SETTINGS))).toBe(480);
  });
});
