import 'server-only';

import { and, asc, eq, sql } from 'drizzle-orm';
import { absences, tenantProfiles } from '../../db/schema';
import { assertTenantContext, withTenant } from '../../db/with-tenant';
import type { Absence, AbsenceInput, AbsenceType } from '../absences';
import { DEFAULT_CALENDAR_SETTINGS, parseCalendarSettings, type CalendarSettings } from '../calendar-settings';
import { getDatabaseErrorCode } from '../db-error';

const PG_FOREIGN_KEY_VIOLATION = '23503';

export class InvalidAbsenceMechanicError extends Error {
  constructor() {
    super('Der ausgewählte Mitarbeiter gehört nicht zu dieser Werkstatt.');
    this.name = 'InvalidAbsenceMechanicError';
  }
}

export class WorkshopProfileMissingError extends Error {
  constructor() {
    super('Bitte speichere zuerst die Werkstattdaten unter „Einstellungen“.');
    this.name = 'WorkshopProfileMissingError';
  }
}

function mapAbsence(row: typeof absences.$inferSelect): Absence {
  return {
    id: row.id,
    mechanicId: row.mechanicId,
    startDate: row.startDate,
    endDate: row.endDate,
    type: row.type as AbsenceType,
    note: row.note ?? undefined,
  };
}

/**
 * Hours and Bundesland of the workshop. Read through a database function so that mechanics,
 * who may not read tenant_profiles (IBAN, tax data), can still see the calendar correctly.
 */
export async function getCalendarSettings(tenantId: string): Promise<CalendarSettings> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const rows = await tx.execute(sql`
      SELECT bundesland, work_start, work_end, lunch_start, lunch_end
      FROM public.get_tenant_calendar_settings(${tenantId}::uuid)
    `);
    const row = rows[0];
    if (!row) return DEFAULT_CALENDAR_SETTINGS;

    return parseCalendarSettings({
      bundesland: row.bundesland,
      workStart: row.work_start,
      workEnd: row.work_end,
      lunchStart: row.lunch_start,
      lunchEnd: row.lunch_end,
    });
  });
}

export async function saveCalendarSettings(tenantId: string, settings: CalendarSettings): Promise<void> {
  await withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const updated = await tx
      .update(tenantProfiles)
      .set({
        bundesland: settings.bundesland,
        workStart: settings.workStart,
        workEnd: settings.workEnd,
        lunchStart: settings.lunchStart,
        lunchEnd: settings.lunchEnd,
        calendarConfirmedAt: new Date(),
      })
      .where(eq(tenantProfiles.tenantId, tenantId))
      .returning({ id: tenantProfiles.id });

    if (updated.length === 0) throw new WorkshopProfileMissingError();
  });
}

export async function getAbsences(tenantId: string): Promise<Absence[]> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const rows = await tx
      .select()
      .from(absences)
      .where(eq(absences.tenantId, tenantId))
      .orderBy(asc(absences.startDate), asc(absences.id));
    return rows.map(mapAbsence);
  });
}

export async function createAbsence(tenantId: string, input: AbsenceInput): Promise<Absence> {
  try {
    return await withTenant(async (tx, context) => {
      assertTenantContext(tenantId, context);
      const [row] = await tx
        .insert(absences)
        .values({
          tenantId,
          mechanicId: input.mechanicId,
          startDate: input.startDate,
          endDate: input.endDate,
          type: input.type,
          note: input.note ?? null,
        })
        .returning();
      if (!row) throw new Error('Die Abwesenheit konnte nicht angelegt werden.');
      return mapAbsence(row);
    });
  } catch (error) {
    if (getDatabaseErrorCode(error) === PG_FOREIGN_KEY_VIOLATION) throw new InvalidAbsenceMechanicError();
    throw error;
  }
}

export async function deleteAbsence(tenantId: string, id: string): Promise<void> {
  await withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    await tx.delete(absences).where(and(eq(absences.tenantId, tenantId), eq(absences.id, id)));
  });
}
