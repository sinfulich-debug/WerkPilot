// Tire storage (Reifenlager): validation and seasonal reminder rules. Pure functions, no database.
// A stored set belongs to a season. Winter tires are fetched in autumn (O bis O: Oktober bis Ostern),
// summer tires in spring. All-season sets get no seasonal reminder.

import { addDaysToDateString } from './date';
import { DEFAULT_WORKSHOP_NAME } from './reminders';

export const TIRE_SEASONS = ['summer', 'winter', 'allseason'] as const;
export type TireSeason = (typeof TIRE_SEASONS)[number];

export const TIRE_SEASON_LABELS: Record<TireSeason, string> = {
  summer: 'Sommerreifen',
  winter: 'Winterreifen',
  allseason: 'Ganzjahresreifen',
};

export const MAX_SLOT_LENGTH = 40;
export const MAX_TIRE_LABEL_LENGTH = 200;
export const MAX_TIRE_NOTES_LENGTH = 1000;
export const MAX_TREAD_DEPTH_TENTH_MM = 150;

/** One stored set of wheels. `releasedAt` set means the set has left the storage (archived, not deleted). */
export type TireStorage = {
  id: string;
  customerId: string;
  vehicleId?: string;
  slot: string;
  season: TireSeason;
  description: string;
  /** Tread depth in tenths of a millimetre (6.5 mm = 65), so there is no float. */
  treadDepthTenthMm?: number;
  storedAt: string;
  releasedAt?: string;
  lastReminderSentAt?: string;
  notes?: string;
};

export type TireStorageInput = {
  customerId: string;
  vehicleId?: string;
  slot: string;
  season: TireSeason;
  description: string;
  treadDepthTenthMm?: number;
  storedAt: string;
  notes?: string;
};

export function isTireSeason(value: unknown): value is TireSeason {
  return typeof value === 'string' && (TIRE_SEASONS as readonly string[]).includes(value);
}

/** Slots are compared without case and spaces, so "a-3" and "A-3 " are the same shelf. */
export function normalizeSlot(slot: string): string {
  return slot.trim().replace(/\s+/g, ' ').toUpperCase();
}

export function formatTreadDepth(tenthMm: number): string {
  return `${(tenthMm / 10).toFixed(1).replace('.', ',')} mm`;
}

/** Legal minimum in Germany is 1.6 mm; advise a swap before that (workshops usually say 3 mm for winter). */
export function isTreadLow(season: TireSeason, tenthMm: number): boolean {
  return tenthMm < (season === 'winter' ? 40 : 30);
}

type Window = { startMonth: number; endMonth: number };

const REMINDER_WINDOWS: Record<TireSeason, Window | null> = {
  winter: { startMonth: 10, endMonth: 11 }, // 1 Oct - 30 Nov
  summer: { startMonth: 3, endMonth: 4 }, // 1 Mar - 30 Apr
  allseason: null,
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** First and last day of the current reminder window for this season, or null if today is outside of it. */
export function getReminderWindow(season: TireSeason, today: string): { start: string; end: string } | null {
  const window = REMINDER_WINDOWS[season];
  if (!window) return null;
  const year = Number(today.slice(0, 4));
  const start = `${year}-${pad(window.startMonth)}-01`;
  // last day of the end month = day before the first of the next month
  const end = addDaysToDateString(`${year}-${pad(window.endMonth + 1)}-01`, -1);
  return today >= start && today <= end ? { start, end } : null;
}

/**
 * A stored set is due for its seasonal reminder when it is still in storage, today is inside
 * the season's window, and no reminder was sent since the window opened.
 * The caller must still check the customer's consent (lib/reminder-consent.ts).
 */
export function isSeasonalReminderDue(
  set: Pick<TireStorage, 'season' | 'releasedAt' | 'lastReminderSentAt'>,
  today: string,
): boolean {
  if (set.releasedAt) return false;
  const window = getReminderWindow(set.season, today);
  if (!window) return false;
  return !set.lastReminderSentAt || set.lastReminderSentAt < window.start;
}

export function buildTireReminderMessage({
  customerName,
  season,
  plate,
  workshopName = DEFAULT_WORKSHOP_NAME,
}: {
  customerName: string;
  season: TireSeason;
  plate: string;
  workshopName?: string;
}): string {
  const name = workshopName.trim() || DEFAULT_WORKSHOP_NAME;
  const vehicle = plate.trim() ? ` für Ihr Fahrzeug ${plate.trim()}` : '';
  const when = season === 'winter' ? 'Die kalte Jahreszeit beginnt' : 'Der Frühling beginnt';
  return `Guten Tag ${customerName}, ${when}: Ihre bei uns eingelagerten ${TIRE_SEASON_LABELS[season]}${vehicle} warten auf den Räderwechsel. Gerne vereinbaren wir einen Termin für Sie. Antworten Sie einfach auf diese Nachricht oder rufen Sie uns an. Viele Grüße, ${name}`;
}

export class TireStorageValidationError extends Error {}

function isValidDateString(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Cleans and checks the form data. Throws TireStorageValidationError with a German message. */
export function validateTireStorageInput(input: TireStorageInput): TireStorageInput {
  const slot = normalizeSlot(input.slot);
  if (!slot) throw new TireStorageValidationError('Bitte gib einen Lagerplatz an.');
  if (slot.length > MAX_SLOT_LENGTH) {
    throw new TireStorageValidationError(`Der Lagerplatz darf höchstens ${MAX_SLOT_LENGTH} Zeichen lang sein.`);
  }
  if (!isTireSeason(input.season)) throw new TireStorageValidationError('Bitte wähle die Saison der Reifen.');
  const description = input.description.trim();
  if (!description) throw new TireStorageValidationError('Bitte beschreibe die Reifen (z. B. Größe und Marke).');
  if (description.length > MAX_TIRE_LABEL_LENGTH) {
    throw new TireStorageValidationError(`Die Beschreibung darf höchstens ${MAX_TIRE_LABEL_LENGTH} Zeichen lang sein.`);
  }
  if (!isValidDateString(input.storedAt)) {
    throw new TireStorageValidationError('Das Einlagerungsdatum muss im Format YYYY-MM-DD angegeben werden.');
  }
  const depth = input.treadDepthTenthMm;
  if (depth !== undefined && (!Number.isInteger(depth) || depth < 0 || depth > MAX_TREAD_DEPTH_TENTH_MM)) {
    throw new TireStorageValidationError('Die Profiltiefe ist ungültig (0 bis 15 mm).');
  }
  const notes = input.notes?.trim() || undefined;
  if (notes && notes.length > MAX_TIRE_NOTES_LENGTH) {
    throw new TireStorageValidationError(`Die Notiz darf höchstens ${MAX_TIRE_NOTES_LENGTH} Zeichen lang sein.`);
  }
  return { ...input, slot, description, notes };
}
