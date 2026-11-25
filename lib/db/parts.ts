import 'server-only';

import { and, asc, eq, isNull } from 'drizzle-orm';
import { parts, stockMovements } from '../../db/schema';
import { assertTenantContext, withTenant } from '../../db/with-tenant';
import type { UserTransaction } from '../../db/with-user';
import type { Part, PartInput } from '../parts';
import { assertStockAdjustmentAllowed } from '../stock';
import { getReservedQuantities, getStockBalances, lockParts } from './stock';

export class PartNotFoundError extends Error {
  constructor() {
    super('Das Ersatzteil wurde nicht gefunden.');
    this.name = 'PartNotFoundError';
  }
}

export class PartNotArchivableError extends Error {
  constructor() {
    super('Ersatzteile mit Bestand oder Reservierungen können nicht archiviert werden.');
    this.name = 'PartNotArchivableError';
  }
}

function assertPartInput(input: PartInput): void {
  if (!input.sku.trim() || !input.name.trim()) {
    throw new RangeError('Artikelnummer und Bezeichnung dürfen nicht leer sein.');
  }
  for (const [label, value] of [
    ['Einkaufspreis', input.purchasePriceCents],
    ['Verkaufspreis', input.salePriceCents],
    ['Mindestbestand', input.minStockMilli],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
      throw new RangeError(`${label} ist ungültig.`);
    }
  }
}

async function mapPartRows(
  tx: UserTransaction,
  tenantId: string,
  rows: (typeof parts.$inferSelect)[],
): Promise<Part[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [balances, reservations] = await Promise.all([
    getStockBalances(tx, tenantId, ids),
    getReservedQuantities(tx, tenantId, ids),
  ]);
  return rows.map((row) => {
    const stockMilli = balances.get(row.id) ?? 0;
    const reservedMilli = reservations.get(row.id) ?? 0;
    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      purchasePriceCents: row.purchasePriceCents,
      salePriceCents: row.salePriceCents,
      minStockMilli: row.minStockMilli,
      stockMilli,
      reservedMilli,
      availableMilli: stockMilli - reservedMilli,
      archivedAt: row.archivedAt?.toISOString() ?? null,
    };
  });
}

async function getPartResult(
  tx: UserTransaction,
  tenantId: string,
  part: typeof parts.$inferSelect,
): Promise<Part> {
  const [mapped] = await mapPartRows(tx, tenantId, [part]);
  if (!mapped) throw new Error('Das Ersatzteil konnte nicht geladen werden.');
  return mapped;
}

export async function getParts(tenantId: string): Promise<Part[]> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const rows = await tx
      .select()
      .from(parts)
      .where(and(eq(parts.tenantId, tenantId), isNull(parts.archivedAt)))
      .orderBy(asc(parts.sku));
    return mapPartRows(tx, tenantId, rows);
  });
}

export async function createPart(
  tenantId: string,
  input: PartInput,
  openingStockMilli: number,
): Promise<Part> {
  assertPartInput(input);
  if (
    !Number.isSafeInteger(openingStockMilli) ||
    openingStockMilli < 0 ||
    openingStockMilli > 2_147_483_647
  ) {
    throw new RangeError('Der Anfangsbestand ist ungültig.');
  }

  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const [part] = await tx
      .insert(parts)
      .values({
        tenantId,
        sku: input.sku.trim(),
        name: input.name.trim(),
        purchasePriceCents: input.purchasePriceCents,
        salePriceCents: input.salePriceCents,
        minStockMilli: input.minStockMilli,
      })
      .returning();
    if (!part) throw new Error('Das Ersatzteil konnte nicht angelegt werden.');

    if (openingStockMilli > 0) {
      await tx.insert(stockMovements).values({
        tenantId,
        partId: part.id,
        qtyMilli: openingStockMilli,
        reason: 'purchase',
        workOrderLineId: null,
      });
    }
    return getPartResult(tx, tenantId, part);
  });
}

export async function updatePart(
  tenantId: string,
  id: string,
  input: PartInput,
): Promise<Part | null> {
  assertPartInput(input);
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const [updated] = await tx
      .update(parts)
      .set({
        sku: input.sku.trim(),
        name: input.name.trim(),
        purchasePriceCents: input.purchasePriceCents,
        salePriceCents: input.salePriceCents,
        minStockMilli: input.minStockMilli,
      })
      .where(and(eq(parts.tenantId, tenantId), eq(parts.id, id), isNull(parts.archivedAt)))
      .returning();
    return updated ? getPartResult(tx, tenantId, updated) : null;
  });
}

export async function recordStockMovement(
  tenantId: string,
  partId: string,
  qtyMilli: number,
  reason: 'purchase' | 'correction',
): Promise<Part> {
  if (!Number.isSafeInteger(qtyMilli) || qtyMilli === 0 || Math.abs(qtyMilli) > 2_147_483_647) {
    throw new RangeError('Die Bestandsbewegung muss eine von 0 verschiedene ganze Menge sein.');
  }
  if (reason === 'purchase' && qtyMilli < 0) {
    throw new RangeError('Ein Wareneingang muss eine positive Menge haben.');
  }

  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const [part] = await lockParts(tx, tenantId, [partId]);
    if (!part || part.archivedAt) throw new PartNotFoundError();

    const [balances, reservations] = await Promise.all([
      getStockBalances(tx, tenantId, [partId]),
      getReservedQuantities(tx, tenantId, [partId]),
    ]);
    const onHandMilli = balances.get(partId) ?? 0;
    const reservedMilli = reservations.get(partId) ?? 0;
    assertStockAdjustmentAllowed(part.name, onHandMilli, reservedMilli, qtyMilli);

    await tx.insert(stockMovements).values({
      tenantId,
      partId,
      qtyMilli,
      reason,
      workOrderLineId: null,
    });
    return getPartResult(tx, tenantId, part);
  });
}

export async function archivePart(tenantId: string, id: string): Promise<boolean> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const [part] = await lockParts(tx, tenantId, [id]);
    if (!part || part.archivedAt) return false;
    const [balances, reservations] = await Promise.all([
      getStockBalances(tx, tenantId, [id]),
      getReservedQuantities(tx, tenantId, [id]),
    ]);
    if ((balances.get(id) ?? 0) !== 0 || (reservations.get(id) ?? 0) !== 0) {
      throw new PartNotArchivableError();
    }
    const [archived] = await tx.update(parts)
      .set({ archivedAt: new Date() })
      .where(and(eq(parts.tenantId, tenantId), eq(parts.id, id)))
      .returning({ id: parts.id });
    if (!archived) throw new Error('Das Ersatzteil konnte nicht archiviert werden.');
    return true;
  });
}

export async function ensurePartsExist(
  tx: UserTransaction,
  tenantId: string,
  partIds: readonly string[],
): Promise<Map<string, typeof parts.$inferSelect>> {
  if (partIds.length === 0) return new Map();
  const rows = await lockParts(tx, tenantId, partIds);
  const result = new Map(rows.filter((part) => !part.archivedAt).map((part) => [part.id, part]));
  if (result.size !== new Set(partIds).size) throw new PartNotFoundError();
  return result;
}
