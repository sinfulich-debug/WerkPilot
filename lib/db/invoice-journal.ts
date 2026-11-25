import 'server-only';

import { and, asc, eq, gte, inArray, lt, or } from 'drizzle-orm';
import { invoiceLines, invoices, payments } from '../../db/schema';
import { assertTenantContext, withTenant } from '../../db/with-tenant';
import { addDaysToDateString } from '../date';
import type { JournalInvoice } from '../invoice-journal';
import type { ReportPeriod } from '../report-period';

function buyerName(snapshot: unknown): string {
  if (typeof snapshot === 'object' && snapshot !== null && !Array.isArray(snapshot)) {
    const name = (snapshot as Record<string, unknown>).name;
    if (typeof name === 'string' && name.trim()) return name;
  }
  return 'Unbekannt';
}

/**
 * Issued and cancelled invoices (including Storno documents) around a period, with their lines,
 * payments and the number of the partner document. The query is a little wider than the period
 * because time zones shift the day boundary; buildJournal does the exact filtering by Berlin day.
 */
export async function getJournalInvoices(tenantId: string, period: ReportPeriod): Promise<JournalInvoice[]> {
  const from = new Date(`${addDaysToDateString(period.from, -1)}T00:00:00.000Z`);
  const to = new Date(`${addDaysToDateString(period.to, 2)}T00:00:00.000Z`);

  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);

    // Drafts have no number and no place in a journal; only issued and cancelled invoices are listed.
    const rows = (
      await tx
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.tenantId, tenantId),
            inArray(invoices.status, ['issued', 'cancelled']),
            gte(invoices.issuedAt, from),
            lt(invoices.issuedAt, to),
          ),
        )
        .orderBy(asc(invoices.issuedAt), asc(invoices.number))
    ).filter((row) => row.number !== null && row.issuedAt !== null);
    if (rows.length === 0) return [];

    const ids = rows.map((row) => row.id);
    const originalIds = rows.flatMap((row) => (row.cancelsInvoiceId ? [row.cancelsInvoiceId] : []));

    const [lineRows, paymentRows, partnerRows] = await Promise.all([
      tx
        .select()
        .from(invoiceLines)
        .where(and(eq(invoiceLines.tenantId, tenantId), inArray(invoiceLines.invoiceId, ids)))
        .orderBy(asc(invoiceLines.position)),
      tx
        .select()
        .from(payments)
        .where(and(eq(payments.tenantId, tenantId), inArray(payments.invoiceId, ids))),
      // the originals these Storno documents cancel, and the Storno documents that cancel these invoices
      tx
        .select({ id: invoices.id, number: invoices.number, cancelsInvoiceId: invoices.cancelsInvoiceId })
        .from(invoices)
        .where(
          and(
            eq(invoices.tenantId, tenantId),
            or(
              inArray(invoices.cancelsInvoiceId, ids),
              originalIds.length > 0 ? inArray(invoices.id, originalIds) : undefined,
            ),
          ),
        ),
    ]);

    const numberById = new Map<string, string>();
    const cancelledByNumber = new Map<string, string>();
    for (const partner of partnerRows) {
      if (!partner.number) continue;
      numberById.set(partner.id, partner.number);
      if (partner.cancelsInvoiceId) cancelledByNumber.set(partner.cancelsInvoiceId, partner.number);
    }

    return rows.map((row): JournalInvoice => {
      const paidCents = paymentRows
        .filter((payment) => payment.invoiceId === row.id)
        .reduce((sum, payment) => sum + payment.amountCents, 0);
      return {
        id: row.id,
        number: row.number as string,
        issuedAt: (row.issuedAt as Date).toISOString(),
        serviceDate: row.serviceDate,
        customer: buyerName(row.buyerSnapshot),
        status: row.status === 'cancelled' ? 'cancelled' : 'issued',
        ...(row.cancelsInvoiceId && { cancelsNumber: numberById.get(row.cancelsInvoiceId) ?? '–' }),
        ...(cancelledByNumber.has(row.id) && { cancelledByNumber: cancelledByNumber.get(row.id) }),
        dueDate: row.dueDate,
        lines: lineRows
          .filter((line) => line.invoiceId === row.id)
          .map((line) => ({ qtyMilli: line.qtyMilli, unitPriceCents: line.unitPriceCents, taxRateBp: line.taxRateBp })),
        paidCents,
      };
    });
  });
}
