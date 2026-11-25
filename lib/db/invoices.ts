import 'server-only';

import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import {
  customers,
  invoiceLines,
  invoices,
  payments,
  tenantProfiles,
  vehicles,
  workOrderLines,
  workOrders,
} from '../../db/schema';
import {
  euroToCents,
  getTaxRateBps,
  quantityToMilli,
  type Invoice,
  type InvoiceBuyerSnapshot,
  type InvoiceInput,
  type InvoiceLine,
  type Payment,
  type InvoiceSellerSnapshot,
  type TaxMode,
} from '../finance';
import { discountedUnitPriceCents, invoiceTotals } from '../money';
import { transitionWorkOrderStatus } from '../work-order-status';
import { DEFAULT_UNIT, isUnitCode, unitForWorkOrderLine, type UnitCode } from '../units';
import { assertTenantContext, withTenant } from '../../db/with-tenant';
import type { UserTransaction } from '../../db/with-user';
import { addDaysToDateString, getDateStringInTimeZone, INVOICE_TIME_ZONE } from '../date';
import { db } from './client';
import { cancelInvoice as cancelInvoiceDocument, type InvoiceCancellationResult } from './invoice-cancel';
import { InvoiceNotEditableError, InvoiceNotFoundError } from './invoice-errors';
import { issueInvoice as issueInvoiceNumber } from './invoice-number';

export { InvoiceNotEditableError, InvoiceNotFoundError } from './invoice-errors';

type InvoiceJoinRow = {
  invoice: typeof invoices.$inferSelect;
  customerName: string | null;
  plate: string | null;
};

function taxModeFromRate(taxRateBps: number): TaxMode {
  if (taxRateBps === 0) return 'smallBusiness';
  if (taxRateBps === 700) return 'reduced7';
  return 'standard19';
}

type DraftInvoiceLine = {
  description: string;
  qtyMilli: number;
  unitCode: UnitCode;
  unitPriceCents: number;
  taxRateBp: number;
};

function snapshotRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Der ${label} der Rechnung ist ungültig.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function snapshotText(
  record: Record<string, unknown>,
  key: string,
  label: string,
  required = false,
): string | null {
  const value = record[key];
  if (value === undefined || value === null) {
    if (required) throw new Error(`Im ${label} der Rechnung fehlt „${key}“.`);
    return null;
  }
  if (typeof value !== 'string') throw new Error(`Das Feld „${key}“ im ${label} der Rechnung ist ungültig.`);
  return value;
}

function mapSellerSnapshot(value: unknown): InvoiceSellerSnapshot {
  const record = snapshotRecord(value, 'Verkäufer-Snapshot');
  const companyName = snapshotText(record, 'companyName', 'Verkäufer-Snapshot', true);
  if (companyName === null) throw new Error('Im Verkäufer-Snapshot der Rechnung fehlt der Firmenname.');
  return {
    companyName,
    ownerName: snapshotText(record, 'ownerName', 'Verkäufer-Snapshot'),
    street: snapshotText(record, 'street', 'Verkäufer-Snapshot'),
    zip: snapshotText(record, 'zip', 'Verkäufer-Snapshot'),
    city: snapshotText(record, 'city', 'Verkäufer-Snapshot'),
    phone: snapshotText(record, 'phone', 'Verkäufer-Snapshot'),
    email: snapshotText(record, 'email', 'Verkäufer-Snapshot'),
    website: snapshotText(record, 'website', 'Verkäufer-Snapshot'),
    taxNumber: snapshotText(record, 'taxNumber', 'Verkäufer-Snapshot'),
    vatId: snapshotText(record, 'vatId', 'Verkäufer-Snapshot'),
    bankName: snapshotText(record, 'bankName', 'Verkäufer-Snapshot'),
    iban: snapshotText(record, 'iban', 'Verkäufer-Snapshot'),
    bic: snapshotText(record, 'bic', 'Verkäufer-Snapshot'),
  };
}

function mapBuyerSnapshot(value: unknown): InvoiceBuyerSnapshot {
  const record = snapshotRecord(value, 'Käufer-Snapshot');
  const name = snapshotText(record, 'name', 'Käufer-Snapshot', true);
  if (name === null) throw new Error('Im Käufer-Snapshot der Rechnung fehlt der Name.');
  return {
    name,
    vehiclePlate: snapshotText(record, 'vehiclePlate', 'Käufer-Snapshot'),
    email: snapshotText(record, 'email', 'Käufer-Snapshot'),
    phone: snapshotText(record, 'phone', 'Käufer-Snapshot'),
    street: snapshotText(record, 'street', 'Käufer-Snapshot'),
    zip: snapshotText(record, 'zip', 'Käufer-Snapshot'),
    city: snapshotText(record, 'city', 'Käufer-Snapshot'),
  };
}

