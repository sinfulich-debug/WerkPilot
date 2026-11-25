import { addDaysToDateString } from './date';

/** A reporting period of whole days, both ends included (YYYY-MM-DD, Europe/Berlin calendar days). */
export type ReportPeriod = { from: string; to: string };

/** Longest period one report may cover. */
export const MAX_PERIOD_DAYS = 366;

/** Error with a message that can be shown as it is (German). */
export class ReportPeriodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportPeriodError';
  }
}

function assertDate(value: string | null | undefined, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ReportPeriodError(`${label} muss im Format JJJJ-MM-TT angegeben werden.`);
  }
  try {
    addDaysToDateString(value, 0);
  } catch {
    throw new ReportPeriodError(`${label} ist kein gültiges Datum.`);
  }
  return value;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Validates a period from the outside world (query string). */
export function parseReportPeriod(from: string | null | undefined, to: string | null | undefined): ReportPeriod {
  const start = assertDate(from, 'Das Startdatum');
  const end = assertDate(to, 'Das Enddatum');
  if (end < start) throw new ReportPeriodError('Das Enddatum darf nicht vor dem Startdatum liegen.');
  if (daysBetween(start, end) >= MAX_PERIOD_DAYS) {
    throw new ReportPeriodError(`Ein Zeitraum darf höchstens ${MAX_PERIOD_DAYS} Tage umfassen.`);
  }
  return { from: start, to: end };
}

function lastDayOfMonth(year: number, month: number): string {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextMonthFirst = `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`;
  return addDaysToDateString(nextMonthFirst, -1);
}

export type PeriodPreset = 'this-month' | 'last-month' | 'this-quarter' | 'last-quarter' | 'this-year' | 'last-year';

export const PERIOD_PRESET_LABEL: Record<PeriodPreset, string> = {
  'this-month': 'Dieser Monat',
  'last-month': 'Letzter Monat',
  'this-quarter': 'Dieses Quartal',
  'last-quarter': 'Letztes Quartal',
  'this-year': 'Dieses Jahr',
  'last-year': 'Letztes Jahr',
};

/** The period of a preset, counted from `today` (YYYY-MM-DD in the workshop's time zone). */
export function getPresetPeriod(preset: PeriodPreset, today: string): ReportPeriod {
  assertDate(today, 'Das heutige Datum');
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const pad = (value: number) => String(value).padStart(2, '0');

  switch (preset) {
    case 'this-month':
      return { from: `${year}-${pad(month)}-01`, to: lastDayOfMonth(year, month) };
    case 'last-month': {
      const previousYear = month === 1 ? year - 1 : year;
      const previousMonth = month === 1 ? 12 : month - 1;
      return { from: `${previousYear}-${pad(previousMonth)}-01`, to: lastDayOfMonth(previousYear, previousMonth) };
    }
    case 'this-quarter':
    case 'last-quarter': {
      const quarterIndex = Math.floor((month - 1) / 3) - (preset === 'last-quarter' ? 1 : 0);
      const quarterYear = quarterIndex < 0 ? year - 1 : year;
      const normalizedIndex = (quarterIndex + 4) % 4;
      const firstMonth = normalizedIndex * 3 + 1;
      return { from: `${quarterYear}-${pad(firstMonth)}-01`, to: lastDayOfMonth(quarterYear, firstMonth + 2) };
    }
    case 'this-year':
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    case 'last-year':
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
  }
}
