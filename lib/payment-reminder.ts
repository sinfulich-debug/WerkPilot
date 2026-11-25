import { addDaysToDateString } from './date';
import { formatEuro } from './money';

/**
 * Drafts for overdue invoices. They are plain text for the workshop to copy and check; nothing is
 * sent or stored. No dunning fees or interest are added: those have legal requirements of their own.
 */
export type ReminderLevel = 'reminder' | 'first' | 'second';

export const REMINDER_LEVEL_LABEL: Record<ReminderLevel, string> = {
  reminder: 'Zahlungserinnerung',
  first: '1. Mahnung',
  second: '2. Mahnung',
};

/** Suggests the next step from how long the invoice has been overdue. */
export function suggestReminderLevel(overdueDays: number): ReminderLevel {
  if (overdueDays > 28) return 'second';
  if (overdueDays > 14) return 'first';
  return 'reminder';
}

export type ReminderInput = {
  level: ReminderLevel;
  sellerName: string;
  customerName: string;
  invoiceNumber: string;
  /** Due date of the invoice (YYYY-MM-DD). */
  dueDate: string;
  grossCents: number;
  openCents: number;
  /** Today (YYYY-MM-DD, workshop time zone). */
  today: string;
  /** Days from today until the new deadline. */
  graceDays?: number;
};

export type ReminderDraft = { subject: string; body: string };

function formatDate(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
}

/** The euro formatter uses non-breaking spaces; plain spaces are safer in a text that gets pasted into mails. */
function euro(cents: number): string {
  return formatEuro(cents).replace(/ /g, ' ');
}

export function buildReminderDraft(input: ReminderInput): ReminderDraft {
  if (input.openCents <= 0) throw new RangeError('There is nothing open to remind about.');
  const graceDays = input.graceDays ?? 7;
  if (!Number.isInteger(graceDays) || graceDays < 1 || graceDays > 60) {
    throw new RangeError('graceDays must be between 1 and 60.');
  }

  const newDeadline = formatDate(addDaysToDateString(input.today, graceDays));
  const label = REMINDER_LEVEL_LABEL[input.level];
  const partlyPaid = input.openCents < input.grossCents;
  const amounts = partlyPaid
    ? `über ${euro(input.grossCents)} (fällig am ${formatDate(input.dueDate)}) ist bisher nur teilweise beglichen. Es sind noch ${euro(input.openCents)} offen.`
    : `über ${euro(input.grossCents)} (fällig am ${formatDate(input.dueDate)}) ist noch nicht beglichen. Der offene Betrag beträgt ${euro(input.openCents)}.`;

  const opening: Record<ReminderLevel, string> = {
    reminder:
      'sicher ist es nur ein Versehen: Bei der Durchsicht unserer Buchhaltung ist uns aufgefallen, dass die Rechnung ' +
      `${input.invoiceNumber} ${amounts}`,
    first:
      `trotz unserer Zahlungserinnerung konnten wir bisher keinen vollständigen Zahlungseingang feststellen. Die Rechnung ${input.invoiceNumber} ${amounts}`,
    second:
      `leider haben wir auch auf unsere bisherigen Schreiben keinen vollständigen Zahlungseingang erhalten. Die Rechnung ${input.invoiceNumber} ${amounts}`,
  };
  const request: Record<ReminderLevel, string> = {
    reminder: `Bitte überweisen Sie den offenen Betrag bis zum ${newDeadline}.`,
    first: `Wir bitten Sie, den offenen Betrag bis spätestens ${newDeadline} zu überweisen.`,
    second:
      `Wir fordern Sie auf, den offenen Betrag bis spätestens ${newDeadline} zu überweisen. ` +
      'Andernfalls behalten wir uns weitere Schritte vor.',
  };

  const body = [
    `Sehr geehrte Damen und Herren, sehr geehrte/r ${input.customerName},`,
    '',
    opening[input.level],
    '',
    request[input.level],
    'Sollten Sie den Betrag inzwischen überwiesen haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.',
    '',
    'Mit freundlichen Grüßen',
    input.sellerName,
  ].join('\n');

  return { subject: `${label} zu Rechnung ${input.invoiceNumber}`, body };
}
