import 'server-only';

import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { tireStorages } from '../../db/schema';
import { assertTenantContext, withTenant } from '../../db/with-tenant';
import { getDateStringInTimeZone, INVOICE_TIME_ZONE } from '../date';
import { getDatabaseErrorCode, PG_UNIQUE_VIOLATION } from '../db-error';
import { isTireSeason, type TireStorage, type TireStorageInput } from '../tire-storage';

export class TireStorageNotFoundError extends Error {
  constructor(message = 'Der Reifensatz wurde nicht gefunden.') {
    super(message);
    this.name = 'TireStorageNotFoundError';
  }
}

export class SlotTakenError extends Error {
  constructor(message = 'Dieser Lagerplatz ist bereits belegt.') {
    super(message);
    this.name = 'SlotTakenError';
  }
}

/** Released sets stay visible as history, but the list is capped so it stays small. */
const MAX_RELEASED = 100;

function mapRow(row: typeof tireStorages.$inferSelect): TireStorage {
  return {
    id: row.id,
    customerId: row.customerId,
    vehicleId: row.vehicleId ?? undefined,
    slot: row.slot,
    season: isTireSeason(row.season) ? row.season : 'allseason',
    description: row.description,
    treadDepthTenthMm: row.treadDepthTenthMm ?? undefined,
    storedAt: row.storedAt,
    releasedAt: row.releasedAt ?? undefined,
    lastReminderSentAt: row.lastReminderSentAt ?? undefined,
    notes: row.notes ?? undefined,
  };
}

function values(input: TireStorageInput) {
  return {
    customerId: input.customerId,
    vehicleId: input.vehicleId ?? null,
    slot: input.slot,
    season: input.season,
    description: input.description,
    treadDepthTenthMm: input.treadDepthTenthMm ?? null,
    storedAt: input.storedAt,
    notes: input.notes ?? null,
  };
}

function today(): string {
  return getDateStringInTimeZone(new Date(), INVOICE_TIME_ZONE);
}

/** A second active set in the same slot hits the partial unique index. */
function rethrowSlotTaken(error: unknown): never {
  if (getDatabaseErrorCode(error) === PG_UNIQUE_VIOLATION) throw new SlotTakenError();
  throw error;
}

export async function listTireStorages(tenantId: string): Promise<TireStorage[]> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const active = await tx
      .select()
      .from(tireStorages)
      .where(and(eq(tireStorages.tenantId, tenantId), isNull(tireStorages.releasedAt)))
      .orderBy(asc(tireStorages.slot));
    const history = await tx
      .select()
      .from(tireStorages)
      .where(and(eq(tireStorages.tenantId, tenantId), isNotNull(tireStorages.releasedAt)))
      .orderBy(desc(tireStorages.releasedAt), desc(tireStorages.createdAt))
      .limit(MAX_RELEASED);
    return [...active, ...history].map(mapRow);
  });
}

export async function createTireStorage(tenantId: string, input: TireStorageInput): Promise<TireStorage> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    try {
      const [row] = await tx
        .insert(tireStorages)
        .values({ tenantId, ...values(input), createdBy: context.userId })
        .returning();
      if (!row) throw new Error('Der Reifensatz konnte nicht angelegt werden.');
      return mapRow(row);
    } catch (error) {
      return rethrowSlotTaken(error);
    }
  });
}

/** Only sets that are still in storage can be changed; a released set is history. */
export async function updateTireStorage(tenantId: string, id: string, input: TireStorageInput): Promise<TireStorage> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    try {
      const [row] = await tx
        .update(tireStorages)
        .set(values(input))
        .where(and(eq(tireStorages.tenantId, tenantId), eq(tireStorages.id, id), isNull(tireStorages.releasedAt)))
        .returning();
      if (!row) throw new TireStorageNotFoundError();
      return mapRow(row);
    } catch (error) {
      return rethrowSlotTaken(error);
    }
  });
}

/** The wheels leave the storage (customer picked them up). The row stays as history. */
export async function releaseTireStorage(tenantId: string, id: string): Promise<void> {
  await withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const rows = await tx
      .update(tireStorages)
      .set({ releasedAt: today() })
      .where(and(eq(tireStorages.tenantId, tenantId), eq(tireStorages.id, id), isNull(tireStorages.releasedAt)))
      .returning({ id: tireStorages.id });
    if (rows.length === 0) throw new TireStorageNotFoundError();
  });
}

export async function markTireReminderSent(tenantId: string, id: string): Promise<void> {
  await withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const rows = await tx
      .update(tireStorages)
      .set({ lastReminderSentAt: today() })
      .where(and(eq(tireStorages.tenantId, tenantId), eq(tireStorages.id, id), isNull(tireStorages.releasedAt)))
      .returning({ id: tireStorages.id });
    if (rows.length === 0) throw new TireStorageNotFoundError();
  });
}