function makeLineValues(input: InvoiceInput, tenantId: string, invoiceId: string) {
  const taxRateBp = getTaxRateBps(input.taxMode);
  return input.lines.map((line, position) => ({
    tenantId,
    invoiceId,
    position: position + 1,
    description: line.description.trim(),
    qtyMilli: quantityToMilli(line.quantity),
    unitCode: line.unit ?? DEFAULT_UNIT,
    unitPriceCents: euroToCents(line.unitPrice),
    taxRateBp,
  }));
}

async function insertInvoiceDraft(
  tx: UserTransaction,
  tenantId: string,
  customer: typeof customers.$inferSelect,
  profile: typeof tenantProfiles.$inferSelect,
  vehicleId: string | null,
  vehiclePlate: string | null,
  workOrderId: string | null,
  serviceDate: string,
  dueDate: string,
  lines: DraftInvoiceLine[],
) {
  const [invoice] = await tx
    .insert(invoices)
    .values({
      tenantId,
      customerId: customer.id,
      vehicleId,
      workOrderId,
      status: 'draft',
      number: null,
      serviceDate,
      dueDate,
      sellerSnapshot: {
        companyName: profile.companyName,
        ownerName: profile.ownerName,
        street: profile.street,
        zip: profile.zip,
        city: profile.city,
        phone: profile.phone,
        email: profile.email,
        website: profile.website,
        taxNumber: profile.taxNumber,
        vatId: profile.vatId,
        bankName: profile.bankName,
        iban: profile.iban,
        bic: profile.bic,
      },
      buyerSnapshot: {
        name: customer.name,
        vehiclePlate,
        email: customer.email,
        phone: customer.phone,
        street: customer.street,
        zip: customer.zip,
        city: customer.city,
      },
    })
    .returning();
  if (!invoice) throw new Error('Der Rechnungsentwurf konnte nicht angelegt werden.');

  const storedLines = await tx
    .insert(invoiceLines)
    .values(lines.map((line, index) => ({
      tenantId,
      invoiceId: invoice.id,
      position: index + 1,
      ...line,
    })))
    .returning();

  return { invoice, storedLines };
}

type CancellationLinks = Pick<Invoice, 'cancelsInvoiceId' | 'cancelsNumber' | 'cancelledByNumber'>;

function mapInvoice(
  invoice: typeof invoices.$inferSelect,
  customerName: string | null,
  plate: string | null,
  storedLines: (typeof invoiceLines.$inferSelect)[],
  invoicePayments: (typeof payments.$inferSelect)[],
  links: CancellationLinks = {},
): Invoice {
  if (!customerName) throw new Error('Der Rechnungskunde konnte nicht geladen werden.');

  const totals = invoiceTotals(storedLines.map((line) => ({
    qtyMilli: line.qtyMilli,
    unitPriceCents: line.unitPriceCents,
    taxRateBp: line.taxRateBp,
  })));
  const paidCents = invoicePayments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const status: Invoice['status'] =
    invoice.status === 'issued' && invoicePayments.length > 0 && paidCents >= totals.grossCents
      ? 'paid'
      : invoice.status;
  const firstTaxRate = storedLines[0]?.taxRateBp ?? 1_900;
  const buyerSnapshot = mapBuyerSnapshot(invoice.buyerSnapshot);

  return {
    id: invoice.id,
    customerId: invoice.customerId,
    vehicleId: invoice.vehicleId,
    number: invoice.number,
    customer: customerName,
    plate: buyerSnapshot.vehiclePlate ?? plate ?? '–',
    lines: storedLines.map((line): InvoiceLine => ({
      id: line.id,
      description: line.description,
      quantity: line.qtyMilli / 1_000,
      unit: isUnitCode(line.unitCode) ? line.unitCode : DEFAULT_UNIT,
      unitPrice: line.unitPriceCents / 100,
    })),
    taxMode: taxModeFromRate(firstTaxRate),
    serviceDate: invoice.serviceDate ?? getDateStringInTimeZone(invoice.createdAt, INVOICE_TIME_ZONE),
    dueAt: invoice.dueDate,
    issuedAt: invoice.issuedAt?.toISOString() ?? null,
    status,
    paidAmount: paidCents / 100,
    sellerSnapshot: mapSellerSnapshot(invoice.sellerSnapshot),
    buyerSnapshot,
    ...links,
  };
}

