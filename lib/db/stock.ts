import 'server-only';

import { and, asc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { parts, stockMovements, workOrderLines, workOrders } from '../../db/schema';
import type { UserTransaction } from '../../db/with-user';

export async function lockParts(
  tx: UserTransaction,
  tenantId: string,
  partIds: readonly string[],
) {
  if (partIds.length === 0) return [];
  return tx
    .select()
    .from(parts)
    .where(and(eq(parts.tenantId, tenantId), inArray(parts.id, Array.from(new Set(partIds)))))
    .orderBy(asc(parts.id))
    .for('update');
}

export async function getStockBalances(
  tx: UserTransaction,
  tenantId: string,
  partIds: readonly string[],
): Promise<Map<string, number>> {
  const balances = new Map(partIds.map((id) => [id, 0]));
  if (partIds.length === 0) return balances;

  const movements = await tx
    .select({ partId: stockMovements.partId, qtyMilli: stockMovements.qtyMilli })
    .from(stockMovements)
    .where(and(
      eq(stockMovements.tenantId, tenantId),
      inArray(stockMovements.partId, Array.from(new Set(partIds))),
    ));
  for (const movement of movements) {
    balances.set(movement.partId, (balances.get(movement.partId) ?? 0) + movement.qtyMilli);
  }
  return balances;
}

export async function getReservedQuantities(
  tx: UserTransaction,
  tenantId: string,
  partIds: readonly string[],
  excludeWorkOrderId?: string,
): Promise<Map<string, number>> {
  const reservations = new Map(partIds.map((id) => [id, 0]));
  if (partIds.length === 0) return reservations;

  const conditions = [
    eq(workOrderLines.tenantId, tenantId),
    inArray(workOrderLines.partId, Array.from(new Set(partIds))),
    isNotNull(workOrderLines.partId),
    eq(workOrders.status, 'approved'),
  ];
  if (excludeWorkOrderId) conditions.push(ne(workOrders.id, excludeWorkOrderId));

  const rows = await tx
    .select({ partId: workOrderLines.partId, qtyMilli: workOrderLines.qtyMilli })
    .from(workOrderLines)
    .innerJoin(
      workOrders,
      and(
        eq(workOrders.tenantId, workOrderLines.tenantId),
        eq(workOrders.id, workOrderLines.workOrderId),
      ),
    )
    .where(and(...conditions));

  for (const row of rows) {
    if (row.partId) {
      reservations.set(row.partId, (reservations.get(row.partId) ?? 0) + row.qtyMilli);
    }
  }
  return reservations;
}
