import 'server-only';

import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { customers, vehicles } from '../../db/schema';
import { assertTenantContext, withTenant } from '../../db/with-tenant';
import { getTodayDateString, type Customer, type CustomerInput, type Vehicle, type VehicleInput } from '../customers';
import { isConsentSource, type ConsentSource } from '../reminder-consent';

function mapCustomer(row: typeof customers.$inferSelect): Customer {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone ?? '',
    email: row.email ?? '',
    notes: row.notes ?? undefined,
    archivedAt: row.archivedAt?.toISOString(),
    reminderConsentAt: row.reminderConsentAt?.toISOString(),
    reminderConsentSource: isConsentSource(row.reminderConsentSource) ? row.reminderConsentSource : undefined,
    reminderOptOutAt: row.reminderOptOutAt?.toISOString(),
  };
}

function mapVehicle(row: typeof vehicles.$inferSelect): Vehicle {
  if (!row.huDueDate) {
    throw new Error(`Für Fahrzeug ${row.id} ist kein HU-Fälligkeitsdatum hinterlegt.`);
  }

  return {
    id: row.id,
    customerId: row.customerId,
    make: [row.make, row.model].filter(Boolean).join(' '),
    plate: row.plate,
    tuvDueDate: row.huDueDate,
    year: row.year ?? undefined,
    hsn: row.hsn ?? undefined,
    tsn: row.tsn ?? undefined,
    vin: row.vin ?? undefined,
    engine: row.engine ?? undefined,
    tuvIntervalMonths: row.tuvIntervalMonths ?? undefined,
    lastReminderSentAt: row.lastReminderSentAt ?? undefined,
    archivedAt: row.archivedAt?.toISOString(),
  };
}

function customerValues(input: CustomerInput) {
  return {
    name: input.name.trim(),
    phone: input.phone.trim(),
    email: input.email.trim() || null,
    notes: input.notes?.trim() || null,
  };
}

function vehicleValues(input: VehicleInput) {
  return {
    customerId: input.customerId,
    make: input.make.trim(),
    model: '',
    plate: input.plate.trim(),
    vin: input.vin?.trim() || null,
    year: input.year ?? null,
    hsn: input.hsn?.trim() || null,
    tsn: input.tsn?.trim() || null,
    engine: input.engine?.trim() || null,
    huDueDate: input.tuvDueDate,
    tuvIntervalMonths: input.tuvIntervalMonths ?? null,
  };
}

export async function getCustomers(tenantId: string): Promise<Customer[]> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const rows = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), isNull(customers.archivedAt)))
      .orderBy(asc(customers.name));

    return rows.map(mapCustomer);
  });
}

export async function getVehicles(tenantId: string): Promise<Vehicle[]> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const rows = await tx
      .select()
      .from(vehicles)
      .innerJoin(
        customers,
        and(eq(customers.tenantId, vehicles.tenantId), eq(customers.id, vehicles.customerId)),
      )
      .where(and(
        eq(vehicles.tenantId, tenantId),
        isNull(vehicles.archivedAt),
        isNull(customers.archivedAt),
      ))
      .orderBy(asc(vehicles.huDueDate));

    return rows.map(({ vehicles: vehicle }) => mapVehicle(vehicle));
  });
}

export async function getArchivedCustomers(tenantId: string): Promise<Customer[]> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const rows = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), isNotNull(customers.archivedAt)))
      .orderBy(asc(customers.name));

    return rows.map(mapCustomer);
  });
}

export async function getArchivedVehicles(tenantId: string): Promise<Vehicle[]> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const rows = await tx
      .select({ vehicle: vehicles })
      .from(vehicles)
      .innerJoin(
        customers,
        and(eq(customers.tenantId, vehicles.tenantId), eq(customers.id, vehicles.customerId)),
      )
      .where(and(
        eq(vehicles.tenantId, tenantId),
        isNotNull(vehicles.archivedAt),
        isNull(customers.archivedAt),
      ))
      .orderBy(asc(vehicles.huDueDate));

    return rows.map(({ vehicle }) => mapVehicle(vehicle));
  });
}

export async function createCustomer(tenantId: string, input: CustomerInput): Promise<Customer> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const [row] = await tx
      .insert(customers)
      .values({ tenantId, ...customerValues(input) })
      .returning();

    if (!row) throw new Error('Der Kunde konnte nicht angelegt werden.');
    return mapCustomer(row);
  });
}

export async function updateCustomer(
  tenantId: string,
  id: string,
  input: CustomerInput,
): Promise<Customer | null> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const [row] = await tx
      .update(customers)
      .set(customerValues(input))
      .where(and(
        eq(customers.tenantId, tenantId),
        eq(customers.id, id),
        isNull(customers.archivedAt),
      ))
      .returning();

    return row ? mapCustomer(row) : null;
  });
}

