import { and, eq } from 'drizzle-orm';
import { getYearInTimeZone, INVOICE_TIME_ZONE } from '../date';
import type { Database } from './client';
import { formatInvoiceNumber, getNextInvoiceSequenceNumber } from './invoice-number-core';
import { setAuditActor } from './audit-actor';
import { InvoiceNotEditableError } from './invoice-errors';
import { invoiceLines, invoiceSequences, invoices, tenantProfiles } from '../../db/schema';

export { formatInvoiceNumber, getNextInvoiceSequenceNumber };

type InvoiceProfileReadiness = {
  companyName: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  taxNumber: string | null;
  vatId: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertInvoiceReadyForIssuing(input: {
  hasLines: boolean;
  serviceDate: string | null;
  profile: InvoiceProfileReadiness | null;
  buyerSnapshot: unknown;
}): void {
  if (!input.hasLines) {
    throw new InvoiceNotEditableError('Die Rechnung benötigt mindestens eine Position.');
  }

  const requiredField = (value: string | null | undefined, field: string, context: string) => {
    if (!value?.trim()) {
      throw new InvoiceNotEditableError(`Bitte ergänze das Feld „${field}“ ${context}.`);
    }
  };
  const profile = input.profile;
  requiredField(profile?.companyName, 'Firmenname', 'im Werkstattprofil');
  requiredField(profile?.street, 'Straße', 'im Werkstattprofil');
  requiredField(profile?.zip, 'Postleitzahl', 'im Werkstattprofil');
  requiredField(profile?.city, 'Ort', 'im Werkstattprofil');
  if (!profile?.taxNumber?.trim() && !profile?.vatId?.trim()) {
    throw new InvoiceNotEditableError(
      'Bitte ergänze das Feld „Steuernummer oder USt-IdNr.“ im Werkstattprofil.',
    );
  }

  if (!input.serviceDate) {
    throw new InvoiceNotEditableError('Bitte ergänze das Feld „Leistungsdatum“ der Rechnung.');
  }

  const buyer = isRecord(input.buyerSnapshot) ? input.buyerSnapshot : {};
  requiredField(typeof buyer.street === 'string' ? buyer.street : null, 'Straße', 'in den Käuferdaten');
  requiredField(typeof buyer.zip === 'string' ? buyer.zip : null, 'Postleitzahl', 'in den Käuferdaten');
  requiredField(typeof buyer.city === 'string' ? buyer.city : null, 'Ort', 'in den Käuferdaten');
}

export type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export async function issueInvoice(
  database: Database,
  input: { tenantId: string; invoiceId: string; issuedAt?: Date; actorId?: string },
): Promise<string> {
  return database.transaction((tx) => issueInvoiceInTransaction(tx, input));
}

/**
 * Gives a draft invoice the next number of the gap-free yearly sequence and marks it issued.
 * Runs inside the caller's transaction so that a Storno can be created and numbered atomically.
 * `skipReadinessCheck` is for a cancellation: it copies the original's snapshots, so today's
 * workshop profile must not be able to block it.
 */
export async function issueInvoiceInTransaction(
  tx: DatabaseTransaction,
  input: { tenantId: string; invoiceId: string; issuedAt?: Date; actorId?: string },
  options: { skipReadinessCheck?: boolean } = {},
): Promise<string> {
  await setAuditActor(tx, input.actorId);
  const issuedAt = input.issuedAt ?? new Date();
  if (Number.isNaN(issuedAt.getTime())) throw new RangeError('issuedAt must be a valid date.');
  const year = getYearInTimeZone(issuedAt, INVOICE_TIME_ZONE);

  const [invoice] = await tx
    .select({
      status: invoices.status,
      serviceDate: invoices.serviceDate,
      buyerSnapshot: invoices.buyerSnapshot,
    })
    .from(invoices)
    .where(and(eq(invoices.tenantId, input.tenantId), eq(invoices.id, input.invoiceId)))
    .for('update');

  if (!invoice) throw new Error('Invoice not found for the current tenant.');
  if (invoice.status !== 'draft') {
    throw new InvoiceNotEditableError('Nur Rechnungsentwürfe können ausgestellt werden.');
  }

  const [line] = await tx
    .select({ id: invoiceLines.id })
    .from(invoiceLines)
    .where(and(
      eq(invoiceLines.tenantId, input.tenantId),
      eq(invoiceLines.invoiceId, input.invoiceId),
    ))
    .limit(1);

  const [profile] = await tx
    .select({
      companyName: tenantProfiles.companyName,
      street: tenantProfiles.street,
      zip: tenantProfiles.zip,
      city: tenantProfiles.city,
      taxNumber: tenantProfiles.taxNumber,
      vatId: tenantProfiles.vatId,
    })
    .from(tenantProfiles)
    .where(eq(tenantProfiles.tenantId, input.tenantId))
    .limit(1);
  if (!options.skipReadinessCheck) {
    assertInvoiceReadyForIssuing({
      hasLines: Boolean(line),
      serviceDate: invoice.serviceDate,
      profile: profile ?? null,
      buyerSnapshot: invoice.buyerSnapshot,
    });
  } else if (!line) {
    throw new InvoiceNotEditableError('Die Rechnung benötigt mindestens eine Position.');
  }

  await tx
    .insert(invoiceSequences)
    .values({ tenantId: input.tenantId, year, lastNumber: 0 })
    .onConflictDoNothing({
      target: [invoiceSequences.tenantId, invoiceSequences.year],
    });

  const [sequence] = await tx
    .select({ lastNumber: invoiceSequences.lastNumber })
    .from(invoiceSequences)
    .where(and(
      eq(invoiceSequences.tenantId, input.tenantId),
      eq(invoiceSequences.year, year),
    ))
    .for('update');

  if (!sequence) throw new Error('Invoice sequence could not be locked.');

  const sequenceNumber = getNextInvoiceSequenceNumber(sequence.lastNumber);
  const number = formatInvoiceNumber(year, sequenceNumber);

  await tx
    .update(invoiceSequences)
    .set({ lastNumber: sequenceNumber })
    .where(and(
      eq(invoiceSequences.tenantId, input.tenantId),
      eq(invoiceSequences.year, year),
    ));

  await tx
    .update(invoices)
    .set({ status: 'issued', number, issuedAt })
    .where(and(eq(invoices.tenantId, input.tenantId), eq(invoices.id, input.invoiceId)));

  return number;
}
