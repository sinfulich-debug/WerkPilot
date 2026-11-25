import 'server-only';

import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { customers, vehicles } from '../../db/schema';
import { assertTenantContext, withTenant } from '../../db/with-tenant';
import { planImport, type ImportRow } from '../customer-import';

export type ImportResult = {
  newCustomers: number;
  existingCustomers: number;
  newVehicles: number;
  skippedVehicles: number;
  invalidRows: number;
};

const CHUNK = 500;

function chunks<T>(items: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += CHUNK) result.push(items.slice(index, index + CHUNK));
  return result;
}

/**
 * Saves checked import rows in ONE transaction: either everything is created or nothing.
 * Existing customers (same e-mail, or same name and phone) are not changed; their new vehicles are attached.
 * Vehicles whose plate already exists (also archived ones) are skipped. Imported customers get no reminder
 * consent: that must be recorded separately (DSGVO).
 */
export async function importCustomers(tenantId: string, rows: readonly ImportRow[]): Promise<ImportResult> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);

    // Serialize imports of one workshop, so two parallel imports cannot both create the same customer.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`customer-import:${tenantId}`}))`);

    const existingCustomers = await tx
      .select({ id: customers.id, name: customers.name, email: customers.email, phone: customers.phone })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), isNull(customers.archivedAt)));
    const existingPlates = await tx
      .select({ plate: vehicles.plate })
      .from(vehicles)
      .where(eq(vehicles.tenantId, tenantId));

    const plan = planImport(rows, {
      customers: existingCustomers,
      plates: existingPlates.map((row) => row.plate),
    });

    const customerValues: (typeof customers.$inferInsert)[] = [];
    const vehicleValues: (typeof vehicles.$inferInsert)[] = [];
    for (const entry of plan.customers) {
      let customerId = entry.existingId;
      if (!customerId) {
        customerId = randomUUID();
        customerValues.push({
          id: customerId,
          tenantId,
          name: entry.data.name,
          phone: entry.data.phone,
          email: entry.data.email || null,
          street: entry.data.street || null,
          zip: entry.data.zip || null,
          city: entry.data.city || null,
          notes: entry.data.notes || null,
        });
      }
      for (const vehicle of entry.vehicles) {
        vehicleValues.push({
          tenantId,
          customerId,
          plate: vehicle.plate,
          make: vehicle.make,
          model: vehicle.model,
          vin: vehicle.vin,
          hsn: vehicle.hsn,
          tsn: vehicle.tsn,
          year: vehicle.year,
          huDueDate: vehicle.huDueDate,
        });
      }
    }

    for (const part of chunks(customerValues)) await tx.insert(customers).values(part);
    for (const part of chunks(vehicleValues)) await tx.insert(vehicles).values(part);

    return {
      newCustomers: plan.newCustomers,
      existingCustomers: plan.existingCustomers,
      newVehicles: plan.newVehicles,
      skippedVehicles: plan.skippedVehicles,
      invalidRows: plan.invalidRows,
    };
  });
}