async function hydrateInvoices(
  tx: UserTransaction,
  tenantId: string,
  rows: InvoiceJoinRow[],
): Promise<Invoice[]> {
  if (rows.length === 0) return [];

  const invoiceIds = rows.map(({ invoice }) => invoice.id);
  const cancelledIds = rows.flatMap(({ invoice }) => (invoice.cancelsInvoiceId ? [invoice.cancelsInvoiceId] : []));
  const [lineRows, paymentRows, relatedRows] = await Promise.all([
    tx
      .select()
      .from(invoiceLines)
      .where(and(eq(invoiceLines.tenantId, tenantId), inArray(invoiceLines.invoiceId, invoiceIds)))
      .orderBy(asc(invoiceLines.position)),
    tx
      .select()
      .from(payments)
      .where(and(eq(payments.tenantId, tenantId), inArray(payments.invoiceId, invoiceIds))),
    // The partner documents: Storno documents that cancel these invoices, and the originals these Storno documents cancel.
    tx
      .select({ id: invoices.id, number: invoices.number, cancelsInvoiceId: invoices.cancelsInvoiceId })
      .from(invoices)
      .where(and(
        eq(invoices.tenantId, tenantId),
        or(
          inArray(invoices.cancelsInvoiceId, invoiceIds),
          cancelledIds.length > 0 ? inArray(invoices.id, cancelledIds) : undefined,
        ),
      )),
  ]);

  const cancelledByNumber = new Map<string, string>();
  const numberById = new Map<string, string>();
  for (const related of relatedRows) {
    if (related.number) numberById.set(related.id, related.number);
    if (related.cancelsInvoiceId && related.number) cancelledByNumber.set(related.cancelsInvoiceId, related.number);
  }

  const linesByInvoice = new Map<string, typeof lineRows>();
  for (const line of lineRows) {
    const lines = linesByInvoice.get(line.invoiceId) ?? [];
    lines.push(line);
    linesByInvoice.set(line.invoiceId, lines);
  }

  const paymentsByInvoice = new Map<string, typeof paymentRows>();
  for (const payment of paymentRows) {
    const invoicePayments = paymentsByInvoice.get(payment.invoiceId) ?? [];
    invoicePayments.push(payment);
    paymentsByInvoice.set(payment.invoiceId, invoicePayments);
  }

  return rows.map(({ invoice, customerName, plate }) =>
    mapInvoice(
      invoice,
      customerName,
      plate,
      linesByInvoice.get(invoice.id) ?? [],
      paymentsByInvoice.get(invoice.id) ?? [],
      {
        ...(invoice.cancelsInvoiceId && {
          cancelsInvoiceId: invoice.cancelsInvoiceId,
          cancelsNumber: numberById.get(invoice.cancelsInvoiceId),
        }),
        ...(cancelledByNumber.has(invoice.id) && { cancelledByNumber: cancelledByNumber.get(invoice.id) }),
      },
    ),
  );
}

export async function getInvoices(tenantId: string): Promise<Invoice[]> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const rows = await tx
      .select({
        invoice: invoices,
        customerName: customers.name,
        plate: vehicles.plate,
      })
      .from(invoices)
      .leftJoin(
        customers,
        and(eq(customers.tenantId, invoices.tenantId), eq(customers.id, invoices.customerId)),
      )
      .leftJoin(
        vehicles,
        and(eq(vehicles.tenantId, invoices.tenantId), eq(vehicles.id, invoices.vehicleId)),
      )
      .where(eq(invoices.tenantId, tenantId))
      .orderBy(desc(invoices.issuedAt), desc(invoices.createdAt));

    return hydrateInvoices(tx, tenantId, rows);
  });
}

export async function getInvoice(tenantId: string, id: string): Promise<Invoice | null> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const rows = await tx
      .select({
        invoice: invoices,
        customerName: customers.name,
        plate: vehicles.plate,
      })
      .from(invoices)
      .leftJoin(
        customers,
        and(eq(customers.tenantId, invoices.tenantId), eq(customers.id, invoices.customerId)),
      )
      .leftJoin(
        vehicles,
        and(eq(vehicles.tenantId, invoices.tenantId), eq(vehicles.id, invoices.vehicleId)),
      )
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id)))
      .limit(1);

    const [invoice] = await hydrateInvoices(tx, tenantId, rows);
    return invoice ?? null;
  });
}

