// Consent rules for HU/TÜV reminders (DSGVO / UWG §7). Pure functions, no database.
// A reminder may only be sent while the customer has a recorded consent that is newer than any
// opt-out. Staff record both: consent when the customer agrees, opt-out when they reply STOP.

export const CONSENT_SOURCES = ['verbal', 'written', 'form'] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

export const CONSENT_SOURCE_LABELS: Record<ConsentSource, string> = {
  verbal: 'mündlich',
  written: 'schriftlich / per Nachricht',
  form: 'Formular in der Werkstatt',
};

export type ReminderConsentFields = {
  reminderConsentAt?: string;
  reminderConsentSource?: ConsentSource;
  reminderOptOutAt?: string;
};

export type ReminderConsentState = 'none' | 'granted' | 'revoked';

export const REMINDER_OPT_OUT_NOTICE =
  'Wenn Sie keine Erinnerungen mehr möchten, antworten Sie einfach mit STOP.';

export function isConsentSource(value: unknown): value is ConsentSource {
  return typeof value === 'string' && (CONSENT_SOURCES as readonly string[]).includes(value);
}

function toTime(value: string | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

export function getReminderConsentState(fields: ReminderConsentFields): ReminderConsentState {
  const consentAt = toTime(fields.reminderConsentAt);
  const optOutAt = toTime(fields.reminderOptOutAt);
  if (optOutAt !== null && (consentAt === null || optOutAt >= consentAt)) return 'revoked';
  return consentAt === null ? 'none' : 'granted';
}

export function canSendReminder(fields: ReminderConsentFields): boolean {
  return getReminderConsentState(fields) === 'granted';
}

/** Appends the opt-out hint once, so every reminder tells the customer how to stop. */
export function withOptOutNotice(message: string): string {
  const trimmed = message.trimEnd();
  if (trimmed.includes(REMINDER_OPT_OUT_NOTICE)) return trimmed;
  return `${trimmed}\n\n${REMINDER_OPT_OUT_NOTICE}`;
}