export async function deleteCustomer(tenantId: string, id: string): Promise<void> {
  await withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    await tx
      .update(customers)
      .set({ archivedAt: new Date() })
      .where(and(
        eq(customers.tenantId, tenantId),
        eq(customers.id, id),
        isNull(customers.archivedAt),
      ));
  });
}

export async function restoreCustomer(tenantId: string, id: string): Promise<boolean> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const [customer] = await tx
      .update(customers)
      .set({ archivedAt: null })
      .where(and(
        eq(customers.tenantId, tenantId),
        eq(customers.id, id),
        isNotNull(customers.archivedAt),
      ))
      .returning({ id: customers.id });

    return Boolean(customer);
  });
}

export async function createVehicle(tenantId: string, input: VehicleInput): Promise<Vehicle> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const [activeCustomer] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(
        eq(customers.tenantId, tenantId),
        eq(customers.id, input.customerId),
        isNull(customers.archivedAt),
      ))
      .limit(1);
    if (!activeCustomer) throw new Error('Der ausgewählte Kunde ist nicht verfügbar.');

    const [row] = await tx
      .insert(vehicles)
      .values({ tenantId, ...vehicleValues(input) })
      .returning();

    if (!row) throw new Error('Das Fahrzeug konnte nicht angelegt werden.');
    return mapVehicle(row);
  });
}

export async function updateVehicle(
  tenantId: string,
  id: string,
  input: VehicleInput,
): Promise<Vehicle | null> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const [existing] = await tx
      .select({ huDueDate: vehicles.huDueDate })
      .from(vehicles)
      .where(and(
        eq(vehicles.tenantId, tenantId),
        eq(vehicles.id, id),
        isNull(vehicles.archivedAt),
      ))
      .for('update');

    if (!existing) return null;

    const [activeCustomer] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(
        eq(customers.tenantId, tenantId),
        eq(customers.id, input.customerId),
        isNull(customers.archivedAt),
      ))
      .limit(1);
    if (!activeCustomer) throw new Error('Der ausgewählte Kunde ist nicht verfügbar.');

    const [row] = await tx
      .update(vehicles)
      .set({
        ...vehicleValues(input),
        ...(existing.huDueDate !== input.tuvDueDate ? { lastReminderSentAt: null } : {}),
      })
      .where(and(
        eq(vehicles.tenantId, tenantId),
        eq(vehicles.id, id),
        isNull(vehicles.archivedAt),
      ))
      .returning();

    return row ? mapVehicle(row) : null;
  });
}

export async function markReminderSent(tenantId: string, vehicleId: string): Promise<void> {
  await withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    await tx
      .update(vehicles)
      .set({ lastReminderSentAt: getTodayDateString() })
      .where(and(eq(vehicles.tenantId, tenantId), eq(vehicles.id, vehicleId)));
  });
}

/** Staff record that the customer agreed to HU reminders. Returns false when the customer is not found. */
export async function recordReminderConsent(
  tenantId: string,
  customerId: string,
  source: ConsentSource,
): Promise<boolean> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const rows = await tx
      .update(customers)
      .set({ reminderConsentAt: new Date(), reminderConsentSource: source })
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId), isNull(customers.archivedAt)))
      .returning({ id: customers.id });
    return rows.length > 0;
  });
}

/** Staff record that the customer withdrew consent (STOP). The consent record stays for the audit trail. */
export async function recordReminderOptOut(tenantId: string, customerId: string): Promise<boolean> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const rows = await tx
      .update(customers)
      .set({ reminderOptOutAt: new Date() })
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId), isNull(customers.archivedAt)))
      .returning({ id: customers.id });
    return rows.length > 0;
  });
}

export async function deleteVehicle(tenantId: string, id: string): Promise<void> {
  await withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    await tx
      .update(vehicles)
      .set({ archivedAt: new Date() })
      .where(and(
        eq(vehicles.tenantId, tenantId),
        eq(vehicles.id, id),
        isNull(vehicles.archivedAt),
      ));
  });
}

export async function restoreVehicle(tenantId: string, id: string): Promise<boolean> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const [activeCustomer] = await tx
      .select({ id: customers.id })
      .from(customers)
      .innerJoin(
        vehicles,
        and(eq(vehicles.tenantId, customers.tenantId), eq(vehicles.customerId, customers.id)),
      )
      .where(and(
        eq(vehicles.tenantId, tenantId),
        eq(vehicles.id, id),
        isNull(customers.archivedAt),
      ))
      .limit(1);
    if (!activeCustomer) return false;

    const [vehicle] = await tx
      .update(vehicles)
      .set({ archivedAt: null })
      .where(and(
        eq(vehicles.tenantId, tenantId),
        eq(vehicles.id, id),
        isNotNull(vehicles.archivedAt),
      ))
      .returning({ id: vehicles.id });

    return Boolean(vehicle);
  });
}