export async function createInvoice(tenantId: string, input: InvoiceInput): Promise<Invoice> {
  if (input.lines.length === 0) throw new RangeError('Eine Rechnung benötigt mindestens eine Position.');

  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const [profile] = await tx
      .select()
      .from(tenantProfiles)
      .where(eq(tenantProfiles.tenantId, tenantId))
      .limit(1);
    if (!profile) throw new Error('Das Werkstattprofil fehlt. Bitte ergänze zuerst die Firmendaten.');

    const [customer] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, input.customerId)))
      .limit(1);
    if (!customer) throw new Error('Der ausgewählte Kunde wurde nicht gefunden.');

    let vehicleId: string | null = null;
    let plate: string | null = null;
    if (input.vehicleId) {
      const [vehicle] = await tx
        .select({ id: vehicles.id, plate: vehicles.plate })
        .from(vehicles)
        .where(and(
          eq(vehicles.tenantId, tenantId),
          eq(vehicles.customerId, input.customerId),
          eq(vehicles.id, input.vehicleId),
        ))
        .limit(1);
      if (!vehicle) throw new Error('Das ausgewählte Fahrzeug gehört nicht zum Kunden.');
      vehicleId = vehicle.id;
      plate = vehicle.plate;
    }

    const taxRateBp = getTaxRateBps(input.taxMode);
    const { invoice, storedLines } = await insertInvoiceDraft(
      tx,
      tenantId,
      customer,
      profile,
      vehicleId,
      plate,
      null,
      input.serviceDate,
      input.dueAt,
      input.lines.map((line) => ({
        description: line.description.trim(),
        qtyMilli: quantityToMilli(line.quantity),
        unitCode: line.unit ?? DEFAULT_UNIT,
        unitPriceCents: euroToCents(line.unitPrice),
        taxRateBp,
      })),
    );

    return mapInvoice(invoice, customer.name, plate, storedLines, []);
  });
}

export async function createInvoiceFromWorkOrder(
  tenantId: string,
  workOrderId: string,
): Promise<Invoice> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const [workOrder] = await tx
      .select()
      .from(workOrders)
      .where(and(
        eq(workOrders.tenantId, tenantId),
        eq(workOrders.id, workOrderId),
      ))
      .for('update');
    if (!workOrder) throw new Error('Der Werkstattauftrag wurde nicht gefunden.');

    const invoicedStatus = transitionWorkOrderStatus(workOrder.status, 'invoiced');
    const [profile] = await tx
      .select()
      .from(tenantProfiles)
      .where(eq(tenantProfiles.tenantId, tenantId))
      .limit(1);
    if (!profile) throw new Error('Das Werkstattprofil fehlt. Bitte ergänze zuerst die Firmendaten.');

    const [customer] = await tx
      .select()
      .from(customers)
      .where(and(
        eq(customers.tenantId, tenantId),
        eq(customers.id, workOrder.customerId),
      ))
      .limit(1);
    if (!customer) throw new Error('Der Rechnungskunde wurde nicht gefunden.');

    const [vehicle] = await tx
      .select({ plate: vehicles.plate })
      .from(vehicles)
      .where(and(
        eq(vehicles.tenantId, tenantId),
        eq(vehicles.id, workOrder.vehicleId),
      ))
      .limit(1);

    const storedWorkOrderLines = await tx
      .select()
      .from(workOrderLines)
      .where(and(
        eq(workOrderLines.tenantId, tenantId),
        eq(workOrderLines.workOrderId, workOrderId),
      ))
      .orderBy(workOrderLines.position);
    if (storedWorkOrderLines.length === 0) {
      throw new Error('Der Werkstattauftrag enthält keine abrechenbaren Positionen.');
    }

    const taxRates = new Set(storedWorkOrderLines.map((line) => line.taxRateBp));
    if (taxRates.size !== 1) {
      throw new Error('Für einen Rechnungsentwurf müssen alle Positionen denselben Steuersatz haben.');
    }

    const now = new Date();
    const serviceDate = getDateStringInTimeZone(now, INVOICE_TIME_ZONE);
    const { invoice, storedLines } = await insertInvoiceDraft(
      tx,
      tenantId,
      customer,
      profile,
      workOrder.vehicleId,
      vehicle?.plate ?? null,
      workOrder.id,
      serviceDate,
      addDaysToDateString(serviceDate, 14),
      storedWorkOrderLines.map((line) => ({
        description: line.description,
        qtyMilli: line.qtyMilli,
        // labor is billed in hours, parts by the piece
        unitCode: unitForWorkOrderLine(line.kind),
        unitPriceCents: discountedUnitPriceCents(line.unitPriceCents, line.discountBp),
        taxRateBp: line.taxRateBp,
      })),
    );

    const [updatedWorkOrder] = await tx
      .update(workOrders)
      .set({ status: invoicedStatus })
      .where(and(
        eq(workOrders.tenantId, tenantId),
        eq(workOrders.id, workOrderId),
      ))
      .returning({ id: workOrders.id });
    if (!updatedWorkOrder) {
      throw new Error('Der Werkstattauftrag konnte nicht als abgerechnet markiert werden.');
    }

    return mapInvoice(invoice, customer.name, vehicle?.plate ?? null, storedLines, []);
  });
}

