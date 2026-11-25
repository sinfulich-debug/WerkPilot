import type { InvoiceStatus } from './finance';

/**
 * What the payment situation of an invoice looks like to the workshop.
 * - open: issued, nothing paid yet
 * - partial: part of the amount is paid
 * - paid: fully paid
 * - draft / cancelled / storno: not a receivable (storno is the credit note of a cancelled invoice)
 * `overdueDays` is above zero when something is still open after the due date.
 */
export type PaymentKind = 'draft' | 'open' | 'partial' | 'paid' | 'cancelled' | 'storno';

export type PaymentSummary = {
  kind: PaymentKind;
  grossCents: number;
  paidCents: number;
  /** Still to be paid; 0 for anything that is not a receivable. */
  openCents: number;
  overdueDays: number;
};

export type PaymentSummaryInput = {
  status: InvoiceStatus;
  /** Set on a Storno document. */
  cancelsInvoiceId?: string;
  grossCents: number;
  paidCents: number;
  /** Due date (YYYY-MM-DD) or null. */
  dueDate: string | null;
  /** Today's date in the workshop's time zone (YYYY-MM-DD). */
  today: string;
};

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Converts an amount in euro (as the API delivers it) to cents without float drift. */
export function eurosToCents(euros: number): number {
  if (!Number.isFinite(euros)) throw new RangeError('euros must be a finite number.');
  return Math.round(euros * 100);
}

export function getPaymentSummary(input: PaymentSummaryInput): PaymentSummary {
  const { grossCents, paidCents } = input;
  const base = { grossCents, paidCents, openCents: 0, overdueDays: 0 };

  if (input.cancelsInvoiceId) return { ...base, kind: 'storno' };
  if (input.status === 'draft') return { ...base, kind: 'draft' };
  if (input.status === 'cancelled') return { ...base, kind: 'cancelled' };

  const openCents = Math.max(0, grossCents - paidCents);
  if (openCents === 0) return { ...base, kind: 'paid' };

  const overdueDays = input.dueDate && input.today > input.dueDate ? daysBetween(input.dueDate, input.today) : 0;
  return { ...base, kind: paidCents > 0 ? 'partial' : 'open', openCents, overdueDays };
}

/** German label for a status badge, e.g. "Teilbezahlt · überfällig". */
export function paymentLabel(summary: PaymentSummary, dueDate: string | null): string {
  const overdue = summary.overdueDays > 0 ? ` · überfällig (${summary.overdueDays} ${summary.overdueDays === 1 ? 'Tag' : 'Tage'})` : '';
  switch (summary.kind) {
    case 'draft':
      return 'Entwurf';
    case 'paid':
      return 'Bezahlt';
    case 'cancelled':
      return 'Storniert';
    case 'storno':
      return 'Stornorechnung';
    case 'partial':
      return `Teilbezahlt${overdue}`;
    case 'open': {
      if (overdue) return `Überfällig (${summary.overdueDays} ${summary.overdueDays === 1 ? 'Tag' : 'Tage'})`;
      return dueDate ? `Offen bis ${dueDate.slice(8, 10)}.${dueDate.slice(5, 7)}.${dueDate.slice(0, 4)}` : 'Offen';
    }
  }
}
