import type { InvoiceLine } from './money';

/**
 * Storno (cancellation) rules under GoBD: an issued invoice is never changed or deleted.
 * It is cancelled by a new, numbered document with the same lines at negative quantity.
 * The original keeps its content and only gets the status "cancelled".
 */

export type InvoiceCancellationState = {
  status: 'draft' | 'issued' | 'cancelled';
  /** Set when this document is itself a cancellation of another invoice. */
  cancelsInvoiceId: string | null;
  /** Whether a cancellation document already exists for this invoice. */
  alreadyCancelled: boolean;
};

export type CancellableLine = InvoiceLine & {
  description: string;
  /** Unit code of the line (C62, HUR, ...); a Storno keeps the unit of the original. */
  unitCode?: string;
};

export const STORNO_PREFIX = 'Storno: ';

/** Why an invoice cannot be cancelled (German, shown to the user), or null when it can. */
export function getCancellationBlocker(state: InvoiceCancellationState): string | null {
  if (state.status === 'draft') {
    return 'Ein Rechnungsentwurf wird gelöscht und nicht storniert.';
  }
  if (state.cancelsInvoiceId !== null) {
    return 'Eine Stornorechnung kann nicht storniert werden.';
  }
  if (state.status === 'cancelled' || state.alreadyCancelled) {
    return 'Diese Rechnung wurde bereits storniert.';
  }
  return null;
}

/**
 * Lines of the cancellation document: same description (marked as Storno), same unit price and tax rate,
 * quantity negated. Because money rounding is half away from zero, every line net, every tax group and
 * the totals are exactly the negative of the original, so the pair always adds up to zero.
 */
export function buildCancellationLines(lines: readonly CancellableLine[]): CancellableLine[] {
  return lines.map((line) => ({
    description: line.description.startsWith(STORNO_PREFIX) ? line.description : `${STORNO_PREFIX}${line.description}`,
    qtyMilli: line.qtyMilli === 0 ? 0 : -line.qtyMilli,
    ...(line.unitCode !== undefined && { unitCode: line.unitCode }),
    unitPriceCents: line.unitPriceCents,
    taxRateBp: line.taxRateBp,
  }));
}