/**
 * Makes sure the invoice exists and is still a draft, then locks it for the change.
 *
 * Two steps on purpose: row-level security lets this role only "update" drafts, so a plain
 * SELECT ... FOR UPDATE does not see an issued or cancelled invoice at all and would look like
 * "not found" - the caller then reported success although nothing was changed. The plain SELECT
 * sees every status; the lock afterwards protects against issuing it in parallel.
 */
async function lockDraftInvoice(tx: UserTransaction, tenantId: string, id: string): Promise<void> {
  const where = and(eq(invoices.tenantId, tenantId), eq(invoices.id, id));
  const [existing] = await tx.select({ status: invoices.status }).from(invoices).where(where);
  if (!existing) throw new InvoiceNotFoundError();
  if (existing.status !== 'draft') throw new InvoiceNotEditableError();

  const [locked] = await tx.select({ status: invoices.status }).from(invoices).where(where).for('update');
  // issued by someone else between the two statements
  if (!locked || locked.status !== 'draft') throw new InvoiceNotEditableError();
}

export async function updateInvoice(
  tenantId: string,
  id: string,
  input: InvoiceInput,
): Promise<Invoice | null> {
  if (input.lines.length === 0) throw new RangeError('Eine Rechnung benötigt mindestens eine Position.');

  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    await lockDraftInvoice(tx, tenantId, id);

    const [profile] = await tx
      .select()
      .from(tenantProfiles)
      .where(eq(tenantProfiles.tenantId, tenantId))
      .limit(1);
    if (!profile) throw new Error('Das Werkstattprofil fehlt. Bitte ergänze zuerst die Firmendaten.');

    const [customer] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, input.customerId)))
      .limit(1);
    if (!customer) throw new Error('Der ausgewählte Kunde wurde nicht gefunden.');

    let vehicleId: string | null = null;
    let plate: string | null = null;
    if (input.vehicleId) {
      const [vehicle] = await tx
        .select({ id: vehicles.id, plate: vehicles.plate })
        .from(vehicles)
        .where(and(
          eq(vehicles.tenantId, tenantId),
          eq(vehicles.customerId, input.customerId),
          eq(vehicles.id, input.vehicleId),
        ))
        .limit(1);
      if (!vehicle) throw new Error('Das ausgewählte Fahrzeug gehört nicht zum Kunden.');
      vehicleId = vehicle.id;
      plate = vehicle.plate;
    }

    const [updatedInvoice] = await tx
      .update(invoices)
      .set({
        customerId: customer.id,
        vehicleId,
        serviceDate: input.serviceDate,
        dueDate: input.dueAt,
        sellerSnapshot: {
          companyName: profile.companyName,
          ownerName: profile.ownerName,
          street: profile.street,
          zip: profile.zip,
          city: profile.city,
          phone: profile.phone,
          email: profile.email,
          website: profile.website,
          taxNumber: profile.taxNumber,
          vatId: profile.vatId,
          bankName: profile.bankName,
          iban: profile.iban,
          bic: profile.bic,
        },
        buyerSnapshot: {
          name: customer.name,
          vehiclePlate: plate,
          email: customer.email,
          phone: customer.phone,
          street: customer.street,
          zip: customer.zip,
          city: customer.city,
        },
      })
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id)))
      .returning();
    if (!updatedInvoice) return null;

    await tx
      .delete(invoiceLines)
      .where(and(eq(invoiceLines.tenantId, tenantId), eq(invoiceLines.invoiceId, id)));
    const storedLines = await tx
      .insert(invoiceLines)
      .values(makeLineValues(input, tenantId, id))
      .returning();

    return mapInvoice(updatedInvoice, customer.name, plate, storedLines, []);
  });
}

