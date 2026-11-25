import { addDaysToDateString } from './date';
import { getIsoWeekday } from './calendar';

/**
 * Statutory public holidays per German Bundesland (state-wide ones only).
 *
 * Holidays that apply only in some municipalities are deliberately left out:
 * Mariä Himmelfahrt in Bavaria, Augsburger Friedensfest, Fronleichnam in parts
 * of Saxony and Thuringia, etc.
 *
 * Verify against the official sources before relying on it:
 * - Tag der Deutschen Einheit: Einigungsvertrag Art. 2 Abs. 2 (gesetze-im-internet.de)
 * - everything else: the Feiertagsgesetz of each Land (e.g. gesetze-bayern.de,
 *   landesrecht-bw.de, gesetze.berlin.de) or the Bundesinnenministerium overview.
 */

export const BUNDESLAENDER = [
  'BW',
  'BY',
  'BE',
  'BB',
  'HB',
  'HH',
  'HE',
  'MV',
  'NI',
  'NW',
  'RP',
  'SL',
  'SN',
  'ST',
  'SH',
  'TH',
] as const;

export type Bundesland = (typeof BUNDESLAENDER)[number];

export type Holiday = {
  date: string;
  name: string;
};

type RegionalHoliday =
  | 'Heilige Drei Könige'
  | 'Frauentag'
  | 'Ostersonntag'
  | 'Pfingstsonntag'
  | 'Fronleichnam'
  | 'Mariä Himmelfahrt'
  | 'Weltkindertag'
  | 'Reformationstag'
  | 'Allerheiligen'
  | 'Buß- und Bettag';

const REGIONAL_HOLIDAYS: Record<Bundesland, readonly RegionalHoliday[]> = {
  BW: ['Heilige Drei Könige', 'Fronleichnam', 'Allerheiligen'],
  BY: ['Heilige Drei Könige', 'Fronleichnam', 'Allerheiligen'],
  BE: ['Frauentag'],
  BB: ['Ostersonntag', 'Pfingstsonntag', 'Reformationstag'],
  HB: ['Reformationstag'],
  HH: ['Reformationstag'],
  HE: ['Fronleichnam'],
  MV: ['Frauentag', 'Reformationstag'],
  NI: ['Reformationstag'],
  NW: ['Fronleichnam', 'Allerheiligen'],
  RP: ['Fronleichnam', 'Allerheiligen'],
  SL: ['Fronleichnam', 'Mariä Himmelfahrt', 'Allerheiligen'],
  SN: ['Reformationstag', 'Buß- und Bettag'],
  ST: ['Heilige Drei Könige', 'Reformationstag'],
  SH: ['Reformationstag'],
  TH: ['Weltkindertag', 'Reformationstag'],
};

function fixedDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function assertYear(year: number): void {
  if (!Number.isInteger(year) || year < 1583 || year > 9999) {
    throw new RangeError('year must be an integer from 1583 (Gregorian calendar) to 9999.');
  }
}

/** Easter Sunday as YYYY-MM-DD (Meeus/Jones/Butcher algorithm, Gregorian calendar). */
export function getEasterSunday(year: number): string {
  assertYear(year);

  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return fixedDate(year, month, day);
}

/** Buß- und Bettag: the Wednesday before 23 November (so 16–22 November). */
export function getBussUndBettag(year: number): string {
  assertYear(year);
  const nov22 = fixedDate(year, 11, 22);
  const daysBack = (getIsoWeekday(nov22) - 3 + 7) % 7; // Wednesday is ISO weekday 3
  return addDaysToDateString(nov22, -daysBack);
}

function regionalHolidayDate(year: number, holiday: RegionalHoliday): string {
  const easter = getEasterSunday(year);
  switch (holiday) {
    case 'Heilige Drei Könige':
      return fixedDate(year, 1, 6);
    case 'Frauentag':
      return fixedDate(year, 3, 8);
    case 'Ostersonntag':
      return easter;
    case 'Pfingstsonntag':
      return addDaysToDateString(easter, 49);
    case 'Fronleichnam':
      return addDaysToDateString(easter, 60);
    case 'Mariä Himmelfahrt':
      return fixedDate(year, 8, 15);
    case 'Weltkindertag':
      return fixedDate(year, 9, 20);
    case 'Reformationstag':
      return fixedDate(year, 10, 31);
    case 'Allerheiligen':
      return fixedDate(year, 11, 1);
    case 'Buß- und Bettag':
      return getBussUndBettag(year);
  }
}

/** All statutory holidays of one Bundesland in a year, sorted by date. */
export function getHolidays(year: number, state: Bundesland): Holiday[] {
  assertYear(year);
  if (!BUNDESLAENDER.includes(state)) throw new RangeError('state must be a valid Bundesland code.');

  const easter = getEasterSunday(year);
  const nationwide: Holiday[] = [
    { date: fixedDate(year, 1, 1), name: 'Neujahr' },
    { date: addDaysToDateString(easter, -2), name: 'Karfreitag' },
    { date: addDaysToDateString(easter, 1), name: 'Ostermontag' },
    { date: fixedDate(year, 5, 1), name: 'Tag der Arbeit' },
    { date: addDaysToDateString(easter, 39), name: 'Christi Himmelfahrt' },
    { date: addDaysToDateString(easter, 50), name: 'Pfingstmontag' },
    { date: fixedDate(year, 10, 3), name: 'Tag der Deutschen Einheit' },
    { date: fixedDate(year, 12, 25), name: '1. Weihnachtstag' },
    { date: fixedDate(year, 12, 26), name: '2. Weihnachtstag' },
  ];
  const regional = REGIONAL_HOLIDAYS[state].map((name) => ({
    date: regionalHolidayDate(year, name),
    name,
  }));

  return [...nationwide, ...regional].sort((a, b) => a.date.localeCompare(b.date));
}

/** Name of the holiday on that date in that Bundesland, or null on a normal day. */
export function getHolidayName(dateString: string, state: Bundesland): string | null {
  const year = Number(dateString.slice(0, 4));
  addDaysToDateString(dateString, 0); // throws on an invalid date
  return getHolidays(year, state).find((holiday) => holiday.date === dateString)?.name ?? null;
}
