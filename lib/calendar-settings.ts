import { parseTimeToMinutes, type CalendarBounds, type MinuteInterval } from './calendar';
import { CALENDAR_GRID_END, CALENDAR_GRID_START, CALENDAR_SLOT_MINUTES } from './calendar-config';
import { BUNDESLAENDER, type Bundesland } from './holidays';

export type CalendarSettings = {
  bundesland: Bundesland;
  workStart: string;
  workEnd: string;
  lunchStart: string;
  lunchEnd: string;
};

/** Same values as the database defaults in migration 0014. */
export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  bundesland: 'BW',
  workStart: '08:00',
  workEnd: '17:00',
  lunchStart: '12:00',
  lunchEnd: '13:00',
};

export const BUNDESLAND_NAMES: Record<Bundesland, string> = {
  BW: 'Baden-Württemberg',
  BY: 'Bayern',
  BE: 'Berlin',
  BB: 'Brandenburg',
  HB: 'Bremen',
  HH: 'Hamburg',
  HE: 'Hessen',
  MV: 'Mecklenburg-Vorpommern',
  NI: 'Niedersachsen',
  NW: 'Nordrhein-Westfalen',
  RP: 'Rheinland-Pfalz',
  SL: 'Saarland',
  SN: 'Sachsen',
  ST: 'Sachsen-Anhalt',
  SH: 'Schleswig-Holstein',
  TH: 'Thüringen',
};

/** Error with a message that can be shown to the user as it is (German). */
export class CalendarSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarSettingsError';
  }
}

function readTime(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new CalendarSettingsError(`${label} muss im Format HH:MM angegeben werden.`);
  }
  return value;
}

/** Validates settings from the outside world (form or request body). */
export function parseCalendarSettings(input: unknown): CalendarSettings {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new CalendarSettingsError('Ungültige Kalender-Einstellungen.');
  }
  const record = input as Record<string, unknown>;

  const bundesland = record.bundesland;
  if (typeof bundesland !== 'string' || !(BUNDESLAENDER as readonly string[]).includes(bundesland)) {
    throw new CalendarSettingsError('Bitte wähle ein gültiges Bundesland.');
  }

  const workStart = readTime(record, 'workStart', 'Der Arbeitsbeginn');
  const workEnd = readTime(record, 'workEnd', 'Das Arbeitsende');
  const lunchStart = readTime(record, 'lunchStart', 'Der Beginn der Mittagspause');
  const lunchEnd = readTime(record, 'lunchEnd', 'Das Ende der Mittagspause');

  const gridStart = parseTimeToMinutes(CALENDAR_GRID_START);
  const gridEnd = parseTimeToMinutes(CALENDAR_GRID_END);
  const work = { start: parseTimeToMinutes(workStart), end: parseTimeToMinutes(workEnd) };
  const lunch = { start: parseTimeToMinutes(lunchStart), end: parseTimeToMinutes(lunchEnd) };

  if (work.start >= work.end) {
    throw new CalendarSettingsError('Der Arbeitsbeginn muss vor dem Arbeitsende liegen.');
  }
  if (work.start < gridStart || work.end > gridEnd) {
    throw new CalendarSettingsError(
      `Die Arbeitszeit muss zwischen ${CALENDAR_GRID_START} und ${CALENDAR_GRID_END} Uhr liegen.`,
    );
  }
  if (lunch.start > lunch.end) {
    throw new CalendarSettingsError('Die Mittagspause darf nicht vor ihrem Beginn enden.');
  }
  if (lunch.end > lunch.start && (lunch.start < work.start || lunch.end > work.end)) {
    throw new CalendarSettingsError('Die Mittagspause muss innerhalb der Arbeitszeit liegen.');
  }

  return { bundesland: bundesland as Bundesland, workStart, workEnd, lunchStart, lunchEnd };
}

/** Bounds for the time grid: the fixed visible range plus this workshop's hours. */
export function toCalendarBounds(settings: CalendarSettings): CalendarBounds {
  return {
    gridStart: CALENDAR_GRID_START,
    gridEnd: CALENDAR_GRID_END,
    slotMinutes: CALENDAR_SLOT_MINUTES,
    workStart: settings.workStart,
    workEnd: settings.workEnd,
    lunchStart: settings.lunchStart,
    lunchEnd: settings.lunchEnd,
  };
}

export function getWorkWindow(settings: CalendarSettings): MinuteInterval {
  return { startMinutes: parseTimeToMinutes(settings.workStart), endMinutes: parseTimeToMinutes(settings.workEnd) };
}

/** The lunch break, or an empty list when it has no length. */
export function getLunchBreaks(settings: CalendarSettings): MinuteInterval[] {
  const lunch = { startMinutes: parseTimeToMinutes(settings.lunchStart), endMinutes: parseTimeToMinutes(settings.lunchEnd) };
  return lunch.endMinutes > lunch.startMinutes ? [lunch] : [];
}
