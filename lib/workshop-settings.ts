/**
 * Everyday workshop settings that several pages need (hourly rate, WhatsApp reminder text, bank
 * details). Pure helpers only: the same rules run in the browser and on the server. Money is kept
 * in whole cents, never as a float.
 */
import type { TaxMode } from './finance';

/** Used until the workshop sets its own hourly rate in the settings. */
export const DEFAULT_HOURLY_RATE_CENTS = 9_500;
/** Upper limit, 10 000 EUR per hour; the database enforces the same range. */
export const MAX_HOURLY_RATE_CENTS = 1_000_000;
export const MAX_WHATSAPP_TEMPLATE_LENGTH = 1_000;

/** Used until the workshop writes its own reminder text. */
export const DEFAULT_WHATSAPP_TEMPLATE =
  'Guten Tag {Kundenname}, die Hauptuntersuchung (TÜV) für Ihr Fahrzeug {Fahrzeug} ({Kennzeichen}) ist am {TÜV-Datum} fällig. Gerne vereinbaren wir rechtzeitig einen Termin für Sie. Viele Grüße, WerkPilot KFZ-Meisterbetrieb';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** What the pages receive from /api/workshop-settings (readable for every role of the workshop). */
export type WorkshopSettings = {
  companyName: string;
  hourlyRateCents: number;
  /** Always filled: the workshop's own text or the default. */
  whatsappTemplate: string;
  /** True when the workshop wrote its own text (the default is then not used). */
  hasCustomTemplate: boolean;
  bankName: string;
  iban: string;
  bic: string;
  isSmallBusiness: boolean;
};

/** Checks that what the server sent has the shape the pages rely on. */
export function isWorkshopSettings(value: unknown): value is WorkshopSettings {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.companyName === 'string' &&
    parseHourlyRateCents(record.hourlyRateCents).ok &&
    typeof record.whatsappTemplate === 'string' &&
    typeof record.hasCustomTemplate === 'boolean' &&
    typeof record.bankName === 'string' &&
    typeof record.iban === 'string' &&
    typeof record.bic === 'string' &&
    typeof record.isSmallBusiness === 'boolean'
  );
}

/** Hourly rate in whole cents: an integer between 0 and MAX_HOURLY_RATE_CENTS. */
export function parseHourlyRateCents(value: unknown): ParseResult<number> {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    return { ok: false, message: 'Der Stundensatz ist ungültig.' };
  }
  if (value < 0 || value > MAX_HOURLY_RATE_CENTS) {
    return { ok: false, message: 'Der Stundensatz muss zwischen 0 und 10.000 € liegen.' };
  }
  return { ok: true, value };
}

/**
 * Reminder text. An empty text means "use the default" and is stored as null; a text that is too
 * long is refused instead of being cut off silently.
 */
export function parseWhatsappTemplate(value: unknown): ParseResult<string | null> {
  if (typeof value !== 'string') return { ok: false, message: 'Die Erinnerungsvorlage ist ungültig.' };
  const text = value.trim();
  if (text.length === 0) return { ok: true, value: null };
  if (text.length > MAX_WHATSAPP_TEMPLATE_LENGTH) {
    return { ok: false, message: `Die Erinnerungsvorlage darf höchstens ${MAX_WHATSAPP_TEMPLATE_LENGTH} Zeichen lang sein.` };
  }
  return { ok: true, value: text };
}

/** Euro amount typed into a form field -> whole cents (rounded, so 19.99 gives 1999, not 1998). */
export function eurosToCentsOrNull(euros: unknown): number | null {
  if (typeof euros !== 'number' || !Number.isFinite(euros) || euros < 0) return null;
  const cents = Math.round(euros * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Cents -> euros for form fields and the estimate preview. */
export function centsToEuros(cents: number): number {
  return cents / 100;
}

/** The tax mode the invoice form starts with: small-business rule if the workshop uses it. */
export function defaultTaxMode(isSmallBusiness: boolean): TaxMode {
  return isSmallBusiness ? 'smallBusiness' : 'standard19';
}

/**
 * Turns the stored profile row (or nothing, for a workshop without a profile) into the settings the
 * pages use, filling the gaps with defaults.
 */
export function toWorkshopSettings(profile: {
  companyName?: string | null;
  hourlyRateCents?: number | null;
  whatsappTemplate?: string | null;
  bankName?: string | null;
  iban?: string | null;
  bic?: string | null;
  isSmallBusiness?: boolean | null;
} | null): WorkshopSettings {
  const template = profile?.whatsappTemplate?.trim() ?? '';
  return {
    companyName: profile?.companyName?.trim() ?? '',
    hourlyRateCents: typeof profile?.hourlyRateCents === 'number' ? profile.hourlyRateCents : DEFAULT_HOURLY_RATE_CENTS,
    whatsappTemplate: template || DEFAULT_WHATSAPP_TEMPLATE,
    hasCustomTemplate: template.length > 0,
    bankName: profile?.bankName ?? '',
    iban: profile?.iban ?? '',
    bic: profile?.bic ?? '',
    isSmallBusiness: profile?.isSmallBusiness ?? false,
  };
}
