import { and, asc, eq } from 'drizzle-orm';
import { invoiceLines, invoices } from '../../db/schema';
import { buildCancellationLines, getCancellationBlocker } from '../invoice-cancellation';
import { setAuditActor } from './audit-actor';
import type { Database } from './client';
import { InvoiceNotEditableError, InvoiceNotFoundError } from './invoice-errors';
import { issueInvoiceInTransaction } from './invoice-number';

export type InvoiceCancellationResult = {
  /** Number of the new cancellation document (same gap-free sequence as every invoice). */
  number: string;
  cancellationId: string;
};

/**
 * Cancels an issued invoice the GoBD way: the original is left untouched, a new numbered document
 * with the same lines at negative quantity is created, and only then the original's status becomes
 * "cancelled". Everything happens in one transaction, so there is never a half-cancelled invoice
 * and the number sequence has no gaps.
 *
 * Uses the privileged client like issueInvoice: creating a numbered document and changing an issued
 * invoice are deliberately impossible for the normal row-level-security role. The caller must check
 * the user's role (owner or office) before calling.
 */
export async function cancelInvoice(
  database: Database,
  input: { tenantId: string; invoiceId: string; issuedAt?: Date; actorId?: string },
): Promise<InvoiceCancellationResult> {
  return database.transaction(async (tx) => {
    await setAuditActor(tx, input.actorId);
    const [original] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, input.tenantId), eq(invoices.id, input.invoiceId)))
      .for('update');
    if (!original) throw new InvoiceNotFoundError();

    const [existingCancellation] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.tenantId, input.tenantId), eq(invoices.cancelsInvoiceId, original.id)))
      .limit(1);

    const blocker = getCancellationBlocker({
      status: original.status,
      cancelsInvoiceId: original.cancelsInvoiceId,
      alreadyCancelled: existingCancellation !== undefined,
    });
    if (blocker) throw new InvoiceNotEditableError(blocker);

    const originalLines = await tx
      .select()
      .from(invoiceLines)
      .where(and(eq(invoiceLines.tenantId, input.tenantId), eq(invoiceLines.invoiceId, original.id)))
      .orderBy(asc(invoiceLines.position));
    if (originalLines.length === 0) {
      throw new InvoiceNotEditableError('Die Rechnung enthält keine Positionen und kann nicht storniert werden.');
    }

    const [draft] = await tx
      .insert(invoices)
      .values({
        tenantId: input.tenantId,
        customerId: original.customerId,
        vehicleId: original.vehicleId,
        workOrderId: null,
        status: 'draft',
        number: null,
        serviceDate: original.serviceDate,
        dueDate: null,
        // The cancellation shows the parties exactly as they were on the original.
        sellerSnapshot: original.sellerSnapshot,
        buyerSnapshot: original.buyerSnapshot,
        cancelsInvoiceId: original.id,
      })
      .returning({ id: invoices.id });
    if (!draft) throw new Error('Die Stornorechnung konnte nicht angelegt werden.');

    const cancellationLines = buildCancellationLines(originalLines);
    await tx.insert(invoiceLines).values(
      cancellationLines.map((line, index) => ({
        tenantId: input.tenantId,
        invoiceId: draft.id,
        position: index + 1,
        description: line.description,
        qtyMilli: line.qtyMilli,
        unitCode: line.unitCode ?? 'C62',
        unitPriceCents: line.unitPriceCents,
        taxRateBp: line.taxRateBp,
      })),
    );

    const number = await issueInvoiceInTransaction(
      tx,
      { tenantId: input.tenantId, invoiceId: draft.id, issuedAt: input.issuedAt, actorId: input.actorId },
      { skipReadinessCheck: true },
    );

    // The database only allows this change now that an issued cancellation document exists.
    await tx
      .update(invoices)
      .set({ status: 'cancelled' })
      .where(and(eq(invoices.tenantId, input.tenantId), eq(invoices.id, original.id)));

    return { number, cancellationId: draft.id };
  });
}