export async function issueInvoice(tenantId: string, id: string, actorId?: string): Promise<string> {
  return issueInvoiceNumber(db, { tenantId, invoiceId: id, actorId });
}

/** Cancels an issued invoice with a Storno document (see invoice-cancel.ts). Owner and office only, checked by the caller. */
export async function cancelInvoice(
  tenantId: string,
  id: string,
  actorId?: string,
): Promise<InvoiceCancellationResult> {
  return cancelInvoiceDocument(db, { tenantId, invoiceId: id, actorId });
}

export async function deleteInvoice(tenantId: string, id: string): Promise<void> {
  await withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    await lockDraftInvoice(tx, tenantId, id);

    await tx
      .delete(invoiceLines)
      .where(and(eq(invoiceLines.tenantId, tenantId), eq(invoiceLines.invoiceId, id)));
    await tx
      .delete(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id)));
  });
}

export async function addPayment(
  tenantId: string,
  invoiceId: string,
  amount: number,
  paidAt: string,
): Promise<Payment> {
  const amountCents = euroToCents(amount);
  if (amountCents <= 0) throw new RangeError('Der Zahlungsbetrag muss größer als 0 sein.');

  const paymentDate = new Date(paidAt);
  if (Number.isNaN(paymentDate.getTime())) throw new RangeError('Das Zahlungsdatum ist ungültig.');

  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    // Serializes payments of one invoice so two at once cannot overpay it. SELECT ... FOR UPDATE cannot
    // be used here: row-level security only lets this role "update" drafts, so an issued invoice would
    // be invisible to it ("Die Rechnung wurde nicht gefunden").
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payment:${invoiceId}`}))`);
    const [invoice] = await tx
      .select({ status: invoices.status })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)));
    if (!invoice) throw new InvoiceNotFoundError();
    if (invoice.status !== 'issued') {
      throw new InvoiceNotEditableError('Zahlungen können nur für ausgestellte Rechnungen erfasst werden.');
    }

    const [storedLines, storedPayments] = await Promise.all([
      tx
        .select({
          qtyMilli: invoiceLines.qtyMilli,
          unitPriceCents: invoiceLines.unitPriceCents,
          taxRateBp: invoiceLines.taxRateBp,
        })
        .from(invoiceLines)
        .where(and(eq(invoiceLines.tenantId, tenantId), eq(invoiceLines.invoiceId, invoiceId))),
      tx
        .select({ amountCents: payments.amountCents })
        .from(payments)
        .where(and(eq(payments.tenantId, tenantId), eq(payments.invoiceId, invoiceId))),
    ]);
    const grossCents = invoiceTotals(storedLines.map((line) => ({
      qtyMilli: line.qtyMilli,
      unitPriceCents: line.unitPriceCents,
      taxRateBp: line.taxRateBp,
    }))).grossCents;
    const paidCents = storedPayments.reduce((sum, payment) => sum + payment.amountCents, 0);
    if (amountCents > grossCents - paidCents) {
      throw new InvoiceNotEditableError('Der Zahlungsbetrag überschreitet den offenen Rechnungsbetrag.');
    }

    const [payment] = await tx
      .insert(payments)
      .values({
        tenantId,
        invoiceId,
        amountCents,
        paidAt: paymentDate,
        method: 'bank_transfer',
      })
      .returning();
    if (!payment) throw new Error('Der Zahlungseingang konnte nicht gespeichert werden.');

    return {
      id: payment.id,
      invoiceId: payment.invoiceId,
      amount: payment.amountCents / 100,
      paidAt: payment.paidAt.toISOString(),
    };
  });
}

export async function getPayments(tenantId: string, invoiceId: string): Promise<Payment[]> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const rows = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.tenantId, tenantId), eq(payments.invoiceId, invoiceId)))
      .orderBy(desc(payments.paidAt));

    return rows.map((payment) => ({
      id: payment.id,
      invoiceId: payment.invoiceId,
      amount: payment.amountCents / 100,
      paidAt: payment.paidAt.toISOString(),
    }));
  });
}
