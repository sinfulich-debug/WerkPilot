/**
 * Rules for the self-registration of a workshop (pages /registrieren and /werkstatt-anlegen).
 * Pure functions, safe for pages and tests.
 */
import { MIN_PASSWORD_LENGTH } from './staff-link';
import type { RateLimitRule } from './rate-limit';

export const WORKSHOP_NAME_MIN = 2;
export const WORKSHOP_NAME_MAX = 200;
const PASSWORD_MAX_BYTES = 72; // Supabase (bcrypt) ignores everything after 72 bytes

/** Five sign-ups per hour from one address are plenty for a real workshop. */
export const REGISTRATION_LIMIT: RateLimitRule = { scope: 'registrieren', limit: 5, windowSeconds: 3600 };

export type RegistrationError = 'name' | 'email' | 'password' | 'terms' | 'rate' | 'failed' | 'confirm';

export type RegistrationInput = { workshopName: string; email: string; password: string };

type Result<T> = { ok: true; value: T } | { ok: false; error: RegistrationError };

export function parseWorkshopName(raw: unknown): Result<string> {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (name.length < WORKSHOP_NAME_MIN || name.length > WORKSHOP_NAME_MAX) return { ok: false, error: 'name' };
  return { ok: true, value: name };
}

export function parseRegistrationForm(form: {
  workshopName: unknown;
  email: unknown;
  password: unknown;
  terms: unknown;
}): Result<RegistrationInput> {
  const name = parseWorkshopName(form.workshopName);
  if (!name.ok) return name;
  const email = typeof form.email === 'string' ? form.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'email' };
  const password = typeof form.password === 'string' ? form.password : '';
  if (password.length < MIN_PASSWORD_LENGTH || new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return { ok: false, error: 'password' };
  }
  if (form.terms !== 'on') return { ok: false, error: 'terms' };
  return { ok: true, value: { workshopName: name.value, email, password } };
}

const MESSAGES: Record<RegistrationError, string> = {
  name: `Der Werkstattname muss ${WORKSHOP_NAME_MIN} bis ${WORKSHOP_NAME_MAX} Zeichen lang sein.`,
  email: 'Bitte eine gültige E-Mail-Adresse eingeben.',
  password: `Das Passwort muss ${MIN_PASSWORD_LENGTH} bis 72 Zeichen lang sein.`,
  terms: 'Bitte AGB und Datenschutzerklärung akzeptieren.',
  rate: 'Zu viele Versuche. Bitte in einer Stunde erneut versuchen.',
  failed: 'Die Registrierung hat nicht geklappt. Bitte später erneut versuchen.',
  confirm: 'Bitte zuerst die E-Mail-Adresse über den Link in der Bestätigungs-E-Mail bestätigen.',
};

/** German message for an error code from the address bar; unknown codes show nothing. */
export function registrationErrorMessage(code: string | undefined): string | null {
  return code && Object.prototype.hasOwnProperty.call(MESSAGES, code) ? MESSAGES[code as RegistrationError] : null;
}

/** What to do when register_workshop refused (Postgres error code). */
export function registerWorkshopOutcome(code: string | undefined): 'has-workshop' | RegistrationError {
  if (code === '23505') return 'has-workshop';
  if (code === '22023') return 'name';
  if (code === '42501') return 'confirm';
  return 'failed';
}

/** Only http(s) origins are used to build the confirmation link (never a header with a path or junk). */
export function safeOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}
