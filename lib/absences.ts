import { addDaysToDateString } from './date';

export const ABSENCE_TYPES = ['Urlaub', 'Krank', 'Schule'] as const;
export type AbsenceType = (typeof ABSENCE_TYPES)[number];

export type Absence = {
  id: string;
  mechanicId: string;
  /** Inclusive range of calendar days (YYYY-MM-DD). */
  startDate: string;
  endDate: string;
  type: AbsenceType;
  note?: string;
};

export type AbsenceInput = Omit<Absence, 'id'>;

/** Longest absence we accept in one entry; a sanity limit against typos like the wrong year. */
export const MAX_ABSENCE_DAYS = 366;

/** Error with a message that can be shown to the user as it is (German). */
export class AbsenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AbsenceError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function readDate(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw new AbsenceError(`${label} fehlt.`);
  try {
    addDaysToDateString(value, 0);
  } catch {
    throw new AbsenceError(`${label} ist kein gültiges Datum.`);
  }
  return value;
}

function daysBetween(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

/** Validates an absence from the outside world (form or request body). */
export function parseAbsenceInput(input: unknown): AbsenceInput {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new AbsenceError('Ungültige Abwesenheit.');
  }
  const record = input as Record<string, unknown>;

  const mechanicId = record.mechanicId;
  if (typeof mechanicId !== 'string' || !UUID_PATTERN.test(mechanicId)) {
    throw new AbsenceError('Bitte wähle einen Mitarbeiter aus.');
  }

  const type = record.type;
  if (typeof type !== 'string' || !(ABSENCE_TYPES as readonly string[]).includes(type)) {
    throw new AbsenceError('Die Art der Abwesenheit ist ungültig.');
  }

  const startDate = readDate(record, 'startDate', 'Das Startdatum');
  const endDate = readDate(record, 'endDate', 'Das Enddatum');
  if (endDate < startDate) throw new AbsenceError('Das Enddatum darf nicht vor dem Startdatum liegen.');
  if (daysBetween(startDate, endDate) >= MAX_ABSENCE_DAYS) {
    throw new AbsenceError(`Eine Abwesenheit darf höchstens ${MAX_ABSENCE_DAYS} Tage dauern.`);
  }

  let note: string | undefined;
  if (record.note !== undefined && record.note !== null && record.note !== '') {
    if (typeof record.note !== 'string') throw new AbsenceError('Die Notiz ist ungültig.');
    note = record.note.trim() || undefined;
    if (note && note.length > 200) throw new AbsenceError('Die Notiz darf höchstens 200 Zeichen lang sein.');
  }

  return { mechanicId, startDate, endDate, type: type as AbsenceType, note };
}

/** All absences that cover the given day (both ends included). */
export function getAbsencesOnDate(absences: readonly Absence[], date: string): Absence[] {
  return absences.filter((absence) => absence.startDate <= date && date <= absence.endDate);
}

export function findMechanicAbsence(
  absences: readonly Absence[],
  mechanicId: string | undefined,
  date: string,
): Absence | null {
  if (!mechanicId) return null;
  return getAbsencesOnDate(absences, date).find((absence) => absence.mechanicId === mechanicId) ?? null;
}

/** Type of absence with the note, e.g. "Urlaub" or "Krank (Grippe)". */
export function describeAbsence(absence: Pick<Absence, 'type' | 'note'>): string {
  return absence.note ? `${absence.type} (${absence.note})` : absence.type;
}
