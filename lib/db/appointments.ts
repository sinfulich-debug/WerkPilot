import 'server-only';

import { and, asc, eq, sql } from 'drizzle-orm';
import { appointments } from '../../db/schema';
import type { UserTransaction } from '../../db/with-user';
import {
  mapStatusToTone,
  type AppointmentMechanic,
  type Appointment,
  type AppointmentForm,
} from '../appointments';
import { assertTenantContext, withTenant } from '../../db/with-tenant';
import { getDatabaseErrorCode, PG_EXCLUSION_VIOLATION } from '../db-error';

export class AppointmentConflictError extends Error {
  constructor() {
    super('Der Termin überschneidet sich mit einem anderen Termin am selben Arbeitsplatz oder beim selben Mechaniker.');
    this.name = 'AppointmentConflictError';
  }
}

export class InvalidAppointmentMechanicError extends Error {
  constructor() {
    super('Der ausgewählte Mechaniker gehört nicht zu dieser Werkstatt.');
    this.name = 'InvalidAppointmentMechanicError';
  }
}

async function withConflictHandling<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (getDatabaseErrorCode(error) === PG_EXCLUSION_VIOLATION) throw new AppointmentConflictError();
    throw error;
  }
}

async function assertMechanicBelongsToTenant(
  tx: UserTransaction,
  tenantId: string,
  mechanicId?: string,
): Promise<void> {
  if (!mechanicId) return;

  const mechanics = await tx.execute(sql<{ user_id: string }>`
    SELECT user_id
    FROM public.get_tenant_mechanics(${tenantId}::uuid)
    WHERE user_id = ${mechanicId}::uuid
    LIMIT 1
  `);
  if (!mechanics[0]) throw new InvalidAppointmentMechanicError();
}

function mapAppointment(row: typeof appointments.$inferSelect): Appointment {
  return {
    id: row.id,
    date: row.date,
    durationMinutes: row.durationMinutes,
    bay: row.bay,
    mechanicId: row.mechanicId ?? undefined,
    customerId: row.customerId ?? undefined,
    vehicleId: row.vehicleId ?? undefined,
    time: row.time,
    customer: row.customer,
    vehicle: row.vehicle,
    plate: row.plate,
    vehicleYear: row.vehicleYear ?? undefined,
    hsn: row.hsn ?? undefined,
    tsn: row.tsn ?? undefined,
    vin: row.vin ?? undefined,
    engine: row.engine ?? undefined,
    tuvIntervalMonths: row.tuvIntervalMonths ?? undefined,
    tuvDueDate: row.tuvDueDate ?? undefined,
    reason: row.reason,
    status: row.status,
    tone: mapStatusToTone(row.status),
  };
}

function appointmentValues(form: AppointmentForm) {
  return {
    date: form.date,
    time: form.time,
    durationMinutes: form.durationMinutes,
    bay: form.bay.trim(),
    mechanicId: form.mechanicId || null,
    customerId: form.customerId || null,
    vehicleId: form.vehicleId || null,
    customer: form.customer.trim(),
    vehicle: form.vehicle.trim(),
    plate: form.plate.trim(),
    vehicleYear: form.vehicleYear ?? null,
    hsn: form.hsn?.trim() || null,
    tsn: form.tsn?.trim() || null,
    vin: form.vin?.trim() || null,
    engine: form.engine?.trim() || null,
    tuvIntervalMonths: form.tuvIntervalMonths ?? null,
    tuvDueDate: form.tuvDueDate || null,
    reason: form.reason.trim() || 'Service',
    status: form.status,
  };
}

export async function getAppointments(tenantId: string): Promise<Appointment[]> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const rows = await tx
      .select()
      .from(appointments)
      .where(eq(appointments.tenantId, tenantId))
      .orderBy(asc(appointments.date), asc(appointments.time));

    return rows.map(mapAppointment);
  });
}

export async function getAppointmentMechanics(tenantId: string): Promise<AppointmentMechanic[]> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const rows = await tx.execute(sql<{ user_id: string; display_name: string }>`
      SELECT user_id, display_name
      FROM public.get_tenant_mechanics(${tenantId}::uuid)
    `);

    return rows.map((row) => {
      if (typeof row.user_id !== 'string' || typeof row.display_name !== 'string') {
        throw new Error('Die Mechanikerdaten haben ein ungültiges Datenbankformat.');
      }
      return { id: row.user_id, name: row.display_name };
    });
  });
}

export async function createAppointment(
  tenantId: string,
  form: AppointmentForm,
): Promise<Appointment> {
  return withConflictHandling(() =>
    withTenant(async (tx, context) => {
      assertTenantContext(tenantId, context);
      await assertMechanicBelongsToTenant(tx, tenantId, form.mechanicId);
      const [row] = await tx
        .insert(appointments)
        .values({ tenantId, ...appointmentValues(form) })
        .returning();

      if (!row) throw new Error('Der Termin konnte nicht angelegt werden.');
      return mapAppointment(row);
    }),
  );
}

export async function updateAppointment(
  tenantId: string,
  id: string,
  form: AppointmentForm,
): Promise<Appointment | null> {
  return withConflictHandling(() =>
    withTenant(async (tx, context) => {
      assertTenantContext(tenantId, context);
      await assertMechanicBelongsToTenant(tx, tenantId, form.mechanicId);
      const [row] = await tx
        .update(appointments)
        .set(appointmentValues(form))
        .where(and(eq(appointments.tenantId, tenantId), eq(appointments.id, id)))
        .returning();

      return row ? mapAppointment(row) : null;
    }),
  );
}

export async function deleteAppointment(tenantId: string, id: string): Promise<void> {
  await withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    await tx
      .delete(appointments)
      .where(and(eq(appointments.tenantId, tenantId), eq(appointments.id, id)));
  });
}
